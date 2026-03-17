#!/usr/bin/env tsx
/**
 * migrate-orphans.ts — One-time migration script
 *
 * Reclaims 388 legacy knowledge chunks tagged with _agentId:"unknown"
 * by assigning them to "system-ingest" (system-level ingestion identity).
 *
 * The FTS5 table (knowledge_fts) uses content-sync triggers, so updating
 * knowledge_chunks.metadata automatically propagates to FTS.
 * The vec_knowledge table stores only (id, embedding) — no metadata column,
 * so no update needed there.
 *
 * Usage:
 *   npx tsx scripts/migrate-orphans.ts
 *   npx tsx scripts/migrate-orphans.ts --dry-run
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';

const DRY_RUN = process.argv.includes('--dry-run');
const DB_PATH = resolve(homedir(), '.openclaw', 'data', 'knowledge.db');
const NEW_AGENT_ID = 'system-ingest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

// ── Pre-migration stats ──
const before = db.prepare(`
  SELECT json_extract(metadata, '$._agentId') as agent, COUNT(*) as cnt
  FROM knowledge_chunks
  GROUP BY agent
  ORDER BY cnt DESC
`).all() as { agent: string; cnt: number }[];

console.log('\n=== Pre-migration agent distribution ===');
for (const row of before) {
  console.log(`  ${row.agent ?? '(null)'} → ${row.cnt} chunks`);
}

const unknownCount = before.find(r => r.agent === 'unknown')?.cnt ?? 0;
console.log(`\nOrphans to migrate: ${unknownCount}`);

if (unknownCount === 0) {
  console.log('Nothing to migrate. Exiting.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('\n[DRY RUN] Would update metadata._agentId from "unknown" → "%s"', NEW_AGENT_ID);
  console.log('[DRY RUN] No changes made.');
  process.exit(0);
}

// ── Migration ──
// json_set() updates the _agentId field in the JSON metadata column.
// The FTS5 content-sync triggers fire automatically on UPDATE.
const stmt = db.prepare(`
  UPDATE knowledge_chunks
  SET metadata = json_set(metadata, '$._agentId', @newAgentId),
      updated_at = @now
  WHERE json_extract(metadata, '$._agentId') = 'unknown'
`);

const result = stmt.run({
  newAgentId: NEW_AGENT_ID,
  now: Date.now(),
});

console.log(`\n✓ Migrated ${result.changes} chunks: _agentId "unknown" → "${NEW_AGENT_ID}"`);

// ── Post-migration verification ──
const after = db.prepare(`
  SELECT json_extract(metadata, '$._agentId') as agent, COUNT(*) as cnt
  FROM knowledge_chunks
  GROUP BY agent
  ORDER BY cnt DESC
`).all() as { agent: string; cnt: number }[];

console.log('\n=== Post-migration agent distribution ===');
for (const row of after) {
  console.log(`  ${row.agent ?? '(null)'} → ${row.cnt} chunks`);
}

const remainingUnknown = after.find(r => r.agent === 'unknown')?.cnt ?? 0;
console.log(`\nRemaining orphans: ${remainingUnknown}`);

if (remainingUnknown === 0) {
  console.log('✓ Migration complete. Zero orphans remaining.\n');
} else {
  console.error(`✗ WARNING: ${remainingUnknown} orphans still remain!\n`);
  process.exit(1);
}

db.close();
