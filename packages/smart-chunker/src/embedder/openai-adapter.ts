/**
 * OpenAI embedding adapter.
 *
 * Uses the official OpenAI SDK to generate embeddings via
 * `text-embedding-3-small` (1536 dimensions). Includes a concurrency
 * semaphore to stay within rate limits.
 */

import type { IEmbeddingProvider } from './embedding-provider.interface.js';

// ---------------------------------------------------------------------------
// Types — minimal subset of the OpenAI SDK response shape.
// We use dynamic import so the `openai` package is optional at install time.
// ---------------------------------------------------------------------------

interface EmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

interface OpenAIClient {
  embeddings: {
    create(params: {
      model: string;
      input: string;
      encoding_format?: string;
    }): Promise<EmbeddingResponse>;
  };
}

// ---------------------------------------------------------------------------
// Semaphore — limits concurrent in-flight API calls
// ---------------------------------------------------------------------------

class Semaphore {
  private queue: Array<() => void> = [];
  private active = 0;

  constructor(private readonly max: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.active--;
    const next = this.queue.shift();
    if (next) {
      this.active++;
      next();
    }
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export interface OpenAIAdapterOptions {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  apiKey?: string;
  /** Model to use (default: 'text-embedding-3-small'). */
  model?: string;
  /** Max concurrent API requests (default: 5). */
  concurrency?: number;
}

export class OpenAIEmbeddingAdapter implements IEmbeddingProvider {
  readonly dimensions = 1536;

  private client: OpenAIClient | null = null;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly semaphore: Semaphore;

  constructor(options: OpenAIAdapterOptions = {}) {
    const key = options.apiKey ?? process.env.OPENAI_API_KEY ?? '';
    if (!key) {
      throw new Error(
        'OpenAI adapter requires an API key. Set OPENAI_API_KEY env var or pass apiKey option.',
      );
    }
    this.apiKey = key;
    this.model = options.model ?? 'text-embedding-3-small';
    this.semaphore = new Semaphore(options.concurrency ?? 5);
  }

  async embed(text: string): Promise<Float32Array> {
    const client = await this.getClient();

    await this.semaphore.acquire();
    try {
      const response = await client.embeddings.create({
        model: this.model,
        input: text,
        encoding_format: 'float',
      });

      const embedding = response.data[0]?.embedding;
      if (!embedding) {
        throw new Error('OpenAI returned empty embedding response');
      }

      return new Float32Array(embedding);
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Lazily import and instantiate the OpenAI client.
   * This allows the package to be installed without `openai` as a hard dep —
   * the adapter is only used when explicitly selected via --embedding-provider.
   */
  private async getClient(): Promise<OpenAIClient> {
    if (this.client) return this.client;

    try {
      // Dynamic import — openai is a peer/optional dependency
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({ apiKey: this.apiKey }) as unknown as OpenAIClient;
      return this.client;
    } catch {
      throw new Error(
        'Failed to import "openai" package. Install it with: pnpm add openai',
      );
    }
  }
}
