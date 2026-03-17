/**
 * Batched, concurrent upserter with retry logic.
 *
 * Processes chunks in batches, sending multiple upsert requests in parallel
 * within each batch. Failed chunks are retried once with exponential backoff.
 *
 * Supports two modes:
 * - Standard upsert (gateway generates embeddings)
 * - Pre-embedded upsert (client sends vectors alongside content)
 */

import type { Chunk } from '../chunker/chunk.interface.js';
import type { GatewayClient, UpsertResponse, EmbeddedChunk } from './gateway-client.js';
import { Logger } from '../utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BatchUpsertOptions {
  /** Number of chunks per batch (default: 20). */
  batchSize?: number;
  /** Max concurrent requests within a batch (default: 5). */
  concurrency?: number;
  /** Max number of retries for failed chunks (default: 1). */
  maxRetries?: number;
}

export interface UpsertReport {
  /** Total chunks processed. */
  total: number;
  /** Successfully created chunks. */
  created: number;
  /** Successfully updated chunks. */
  updated: number;
  /** Chunks that failed after all retries. */
  failed: number;
  /** Details of each failed chunk. */
  errors: Array<{ chunkId: string; filePath: string; error: string }>;
  /** Duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Upserter item: wraps either a plain Chunk or an EmbeddedChunk
// ---------------------------------------------------------------------------

interface UpsertItem {
  chunk: Chunk;
  vector?: Float32Array;
}

// ---------------------------------------------------------------------------
// Batch upserter
// ---------------------------------------------------------------------------

export class BatchUpserter {
  private readonly client: GatewayClient;
  private readonly log: Logger;
  private readonly batchSize: number;
  private readonly concurrency: number;
  private readonly maxRetries: number;

  constructor(client: GatewayClient, logger: Logger, options: BatchUpsertOptions = {}) {
    this.client = client;
    this.log = logger;
    this.batchSize = options.batchSize ?? 20;
    this.concurrency = options.concurrency ?? 5;
    this.maxRetries = options.maxRetries ?? 1;
  }

  /**
   * Upsert plain chunks (gateway generates embeddings server-side).
   */
  async upsert(chunks: Chunk[]): Promise<UpsertReport> {
    return this.processItems(chunks.map((c) => ({ chunk: c })));
  }

  /**
   * Upsert pre-embedded chunks (client sends vectors alongside content).
   */
  async upsertWithVectors(embedded: EmbeddedChunk[]): Promise<UpsertReport> {
    return this.processItems(embedded.map((e) => ({ chunk: e.chunk, vector: e.vector })));
  }

  /**
   * Delete a list of chunk IDs from the gateway.
   */
  async deleteStale(chunkIds: string[], agentId: string): Promise<number> {
    if (chunkIds.length === 0) return 0;

    this.log.info(`Deleting ${chunkIds.length} stale chunks...`);
    let deleted = 0;

    for (let i = 0; i < chunkIds.length; i += this.concurrency) {
      const batch = chunkIds.slice(i, i + this.concurrency);
      const results = await Promise.all(
        batch.map((id) => this.client.deleteChunk(id, agentId)),
      );
      deleted += results.filter(Boolean).length;
    }

    return deleted;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async processItems(items: UpsertItem[]): Promise<UpsertReport> {
    const start = performance.now();
    const report: UpsertReport = {
      total: items.length,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
      durationMs: 0,
    };

    if (items.length === 0) {
      report.durationMs = performance.now() - start;
      return report;
    }

    const mode = items[0].vector ? 'pre-embedded' : 'gateway-embedded';
    this.log.info(`Upserting ${items.length} chunks [${mode}] (batch=${this.batchSize}, concurrency=${this.concurrency})`);

    // First pass
    let failedItems: UpsertItem[] = [];
    let processed = 0;

    for (let i = 0; i < items.length; i += this.batchSize) {
      const batch = items.slice(i, i + this.batchSize);
      const results = await this.processBatch(batch);

      for (const result of results) {
        if (result.ok) {
          if (result.status === 'updated') report.updated++;
          else report.created++;
        } else {
          const item = batch.find((it) => it.chunk.id === result.chunkId);
          if (item) failedItems.push(item);
        }
      }

      processed += batch.length;
      this.log.progress(processed, items.length, 'chunks upserted');
    }

    // Retry pass
    if (failedItems.length > 0 && this.maxRetries > 0) {
      this.log.clearProgress();
      this.log.info(`Retrying ${failedItems.length} failed chunks...`);

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        const stillFailing: UpsertItem[] = [];
        const delay = 1000 * Math.pow(2, attempt);
        await sleep(delay);

        for (let i = 0; i < failedItems.length; i += this.batchSize) {
          const batch = failedItems.slice(i, i + this.batchSize);
          const results = await this.processBatch(batch);

          for (const result of results) {
            if (result.ok) {
              if (result.status === 'updated') report.updated++;
              else report.created++;
            } else {
              const item = batch.find((it) => it.chunk.id === result.chunkId);
              if (item) stillFailing.push(item);
            }
          }
        }

        failedItems = stillFailing;
        if (failedItems.length === 0) break;
      }
    }

    for (const item of failedItems) {
      report.failed++;
      report.errors.push({
        chunkId: item.chunk.id,
        filePath: item.chunk.metadata.filePath,
        error: 'Failed after all retries',
      });
    }

    report.durationMs = performance.now() - start;
    return report;
  }

  private async processBatch(batch: UpsertItem[]): Promise<UpsertResponse[]> {
    const results: UpsertResponse[] = [];

    for (let i = 0; i < batch.length; i += this.concurrency) {
      const wave = batch.slice(i, i + this.concurrency);
      const waveResults = await Promise.all(
        wave.map((item) =>
          item.vector
            ? this.client.upsertChunkWithVector({ chunk: item.chunk, vector: item.vector })
            : this.client.upsertChunk(item.chunk),
        ),
      );
      results.push(...waveResults);
    }

    return results;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
