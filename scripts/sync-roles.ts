#!/usr/bin/env tsx
/**
 * sync-roles.ts — Community Role Manifest Generator
 *
 * Scans the community-roles/ directory for markdown files containing
 * a metadata table (columns: name, description, color, emoji, vibe),
 * extracts the metadata, and writes a roles-manifest.json consumed
 * by the NestJS API and Frontend UI.
 *
 * Usage:
 *   npx tsx scripts/sync-roles.ts
 *   npx tsx scripts/sync-roles.ts --roles-dir ./path/to/roles
 *   npx tsx scripts/sync-roles.ts --out ./custom-output.json
 *   npx tsx scripts/sync-roles.ts --dry-run
 */

import { resolve, relative, basename, extname } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleManifestEntry {
  /** Stable identifier derived from relative path, e.g. "dev/senior-developer" */
  id: string;
  /** Relative path from roles root, e.g. "dev/senior-developer.md" */
  fileName: string;
  /** Role name extracted from the metadata table */
  name: string;
  /** Short description */
  description: string;
  /** Hex colour for UI theming, e.g. "#7C3AED" */
  color: string;
  /** Emoji avatar */
  emoji: string;
  /** Personality vibe tag, e.g. "focused", "chaotic", "chill" */
  vibe: string;
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function argValue(flag: string, fallback: string): string {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

const DRY_RUN = args.includes('--dry-run');
const REPO_ROOT = resolve(import.meta.dirname ?? __dirname, '..');
const ROLES_DIR = resolve(argValue('--roles-dir', resolve(REPO_ROOT, 'community-roles')));
const OUT_PATH = resolve(argValue('--out', resolve(REPO_ROOT, 'data', 'roles-manifest.json')));

// ---------------------------------------------------------------------------
// Markdown table parser
// ---------------------------------------------------------------------------

/**
 * Parse a markdown table into an array of objects keyed by header names.
 * Handles standard GFM tables with `| col | col |` rows.
 */
function parseMarkdownTable(markdown: string): Record<string, string>[] {
  const lines = markdown.split('\n');
  const results: Record<string, string>[] = [];

  let headers: string[] | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) continue;

    // Must be a pipe-delimited row
    if (!line.startsWith('|') || !line.endsWith('|')) continue;

    const cells = line
      .slice(1, -1) // strip leading/trailing pipes
      .split('|')
      .map((c) => c.trim());

    // First table row → headers
    if (!headers) {
      headers = cells.map((h) => h.toLowerCase());
      continue;
    }

    // Second row is typically the separator (|---|---|...)
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;

    // Data row
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    results.push(row);
  }

  return results;
}

// ---------------------------------------------------------------------------
// File scanner
// ---------------------------------------------------------------------------

function collectMarkdownFiles(dir: string): string[] {
  const files: string[] = [];
  const rootReal = resolve(dir);

  function walk(current: string): void {
    for (const entry of readdirSync(current)) {
      const fullPath = resolve(current, entry);
      // Guard: reject symlinks or paths that escape the roles root
      if (!fullPath.startsWith(rootReal + '/') && fullPath !== rootReal) continue;
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (extname(entry) === '.md') {
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files.sort();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  console.log(`📂 Roles directory: ${ROLES_DIR}`);
  console.log(`📄 Output path:     ${OUT_PATH}`);
  if (DRY_RUN) console.log('🔍 Dry run — no files will be written.\n');

  if (!existsSync(ROLES_DIR)) {
    console.error(`❌ Roles directory not found: ${ROLES_DIR}`);
    console.error('   Download or clone community roles first, then re-run.');
    process.exit(1);
  }

  const mdFiles = collectMarkdownFiles(ROLES_DIR);
  console.log(`   Found ${mdFiles.length} markdown file(s).\n`);

  const manifest: RoleManifestEntry[] = [];
  const warnings: string[] = [];

  for (const filePath of mdFiles) {
    const relPath = relative(ROLES_DIR, filePath);
    const content = readFileSync(filePath, 'utf-8');
    const rows = parseMarkdownTable(content);

    if (rows.length === 0) {
      warnings.push(`⚠️  No metadata table found in ${relPath} — skipped.`);
      continue;
    }

    // We expect exactly one data row per role file
    const meta = rows[0];

    const name = meta['name'] ?? '';
    const description = meta['description'] ?? '';
    const color = meta['color'] ?? '';
    const emoji = meta['emoji'] ?? '';
    const vibe = meta['vibe'] ?? '';

    if (!name) {
      warnings.push(`⚠️  Missing 'name' in ${relPath} — skipped.`);
      continue;
    }

    // Derive a stable ID from the relative path (strip .md extension)
    const id = relPath.replace(/\.md$/, '').replace(/\\/g, '/');

    manifest.push({ id, fileName: relPath.replace(/\\/g, '/'), name, description, color, emoji, vibe });
    console.log(`   ✅ ${id} → ${emoji} ${name} (${vibe})`);
  }

  if (warnings.length) {
    console.log('');
    warnings.forEach((w) => console.log(w));
  }

  console.log(`\n📊 Total roles extracted: ${manifest.length}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN OUTPUT ---');
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  // Ensure output directory exists
  const outDir = resolve(OUT_PATH, '..');
  if (!existsSync(outDir)) {
    const { mkdirSync } = require('node:fs');
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`\n✅ Wrote ${OUT_PATH}`);
}

main();
