# Phase 6 · Stage 3 — Smart Chunker: Data Ingestion Pipeline

> **Status:** Proposed
> **Depends on:** Phase 6 Stage 2 (Omnichannel Knowledge Hub) — `@gamma/openclaw-knowledge`
> **Target package:** `packages/smart-chunker`
> **Date:** 2026-03-17

---

## 1. Architecture & Directory Structure

### 1.1 High-Level Flow

```
  Local Files          Smart Chunker Pipeline              OpenClaw Gateway
 ┌──────────┐    ┌──────────────────────────────┐    ┌────────────────────┐
 │ project/  │───▶│  Scanner → Chunker → Embedder │───▶│ POST /tools/invoke │
 │ codebase  │    │           → Upserter           │    │  vector_store:     │
 │ docs      │    └──────────────────────────────┘    │    upsert           │
 └──────────┘                                         └────────────────────┘
```

### 1.2 Package Location

```
packages/smart-chunker/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                 # CLI entry point (bin)
│   ├── pipeline.ts              # Orchestrator: ties Scanner → Chunker → Embedder → Upserter
│   ├── scanner/
│   │   ├── file-scanner.ts      # Recursive directory traversal with ignore rules
│   │   └── ignore-rules.ts      # Default + custom ignore patterns
│   ├── chunker/
│   │   ├── chunk.interface.ts   # Chunk data model
│   │   ├── chunker-registry.ts  # Maps file extensions → chunker strategy
│   │   ├── strategies/
│   │   │   ├── typescript.ts    # AST-based chunking for .ts/.tsx/.js/.jsx
│   │   │   ├── markdown.ts      # Header-based chunking for .md/.mdx
│   │   │   ├── json-yaml.ts     # Top-level key chunking for .json/.yaml
│   │   │   ├── plain-text.ts    # Paragraph-aware fallback for .txt, .env, etc.
│   │   │   └── gitignore.ts     # Line-group chunking for dotfiles
│   │   └── overlap.ts           # Sliding-window overlap utility (for context bleed)
│   ├── embedder/
│   │   ├── embedding-provider.interface.ts  # Pluggable interface (re-export from openclaw-knowledge)
│   │   ├── openai-adapter.ts    # Default: OpenAI text-embedding-3-small
│   │   └── ollama-adapter.ts    # Optional: local Ollama models
│   ├── upserter/
│   │   ├── gateway-client.ts    # HTTP client for OpenClaw /tools/invoke
│   │   └── batch-upserter.ts    # Batched upsert with concurrency control
│   └── utils/
│       ├── hasher.ts            # Deterministic content hashing for dedup / change detection
│       └── logger.ts            # Pino-based logger (consistent with watchdog)
└── tests/
    ├── scanner.test.ts
    ├── chunker-ts.test.ts
    ├── chunker-md.test.ts
    └── pipeline.integration.test.ts
```

### 1.3 Registration in Monorepo

Add to `pnpm-workspace.yaml` (already includes `packages/*` — no change needed).

**`package.json`:**
```json
{
  "name": "@gamma/smart-chunker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "gamma-ingest": "./dist/index.js" },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "openai": "^4.x",
    "pino": "^9.x",
    "typescript": "~5.7.2"
  },
  "devDependencies": {
    "tsup": "^8.x",
    "tsx": "^4.x",
    "vitest": "^2.x",
    "@types/node": "^22.x"
  }
}
```

### 1.4 Configuration

The CLI accepts a JSON/YAML config file or CLI flags:

```typescript
interface IngestConfig {
  /** Directories to scan (absolute or relative to cwd) */
  targets: string[];
  /** Project name stamped into every chunk's metadata */
  projectName: string;
  /** OpenClaw Gateway URL */
  gatewayUrl: string;        // default: http://localhost:3100
  /** OpenClaw Gateway Bearer token */
  gatewayToken: string;      // default: from OPENCLAW_GATEWAY_TOKEN env
  /** Embedding provider: 'openai' | 'ollama' */
  embeddingProvider: 'openai' | 'ollama';  // default: 'openai'
  /** Namespace for vector store partitioning */
  namespace: string;         // default: 'codebase'
  /** Max concurrent embedding requests */
  concurrency: number;       // default: 5
  /** Extra ignore patterns (glob) */
  ignorePatterns?: string[];
  /** Agent ID stamped into metadata */
  agentId: string;           // default: 'system-ingestion'
}
```

---

## 2. Semantic Chunking Strategy

### 2.1 Core Principle

Every chunk must be **semantically self-contained** — a reader (human or LLM) should understand the chunk without needing surrounding context. Fixed-character-length chunking destroys this property. Instead, we parse each file type using its natural structure.

### 2.2 Chunk Data Model

```typescript
interface Chunk {
  /** Deterministic ID: SHA-256(filePath + chunkIndex + content) */
  id: string;
  /** The text content of the chunk */
  content: string;
  /** Rich metadata for filtering and attribution */
  metadata: {
    filePath: string;         // relative to project root
    projectName: string;
    fileType: string;         // e.g., 'typescript', 'markdown', 'json'
    chunkIndex: number;       // position within the file
    totalChunks: number;      // total chunks from this file
    symbolName?: string;      // e.g., function/class name (for code)
    symbolType?: string;      // e.g., 'function', 'class', 'interface'
    headingPath?: string;     // e.g., 'Guide > Installation > Prerequisites' (for markdown)
    lineStart: number;        // 1-based line number
    lineEnd: number;
    _agentId: string;         // 'system-ingestion'
    contentHash: string;      // for dedup / incremental re-ingestion
  };
}
```

### 2.3 Strategy: TypeScript / JavaScript (`.ts`, `.tsx`, `.js`, `.jsx`)

**Parser:** TypeScript Compiler API (`ts.createSourceFile`) — zero extra dependencies since `typescript` is already in the monorepo.

**Chunking rules:**
1. **Top-level declarations** are the primary chunk boundaries:
   - `function`, `class`, `interface`, `type alias`, `enum`, `const/let` (exported)
2. **Classes** with >40 lines are split into sub-chunks: one chunk per method, plus one for the class signature + constructor.
3. **Imports block** at the top of the file is prepended as context to the **first** chunk only (not duplicated into every chunk — wastes tokens).
4. **JSDoc / leading comments** are attached to the declaration they precede.
5. **Re-exports** (`export { Foo } from './bar'`) and barrel files (`index.ts`) are chunked as a single unit.

**Fallback:** If a file has no parseable top-level declarations (e.g., a script with only side-effects), fall back to paragraph-aware plain-text chunking.

**Metadata enrichment:**
- `symbolName`: the exported name (e.g., `ToolExecutorService`)
- `symbolType`: `function` | `class` | `interface` | `type` | `enum` | `variable`

### 2.4 Strategy: Markdown (`.md`, `.mdx`)

**Parser:** Simple regex/line-based — no AST library needed.

**Chunking rules:**
1. Split on headings (`#`, `##`, `###`, etc.).
2. Each heading starts a new chunk. The chunk includes all content until the next heading of **equal or higher** level.
3. Parent heading is prepended as a one-line breadcrumb context line:
   ```
   [Context: # Guide > ## Installation]
   ### Prerequisites
   You need Node.js >= 20...
   ```
4. Code fences within markdown are kept intact (never split mid-fence).
5. Chunks smaller than 50 characters are merged upward into the previous chunk.

**Metadata enrichment:**
- `headingPath`: `'Guide > Installation > Prerequisites'`

### 2.5 Strategy: JSON / YAML (`.json`, `.yaml`, `.yml`)

**Chunking rules:**
1. **`package.json`**: Chunk by top-level key (`dependencies`, `scripts`, `devDependencies`, etc.). Each key-value pair is one chunk.
2. **`tsconfig.json`**: Single chunk (usually small).
3. **Generic JSON/YAML**: If the root is an object, chunk by top-level keys. If the root is an array, chunk in groups of 10 items (with overlap of 2).
4. **Large values** (>2000 chars for a single key): sub-chunk by nested keys or array slicing.

**Metadata enrichment:**
- `symbolName`: the JSON key path (e.g., `dependencies`, `compilerOptions.paths`)

### 2.6 Strategy: Plain Text / Fallback (`.txt`, `.env`, `.cfg`, `.toml`, unknown)

**Chunking rules:**
1. Split by double-newline (paragraph boundary).
2. Merge consecutive small paragraphs until reaching ~1500 characters.
3. Never split mid-sentence if avoidable (use sentence-boundary regex as a secondary split point).

### 2.7 Strategy: Dotfiles & Config (`.gitignore`, `.eslintrc`, `Dockerfile`)

**Chunking rules:**
1. These files are typically small — ingest as a **single chunk** if under 2000 characters.
2. `Dockerfile`: chunk by `FROM` stages (multi-stage builds).

### 2.8 Global Constraints

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Max chunk size | 2000 chars | Fits well within embedding model context windows (8191 tokens for `text-embedding-3-small`) while preserving semantic density |
| Min chunk size | 50 chars | Avoid noise from trivially small chunks |
| Context overlap | 2 lines from previous chunk prepended | Maintains continuity for retrieval without bloating storage |
| Max file size | 1 MB | Skip binary-like files that slipped through the scanner |

### 2.9 Files to Skip Entirely

The Scanner applies these ignore rules **before** any chunking:

```
node_modules/**, .git/**, dist/**, build/**, .next/**,
coverage/**, .pnpm-store/**, *.lock, pnpm-lock.yaml,
*.png, *.jpg, *.jpeg, *.gif, *.svg, *.ico, *.woff, *.woff2, *.ttf, *.eot,
*.mp3, *.mp4, *.wav, *.avi, *.mov,
*.zip, *.tar, *.gz, *.rar,
*.db, *.sqlite, *.sqlite3,
*.min.js, *.min.css, *.map,
*.cert, *.pem, *.key
```

User-provided `ignorePatterns` are merged on top.

---

## 3. Embedding & Gateway Integration Strategy

### 3.1 Embedding Provider Interface

Re-use the interface already defined in `@gamma/openclaw-knowledge`:

```typescript
// Re-exported from skills/openclaw-knowledge/src/interfaces.ts
interface IEmbeddingProvider {
  embed(text: string): Promise<Float32Array>;
  readonly dimensions: number;
}
```

The Smart Chunker imports this interface and ships two adapters.

### 3.2 Default Adapter: OpenAI `text-embedding-3-small`

```typescript
class OpenAIEmbeddingAdapter implements IEmbeddingProvider {
  readonly dimensions = 1536;

  constructor(private client: OpenAI) {}

  async embed(text: string): Promise<Float32Array> {
    const res = await this.client.embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
      encoding_format: 'float',
    });
    return new Float32Array(res.data[0].embedding);
  }
}
```

- **Rate limiting:** Use a semaphore (configurable `concurrency` param, default 5) to avoid 429s.
- **Cost:** ~$0.02 per 1M tokens. A typical 10K-line codebase produces ~500 chunks ≈ 250K tokens ≈ $0.005.

### 3.3 Alternative Adapter: Ollama (Local)

```typescript
class OllamaEmbeddingAdapter implements IEmbeddingProvider {
  readonly dimensions: number; // set from model metadata at init

  constructor(private baseUrl: string, private model: string) {}

  async embed(text: string): Promise<Float32Array> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    const json = await res.json();
    return new Float32Array(json.embedding);
  }
}
```

Selected via `--embedding-provider ollama --ollama-url http://localhost:11434 --ollama-model nomic-embed-text`.

### 3.4 Gateway Upsert Client

The upserter calls the existing OpenClaw Gateway endpoint:

```
POST {gatewayUrl}/tools/invoke
Authorization: Bearer {gatewayToken}
Content-Type: application/json

{
  "tool": "vector_store",
  "arguments": {
    "action": "upsert",
    "payload": {
      "id": "<chunk.id>",
      "namespace": "<config.namespace>",
      "content": "<chunk.content>",
      "metadata": { ...chunk.metadata }
    }
  },
  "context": {
    "agentId": "system-ingestion"
  }
}
```

**Important:** The existing `vector_store` upsert handler in `openclaw-knowledge` generates the embedding internally via its own `IEmbeddingProvider`. This means:

**Option A — Gateway-side embedding (recommended for PR 1):**
Send raw text to the gateway. The skill's own embedding provider handles vectorization. The Smart Chunker does NOT embed locally — it only chunks and sends.
- **Pro:** Single source of truth for embedding model. No dimension mismatch risk.
- **Con:** All embedding load goes through the gateway.

**Option B — Client-side pre-embedding (future optimization):**
Add a new `upsert_with_vector` action to the skill that accepts pre-computed vectors. The Smart Chunker embeds locally and sends `{ content, vector, metadata }`.
- **Pro:** Distributes embedding compute. Enables offline batch processing.
- **Con:** Must ensure model/dimension parity. Requires skill API extension.

**Decision:** Start with **Option A** in PR 1. Add Option B as an optimization in PR 3 if needed. The `embedder/` directory is scaffolded from the start so the architecture is ready.

### 3.5 Batch Upserter

```typescript
class BatchUpserter {
  constructor(
    private client: GatewayClient,
    private options: { batchSize: number; concurrency: number }
  ) {}

  async upsert(chunks: Chunk[]): Promise<UpsertReport> {
    // Process in batches of `batchSize` (default 20)
    // Within each batch, fire `concurrency` (default 3) parallel requests
    // Collect results: { created: number, updated: number, failed: ChunkError[] }
    // Retry failed chunks once with exponential backoff
  }
}
```

### 3.6 Incremental Re-Ingestion (Change Detection)

To avoid re-embedding unchanged files on repeat runs:

1. Maintain a local **manifest file** at `.gamma-ingest.manifest.json` in the project root.
2. The manifest maps `filePath → { contentHash, chunkIds[], lastIngested }`.
3. On each run, the Scanner computes a fast hash (xxhash or SHA-256) of each file.
4. If the hash matches the manifest, skip the file entirely.
5. If the hash differs, re-chunk, re-upsert, and **delete stale chunk IDs** (chunks that existed before but don't exist in the new chunking) via `vector_store` `delete` action.
6. `--force` flag bypasses the manifest and re-ingests everything.

---

## 4. PR Phasing

### PR 1 — Scanner + Chunker Core (`packages/smart-chunker` scaffold)

**Scope:**
- Package scaffolding: `package.json`, `tsconfig.json`, build scripts
- `file-scanner.ts` + `ignore-rules.ts` — recursive traversal with glob-based ignore
- `chunk.interface.ts` + `chunker-registry.ts` — the strategy pattern registry
- Chunking strategies: **TypeScript** and **Markdown** (the two highest-value file types)
- `plain-text.ts` fallback strategy
- `hasher.ts` utility
- Unit tests for scanner and both chunking strategies
- CLI skeleton (`index.ts`) that runs scan + chunk and **prints** chunks to stdout (no network)

**Deliverable:** `pnpm --filter @gamma/smart-chunker dev -- --target ./apps/gamma-core/src --dry-run` outputs chunked results to console.

**Estimated files:** ~12 new files, ~800 LOC.

---

### PR 2 — Gateway Integration + Full Pipeline

**Scope:**
- `gateway-client.ts` — HTTP client for `/tools/invoke`
- `batch-upserter.ts` — batched concurrent upsert with retry
- `pipeline.ts` — full orchestrator wiring: scan → chunk → upsert
- JSON/YAML chunking strategy
- Dotfile/config chunking strategy
- Incremental manifest (`.gamma-ingest.manifest.json`) + change detection
- `logger.ts` — structured logging with progress reporting
- Integration test against a running OpenClaw Gateway
- CLI finalized: `gamma-ingest --target ./src --project my-project --gateway-url http://localhost:3100`

**Deliverable:** End-to-end ingestion of a local codebase into the Knowledge Hub.

**Estimated files:** ~8 new files + edits, ~600 LOC.

---

### PR 3 — Embedding Adapters + Optimization

**Scope:**
- `openai-adapter.ts` with rate-limiting semaphore
- `ollama-adapter.ts` for local model support
- New `upsert_with_vector` action in `@gamma/openclaw-knowledge` skill (Option B from §3.4)
- Client-side embedding mode in `pipeline.ts` (used when pre-embedding is available)
- Add root-level script to `package.json`: `"ingest": "pnpm --filter @gamma/smart-chunker dev"`
- Performance benchmarks and tuning (batch sizes, concurrency)
- Documentation in the package README

**Deliverable:** Full production-ready ingestion with pluggable embedding, local model support, and optimized throughput.

**Estimated files:** ~5 new files + edits, ~400 LOC.

---

## Appendix: CLI Usage (Target UX)

```bash
# Basic: ingest current directory
gamma-ingest --target . --project gamma-runtime

# Multiple targets
gamma-ingest --target ./apps/gamma-core/src --target ./docs --project gamma-runtime

# With Ollama
gamma-ingest --target . --project gamma-runtime \
  --embedding-provider ollama \
  --ollama-model nomic-embed-text

# Dry run (no network, print chunks to stdout)
gamma-ingest --target . --project gamma-runtime --dry-run

# Force full re-ingestion (ignore manifest)
gamma-ingest --target . --project gamma-runtime --force

# Custom gateway
gamma-ingest --target . --project gamma-runtime \
  --gateway-url https://openclaw.example.com \
  --gateway-token $MY_TOKEN
```
