#!/usr/bin/env tsx
/**
 * sync-roles.ts — Community Role Manifest Generator
 *
 * Scans a roles directory for markdown agent definitions, extracts metadata
 * using a 3-tier strategy, and writes a roles-manifest.json consumed by the
 * NestJS API and Frontend UI.
 *
 * Extraction priority:
 *   1. YAML frontmatter (--- delimited, keys: name, description, color, emoji, vibe)
 *   2. GFM pipe table  (| name | description | ... |)
 *   3. H1 fallback     (# Title → name, first paragraph → description)
 *
 * Usage:
 *   npx tsx scripts/sync-roles.ts
 *   npx tsx scripts/sync-roles.ts --roles-dir ./agency-agents
 *   npx tsx scripts/sync-roles.ts --out ./custom-output.json
 *   npx tsx scripts/sync-roles.ts --dry-run
 */

import { resolve, relative, extname } from 'node:path';
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleManifestEntry {
  /** Stable identifier derived from relative path, e.g. "dev/senior-developer" */
  id: string;
  /** Relative path from roles root, e.g. "dev/senior-developer.md" */
  fileName: string;
  /** Role name extracted from metadata */
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

interface ExtractedMeta {
  name: string;
  description: string;
  color: string;
  emoji: string;
  vibe: string;
  source: 'frontmatter' | 'table' | 'fallback';
}

// ---------------------------------------------------------------------------
// Defaults & color normalization
// ---------------------------------------------------------------------------

const DEFAULT_EMOJI = '\u{1F916}'; // 🤖
const DEFAULT_COLOR = '#64748b';   // Slate grey
const DEFAULT_VIBE = 'professional';

/** Map CSS named colors to hex. Covers values found in agency-agents. */
const NAMED_COLORS: Record<string, string> = {
  red: '#EF4444', orange: '#F97316', amber: '#F59E0B', yellow: '#EAB308',
  lime: '#84CC16', green: '#22C55E', teal: '#14B8A6', cyan: '#06B6D4',
  blue: '#3B82F6', indigo: '#6366F1', violet: '#8B5CF6', purple: '#A855F7',
  fuchsia: '#D946EF', pink: '#EC4899', rose: '#F43F5E', gold: '#D4A017',
  gray: '#6B7280', grey: '#6B7280',
  'metallic-blue': '#4682B4', 'neon-cyan': '#00E5FF', 'neon-green': '#39FF14',
};

/** Normalize a color value to a hex string. Passes through valid hex, maps names. */
function normalizeColor(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/i.test(trimmed)) return trimmed;
  return NAMED_COLORS[trimmed] ?? DEFAULT_COLOR;
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
// 1. YAML Frontmatter parser
// ---------------------------------------------------------------------------

/**
 * Extract YAML frontmatter delimited by `---` lines.
 * Returns a key→value map with lowercase keys, or null if no frontmatter found.
 */
function parseFrontmatter(markdown: string): Record<string, string> | null {
  const lines = markdown.split('\n');
  if (lines[0].trim() !== '---') return null;

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endIdx = i;
      break;
    }
  }
  if (endIdx === -1) return null;

  const result: Record<string, string> = {};
  for (let i = 1; i < endIdx; i++) {
    const line = lines[i];
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    let value = line.slice(colonIdx + 1).trim();

    // Strip surrounding quotes (single or double)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && value) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

// ---------------------------------------------------------------------------
// 2. GFM table parser
// ---------------------------------------------------------------------------

/**
 * Parse the first GFM pipe-table into an array of row objects.
 * Headers are normalized to lowercase + trimmed.
 */
function parseMarkdownTable(markdown: string): Record<string, string>[] {
  const lines = markdown.split('\n');
  const results: Record<string, string>[] = [];

  let headers: string[] | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!line.startsWith('|') || !line.endsWith('|')) {
      // If we already started a table, a non-table line ends it
      if (headers) break;
      continue;
    }

    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());

    if (!headers) {
      headers = cells.map((h) => h.toLowerCase().replace(/[^a-z0-9_-]/g, ''));
      continue;
    }

    // Separator row
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;

    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    results.push(row);
  }

  return results;
}

// ---------------------------------------------------------------------------
// 3. H1 / paragraph fallback
// ---------------------------------------------------------------------------

/** Strip common prefixes and leading emojis from an H1 heading. */
function cleanH1(raw: string): string {
  let text = raw.trim();
  // Remove leading emojis (unicode emoji sequences)
  text = text.replace(/^[\p{Emoji_Presentation}\p{Extended_Pictographic}\uFE0F\u200D]+\s*/u, '');
  // Remove prefixes like "Role:", "Agent:", case-insensitive
  text = text.replace(/^(?:role|agent)\s*:\s*/i, '');
  return text.trim();
}

/**
 * Extract name from the first H1 and description from the first
 * non-empty paragraph after it.
 */
function extractH1Fallback(markdown: string): { name: string; description: string } | null {
  const lines = markdown.split('\n');

  // Skip frontmatter block if present
  let startIdx = 0;
  if (lines[0]?.trim() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        startIdx = i + 1;
        break;
      }
    }
  }

  let name = '';
  let description = '';

  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i].trim();

    // Find the first H1
    if (!name) {
      const h1Match = line.match(/^#\s+(.+)/);
      if (h1Match) {
        name = cleanH1(h1Match[1]);
      }
      continue;
    }

    // After finding H1, grab the first non-empty, non-heading paragraph
    if (!line) continue;
    if (line.startsWith('#')) continue; // skip sub-headings
    if (line.startsWith('|')) continue; // skip tables
    if (line.startsWith('---')) continue;
    if (line.startsWith('```')) continue;
    if (line.startsWith('- **') || line.startsWith('* **')) continue; // skip bullet metadata

    // Found a paragraph line — take it (truncate to 200 chars)
    description = line.length > 200 ? line.slice(0, 200) + '...' : line;
    break;
  }

  return name ? { name, description } : null;
}

// ---------------------------------------------------------------------------
// Unified metadata extractor
// ---------------------------------------------------------------------------

function extractMetadata(content: string): ExtractedMeta | null {
  // Strategy 1: YAML frontmatter
  const fm = parseFrontmatter(content);
  if (fm && fm['name']) {
    return {
      name: fm['name'],
      description: fm['description'] ?? '',
      color: normalizeColor(fm['color'] ?? ''),
      emoji: fm['emoji'] ?? DEFAULT_EMOJI,
      vibe: fm['vibe'] ?? DEFAULT_VIBE,
      source: 'frontmatter',
    };
  }

  // Strategy 2: GFM pipe table
  const rows = parseMarkdownTable(content);
  if (rows.length > 0 && rows[0]['name']) {
    const meta = rows[0];
    return {
      name: meta['name'],
      description: meta['description'] ?? '',
      color: normalizeColor(meta['color'] ?? ''),
      emoji: meta['emoji'] ?? DEFAULT_EMOJI,
      vibe: meta['vibe'] ?? DEFAULT_VIBE,
      source: 'table',
    };
  }

  // Strategy 3: H1 fallback
  const h1 = extractH1Fallback(content);
  if (h1) {
    return {
      name: h1.name,
      description: h1.description,
      color: DEFAULT_COLOR,
      emoji: DEFAULT_EMOJI,
      vibe: DEFAULT_VIBE,
      source: 'fallback',
    };
  }

  return null;
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
  console.log(`\u{1F4C2} Roles directory: ${ROLES_DIR}`);
  console.log(`\u{1F4C4} Output path:     ${OUT_PATH}`);
  if (DRY_RUN) console.log('\u{1F50D} Dry run — no files will be written.\n');

  if (!existsSync(ROLES_DIR)) {
    console.error(`\u{274C} Roles directory not found: ${ROLES_DIR}`);
    console.error('   Download or clone community roles first, then re-run.');
    process.exit(1);
  }

  const mdFiles = collectMarkdownFiles(ROLES_DIR);
  console.log(`   Found ${mdFiles.length} markdown file(s).\n`);

  const manifest: RoleManifestEntry[] = [];
  const skipped: string[] = [];
  let countFrontmatter = 0;
  let countTable = 0;
  let countFallback = 0;

  for (const filePath of mdFiles) {
    const relPath = relative(ROLES_DIR, filePath);
    const content = readFileSync(filePath, 'utf-8');

    // Skip effectively empty files
    if (content.trim().length === 0) {
      skipped.push(`   \u{26A0}\u{FE0F}  ${relPath} \u{2192} Empty file — skipped.`);
      continue;
    }

    const meta = extractMetadata(content);
    if (!meta) {
      skipped.push(`   \u{26A0}\u{FE0F}  ${relPath} \u{2192} No name found (no frontmatter, table, or H1) — skipped.`);
      continue;
    }

    // Derive a stable ID from the relative path (strip .md extension)
    const id = relPath.replace(/\.md$/, '').replace(/\\/g, '/');
    const fileName = relPath.replace(/\\/g, '/');

    manifest.push({
      id,
      fileName,
      name: meta.name,
      description: meta.description,
      color: meta.color,
      emoji: meta.emoji,
      vibe: meta.vibe,
    });

    if (meta.source === 'frontmatter') {
      countFrontmatter++;
      console.log(`   \u{2705} ${id} \u{2192} ${meta.emoji} ${meta.name} (${meta.vibe})`);
    } else if (meta.source === 'table') {
      countTable++;
      console.log(`   \u{2705} ${id} \u{2192} ${meta.emoji} ${meta.name} (${meta.vibe})`);
    } else {
      countFallback++;
      console.log(`   \u{2139}\u{FE0F}  ${id} \u{2192} Using fallback extraction (no table found)`);
    }
  }

  if (skipped.length) {
    console.log('\n--- Skipped files ---');
    skipped.forEach((w) => console.log(w));
  }

  console.log(`\n\u{1F4CA} Total roles extracted: ${manifest.length} / ${mdFiles.length} files`);
  console.log(`   Frontmatter: ${countFrontmatter}  |  Table: ${countTable}  |  H1 fallback: ${countFallback}  |  Skipped: ${skipped.length}`);

  if (DRY_RUN) {
    console.log('\n--- DRY RUN OUTPUT (first 5) ---');
    console.log(JSON.stringify(manifest.slice(0, 5), null, 2));
    console.log(`... and ${Math.max(0, manifest.length - 5)} more`);
    return;
  }

  // Ensure output directory exists
  const outDir = resolve(OUT_PATH, '..');
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }

  writeFileSync(OUT_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf-8');
  console.log(`\n\u{2705} Wrote ${OUT_PATH}`);
}

main();
