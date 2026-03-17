#!/usr/bin/env node
/**
 * gamma-ingest CLI — Smart Chunker pipeline entry point.
 *
 * Scans target directories, semantically chunks files, optionally generates
 * embeddings client-side, and upserts the results to the OpenClaw Gateway.
 *
 * Usage:
 *   gamma-ingest --target ./src --project my-project --dry-run
 *   gamma-ingest --target ./src --project my-project --gateway-token $TOKEN
 *   gamma-ingest --target ./src --project my-project --embedding-provider openai
 *   gamma-ingest --target ./src --project my-project --embedding-provider ollama --ollama-model nomic-embed-text
 */

import { resolve, join } from 'node:path';
import { runPipeline, type PipelineConfig } from './pipeline.js';
import { scanDirectory } from './scanner/file-scanner.js';
import { chunkFile } from './chunker/chunker-registry.js';
import type { Chunk } from './chunker/chunk.interface.js';
import type { IEmbeddingProvider } from './embedder/embedding-provider.interface.js';

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

interface CliArgs {
  targets: string[];
  projectName: string;
  agentId: string;
  gatewayUrl: string;
  gatewayToken: string;
  namespace: string;
  embeddingProvider: 'none' | 'openai' | 'ollama';
  openaiApiKey: string;
  openaiModel: string;
  ollamaUrl: string;
  ollamaModel: string;
  dryRun: boolean;
  force: boolean;
  json: boolean;
  concurrency: number;
  batchSize: number;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    targets: [],
    projectName: 'unnamed',
    agentId: 'system-ingestion',
    gatewayUrl: process.env.OPENCLAW_GATEWAY_URL ?? 'ws://localhost:18789',
    gatewayToken: process.env.OPENCLAW_GATEWAY_TOKEN ?? '',
    namespace: 'codebase',
    embeddingProvider: 'none',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: 'text-embedding-3-small',
    ollamaUrl: 'http://localhost:11434',
    ollamaModel: 'nomic-embed-text',
    dryRun: false,
    force: false,
    json: false,
    concurrency: 5,
    batchSize: 20,
    logLevel: 'info',
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--target':
      case '-t':
        if (argv[i + 1]) args.targets.push(argv[++i]);
        break;
      case '--project':
      case '-p':
        if (argv[i + 1]) args.projectName = argv[++i];
        break;
      case '--agent-id':
        if (argv[i + 1]) args.agentId = argv[++i];
        break;
      case '--gateway-url':
        if (argv[i + 1]) args.gatewayUrl = argv[++i];
        break;
      case '--gateway-token':
        if (argv[i + 1]) args.gatewayToken = argv[++i];
        break;
      case '--namespace':
        if (argv[i + 1]) args.namespace = argv[++i];
        break;
      case '--embedding-provider':
        if (argv[i + 1]) args.embeddingProvider = argv[++i] as CliArgs['embeddingProvider'];
        break;
      case '--openai-api-key':
        if (argv[i + 1]) args.openaiApiKey = argv[++i];
        break;
      case '--openai-model':
        if (argv[i + 1]) args.openaiModel = argv[++i];
        break;
      case '--ollama-url':
        if (argv[i + 1]) args.ollamaUrl = argv[++i];
        break;
      case '--ollama-model':
        if (argv[i + 1]) args.ollamaModel = argv[++i];
        break;
      case '--concurrency':
        if (argv[i + 1]) args.concurrency = parseInt(argv[++i], 10);
        break;
      case '--batch-size':
        if (argv[i + 1]) args.batchSize = parseInt(argv[++i], 10);
        break;
      case '--log-level':
        if (argv[i + 1]) args.logLevel = argv[++i] as CliArgs['logLevel'];
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--force':
        args.force = true;
        break;
      case '--json':
        args.json = true;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
      default:
        if (!arg.startsWith('-')) {
          args.targets.push(arg);
        } else {
          console.error(`Unknown flag: ${arg}`);
          process.exit(1);
        }
    }
  }

  if (args.targets.length === 0) {
    console.error('Error: at least one --target is required.\n');
    printHelp();
    process.exit(1);
  }

  return args;
}

function printHelp(): void {
  console.log(`
gamma-ingest — Semantic code & document chunker for the Gamma Knowledge Hub

Usage:
  gamma-ingest --target <dir> [--target <dir2>] --project <name> [options]

Targets & Metadata:
  -t, --target <dir>              Directory to scan (repeatable, required)
  -p, --project <name>            Project name for metadata (default: "unnamed")
      --agent-id <id>             Agent ID for metadata (default: "system-ingestion")
      --namespace <ns>            Vector store namespace (default: "codebase")

Gateway Connection:
      --gateway-url <url>         OpenClaw Gateway URL (default: env OPENCLAW_GATEWAY_URL)
      --gateway-token <token>     Bearer token (default: env OPENCLAW_GATEWAY_TOKEN)

Embedding (client-side, optional):
      --embedding-provider <p>    none | openai | ollama (default: none = gateway embeds)
      --openai-api-key <key>      OpenAI API key (default: env OPENAI_API_KEY)
      --openai-model <model>      OpenAI model (default: text-embedding-3-small)
      --ollama-url <url>          Ollama server URL (default: http://localhost:11434)
      --ollama-model <model>      Ollama model (default: nomic-embed-text)

Pipeline Control:
      --dry-run                   Chunk locally, print results, skip network ops
      --force                     Ignore manifest, re-ingest all files
      --json                      Output chunks as JSON (dry-run mode)
      --batch-size <n>            Chunks per batch (default: 20)
      --concurrency <n>           Parallel requests per batch (default: 5)
      --log-level <level>         debug | info | warn | error (default: info)

  -h, --help                      Show this help message
`);
}

// ---------------------------------------------------------------------------
// Embedding provider factory
// ---------------------------------------------------------------------------

async function createEmbeddingProvider(args: CliArgs): Promise<IEmbeddingProvider | null> {
  switch (args.embeddingProvider) {
    case 'none':
      return null;

    case 'openai': {
      const { OpenAIEmbeddingAdapter } = await import('./embedder/openai-adapter.js');
      return new OpenAIEmbeddingAdapter({
        apiKey: args.openaiApiKey,
        model: args.openaiModel,
        concurrency: args.concurrency,
      });
    }

    case 'ollama': {
      const { OllamaEmbeddingAdapter } = await import('./embedder/ollama-adapter.js');
      return new OllamaEmbeddingAdapter({
        baseUrl: args.ollamaUrl,
        model: args.ollamaModel,
      });
    }

    default:
      console.error(`Unknown embedding provider: ${args.embeddingProvider}`);
      console.error('Valid options: none, openai, ollama');
      process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Dry-run mode
// ---------------------------------------------------------------------------

async function runDryMode(args: CliArgs): Promise<void> {
  const allChunks: Chunk[] = [];
  let totalFiles = 0;

  for (const target of args.targets) {
    const absTarget = resolve(target);
    console.error(`Scanning: ${absTarget}`);

    const files = await scanDirectory(absTarget);
    totalFiles += files.length;
    console.error(`  Found ${files.length} files`);

    for (const file of files) {
      const chunks = chunkFile(file, {
        projectName: args.projectName,
        agentId: args.agentId,
      });
      allChunks.push(...chunks);
    }
  }

  console.error(`\nTotal: ${totalFiles} files → ${allChunks.length} chunks\n`);

  if (args.json) {
    console.log(JSON.stringify(allChunks, null, 2));
  } else {
    printHumanReadable(allChunks);
  }
}

function printHumanReadable(chunks: Chunk[]): void {
  const byFile = new Map<string, Chunk[]>();
  for (const chunk of chunks) {
    const key = chunk.metadata.filePath;
    if (!byFile.has(key)) byFile.set(key, []);
    byFile.get(key)!.push(chunk);
  }

  for (const [filePath, fileChunks] of byFile) {
    console.log(`━━━ ${filePath} (${fileChunks.length} chunks) ━━━`);
    for (const chunk of fileChunks) {
      const m = chunk.metadata;
      const symbol = m.symbolName ? ` [${m.symbolType}: ${m.symbolName}]` : '';
      const heading = m.headingPath ? ` [${m.headingPath}]` : '';
      console.log(`  ┌─ chunk ${m.chunkIndex + 1}/${m.totalChunks}${symbol}${heading}  L${m.lineStart}–${m.lineEnd}  (${chunk.content.length} chars)`);
      const preview = chunk.content.slice(0, 120).replace(/\n/g, '↵');
      console.log(`  │  ${preview}${chunk.content.length > 120 ? '…' : ''}`);
      console.log(`  └─ id: ${chunk.id}`);
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Full pipeline
// ---------------------------------------------------------------------------

async function runFull(args: CliArgs): Promise<void> {
  if (!args.gatewayToken) {
    console.error(
      'Error: --gateway-token or OPENCLAW_GATEWAY_TOKEN env var is required for live mode.\n' +
      'Use --dry-run to test without a gateway connection.',
    );
    process.exit(1);
  }

  const embeddingProvider = await createEmbeddingProvider(args);
  const manifestPath = join(resolve(args.targets[0]), '..', '.gamma-ingest.manifest.json');

  const config: PipelineConfig = {
    targets: args.targets,
    projectName: args.projectName,
    agentId: args.agentId,
    manifestPath,
    force: args.force,
    dryRun: false,
    logLevel: args.logLevel,
    embeddingProvider,
    gateway: {
      gatewayUrl: args.gatewayUrl,
      gatewayToken: args.gatewayToken,
      namespace: args.namespace,
    },
    batch: {
      batchSize: args.batchSize,
      concurrency: args.concurrency,
    },
  };

  const result = await runPipeline(config);

  // Print summary
  const embLabel = embeddingProvider ? 'client-side' : 'gateway';
  console.error(`\n┌─────────────────────────────────────────┐`);
  console.error(`│  INGESTION COMPLETE  [embed: ${embLabel.padEnd(11)}] │`);
  console.error(`├─────────────────────────────────────────┤`);
  console.error(`│  Files scanned:     ${String(result.filesScanned).padStart(8)}          │`);
  console.error(`│  Files skipped:     ${String(result.filesSkipped).padStart(8)}          │`);
  console.error(`│  Files processed:   ${String(result.filesProcessed).padStart(8)}          │`);
  console.error(`│  Chunks generated:  ${String(result.chunksGenerated).padStart(8)}          │`);
  console.error(`│  Stale deleted:     ${String(result.staleChunksDeleted).padStart(8)}          │`);
  if (result.upsert) {
    console.error(`│  Created:           ${String(result.upsert.created).padStart(8)}          │`);
    console.error(`│  Updated:           ${String(result.upsert.updated).padStart(8)}          │`);
    console.error(`│  Failed:            ${String(result.upsert.failed).padStart(8)}          │`);
  }
  console.error(`│  Duration:          ${String(Math.round(result.durationMs) + 'ms').padStart(8)}          │`);
  console.error(`└─────────────────────────────────────────┘`);

  if (result.upsert && result.upsert.errors.length > 0) {
    console.error('\nFailed chunks:');
    for (const err of result.upsert.errors) {
      console.error(`  - ${err.filePath} (${err.chunkId}): ${err.error}`);
    }
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.dryRun) {
    await runDryMode(args);
  } else {
    await runFull(args);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
