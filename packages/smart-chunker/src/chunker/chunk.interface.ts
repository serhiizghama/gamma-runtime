/**
 * Data model for a semantic chunk produced by the chunking pipeline.
 *
 * Every chunk is a self-contained unit of meaning, tagged with rich metadata
 * so the vector store can support precise filtering and attribution during
 * retrieval-augmented generation.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/** Metadata attached to every chunk for filtering and attribution. */
export interface ChunkMetadata {
  /** Path relative to the project root (e.g. 'src/tools/executor.ts'). */
  filePath: string;
  /** Human-readable project identifier (e.g. 'gamma-runtime'). */
  projectName: string;
  /** Semantic file type label (e.g. 'typescript', 'markdown', 'json'). */
  fileType: string;
  /** 0-based position of this chunk within its source file. */
  chunkIndex: number;
  /** Total number of chunks produced from the source file. */
  totalChunks: number;
  /** Name of the symbol (function, class, interface) — code files only. */
  symbolName?: string;
  /** Type of the symbol — code files only. */
  symbolType?: 'function' | 'class' | 'interface' | 'type' | 'enum' | 'variable' | 'other';
  /** Breadcrumb heading path — Markdown files only (e.g. 'Guide > Installation'). */
  headingPath?: string;
  /** 1-based start line in the source file. */
  lineStart: number;
  /** 1-based end line in the source file (inclusive). */
  lineEnd: number;
  /** Agent identity for vector store access control. */
  _agentId: string;
  /** SHA-256 hash of the chunk content — used for dedup & incremental re-ingestion. */
  contentHash: string;
}

/** A single semantic chunk, ready for embedding and upserting. */
export interface Chunk {
  /** Deterministic ID: SHA-256(filePath + chunkIndex + content), truncated to 32 hex chars. */
  id: string;
  /** The textual content of the chunk. */
  content: string;
  /** Rich metadata for filtering and attribution. */
  metadata: ChunkMetadata;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a deterministic chunk ID from its file path, index, and content.
 * Truncated to 32 hex characters (128 bits) — collision-safe for our scale.
 */
export function generateChunkId(filePath: string, chunkIndex: number, content: string): string {
  return createHash('sha256')
    .update(`${filePath}::${chunkIndex}::${content}`)
    .digest('hex')
    .slice(0, 32);
}

/** Generate a SHA-256 content hash for dedup / change detection. */
export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
