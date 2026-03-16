/**
 * Core interfaces for the gamma-knowledge OpenClaw Skill.
 *
 * All types are framework-agnostic — no NestJS, no Express, no OpenClaw SDK
 * types leak into this file. The only contract is the shape of data flowing
 * through the VectorStoreService and the tool handler.
 */

// ---------------------------------------------------------------------------
// Stored entity
// ---------------------------------------------------------------------------

/** A single knowledge chunk persisted in the centralized SQLite database. */
export interface IVectorChunk {
  /** ULID — time-sortable unique identifier. */
  id: string;
  /** Logical partition key (e.g. "project-alpha", "general"). */
  namespace: string;
  /** The textual content that was embedded. */
  content: string;
  /**
   * Arbitrary JSON metadata.
   * The reserved `_agentId` field is injected automatically on every write
   * and used for agent-level isolation queries.
   */
  metadata: Record<string, unknown>;
  /** Raw embedding vector (Float32). Length equals the configured dimensionality. */
  embedding: Float32Array;
  /** Unix epoch milliseconds — set on first insert. */
  createdAt: number;
  /** Unix epoch milliseconds — updated on every upsert. */
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/** Input accepted by `VectorStoreService.upsert()`. */
export interface IVectorUpsertInput {
  /** Optional — if omitted a ULID is generated. If provided, acts as idempotency key. */
  id?: string;
  /** Defaults to `"default"` when omitted. */
  namespace?: string;
  /** The text to embed and store. Required. */
  content: string;
  /** User-supplied metadata. `_agentId` is injected by the service — any caller-supplied value is overwritten. */
  metadata?: Record<string, unknown>;
}

/** Result returned from a successful upsert. */
export interface IUpsertResult {
  id: string;
  status: 'created' | 'updated';
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** Search mode selector. */
export type SearchMode = 'hybrid' | 'vector' | 'fts';

/** Options bag for `VectorStoreService.search()`. */
export interface ISearchOptions {
  /** The natural-language query string. Required. */
  query: string;
  /** Restrict results to this namespace. `null` / `undefined` = all namespaces. */
  namespace?: string;
  /** Maximum results to return. Defaults to 10. */
  limit?: number;
  /** Search strategy. Defaults to `"hybrid"`. */
  mode?: SearchMode;
  /**
   * When `true`, search across ALL agents' knowledge (omnichannel).
   * When `false` (default), results are scoped to the calling agent's entries.
   */
  shared?: boolean;
}

/** A single search hit returned to the caller. */
export interface ISearchResult {
  id: string;
  namespace: string;
  content: string;
  metadata: Record<string, unknown>;
  /** Reciprocal Rank Fusion score (hybrid), cosine distance (vector), or BM25 rank (fts). */
  score: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

export interface IDeleteResult {
  status: 'deleted' | 'not_found';
}

// ---------------------------------------------------------------------------
// Skill context (passed by the OpenClaw runtime per invocation)
// ---------------------------------------------------------------------------

/** Minimal execution context provided by OpenClaw on every tool call. */
export interface ISkillContext {
  /** The identity of the agent invoking the tool. */
  agentId: string;
}

// ---------------------------------------------------------------------------
// Embedding provider (pluggable)
// ---------------------------------------------------------------------------

export interface IEmbeddingProvider {
  /** Generate an embedding vector for the given text. */
  embed(text: string): Promise<Float32Array>;
  /** Dimensionality of vectors produced by this provider. */
  readonly dimensions: number;
}

// ---------------------------------------------------------------------------
// Tool handler (OpenClaw skill contract)
// ---------------------------------------------------------------------------

export type VectorStoreAction = 'upsert' | 'search' | 'delete';

/** The raw JSON params object received from the LLM via OpenClaw. */
export interface IToolParams {
  action: VectorStoreAction;
  id?: string;
  namespace?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  query?: string;
  limit?: number;
  mode?: SearchMode;
  shared?: boolean;
}
