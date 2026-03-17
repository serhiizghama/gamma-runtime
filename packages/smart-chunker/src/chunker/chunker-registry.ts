/**
 * Strategy-pattern registry that routes files to the appropriate chunker
 * based on their file extension.
 *
 * Each chunker strategy implements ChunkerStrategy and is registered once
 * at startup. The registry falls back to the plain-text chunker for
 * unrecognized extensions.
 */

import type { Chunk } from './chunk.interface.js';
import type { ScannedFile } from '../scanner/file-scanner.js';
import { chunkTypeScript } from './strategies/typescript.js';
import { chunkMarkdown } from './strategies/markdown.js';
import { chunkJsonYaml } from './strategies/json-yaml.js';
import { chunkDotfile } from './strategies/gitignore.js';
import { chunkPlainText } from './strategies/plain-text.js';

// ---------------------------------------------------------------------------
// Strategy interface
// ---------------------------------------------------------------------------

/** Options passed to every chunker strategy. */
export interface ChunkerOptions {
  /** Human-readable project name stamped into metadata. */
  projectName: string;
  /** Agent ID stamped into metadata. */
  agentId: string;
}

/**
 * A chunker strategy: takes a scanned file and produces an array of
 * semantically meaningful chunks.
 */
export type ChunkerStrategy = (file: ScannedFile, options: ChunkerOptions) => Chunk[];

// ---------------------------------------------------------------------------
// Extension → strategy mapping
// ---------------------------------------------------------------------------

const strategyMap = new Map<string, ChunkerStrategy>();

// TypeScript & JavaScript family
for (const ext of ['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']) {
  strategyMap.set(ext, chunkTypeScript);
}

// Markdown
for (const ext of ['.md', '.mdx']) {
  strategyMap.set(ext, chunkMarkdown);
}

// JSON / YAML
for (const ext of ['.json', '.yaml', '.yml']) {
  strategyMap.set(ext, chunkJsonYaml);
}

// Dotfiles and configs (single-chunk strategy)
for (const ext of ['.gitignore', '.dockerignore', '.editorconfig', '.env']) {
  strategyMap.set(ext, chunkDotfile);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Select the best chunker strategy for a given file extension.
 * Falls back to plain-text chunking for unrecognized extensions.
 */
export function getChunker(extension: string): ChunkerStrategy {
  return strategyMap.get(extension.toLowerCase()) ?? chunkPlainText;
}

/**
 * Chunk a scanned file using the appropriate strategy.
 * Convenience wrapper around getChunker + invoke.
 */
export function chunkFile(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const strategy = getChunker(file.extension);
  return strategy(file, options);
}
