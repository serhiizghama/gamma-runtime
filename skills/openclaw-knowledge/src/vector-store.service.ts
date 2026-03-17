/**
 * vector-store.service.ts
 *
 * Core service implementing the Omnichannel Knowledge Hub:
 *  - Transactional upsert (knowledge_chunks + vec_knowledge)
 *  - Ownership-checked delete
 *  - Hybrid search (vector + FTS5 fused via Reciprocal Rank Fusion)
 *  - Vector-only and FTS-only search modes
 *  - Agent-level isolation via metadata._agentId filtering
 *
 * Completely framework-agnostic. Depends only on `better-sqlite3`.
 */

import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { ulid } from 'ulid';
import type {
  IVectorUpsertInput,
  IVectorUpsertWithVectorInput,
  IUpsertResult,
  ISearchOptions,
  ISearchResult,
  IDeleteResult,
  ISkillContext,
  IEmbeddingProvider,
  SearchMode,
} from './interfaces.js';

// ---------------------------------------------------------------------------
// SQL — prepared at construction time
// ---------------------------------------------------------------------------

const SQL_UPSERT_CHUNK = `
  INSERT INTO knowledge_chunks (id, namespace, content, metadata, created_at, updated_at)
  VALUES (@id, @namespace, @content, @metadata, @now, @now)
  ON CONFLICT(id) DO UPDATE SET
    namespace  = excluded.namespace,
    content    = excluded.content,
    metadata   = excluded.metadata,
    updated_at = excluded.updated_at
`;

const SQL_DELETE_CHUNK = `DELETE FROM knowledge_chunks WHERE id = @id`;
const SQL_DELETE_VEC = `DELETE FROM vec_knowledge WHERE id = @id`;

const SQL_GET_OWNER = `
  SELECT json_extract(metadata, '$._agentId') AS agent_id
  FROM knowledge_chunks
  WHERE id = @id
`;

const SQL_EXISTS = `SELECT 1 FROM knowledge_chunks WHERE id = @id`;

// ---------------------------------------------------------------------------
// Hybrid search CTE — Reciprocal Rank Fusion (k = 60)
// ---------------------------------------------------------------------------

const SQL_HYBRID_SEARCH = `
  WITH vector_hits AS (
    SELECT
      v.id,
      v.distance AS vec_distance,
      ROW_NUMBER() OVER (ORDER BY v.distance ASC) AS vec_rank
    FROM vec_knowledge v
    WHERE v.embedding MATCH @query_embedding
      AND k = @k_param
    ORDER BY v.distance ASC
    LIMIT @candidate_limit
  ),
  fts_hits AS (
    SELECT
      k.id,
      knowledge_fts.rank AS fts_rank_score,
      ROW_NUMBER() OVER (ORDER BY knowledge_fts.rank ASC) AS fts_rank
    FROM knowledge_fts
    JOIN knowledge_chunks k ON k.rowid = knowledge_fts.rowid
    WHERE knowledge_fts MATCH @query_text
    LIMIT @candidate_limit
  ),
  fused AS (
    SELECT
      COALESCE(v.id, f.id) AS id,
      COALESCE(1.0 / (60 + v.vec_rank), 0) +
      COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score
    FROM vector_hits v
    LEFT JOIN fts_hits f ON v.id = f.id
    UNION
    SELECT
      f.id,
      COALESCE(1.0 / (60 + v.vec_rank), 0) +
      COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score
    FROM fts_hits f
    LEFT JOIN vector_hits v ON f.id = v.id
    WHERE v.id IS NULL
  )
  SELECT
    k.id,
    k.namespace,
    k.content,
    k.metadata,
    k.created_at,
    k.updated_at,
    fused.rrf_score AS score
  FROM fused
  JOIN knowledge_chunks k ON k.id = fused.id
  WHERE (@namespace IS NULL OR k.namespace = @namespace)
    AND (@shared = 1 OR json_extract(k.metadata, '$._agentId') = @agent_id)
  ORDER BY fused.rrf_score DESC
  LIMIT @result_limit
`;

// ---------------------------------------------------------------------------
// Vector-only search
// ---------------------------------------------------------------------------

const SQL_VECTOR_SEARCH = `
  SELECT
    k.id,
    k.namespace,
    k.content,
    k.metadata,
    k.created_at,
    k.updated_at,
    v.distance AS score
  FROM vec_knowledge v
  JOIN knowledge_chunks k ON k.id = v.id
  WHERE v.embedding MATCH @query_embedding
    AND k = @k_param
    AND (@namespace IS NULL OR k.namespace = @namespace)
    AND (@shared = 1 OR json_extract(k.metadata, '$._agentId') = @agent_id)
  ORDER BY v.distance ASC
  LIMIT @result_limit
`;

// ---------------------------------------------------------------------------
// FTS-only search
// ---------------------------------------------------------------------------

const SQL_FTS_SEARCH = `
  SELECT
    k.id,
    k.namespace,
    k.content,
    k.metadata,
    k.created_at,
    k.updated_at,
    knowledge_fts.rank AS score
  FROM knowledge_fts
  JOIN knowledge_chunks k ON k.rowid = knowledge_fts.rowid
  WHERE knowledge_fts MATCH @query_text
    AND (@namespace IS NULL OR k.namespace = @namespace)
    AND (@shared = 1 OR json_extract(k.metadata, '$._agentId') = @agent_id)
  ORDER BY knowledge_fts.rank ASC
  LIMIT @result_limit
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape FTS5 special characters so user input is treated as literals. */
function escapeFts5Query(raw: string): string {
  // Wrap every whitespace-delimited token in double quotes to prevent
  // FTS5 syntax errors from special characters like *, -, OR, AND, etc.
  const tokens = raw
    .replace(/"/g, '""')
    .split(/\s+/)
    .filter(Boolean);

  if (tokens.length === 0) return '""';
  return tokens.map((t) => `"${t}"`).join(' ');
}

function serializeEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function parseMetadata(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapRow(row: RawRow): ISearchResult {
  return {
    id: row.id,
    namespace: row.namespace,
    content: row.content,
    metadata: parseMetadata(row.metadata),
    score: row.score,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface RawRow {
  id: string;
  namespace: string;
  content: string;
  metadata: string;
  score: number;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class VectorStoreService {
  private readonly db: DatabaseType;
  private readonly embedding: IEmbeddingProvider;

  // Prepared statements (lazy — created on first use)
  private stmtUpsertChunk: Statement | null = null;
  private stmtUpsertVec: Statement | null = null;
  private stmtDeleteChunk: Statement | null = null;
  private stmtDeleteVec: Statement | null = null;
  private stmtGetOwner: Statement | null = null;
  private stmtExists: Statement | null = null;

  constructor(db: DatabaseType, embeddingProvider: IEmbeddingProvider) {
    this.db = db;
    this.embedding = embeddingProvider;
  }

  // -----------------------------------------------------------------------
  // Upsert
  // -----------------------------------------------------------------------

  async upsert(input: IVectorUpsertInput, ctx: ISkillContext): Promise<IUpsertResult> {
    const id = input.id ?? ulid();
    const namespace = input.namespace ?? 'default';
    const now = Date.now();

    // Check if this is a create or update
    const exists = this.prepareExists().get({ id }) !== undefined;

    // If updating, verify ownership
    if (exists) {
      this.assertOwnership(id, ctx.agentId);
    }

    // Generate embedding
    const vec = await this.embedding.embed(input.content);

    // Stamp agent identity into metadata
    const metadata: Record<string, unknown> = { ...input.metadata, _agentId: ctx.agentId };
    const metadataJson = JSON.stringify(metadata);

    // Transactional write: knowledge_chunks + vec_knowledge
    const tx = this.db.transaction(() => {
      this.prepareUpsertChunk().run({
        id,
        namespace,
        content: input.content,
        metadata: metadataJson,
        now,
      });

      // vec0 does not support ON CONFLICT UPDATE in all builds —
      // use DELETE + INSERT to guarantee idempotency.
      this.prepareDeleteVec().run({ id });
      this.prepareUpsertVec().run({
        id,
        embedding: serializeEmbedding(vec),
      });
    });

    tx();

    return { id, status: exists ? 'updated' : 'created' };
  }

  // -----------------------------------------------------------------------
  // Upsert with pre-computed vector (bypasses internal embedding provider)
  // -----------------------------------------------------------------------

  upsertWithVector(input: IVectorUpsertWithVectorInput, ctx: ISkillContext): IUpsertResult {
    const id = input.id ?? ulid();
    const namespace = input.namespace ?? 'default';
    const now = Date.now();

    const exists = this.prepareExists().get({ id }) !== undefined;

    if (exists) {
      this.assertOwnership(id, ctx.agentId);
    }

    const metadata: Record<string, unknown> = { ...input.metadata, _agentId: ctx.agentId };
    const metadataJson = JSON.stringify(metadata);

    const tx = this.db.transaction(() => {
      this.prepareUpsertChunk().run({
        id,
        namespace,
        content: input.content,
        metadata: metadataJson,
        now,
      });

      this.prepareDeleteVec().run({ id });
      this.prepareUpsertVec().run({
        id,
        embedding: serializeEmbedding(input.vector),
      });
    });

    tx();

    return { id, status: exists ? 'updated' : 'created' };
  }

  // -----------------------------------------------------------------------
  // Delete
  // -----------------------------------------------------------------------

  delete(id: string, ctx: ISkillContext): IDeleteResult {
    const exists = this.prepareExists().get({ id }) !== undefined;
    if (!exists) {
      return { status: 'not_found' };
    }

    this.assertOwnership(id, ctx.agentId);

    const tx = this.db.transaction(() => {
      // Delete from vec first (no trigger covers this on chunk delete
      // because vec0 virtual tables can't be targeted by triggers on
      // the main table in all sqlite-vec versions — the trigger in
      // knowledge-db.ts handles it, but we do it explicitly for safety).
      this.prepareDeleteVec().run({ id });
      this.prepareDeleteChunk().run({ id });
    });

    tx();

    return { status: 'deleted' };
  }

  // -----------------------------------------------------------------------
  // Search
  // -----------------------------------------------------------------------

  async search(options: ISearchOptions, ctx: ISkillContext): Promise<ISearchResult[]> {
    const mode: SearchMode = options.mode ?? 'hybrid';
    const limit = Math.max(1, Math.min(options.limit ?? 10, 100));
    const shared = options.shared === true ? 1 : 0;
    const namespace = options.namespace ?? null;
    const agentId = ctx.agentId;

    switch (mode) {
      case 'hybrid':
        return this.searchHybrid(options.query, limit, namespace, shared, agentId);
      case 'vector':
        return this.searchVector(options.query, limit, namespace, shared, agentId);
      case 'fts':
        return this.searchFts(options.query, limit, namespace, shared, agentId);
      default:
        throw new Error(`Unknown search mode: "${mode as string}"`);
    }
  }

  // -----------------------------------------------------------------------
  // Private: search strategies
  // -----------------------------------------------------------------------

  private async searchHybrid(
    query: string,
    limit: number,
    namespace: string | null,
    shared: number,
    agentId: string,
  ): Promise<ISearchResult[]> {
    const queryEmbedding = await this.embedding.embed(query);
    const queryText = escapeFts5Query(query);
    const candidateLimit = limit * 3;

    const rows = this.db.prepare(SQL_HYBRID_SEARCH).all({
      query_embedding: serializeEmbedding(queryEmbedding),
      k_param: candidateLimit,
      query_text: queryText,
      candidate_limit: candidateLimit,
      namespace,
      shared,
      agent_id: agentId,
      result_limit: limit,
    }) as RawRow[];

    return rows.map(mapRow);
  }

  private async searchVector(
    query: string,
    limit: number,
    namespace: string | null,
    shared: number,
    agentId: string,
  ): Promise<ISearchResult[]> {
    const queryEmbedding = await this.embedding.embed(query);

    const rows = this.db.prepare(SQL_VECTOR_SEARCH).all({
      query_embedding: serializeEmbedding(queryEmbedding),
      k_param: limit,
      namespace,
      shared,
      agent_id: agentId,
      result_limit: limit,
    }) as RawRow[];

    return rows.map(mapRow);
  }

  private searchFts(
    query: string,
    limit: number,
    namespace: string | null,
    shared: number,
    agentId: string,
  ): ISearchResult[] {
    const queryText = escapeFts5Query(query);

    const rows = this.db.prepare(SQL_FTS_SEARCH).all({
      query_text: queryText,
      namespace,
      shared,
      agent_id: agentId,
      result_limit: limit,
    }) as RawRow[];

    return rows.map(mapRow);
  }

  // -----------------------------------------------------------------------
  // Private: ownership enforcement
  // -----------------------------------------------------------------------

  private assertOwnership(id: string, agentId: string): void {
    const row = this.prepareGetOwner().get({ id }) as { agent_id: string | null } | undefined;
    if (row && row.agent_id !== null && row.agent_id !== agentId) {
      throw new Error(
        `Ownership violation: agent "${agentId}" cannot modify chunk "${id}" owned by "${row.agent_id}".`,
      );
    }
  }

  // -----------------------------------------------------------------------
  // Private: lazy statement preparation
  // -----------------------------------------------------------------------

  private prepareUpsertChunk(): Statement {
    this.stmtUpsertChunk ??= this.db.prepare(SQL_UPSERT_CHUNK);
    return this.stmtUpsertChunk;
  }

  private prepareUpsertVec(): Statement {
    // Use the simple INSERT form — caller handles DELETE-before-INSERT
    this.stmtUpsertVec ??= this.db.prepare(
      `INSERT INTO vec_knowledge (id, embedding) VALUES (@id, @embedding)`,
    );
    return this.stmtUpsertVec;
  }

  private prepareDeleteChunk(): Statement {
    this.stmtDeleteChunk ??= this.db.prepare(SQL_DELETE_CHUNK);
    return this.stmtDeleteChunk;
  }

  private prepareDeleteVec(): Statement {
    this.stmtDeleteVec ??= this.db.prepare(SQL_DELETE_VEC);
    return this.stmtDeleteVec;
  }

  private prepareGetOwner(): Statement {
    this.stmtGetOwner ??= this.db.prepare(SQL_GET_OWNER);
    return this.stmtGetOwner;
  }

  private prepareExists(): Statement {
    this.stmtExists ??= this.db.prepare(SQL_EXISTS);
    return this.stmtExists;
  }
}
