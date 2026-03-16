/**
 * index.ts — OpenClaw Skill entry point for gamma-knowledge.
 *
 * Exports a single tool (`vector_store`) with three actions:
 * upsert, search, delete. The database and embedding provider are
 * initialized lazily on first invocation and reused across calls.
 */

import { openKnowledgeDb } from './knowledge-db.js';
import { VectorStoreService } from './vector-store.service.js';
import type {
  IToolParams,
  ISkillContext,
  IEmbeddingProvider,
  IUpsertResult,
  ISearchResult,
  IDeleteResult,
} from './interfaces.js';

// Re-export for downstream consumers
export type {
  IVectorChunk,
  IVectorUpsertInput,
  ISearchResult,
  ISearchOptions,
  IDeleteResult,
  IUpsertResult,
  ISkillContext,
  IEmbeddingProvider,
  IToolParams,
  VectorStoreAction,
  SearchMode,
} from './interfaces.js';

export { openKnowledgeDb } from './knowledge-db.js';
export { VectorStoreService } from './vector-store.service.js';

// ---------------------------------------------------------------------------
// Lazy singleton — initialized on first tool invocation
// ---------------------------------------------------------------------------

let service: VectorStoreService | null = null;

function getService(embeddingProvider: IEmbeddingProvider): VectorStoreService {
  if (!service) {
    const db = openKnowledgeDb();
    service = new VectorStoreService(db, embeddingProvider);
  }
  return service;
}

// ---------------------------------------------------------------------------
// Tool handler
// ---------------------------------------------------------------------------

type ToolResult =
  | IUpsertResult
  | { results: ISearchResult[] }
  | IDeleteResult;

/**
 * The OpenClaw-compatible tool handler.
 *
 * OpenClaw invokes this function with the raw JSON params from the LLM
 * and a context object identifying the calling agent.
 *
 * @param params  - Deserialized JSON from the LLM tool call.
 * @param ctx     - Execution context (must include `agentId`).
 * @param deps    - Injectable dependencies. The caller MUST provide an
 *                  `embeddingProvider` since embedding strategy is deployment-specific.
 */
export async function handleVectorStore(
  params: IToolParams,
  ctx: ISkillContext,
  deps: { embeddingProvider: IEmbeddingProvider },
): Promise<ToolResult> {
  const svc = getService(deps.embeddingProvider);

  switch (params.action) {
    case 'upsert': {
      if (!params.content) {
        throw new Error('vector_store upsert: "content" is required.');
      }
      return svc.upsert(
        {
          id: params.id,
          namespace: params.namespace,
          content: params.content,
          metadata: params.metadata,
        },
        ctx,
      );
    }

    case 'search': {
      if (!params.query) {
        throw new Error('vector_store search: "query" is required.');
      }
      const results = await svc.search(
        {
          query: params.query,
          namespace: params.namespace,
          limit: params.limit,
          mode: params.mode,
          shared: params.shared,
        },
        ctx,
      );
      return { results };
    }

    case 'delete': {
      if (!params.id) {
        throw new Error('vector_store delete: "id" is required.');
      }
      return svc.delete(params.id, ctx);
    }

    default:
      throw new Error(
        `vector_store: unknown action "${params.action as string}". Expected: upsert, search, delete.`,
      );
  }
}

// ---------------------------------------------------------------------------
// OpenClaw skill manifest
// ---------------------------------------------------------------------------

const TOOL_PARAMETERS_SCHEMA = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string' as const,
      enum: ['upsert', 'search', 'delete'],
      description: 'The operation to perform on the knowledge store.',
    },
    id: {
      type: 'string' as const,
      description: 'Chunk ID. Required for delete. Optional for upsert (auto-generated if omitted).',
    },
    namespace: {
      type: 'string' as const,
      description: 'Logical partition key. Defaults to "default".',
    },
    content: {
      type: 'string' as const,
      description: 'The text to embed and store. Required for upsert.',
    },
    metadata: {
      type: 'object' as const,
      description: 'Arbitrary JSON metadata attached to the chunk.',
    },
    query: {
      type: 'string' as const,
      description: 'Natural-language search query. Required for search.',
    },
    limit: {
      type: 'number' as const,
      description: 'Max results to return (1–100). Defaults to 10.',
      default: 10,
    },
    mode: {
      type: 'string' as const,
      enum: ['hybrid', 'vector', 'fts'],
      description: 'Search strategy. Defaults to "hybrid".',
      default: 'hybrid',
    },
    shared: {
      type: 'boolean' as const,
      default: false,
      description:
        'If true, search across all agents\' knowledge (omnichannel). ' +
        'If false (default), restrict to the calling agent\'s entries.',
    },
  },
  required: ['action'],
} as const;

export default {
  name: 'gamma-knowledge',
  version: '0.1.0',
  tools: [
    {
      name: 'vector_store',
      description:
        'Persistent knowledge store with hybrid vector + full-text search. ' +
        'Supports upsert, search (hybrid/vector/fts), and delete operations. ' +
        'Data is shared across the Gamma agent ecosystem via an Omnichannel Knowledge Hub.',
      parameters: TOOL_PARAMETERS_SCHEMA,
      handler: handleVectorStore,
    },
  ],
};
