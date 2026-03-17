/**
 * Ollama embedding adapter.
 *
 * Generates embeddings using a local Ollama instance via its HTTP API
 * (`/api/embeddings`). Supports any Ollama-compatible embedding model
 * (e.g. nomic-embed-text, mxbai-embed-large).
 *
 * The embedding dimensions are detected automatically on the first call
 * by inspecting the length of the returned vector.
 */

import type { IEmbeddingProvider } from './embedding-provider.interface.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OllamaEmbeddingResponse {
  embedding: number[];
}

export interface OllamaAdapterOptions {
  /** Base URL of the Ollama server (default: 'http://localhost:11434'). */
  baseUrl?: string;
  /** Model name (default: 'nomic-embed-text'). */
  model?: string;
  /** Request timeout in milliseconds (default: 30_000). */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class OllamaEmbeddingAdapter implements IEmbeddingProvider {
  /** Detected on first embed() call; -1 until then. */
  private _dimensions = -1;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(options: OllamaAdapterOptions = {}) {
    this.baseUrl = (options.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.model = options.model ?? 'nomic-embed-text';
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  get dimensions(): number {
    if (this._dimensions < 0) {
      throw new Error(
        'Ollama adapter dimensions unknown — call embed() at least once first.',
      );
    }
    return this._dimensions;
  }

  async embed(text: string): Promise<Float32Array> {
    const url = `${this.baseUrl}/api/embeddings`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '<unreadable>');
        throw new Error(
          `Ollama embedding request failed (HTTP ${response.status}): ${body.slice(0, 200)}`,
        );
      }

      const json = (await response.json()) as OllamaEmbeddingResponse;

      if (!json.embedding || !Array.isArray(json.embedding)) {
        throw new Error('Ollama returned invalid embedding response (missing "embedding" array)');
      }

      // Detect dimensions on first call
      if (this._dimensions < 0) {
        this._dimensions = json.embedding.length;
      }

      return new Float32Array(json.embedding);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        throw new Error(`Ollama embedding request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
