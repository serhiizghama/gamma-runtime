/**
 * index.ts — OpenClaw Plugin entry point for gamma-knowledge.
 *
 * Registers a single tool (`vector_store`) with actions:
 * upsert, upsert_with_vector, search, delete.
 *
 * The database and embedding provider are initialized lazily on first
 * invocation and reused across calls.
 *
 * Plugin API: exports a default function `register(api)` that calls
 * `api.registerTool()` per the OpenClaw plugin contract.
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
  IVectorUpsertWithVectorInput,
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

    case 'upsert_with_vector': {
      if (!params.content) {
        throw new Error('vector_store upsert_with_vector: "content" is required.');
      }
      if (!params.vector || !Array.isArray(params.vector)) {
        throw new Error('vector_store upsert_with_vector: "vector" (number[]) is required.');
      }
      return svc.upsertWithVector(
        {
          id: params.id,
          namespace: params.namespace,
          content: params.content,
          vector: new Float32Array(params.vector),
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
        `vector_store: unknown action "${params.action as string}". Expected: upsert, upsert_with_vector, search, delete.`,
      );
  }
}

// ---------------------------------------------------------------------------
// Tool JSON Schema (for registerTool parameters)
// ---------------------------------------------------------------------------

const TOOL_PARAMETERS_SCHEMA = {
  type: 'object' as const,
  properties: {
    action: {
      type: 'string' as const,
      enum: ['upsert', 'upsert_with_vector', 'search', 'delete'],
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
    vector: {
      type: 'array' as const,
      items: { type: 'number' as const },
      description: 'Pre-computed embedding vector (number[]). Required for upsert_with_vector.',
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

// ---------------------------------------------------------------------------
// OpenClaw Plugin registration
// ---------------------------------------------------------------------------

/**
 * OpenClaw Plugin entry point.
 *
 * Called by the Gateway at startup with the plugin API object.
 * Registers the `vector_store` tool so it becomes available via
 * `/tools/invoke` and agent tool calls.
 */
export default function register(api: any): void {
  api.registerTool({
    name: 'vector_store',
    description:
      'Persistent knowledge store with hybrid vector + full-text search. ' +
      'Supports upsert, upsert_with_vector, search (hybrid/vector/fts), and delete operations. ' +
      'Data is shared across the Gamma agent ecosystem via an Omnichannel Knowledge Hub.',
    parameters: TOOL_PARAMETERS_SCHEMA,
    async execute(_id: string, params: IToolParams, ctx?: { sessionKey?: string; agentId?: string }) {
      // Build the skill context from the plugin execution context
      const skillCtx: ISkillContext = {
        agentId: ctx?.agentId ?? ctx?.sessionKey ?? 'unknown',
      };

      // For now, we create a no-op embedding provider for upsert_with_vector
      // (vectors are pre-computed). For upsert/search, the provider is needed.
      const noopProvider: IEmbeddingProvider = {
        dimensions: -1,
        async embed(_text: string): Promise<Float32Array> {
          throw new Error(
            'vector_store plugin: embedding provider not configured. ' +
            'Use upsert_with_vector with pre-computed embeddings, or configure an embedding provider.',
          );
        },
      };

      const result = await handleVectorStore(params, skillCtx, {
        embeddingProvider: noopProvider,
      });

      // Return in MCP tool result format
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result),
          },
        ],
      };
    },
  });
}
