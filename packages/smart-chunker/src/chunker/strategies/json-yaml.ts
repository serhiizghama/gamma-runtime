/**
 * JSON / YAML semantic chunker.
 *
 * Splits structured data files by their top-level keys so that each chunk
 * represents a logically distinct configuration block. Small files (under
 * MAX_SINGLE_CHUNK_SIZE) are emitted as a single chunk.
 *
 * For YAML: a lightweight line-based parser handles the common case of
 * top-level keys without requiring a YAML library dependency.
 */

import type { Chunk } from '../chunk.interface.js';
import { generateChunkId, hashContent } from '../chunk.interface.js';
import type { ScannedFile } from '../../scanner/file-scanner.js';
import type { ChunkerOptions } from '../chunker-registry.js';

/** Files under this size are emitted as a single chunk. */
const MAX_SINGLE_CHUNK_SIZE = 800;

/** If a single top-level value exceeds this, it's emitted as its own chunk regardless. */
const LARGE_VALUE_THRESHOLD = 2000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkJsonYaml(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const content = file.content.trim();
  if (content.length === 0) return [];

  const isYaml = file.extension === '.yaml' || file.extension === '.yml';
  const fileType = isYaml ? 'yaml' : 'json';

  // Small files → single chunk
  if (content.length <= MAX_SINGLE_CHUNK_SIZE) {
    return [singleChunk(file, options, fileType)];
  }

  const segments = isYaml
    ? splitYamlTopLevel(file.content)
    : splitJsonTopLevel(file.content);

  // If splitting failed or produced nothing meaningful, fall back to single chunk
  if (segments.length === 0) {
    return [singleChunk(file, options, fileType)];
  }

  const totalChunks = segments.length;
  return segments.map((seg, i) => ({
    id: generateChunkId(file.relativePath, i, seg.content),
    content: seg.content,
    metadata: {
      filePath: file.relativePath,
      projectName: options.projectName,
      fileType,
      chunkIndex: i,
      totalChunks,
      symbolName: seg.key,
      symbolType: 'variable' as const,
      lineStart: seg.lineStart,
      lineEnd: seg.lineEnd,
      _agentId: options.agentId,
      contentHash: hashContent(seg.content),
    },
  }));
}

// ---------------------------------------------------------------------------
// JSON splitting
// ---------------------------------------------------------------------------

interface Segment {
  key: string;
  content: string;
  lineStart: number; // 1-based
  lineEnd: number;   // 1-based
}

/**
 * Parse JSON and split by top-level keys. Each key-value pair becomes
 * a segment formatted as `{ "key": value }` so it's valid JSON in isolation.
 */
function splitJsonTopLevel(raw: string): Segment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return []; // invalid JSON — fall back to single chunk
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return []; // arrays and primitives → single chunk
  }

  const obj = parsed as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return [];

  // If there's only one key, no point splitting
  if (keys.length === 1) return [];

  const segments: Segment[] = [];
  const lines = raw.split('\n');

  for (const key of keys) {
    const value = obj[key];
    const formatted = JSON.stringify({ [key]: value }, null, 2);

    // Approximate line range by finding the key in the original source
    const keyPattern = `"${key}"`;
    const startIdx = lines.findIndex((l) => l.includes(keyPattern));
    const lineStart = startIdx >= 0 ? startIdx + 1 : 1;

    // Estimate end line from the size of the serialized value
    const valueLines = formatted.split('\n').length;
    const lineEnd = Math.min(lineStart + valueLines - 1, lines.length);

    segments.push({ key, content: formatted, lineStart, lineEnd });
  }

  return segments;
}

// ---------------------------------------------------------------------------
// YAML splitting (line-based, no library)
// ---------------------------------------------------------------------------

/**
 * Split a YAML file by top-level keys. A top-level key is identified as a
 * line that starts with a non-space, non-comment character and contains a colon.
 * Everything indented below it belongs to that key's section.
 */
function splitYamlTopLevel(raw: string): Segment[] {
  const lines = raw.split('\n');
  const sections: { key: string; startLine: number; lines: string[] }[] = [];
  let current: { key: string; startLine: number; lines: string[] } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip blank lines and comments at the top level
    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      current?.lines.push(line);
      continue;
    }

    // Top-level key: starts at column 0, not a comment, has a colon
    if (!line.startsWith(' ') && !line.startsWith('\t') && line.includes(':')) {
      if (current) sections.push(current);
      const key = line.split(':')[0].trim();
      current = { key, startLine: i + 1, lines: [line] };
    } else {
      current?.lines.push(line);
    }
  }

  if (current) sections.push(current);

  // If there's only one section, no point splitting
  if (sections.length <= 1) return [];

  return sections.map((sec) => ({
    key: sec.key,
    content: sec.lines.join('\n').trimEnd(),
    lineStart: sec.startLine,
    lineEnd: sec.startLine + sec.lines.length - 1,
  }));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function singleChunk(file: ScannedFile, options: ChunkerOptions, fileType: string): Chunk {
  const content = file.content.trim();
  const lines = file.content.split('\n');
  return {
    id: generateChunkId(file.relativePath, 0, content),
    content,
    metadata: {
      filePath: file.relativePath,
      projectName: options.projectName,
      fileType,
      chunkIndex: 0,
      totalChunks: 1,
      lineStart: 1,
      lineEnd: lines.length,
      _agentId: options.agentId,
      contentHash: hashContent(content),
    },
  };
}
