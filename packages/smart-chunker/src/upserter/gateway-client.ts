/**
 * HTTP client for the OpenClaw Gateway `/tools/invoke` endpoint.
 *
 * Sends tool invocation requests matching the exact payload format expected
 * by the gateway: `{ tool, args, sessionKey }`. Uses native `fetch` —
 * no HTTP library dependency.
 *
 * Supports two upsert modes:
 * - `upsertChunk`: standard upsert (gateway generates the embedding)
 * - `upsertChunkWithVector`: sends a pre-computed embedding (skips server-side embedding)
 */

import type { Chunk } from '../chunker/chunk.interface.js';
import { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GatewayClientOptions {
  /** Full URL of the OpenClaw Gateway (e.g. http://localhost:18789). */
  gatewayUrl: string;
  /** Bearer token for authentication. */
  gatewayToken: string;
  /** Namespace for vector store partitioning (default: 'codebase'). */
  namespace: string;
  /** Request timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
}

/** Result from a single upsert call. */
export interface UpsertResponse {
  ok: boolean;
  chunkId: string;
  status?: 'created' | 'updated';
  error?: string;
}

/** A chunk paired with its pre-computed embedding. */
export interface EmbeddedChunk {
  chunk: Chunk;
  vector: Float32Array;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class GatewayClient {
  private readonly url: string;
  private readonly token: string;
  private readonly namespace: string;
  private readonly timeoutMs: number;
  private readonly log: Logger;

  constructor(options: GatewayClientOptions, logger: Logger) {
    // Normalize: strip trailing slash, convert ws:// to http://
    const base = options.gatewayUrl
      .replace(/\/+$/, '')
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');
    this.url = `${base}/tools/invoke`;
    this.token = options.gatewayToken;
    this.namespace = options.namespace;
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.log = logger;
  }

  /**
   * Standard upsert — the gateway's embedding provider generates the vector.
   */
  async upsertChunk(chunk: Chunk): Promise<UpsertResponse> {
    return this.invoke(chunk.id, {
      action: 'upsert',
      id: chunk.id,
      namespace: this.namespace,
      content: chunk.content,
      metadata: chunk.metadata,
    }, chunk.metadata._agentId);
  }

  /**
   * Pre-embedded upsert — sends the vector alongside the content so the
   * gateway skips its internal embedding step. Uses the `upsert_with_vector` action.
   */
  async upsertChunkWithVector(embedded: EmbeddedChunk): Promise<UpsertResponse> {
    const { chunk, vector } = embedded;
    return this.invoke(chunk.id, {
      action: 'upsert_with_vector',
      id: chunk.id,
      namespace: this.namespace,
      content: chunk.content,
      metadata: chunk.metadata,
      vector: Array.from(vector),
    }, chunk.metadata._agentId);
  }

  /**
   * Delete a chunk from the vector store by ID.
   */
  async deleteChunk(chunkId: string, agentId: string): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          tool: 'vector_store',
          args: { action: 'delete', id: chunkId },
          sessionKey: agentId,
        }),
        signal: controller.signal,
      });

      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------------
  // Private: shared HTTP invocation logic
  // -------------------------------------------------------------------------

  private async invoke(
    chunkId: string,
    args: Record<string, unknown>,
    agentId: string,
  ): Promise<UpsertResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({
          tool: 'vector_store',
          args,
          sessionKey: agentId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '<unreadable>');
        return {
          ok: false,
          chunkId,
          error: `HTTP ${response.status}: ${text.slice(0, 200)}`,
        };
      }

      const payload = await response.json() as Record<string, unknown>;

      return {
        ok: true,
        chunkId,
        status: (payload.status as 'created' | 'updated') ?? 'created',
      };
    } catch (err: unknown) {
      const message = err instanceof DOMException && err.name === 'AbortError'
        ? `Timeout after ${this.timeoutMs}ms`
        : err instanceof Error ? err.message : String(err);

      return { ok: false, chunkId, error: message };
    } finally {
      clearTimeout(timer);
    }
  }
}
