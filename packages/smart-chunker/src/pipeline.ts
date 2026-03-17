/**
 * Core pipeline orchestrator.
 *
 * Coordinates the full ingestion flow:
 * 1. Load manifest (incremental change detection)
 * 2. Scan directories for eligible files
 * 3. Hash each file and skip unchanged ones
 * 4. Chunk modified/new files via the ChunkerRegistry
 * 5. (Optional) Generate embeddings client-side
 * 6. Delete stale chunks for files that changed
 * 7. Upsert new chunks via the BatchUpserter
 * 8. Save updated manifest
 */

import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { scanDirectory } from './scanner/file-scanner.js';
import { chunkFile } from './chunker/chunker-registry.js';
import type { Chunk } from './chunker/chunk.interface.js';
import type { IEmbeddingProvider } from './embedder/embedding-provider.interface.js';
import { GatewayClient, type GatewayClientOptions, type EmbeddedChunk } from './upserter/gateway-client.js';
import { BatchUpserter, type UpsertReport, type BatchUpsertOptions } from './upserter/batch-upserter.js';
import { Logger } from './utils/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineConfig {
  /** Directories to scan (absolute or relative to cwd). */
  targets: string[];
  /** Project name stamped into chunk metadata. */
  projectName: string;
  /** Agent ID for vector store access control. */
  agentId: string;
  /** Path to the manifest file for incremental detection. */
  manifestPath: string;
  /** Gateway connection options. */
  gateway: GatewayClientOptions;
  /** Batch upserter tuning options. */
  batch?: BatchUpsertOptions;
  /**
   * Optional client-side embedding provider.
   * When set, embeddings are generated locally and sent via `upsert_with_vector`.
   * When null, the gateway's internal embedding provider is used.
   */
  embeddingProvider?: IEmbeddingProvider | null;
  /** Skip the manifest and re-ingest everything. */
  force?: boolean;
  /** Dry-run mode: chunk but don't upsert. */
  dryRun?: boolean;
  /** Log level. */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

export interface PipelineResult {
  /** Total files scanned across all targets. */
  filesScanned: number;
  /** Files skipped because their hash matched the manifest. */
  filesSkipped: number;
  /** Files that were new or modified since last run. */
  filesProcessed: number;
  /** Total chunks generated from processed files. */
  chunksGenerated: number;
  /** Stale chunks deleted (from files that changed). */
  staleChunksDeleted: number;
  /** Upsert report (null in dry-run mode). */
  upsert: UpsertReport | null;
  /** Duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

interface ManifestEntry {
  contentHash: string;
  chunkIds: string[];
  lastIngested: string;
}

type Manifest = Record<string, ManifestEntry>;

async function loadManifest(path: string): Promise<Manifest> {
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as Manifest;
  } catch {
    return {};
  }
}

async function saveManifest(path: string, manifest: Manifest): Promise<void> {
  await writeFile(path, JSON.stringify(manifest, null, 2), 'utf-8');
}

function hashFileContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(config: PipelineConfig): Promise<PipelineResult> {
  const start = performance.now();
  const log = new Logger(config.logLevel ?? 'info');
  const embeddingProvider = config.embeddingProvider ?? null;

  const result: PipelineResult = {
    filesScanned: 0,
    filesSkipped: 0,
    filesProcessed: 0,
    chunksGenerated: 0,
    staleChunksDeleted: 0,
    upsert: null,
    durationMs: 0,
  };

  // 1. Load manifest
  const manifest = config.force ? {} : await loadManifest(config.manifestPath);
  const newManifest: Manifest = {};
  log.debug('Manifest loaded', { entries: Object.keys(manifest).length, force: !!config.force });

  // 2. Scan all targets
  const allChunks: Chunk[] = [];
  const staleChunkIds: string[] = [];
  const seenFiles = new Set<string>();

  for (const target of config.targets) {
    const absTarget = resolve(target);
    log.info(`Scanning: ${absTarget}`);

    const files = await scanDirectory(absTarget);
    result.filesScanned += files.length;
    log.info(`  Found ${files.length} files`);

    // 3. Hash and diff against manifest
    for (let fi = 0; fi < files.length; fi++) {
      const file = files[fi];
      seenFiles.add(file.relativePath);
      const fileHash = hashFileContent(file.content);
      const prev = manifest[file.relativePath];

      if (prev && prev.contentHash === fileHash) {
        result.filesSkipped++;
        newManifest[file.relativePath] = prev;
        continue;
      }

      const chunks = chunkFile(file, {
        projectName: config.projectName,
        agentId: config.agentId,
      });

      allChunks.push(...chunks);
      result.filesProcessed++;

      if (prev) {
        const newIds = new Set(chunks.map((c) => c.id));
        for (const oldId of prev.chunkIds) {
          if (!newIds.has(oldId)) {
            staleChunkIds.push(oldId);
          }
        }
      }

      newManifest[file.relativePath] = {
        contentHash: fileHash,
        chunkIds: chunks.map((c) => c.id),
        lastIngested: new Date().toISOString(),
      };

      log.progress(fi + 1, files.length, 'files processed');
    }

    log.clearProgress();
  }

  // Detect deleted files
  for (const [filePath, entry] of Object.entries(manifest)) {
    if (!seenFiles.has(filePath)) {
      staleChunkIds.push(...entry.chunkIds);
      log.debug(`Deleted file detected: ${filePath}`, { staleChunks: entry.chunkIds.length });
    }
  }

  result.chunksGenerated = allChunks.length;

  log.info('Scan complete', {
    scanned: result.filesScanned,
    skipped: result.filesSkipped,
    processed: result.filesProcessed,
    chunks: allChunks.length,
    stale: staleChunkIds.length,
  });

  // 4. Dry-run: skip network operations
  if (config.dryRun) {
    log.info('Dry-run mode — skipping upsert and manifest save');
    result.durationMs = performance.now() - start;
    return result;
  }

  // 5. Upsert via gateway
  const client = new GatewayClient(config.gateway, log);
  const upserter = new BatchUpserter(client, log, config.batch);

  // Delete stale chunks first
  if (staleChunkIds.length > 0) {
    result.staleChunksDeleted = await upserter.deleteStale(staleChunkIds, config.agentId);
    log.info(`Deleted ${result.staleChunksDeleted}/${staleChunkIds.length} stale chunks`);
  }

  // Upsert new/modified chunks
  if (allChunks.length > 0) {
    if (embeddingProvider) {
      // Client-side embedding → upsert_with_vector
      log.info(`Generating embeddings client-side (${embeddingProvider.dimensions}d)...`);
      const embedded = await embedChunks(allChunks, embeddingProvider, log);
      result.upsert = await upserter.upsertWithVectors(embedded);
    } else {
      // Gateway-side embedding → standard upsert
      result.upsert = await upserter.upsert(allChunks);
    }

    log.info('Upsert complete', {
      created: result.upsert.created,
      updated: result.upsert.updated,
      failed: result.upsert.failed,
      durationMs: Math.round(result.upsert.durationMs),
    });
  }

  // 6. Save manifest
  await saveManifest(config.manifestPath, newManifest);
  log.info(`Manifest saved: ${config.manifestPath}`);

  result.durationMs = performance.now() - start;
  return result;
}

// ---------------------------------------------------------------------------
// Client-side embedding generation
// ---------------------------------------------------------------------------

async function embedChunks(
  chunks: Chunk[],
  provider: IEmbeddingProvider,
  log: Logger,
): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      const vector = await provider.embed(chunk.content);
      results.push({ chunk, vector });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Embedding failed for chunk ${chunk.id}: ${msg}`);
      // Still include the chunk — it will fail at upsert but gets reported
      results.push({ chunk, vector: new Float32Array(0) });
    }
    log.progress(i + 1, chunks.length, 'embeddings generated');
  }

  log.clearProgress();
  return results;
}
