/**
 * state-db.ts — Platform State Database (gamma-state.db)
 *
 * Manages the SQLite database for agent metadata and lifecycle state.
 * Separate from gamma-knowledge (vector/FTS) — this DB stores identity,
 * display metadata, and status for the Agent Genesis system.
 *
 * Uses better-sqlite3 with WAL mode. Singleton access via getStateDb().
 */

import Database, { type Database as DatabaseType } from 'better-sqlite3';
import { resolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_FILENAME = 'gamma-state.db';
const CURRENT_SCHEMA_VERSION = 2;

/** Resolve DB path: env override → <repoRoot>/data/gamma-state.db */
function resolveDbPath(): string {
  if (process.env['GAMMA_STATE_DB_PATH']) {
    return process.env['GAMMA_STATE_DB_PATH'];
  }
  // Default: <repoRoot>/data/gamma-state.db
  const repoRoot = resolve(__dirname, '..', '..', '..', '..');
  return resolve(repoRoot, 'data', DB_FILENAME);
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: DatabaseType | null = null;

/**
 * Return the singleton better-sqlite3 connection for the platform state DB.
 * Creates the file + schema on first call.
 */
export function getStateDb(): DatabaseType {
  if (_instance) return _instance;

  const dbPath = resolveDbPath();

  // Ensure parent directory exists
  const parentDir = resolve(dbPath, '..');
  if (!existsSync(parentDir)) {
    mkdirSync(parentDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Performance & safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');

  applyMigrations(db);

  _instance = db;
  return db;
}

/**
 * Close the singleton connection. Used for graceful shutdown.
 */
export function closeStateDb(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

function getSchemaVersion(db: DatabaseType): number {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='_schema_version'`)
    .get() as { name: string } | undefined;

  if (!row) return 0;

  const versionRow = db
    .prepare(`SELECT version FROM _schema_version LIMIT 1`)
    .get() as { version: number } | undefined;

  return versionRow?.version ?? 0;
}

function setSchemaVersion(db: DatabaseType, version: number): void {
  db.prepare(`DELETE FROM _schema_version`).run();
  db.prepare(`INSERT INTO _schema_version (version) VALUES (?)`).run(version);
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

function applyMigrations(db: DatabaseType): void {
  const currentVersion = getSchemaVersion(db);
  if (currentVersion >= CURRENT_SCHEMA_VERSION) return;

  const migrate = db.transaction(() => {
    if (currentVersion < 1) migrateToV1(db);
    if (currentVersion < 2) migrateToV2(db);
    setSchemaVersion(db, CURRENT_SCHEMA_VERSION);
  });

  migrate();
}

/** V1: Schema version table + agents table with indexes. */
function migrateToV1(db: DatabaseType): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS _schema_version (
      version INTEGER NOT NULL
    )`,

    `CREATE TABLE IF NOT EXISTS agents (
      id             TEXT PRIMARY KEY,
      name           TEXT NOT NULL,
      role_id        TEXT NOT NULL,
      avatar_emoji   TEXT NOT NULL DEFAULT '🤖',
      ui_color       TEXT NOT NULL DEFAULT '#6366F1',
      status         TEXT NOT NULL DEFAULT 'active'
                     CHECK(status IN ('active', 'archived', 'corrupted')),
      workspace_path TEXT NOT NULL,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status)`,
    `CREATE INDEX IF NOT EXISTS idx_agents_role ON agents(role_id)`,
  ];

  for (const sql of statements) {
    db.exec(sql);
  }
}

/** V2: Tasks table for IPC task state tracking. */
function migrateToV2(db: DatabaseType): void {
  const statements = [
    `CREATE TABLE IF NOT EXISTS tasks (
      id               TEXT PRIMARY KEY,
      source_agent_id  TEXT NOT NULL,
      target_agent_id  TEXT NOT NULL,
      status           TEXT NOT NULL DEFAULT 'pending'
                       CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
      payload          TEXT NOT NULL DEFAULT '{}',
      result           TEXT,
      created_at       INTEGER NOT NULL,
      updated_at       INTEGER NOT NULL
    )`,

    `CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source_agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_target ON tasks(target_agent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`,
  ];

  for (const sql of statements) {
    db.exec(sql);
  }
}
