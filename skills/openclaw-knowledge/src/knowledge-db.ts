/**
 * knowledge-db.ts
 *
 * Manages the centralized SQLite database for the gamma-knowledge skill.
 * Handles:
 *  - `better-sqlite3` initialization with WAL journal mode
 *  - Dynamic `sqlite-vec` extension loading (platform detection + env fallback)
 *  - Idempotent DDL: core table, FTS5 shadow table, vec0 table, sync triggers
 *  - Forward-only schema versioning
 *
 * This module is completely framework-agnostic.
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_DATA_DIR = resolve(homedir(), '.openclaw', 'data');
const DEFAULT_EXT_DIR = resolve(homedir(), '.openclaw', 'extensions');
const DB_FILENAME = 'knowledge.db';
const CURRENT_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// Platform → extension file mapping
// ---------------------------------------------------------------------------

const EXTENSION_MAP: Record<string, string> = {
  'darwin-arm64': 'vec0.dylib',
  'darwin-x64': 'vec0.dylib',
  'linux-x64': 'vec0.so',
  'linux-arm64': 'vec0.so',
  'win32-x64': 'vec0.dll',
};

function resolveExtensionPath(): string {
  // 1. Explicit env override (highest priority)
  const envPath = process.env['SQLITE_VEC_PATH'];
  if (envPath) {
    return envPath;
  }

  // 2. Platform-specific auto-detection
  const extDir = process.env['OPENCLAW_EXTENSIONS_DIR'] ?? DEFAULT_EXT_DIR;
  const platformKey = `${process.platform}-${process.arch}`;
  const filename = EXTENSION_MAP[platformKey];

  if (!filename) {
    throw new Error(
      `sqlite-vec: unsupported platform "${platformKey}". ` +
      `Supported: ${Object.keys(EXTENSION_MAP).join(', ')}. ` +
      `Set SQLITE_VEC_PATH to provide a custom binary path.`,
    );
  }

  const fullPath = join(extDir, filename);

  // Strip file extension — better-sqlite3's loadExtension appends it
  return fullPath.replace(/\.(dylib|so|dll)$/, '');
}

// ---------------------------------------------------------------------------
// DDL statements
// ---------------------------------------------------------------------------

function buildDDL(dimensions: number): string[] {
  return [
    // Schema version tracking
    `CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER NOT NULL
    )`,

    // Core knowledge table
    `CREATE TABLE IF NOT EXISTS knowledge_chunks (
      id          TEXT PRIMARY KEY,
      namespace   TEXT NOT NULL DEFAULT 'default',
      content     TEXT NOT NULL,
      metadata    TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    )`,

    // FTS5 content-sync shadow table
    `CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      content,
      metadata,
      content='knowledge_chunks',
      content_rowid='rowid'
    )`,

    // sqlite-vec virtual table for ANN search
    `CREATE VIRTUAL TABLE IF NOT EXISTS vec_knowledge USING vec0(
      id TEXT PRIMARY KEY,
      embedding float[${dimensions}]
    )`,

    // ----- Synchronization triggers: FTS5 + vec0 -----

    // AFTER INSERT → propagate to FTS5 and vec0
    `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(rowid, content, metadata)
        VALUES (new.rowid, new.content, new.metadata);
    END`,

    // AFTER DELETE → remove from FTS5 and vec0
    `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content, metadata)
        VALUES ('delete', old.rowid, old.content, old.metadata);
      DELETE FROM vec_knowledge WHERE id = old.id;
    END`,

    // AFTER UPDATE → re-sync FTS5 (delete old + insert new). vec0 update is
    // handled by the service layer (DELETE + INSERT) because vec0 does not
    // support UPDATE in-place.
    `CREATE TRIGGER IF NOT EXISTS knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
      INSERT INTO knowledge_fts(knowledge_fts, rowid, content, metadata)
        VALUES ('delete', old.rowid, old.content, old.metadata);
      INSERT INTO knowledge_fts(rowid, content, metadata)
        VALUES (new.rowid, new.content, new.metadata);
    END`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_chunks_namespace ON knowledge_chunks(namespace)`,
    `CREATE INDEX IF NOT EXISTS idx_chunks_updated ON knowledge_chunks(updated_at)`,
  ];
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

function getSchemaVersion(db: DatabaseType): number {
  const row = db.prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'`,
  ).get() as { name: string } | undefined;

  if (!row) return 0;

  const versionRow = db.prepare(`SELECT version FROM _schema_version LIMIT 1`).get() as
    | { version: number }
    | undefined;

  return versionRow?.version ?? 0;
}

function setSchemaVersion(db: DatabaseType, version: number): void {
  db.prepare(`DELETE FROM _schema_version`).run();
  db.prepare(`INSERT INTO _schema_version (version) VALUES (?)`).run(version);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface KnowledgeDbOptions {
  /** Override the default database file path (`~/.openclaw/data/knowledge.db`). */
  dbPath?: string;
  /** Override the sqlite-vec extension path (auto-detected by default). */
  extensionPath?: string;
  /** Embedding dimensionality. Defaults to 1536. */
  dimensions?: number;
}

/**
 * Open (or create) the centralized knowledge database.
 *
 * This function is idempotent — calling it multiple times with the same path
 * returns a fully-migrated database handle each time. The caller owns the
 * returned `Database` instance and is responsible for closing it.
 */
export function openKnowledgeDb(options: KnowledgeDbOptions = {}): DatabaseType {
  const dimensions = options.dimensions ?? 1536;
  const dbPath = options.dbPath ?? resolve(
    process.env['OPENCLAW_DATA_DIR'] ?? DEFAULT_DATA_DIR,
    DB_FILENAME,
  );

  // Ensure the parent directory exists
  const parentDir = resolve(dbPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  // Open database
  const db = new Database(dbPath);

  // Performance pragmas — order matters: WAL must be set before heavy writes
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  // Load sqlite-vec extension
  const extPath = options.extensionPath ?? resolveExtensionPath();
  db.loadExtension(extPath);

  // Run idempotent migrations
  applyMigrations(db, dimensions);

  return db;
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function applyMigrations(db: DatabaseType, dimensions: number): void {
  const currentVersion = getSchemaVersion(db);

  if (currentVersion >= CURRENT_SCHEMA_VERSION) {
    return; // Already up to date
  }

  // Wrap the entire migration in a transaction for atomicity
  const migrate = db.transaction(() => {
    if (currentVersion < 1) {
      migrateToV1(db, dimensions);
    }

    // Future migrations:
    // if (currentVersion < 2) { migrateToV2(db); }

    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  });

  migrate();
}

/** V1: Initial schema — core table, FTS5, vec0, triggers, indexes. */
function migrateToV1(db: DatabaseType, dimensions: number): void {
  const statements = buildDDL(dimensions);
  for (const sql of statements) {
    db.exec(sql);
  }
}
