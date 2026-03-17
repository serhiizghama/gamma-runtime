/**
 * Plain-text fallback chunker.
 *
 * Splits files by paragraph boundaries (double newlines), then merges
 * consecutive small paragraphs until reaching the target chunk size.
 * Used for .txt, .env, .toml, config files, and any extension not
 * covered by a specialized strategy.
 */

import type { Chunk } from '../chunk.interface.js';
import { generateChunkId, hashContent } from '../chunk.interface.js';
import type { ScannedFile } from '../../scanner/file-scanner.js';
import type { ChunkerOptions } from '../chunker-registry.js';

/** Target maximum chunk size in characters. */
const MAX_CHUNK_CHARS = 1500;

/** Minimum chunk size — smaller paragraphs are merged upward. */
const MIN_CHUNK_CHARS = 50;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function chunkPlainText(file: ScannedFile, options: ChunkerOptions): Chunk[] {
  const text = file.content.trim();
  if (text.length < MIN_CHUNK_CHARS) return [];

  // If the entire file is small enough, emit a single chunk
  if (text.length <= MAX_CHUNK_CHARS) {
    const lines = file.content.split('\n');
    return [
      buildChunk(file, options, text, 0, 1, 1, lines.length),
    ];
  }

  const paragraphs = splitParagraphs(file.content);
  const merged = mergeParagraphs(paragraphs);

  const totalChunks = merged.length;
  return merged.map((seg, i) => {
    const chunk = buildChunk(
      file,
      options,
      seg.content,
      i,
      totalChunks,
      seg.lineStart,
      seg.lineEnd,
    );
    return chunk;
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Paragraph {
  content: string;
  lineStart: number; // 1-based
  lineEnd: number;   // 1-based
}

/**
 * Split file content into paragraphs separated by one or more blank lines.
 * Preserves line number tracking for metadata.
 */
function splitParagraphs(content: string): Paragraph[] {
  const lines = content.split('\n');
  const paragraphs: Paragraph[] = [];
  let current: string[] = [];
  let paraStart = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1; // 1-based

    if (line.trim() === '') {
      // End of a paragraph
      if (current.length > 0) {
        paragraphs.push({
          content: current.join('\n'),
          lineStart: paraStart,
          lineEnd: lineNum - 1,
        });
        current = [];
      }
      paraStart = lineNum + 1;
    } else {
      if (current.length === 0) {
        paraStart = lineNum;
      }
      current.push(line);
    }
  }

  // Flush remaining content
  if (current.length > 0) {
    paragraphs.push({
      content: current.join('\n'),
      lineStart: paraStart,
      lineEnd: lines.length,
    });
  }

  return paragraphs;
}

/**
 * Merge consecutive small paragraphs into larger segments that approach
 * MAX_CHUNK_CHARS without exceeding it. This prevents noise from many
 * tiny chunks while keeping each segment semantically cohesive.
 */
function mergeParagraphs(paragraphs: Paragraph[]): Paragraph[] {
  if (paragraphs.length === 0) return [];

  const merged: Paragraph[] = [];
  let buffer: Paragraph = { ...paragraphs[0] };

  for (let i = 1; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const combinedLength = buffer.content.length + 1 + para.content.length;

    if (combinedLength <= MAX_CHUNK_CHARS) {
      // Merge into buffer
      buffer.content += '\n\n' + para.content;
      buffer.lineEnd = para.lineEnd;
    } else {
      // Flush buffer and start fresh
      merged.push(buffer);
      buffer = { ...para };
    }
  }

  merged.push(buffer);
  return merged;
}

/** Determine a human-readable file type from the extension. */
function inferFileType(ext: string): string {
  const map: Record<string, string> = {
    '.txt': 'text',
    '.env': 'env',
    '.toml': 'toml',
    '.cfg': 'config',
    '.ini': 'config',
    '.conf': 'config',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.json': 'json',
    '.xml': 'xml',
    '.html': 'html',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.sql': 'sql',
    '.sh': 'shell',
    '.bash': 'shell',
    '.zsh': 'shell',
    '.fish': 'shell',
    '.py': 'python',
    '.rb': 'ruby',
    '.go': 'go',
    '.rs': 'rust',
    '.java': 'java',
    '.kt': 'kotlin',
    '.swift': 'swift',
    '.c': 'c',
    '.cpp': 'cpp',
    '.h': 'c-header',
    '.hpp': 'cpp-header',
  };
  return map[ext] ?? 'text';
}

function buildChunk(
  file: ScannedFile,
  options: ChunkerOptions,
  content: string,
  index: number,
  totalChunks: number,
  lineStart: number,
  lineEnd: number,
): Chunk {
  return {
    id: generateChunkId(file.relativePath, index, content),
    content,
    metadata: {
      filePath: file.relativePath,
      projectName: options.projectName,
      fileType: inferFileType(file.extension),
      chunkIndex: index,
      totalChunks,
      lineStart,
      lineEnd,
      _agentId: options.agentId,
      contentHash: hashContent(content),
    },
  };
}
