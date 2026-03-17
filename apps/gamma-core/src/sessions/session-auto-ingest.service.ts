/**
 * session-auto-ingest.service.ts
 *
 * Lightweight service that auto-ingests session conversation summaries
 * into the Gamma Knowledge Hub (vector_store) on lifecycle_end.
 *
 * Design constraints:
 *  - Fire-and-forget: errors are logged, never thrown into the hot path
 *  - Rate-limited: max 1 ingest per session per 30 seconds
 *  - Minimal payload: stores a concise snippet, not full transcripts
 *  - Agent-tagged: every record carries the correct _agentId
 */

import { Injectable, Logger } from '@nestjs/common';

// ---------------------------------------------------------------------------
// Lazy import of knowledge layer — avoids hard crash if the skill package
// is not installed or native bindings fail to load.
// ---------------------------------------------------------------------------

let VectorStoreService: any = null;
let openKnowledgeDb: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const knowledge = require('@gamma/openclaw-knowledge');
  VectorStoreService = knowledge.VectorStoreService;
  openKnowledgeDb = knowledge.openKnowledgeDb;
} catch {
  // Knowledge package not available — service will be disabled
}

// ---------------------------------------------------------------------------
// Embedding provider (mirrors the plugin's approach)
// ---------------------------------------------------------------------------

class SimpleEmbeddingProvider {
  private _dimensions = -1;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor() {
    this.baseUrl = (process.env['OLLAMA_BASE_URL'] ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = process.env['OLLAMA_MODEL'] ?? 'nomic-embed-text';
  }

  get dimensions(): number {
    return this._dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Ollama HTTP ${response.status}`);
      }

      const json = (await response.json()) as { embedding?: number[] };
      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error('Invalid embedding response');
      }

      if (this._dimensions < 0) {
        this._dimensions = json.embedding.length;
      }

      return new Float32Array(json.embedding);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Auto-Ingest Service
// ---------------------------------------------------------------------------

const INGEST_NAMESPACE = 'session-history';
const MIN_CONTENT_LENGTH = 60;
const RATE_LIMIT_MS = 30_000; // 30 seconds per session

@Injectable()
export class SessionAutoIngestService {
  private readonly logger = new Logger('AutoIngest');
  private readonly enabled: boolean;
  private store: any = null;
  private embeddingProvider: SimpleEmbeddingProvider | null = null;
  private readonly lastIngestTime = new Map<string, number>();

  constructor() {
    this.enabled = VectorStoreService != null && openKnowledgeDb != null;
    if (!this.enabled) {
      this.logger.warn('Knowledge package not available — auto-ingest disabled');
    } else {
      this.logger.log('Auto-ingest service initialized');
    }
  }

  /**
   * Called from GatewayWsService on lifecycle_end.
   * Ingests a summary of the completed agent run into the knowledge store.
   *
   * @param sessionKey  Agent session key (used as _agentId)
   * @param windowId    UI window ID
   * @param runId       Completed run ID
   * @param streamText  Full streamed response text from the agent
   */
  async onRunCompleted(
    sessionKey: string,
    windowId: string,
    runId: string,
    streamText: string,
  ): Promise<void> {
    if (!this.enabled) return;

    // Rate limit check
    const now = Date.now();
    const lastTime = this.lastIngestTime.get(sessionKey) ?? 0;
    if (now - lastTime < RATE_LIMIT_MS) {
      this.logger.debug(`Rate limited: ${sessionKey} (${now - lastTime}ms since last)`);
      return;
    }

    // Skip trivially short responses
    const trimmed = streamText.trim();
    if (trimmed.length < MIN_CONTENT_LENGTH) {
      this.logger.debug(`Skipping short response (${trimmed.length} chars) for ${sessionKey}`);
      return;
    }

    // Create snippet: first 500 chars of the response
    const snippet = trimmed.length > 500 ? trimmed.slice(0, 500) + '…' : trimmed;

    try {
      const store = this.getStore();
      if (!store) return;

      await store.upsert(
        {
          namespace: INGEST_NAMESPACE,
          content: snippet,
          metadata: {
            windowId,
            runId,
            ts: now,
            autoIngested: true,
          },
        },
        { agentId: sessionKey },
      );

      this.lastIngestTime.set(sessionKey, now);
      this.logger.log(
        `Ingested ${snippet.length} chars for ${sessionKey} (run=${runId.slice(0, 8)})`,
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Auto-ingest failed for ${sessionKey}: ${msg}`);
    }
  }

  private getStore(): any {
    if (this.store) return this.store;
    try {
      const db = openKnowledgeDb();
      if (!this.embeddingProvider) {
        this.embeddingProvider = new SimpleEmbeddingProvider();
      }
      this.store = new VectorStoreService(db, this.embeddingProvider);
      return this.store;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to initialize knowledge store: ${msg}`);
      this.store = null;
      return null;
    }
  }
}
