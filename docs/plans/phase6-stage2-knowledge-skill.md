# Phase 6, Stage 2: OpenClaw Knowledge Skill — Implementation Plan

**Status:** Proposed
**Author:** System Architect
**Date:** 2026-03-17
**Priority:** High
**Parent:** Phase 5 — Data Layer & Agent Capability Architecture

---

## Problem

Gamma agents currently have no persistent semantic memory. All knowledge is ephemeral — limited to the LLM context window and lost between sessions. Agents cannot store, retrieve, or reason over structured knowledge accumulated during their lifetime. This is a fundamental limitation for long-lived daemon agents that need to build understanding over time.

---

## Goal

Deliver a **standalone OpenClaw Skill** (`gamma-knowledge`) that provides an **Omnichannel Knowledge Hub** — a single, centralized hybrid vector + full-text knowledge store shared across the entire Gamma agent ecosystem. The skill runs entirely within the OpenClaw execution environment, keeping the `gamma-runtime` monorepo fully decoupled from OpenClaw internals.

---

## Architectural Decision: Why a Standalone Skill

The knowledge engine must live **outside** gamma-core for three reasons:

1. **Separation of Concerns.** The knowledge store depends on heavy native C-extensions (`better-sqlite3`, `sqlite-vec`) and manages filesystem state (the `.db` file). Keeping this out of the lightweight NestJS orchestrator prevents gamma-core from accumulating native compilation dependencies, platform-specific binaries, and filesystem coupling that belong in the execution tier, not the orchestration tier.
2. **Deployment independence.** Skills are user-installable artifacts. A user can install `gamma-knowledge` without redeploying the runtime.
3. **Omnichannel Knowledge Hub.** A single, centralized `knowledge.db` serves the entire OpenClaw Gateway instance. All agents — System Architect, App Owners, daemons — read and write to the same database. Data isolation between agents is enforced at the query level via metadata filtering (e.g., `WHERE json_extract(metadata, '$._agentId') = ?`), not by creating separate database files. This enables seamless cross-agent context sharing when permitted, while maintaining logical boundaries when required.

---

## Section 1: Directory Structure

### 1.1 Development Layout (monorepo)

```
skills/
└── openclaw-knowledge/
    ├── package.json              # name: @gamma/openclaw-knowledge
    ├── tsconfig.json             # extends ../../tsconfig.base.json
    ├── src/
    │   ├── index.ts              # Skill entry point — exports tool handler
    │   ├── tool-handler.ts       # Action router: upsert | search | delete
    │   ├── db/
    │   │   ├── schema.ts         # CREATE TABLE / FTS5 / sqlite-vec DDL
    │   │   ├── connection.ts     # better-sqlite3 init + extension loading (centralized DB path)
    │   │   └── migrations.ts     # Forward-only schema versioning
    │   ├── services/
    │   │   ├── knowledge.service.ts   # Core CRUD + hybrid search logic
    │   │   └── embedding.service.ts   # Embedding generation (provider-agnostic)
    │   └── types.ts              # Internal types (KnowledgeEntry, SearchResult, etc.)
    └── scripts/
        └── install-knowledge-skill.ts   # Build + deploy installer
```

### 1.2 Target Layout (user machine after install)

```
~/.openclaw/
├── skills/
│   └── gamma-knowledge/
│       ├── index.js              # Bundled skill (single file, ESM)
│       └── skill.json            # OpenClaw skill manifest
├── data/
│   └── knowledge.db              # Centralized SQLite database (created on first use)
└── extensions/
    └── vec0.{dylib|so|dll}       # sqlite-vec native extension for current OS/arch
```

The `knowledge.db` lives in `~/.openclaw/data/`, **not** alongside the skill code. There is exactly **one** database file per OpenClaw Gateway instance. All agents read and write to this single database. Logical isolation between agents is enforced via metadata filtering at the query level (see Section 2.3), not by filesystem separation.

---

## Section 2: Database Schema & Service Logic

### 2.1 SQLite Schema

```sql
-- Core knowledge table
CREATE TABLE IF NOT EXISTS knowledge (
    id          TEXT PRIMARY KEY,        -- ULID for time-sortable uniqueness
    namespace   TEXT NOT NULL DEFAULT 'default',
    content     TEXT NOT NULL,
    metadata    TEXT,                     -- JSON blob (tags, source, etc.)
    embedding   FLOAT32[1536],           -- sqlite-vec virtual column (dimensionality configurable)
    created_at  INTEGER NOT NULL,        -- Unix ms
    updated_at  INTEGER NOT NULL         -- Unix ms
);

-- Full-text search shadow table
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
    content,
    metadata,
    content='knowledge',
    content_rowid='rowid'
);

-- Synchronization triggers: keep FTS5 in lockstep with base table
CREATE TRIGGER IF NOT EXISTS knowledge_ai AFTER INSERT ON knowledge BEGIN
    INSERT INTO knowledge_fts(rowid, content, metadata)
    VALUES (new.rowid, new.content, new.metadata);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_ad AFTER DELETE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, content, metadata)
    VALUES ('delete', old.rowid, old.content, old.metadata);
END;

CREATE TRIGGER IF NOT EXISTS knowledge_au AFTER UPDATE ON knowledge BEGIN
    INSERT INTO knowledge_fts(knowledge_fts, rowid, content, metadata)
    VALUES ('delete', old.rowid, old.content, old.metadata);
    INSERT INTO knowledge_fts(rowid, content, metadata)
    VALUES (new.rowid, new.content, new.metadata);
END;

-- sqlite-vec virtual table for ANN search
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_vec USING vec0(
    id TEXT PRIMARY KEY,
    embedding FLOAT32[1536]
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_knowledge_namespace ON knowledge(namespace);
CREATE INDEX IF NOT EXISTS idx_knowledge_updated ON knowledge(updated_at);
```

### 2.2 Hybrid Search CTE

The core retrieval query combines vector similarity (semantic) with FTS5 (keyword) in a single query using a Common Table Expression. This avoids two round-trips and lets SQLite's query planner optimize the join.

```sql
-- Hybrid search: vector similarity + full-text relevance, fused via RRF
WITH vector_hits AS (
    SELECT
        v.id,
        v.distance AS vec_distance,
        ROW_NUMBER() OVER (ORDER BY v.distance ASC) AS vec_rank
    FROM knowledge_vec v
    WHERE v.embedding MATCH :query_embedding
    ORDER BY v.distance ASC
    LIMIT :limit * 3
),
fts_hits AS (
    SELECT
        k.id,
        knowledge_fts.rank AS fts_rank_score,
        ROW_NUMBER() OVER (ORDER BY knowledge_fts.rank ASC) AS fts_rank
    FROM knowledge_fts
    JOIN knowledge k ON k.rowid = knowledge_fts.rowid
    WHERE knowledge_fts MATCH :query_text
    LIMIT :limit * 3
),
fused AS (
    SELECT
        COALESCE(v.id, f.id) AS id,
        -- Reciprocal Rank Fusion (k=60)
        COALESCE(1.0 / (60 + v.vec_rank), 0) +
        COALESCE(1.0 / (60 + f.fts_rank), 0) AS rrf_score
    FROM vector_hits v
    FULL OUTER JOIN fts_hits f ON v.id = f.id
)
SELECT
    k.id,
    k.namespace,
    k.content,
    k.metadata,
    k.created_at,
    k.updated_at,
    fused.rrf_score
FROM fused
JOIN knowledge k ON k.id = fused.id
WHERE (:namespace IS NULL OR k.namespace = :namespace)
  AND (:shared = 1 OR json_extract(k.metadata, '$._agentId') = :agent_id)
ORDER BY fused.rrf_score DESC
LIMIT :limit;
```

**Note on `FULL OUTER JOIN`:** SQLite 3.39+ supports `FULL OUTER JOIN`. If targeting older versions, this can be emulated with `LEFT JOIN` + `UNION` of unmatched FTS hits.

### 2.3 Service Layer (`knowledge.service.ts`)

**Agent isolation model:** The centralized database stores entries from all agents. Every write stamps `metadata._agentId` automatically from the calling context. Reads apply a `WHERE json_extract(metadata, '$._agentId') = :agentId` filter by default. Cross-agent searches are opt-in via an explicit `shared: true` parameter, enabling the Omnichannel Knowledge Hub pattern where agents can access each other's knowledge when permitted.

```
KnowledgeService
├── upsert(entry: UpsertInput, context: SkillContext): KnowledgeEntry
│   ├── Inject context.agentId into metadata._agentId
│   ├── Generate embedding via EmbeddingService
│   ├── INSERT OR REPLACE into knowledge table
│   └── INSERT OR REPLACE into knowledge_vec table
│
├── search(query: SearchInput, context: SkillContext): SearchResult[]
│   ├── Generate query embedding via EmbeddingService
│   ├── Execute Hybrid Search CTE
│   ├── Apply metadata._agentId filter (unless query.shared === true)
│   └── Return ranked results with scores
│
├── delete(id: string, context: SkillContext): void
│   ├── Verify metadata._agentId matches context.agentId (ownership check)
│   ├── DELETE from knowledge (triggers cascade to FTS5)
│   └── DELETE from knowledge_vec
│
└── ensureSchema(): void
    ├── Run schema DDL
    └── Run forward migrations if schema_version < current
```

### 2.4 Embedding Service (`embedding.service.ts`)

The embedding service is **provider-agnostic** with a simple interface:

```typescript
interface IEmbeddingProvider {
    embed(text: string): Promise<Float32Array>;
    dimensions: number;
}
```

**Initial implementation:** Use OpenClaw's built-in embedding capability if available, or fall back to a local embedding model (e.g., `@xenova/transformers` with `all-MiniLM-L6-v2`). The provider is selected at initialization based on environment detection.

Embedding dimensionality is read from the provider at init time and used to validate the schema's `FLOAT32[N]` declaration. A mismatch triggers a migration.

### 2.5 Skill Entry Point & Tool Handler

**`src/index.ts`** — exports the skill in OpenClaw's expected format:

```typescript
export default {
    name: 'gamma-knowledge',
    version: '0.1.0',
    tools: [{
        name: 'vector_store',
        description: 'Persistent knowledge store with hybrid vector + full-text search.',
        parameters: { /* JSON Schema — see below */ },
        handler: toolHandler,
    }],
};
```

**`src/tool-handler.ts`** — dispatches on `action`:

| Action   | Parameters                                                    | Returns                                  |
|----------|---------------------------------------------------------------|------------------------------------------|
| `upsert` | `{ id?, namespace?, content, metadata? }`                     | `{ id, status: "created" \| "updated" }` |
| `search` | `{ query, namespace?, limit?, mode?: "hybrid"\|"vector"\|"fts", shared?: boolean }` | `{ results: SearchResult[] }`            |
| `delete` | `{ id }`                                                      | `{ status: "deleted" }`                  |

**JSON Schema for `vector_store` tool parameters:**

```json
{
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["upsert", "search", "delete"]
        },
        "id": { "type": "string" },
        "namespace": { "type": "string" },
        "content": { "type": "string" },
        "metadata": { "type": "object" },
        "query": { "type": "string" },
        "limit": { "type": "number", "default": 10 },
        "mode": { "type": "string", "enum": ["hybrid", "vector", "fts"], "default": "hybrid" },
        "shared": { "type": "boolean", "default": false, "description": "If true, search across all agents' knowledge (omnichannel). If false (default), restrict to the calling agent's entries." }
    },
    "required": ["action"]
}
```

---

## Section 3: The Install Script

**File:** `skills/openclaw-knowledge/scripts/install-knowledge-skill.ts`

The installer is a Node.js script runnable via `pnpm --filter @gamma/openclaw-knowledge run install-skill` or `npx tsx scripts/install-knowledge-skill.ts`. It performs a deterministic build-and-deploy sequence.

### 3.1 Step-by-Step Logic

```
Step 1 — Resolve Paths
├── SKILL_SRC    = resolve(__dirname, '..')
├── SKILL_TARGET = resolve(homedir(), '.openclaw/skills/gamma-knowledge')
├── DATA_DIR     = resolve(homedir(), '.openclaw/data')
├── EXT_TARGET   = resolve(homedir(), '.openclaw/extensions')
└── Ensure target directories exist (mkdirSync recursive)

Step 2 — Transpile & Bundle
├── Use esbuild (programmatic API, not CLI) for speed and zero-config
├── Entry point:  src/index.ts
├── Output:       dist/index.js
├── Format:       ESM (OpenClaw skills are ESM)
├── Platform:     node
├── Target:       node18 (minimum OpenClaw runtime)
├── Bundle:       true (inline all dependencies except better-sqlite3)
├── External:     ['better-sqlite3'] (native addon — cannot be bundled)
└── Sourcemap:    true (for debugging)

Step 3 — Copy Bundled Skill to Target
├── Copy dist/index.js       → SKILL_TARGET/index.js
├── Copy dist/index.js.map   → SKILL_TARGET/index.js.map
├── Generate skill.json manifest:
│   {
│       "name": "gamma-knowledge",
│       "version": "<read from package.json>",
│       "entry": "index.js",
│       "tools": ["vector_store"],
│       "runtime": "node"
│   }
└── Write skill.json          → SKILL_TARGET/skill.json

Step 4 — Install Native Dependencies to Target
├── Copy node_modules/better-sqlite3/ → SKILL_TARGET/node_modules/better-sqlite3/
│   (including prebuilt .node binary)
└── This ensures better-sqlite3 resolves at runtime from the skill directory

Step 5 — Deploy sqlite-vec Extension
├── Detect current platform:  process.platform + process.arch
├── Map to extension filename:
│   ├── darwin-arm64   → vec0.dylib
│   ├── darwin-x64     → vec0.dylib
│   ├── linux-x64      → vec0.so
│   ├── linux-arm64    → vec0.so
│   └── win32-x64      → vec0.dll
├── Source: node_modules/sqlite-vec-{platform}-{arch}/vec0.{ext}
│   (sqlite-vec publishes platform-specific npm packages)
└── Copy to EXT_TARGET/vec0.{ext}

Step 6 — Verify Installation
├── Require the bundled index.js and call a health-check export
├── Verify better-sqlite3 loads
├── Verify vec0 extension loads: db.loadExtension(EXT_TARGET/vec0)
├── Verify FTS5 is available: PRAGMA compile_options → check for ENABLE_FTS5
└── Print success summary:
    ✓ Skill installed:     ~/.openclaw/skills/gamma-knowledge/
    ✓ Extension deployed:  ~/.openclaw/extensions/vec0.dylib
    ✓ SQLite version:      3.45.0
    ✓ sqlite-vec:          loaded
    ✓ FTS5:                enabled
```

### 3.2 Error Handling

| Failure                           | Behavior                                                             |
|-----------------------------------|----------------------------------------------------------------------|
| `esbuild` not installed           | Error with `pnpm add -D esbuild` instruction                        |
| `better-sqlite3` prebuild missing | Error with `npm rebuild better-sqlite3` instruction                  |
| `sqlite-vec` platform unsupported | Error listing supported platforms; link to sqlite-vec build docs     |
| Target dir not writable           | Error with permission fix instruction                                |
| Extension load fails              | Error with architecture mismatch diagnostic                          |

### 3.3 package.json Scripts

```json
{
    "scripts": {
        "build": "tsx scripts/install-knowledge-skill.ts --build-only",
        "install-skill": "tsx scripts/install-knowledge-skill.ts",
        "test": "vitest run",
        "test:watch": "vitest"
    }
}
```

---

## Section 4: PR Phasing

### PR 2.1 — Skill Core (`gamma-knowledge` skill code)

**Branch:** `feat/knowledge-skill-core`

**Scope:**

| File | Description |
|---|---|
| `skills/openclaw-knowledge/package.json` | Package manifest with dependencies |
| `skills/openclaw-knowledge/tsconfig.json` | TypeScript config extending base |
| `skills/openclaw-knowledge/src/index.ts` | Skill entry point and export |
| `skills/openclaw-knowledge/src/tool-handler.ts` | Action router (upsert/search/delete) |
| `skills/openclaw-knowledge/src/types.ts` | Internal types |
| `skills/openclaw-knowledge/src/db/schema.ts` | DDL statements |
| `skills/openclaw-knowledge/src/db/connection.ts` | Database init + extension loading |
| `skills/openclaw-knowledge/src/db/migrations.ts` | Schema versioning |
| `skills/openclaw-knowledge/src/services/knowledge.service.ts` | Core CRUD + hybrid search |
| `skills/openclaw-knowledge/src/services/embedding.service.ts` | Embedding generation |
| `pnpm-workspace.yaml` | Add `skills/*` to workspace packages |

**Dependencies to add:**

```
better-sqlite3: ^11.x
sqlite-vec: ^0.1.x (+ platform-specific optional deps)
ulid: ^2.3.x
```

**Acceptance criteria:**

- [ ] `pnpm --filter @gamma/openclaw-knowledge build` succeeds
- [ ] Unit tests pass for: upsert, search (all 3 modes), delete, schema creation
- [ ] Hybrid search returns results ranked by RRF score
- [ ] FTS5 triggers fire correctly on insert/update/delete
- [ ] sqlite-vec extension loads and vector search returns nearest neighbors
- [ ] Centralized database is created lazily at `~/.openclaw/data/knowledge.db` on first tool invocation
- [ ] Namespace isolation: search in namespace A does not return namespace B results
- [ ] Agent isolation: default search returns only the calling agent's entries (metadata `_agentId` filter)
- [ ] Omnichannel search: `shared: true` returns entries from all agents
- [ ] Ownership enforcement: agent A cannot delete agent B's entries

**Test strategy:**

- Unit tests with in-memory SQLite (`:memory:`) + sqlite-vec extension
- Test fixtures: 50 pre-computed embeddings for deterministic search verification
- Edge cases: empty database search, duplicate upsert (idempotency), unicode content, large metadata blobs

---

### PR 2.2 — Installer Script

**Branch:** `feat/knowledge-skill-installer`
**Depends on:** PR 2.1 merged

**Scope:**

| File | Description |
|---|---|
| `skills/openclaw-knowledge/scripts/install-knowledge-skill.ts` | Full installer logic |
| `skills/openclaw-knowledge/package.json` | Add `install-skill` script and `esbuild` dev dependency |

**Dependencies to add (devDependencies):**

```
esbuild: ^0.21.x
```

**Acceptance criteria:**

- [ ] `pnpm --filter @gamma/openclaw-knowledge run install-skill` completes without error
- [ ] `~/.openclaw/skills/gamma-knowledge/index.js` exists and is a valid ESM bundle
- [ ] `~/.openclaw/skills/gamma-knowledge/skill.json` contains correct manifest
- [ ] `~/.openclaw/extensions/vec0.{dylib|so|dll}` exists for current platform
- [ ] Bundled skill loads in a standalone Node.js process (no monorepo dependencies required)
- [ ] Re-running the installer overwrites cleanly (idempotent)
- [ ] Verification step confirms all native extensions load

**Test strategy:**

- Integration test: run installer in a temp `HOME` directory, verify file layout
- Smoke test: load the installed bundle, call `vector_store` with a test upsert + search cycle
- Platform matrix: CI runs on macOS (arm64) and Linux (x64) at minimum

---

## Risk & Mitigations

| Risk | Mitigation |
|---|---|
| `sqlite-vec` not available for user's platform | Installer detects platform early and fails with clear message; degrade to FTS-only mode as fallback |
| `better-sqlite3` native addon mismatch with OpenClaw's Node.js version | Pin `better-sqlite3` to version with broadest prebuild coverage; installer verifies load |
| Embedding dimensionality mismatch after provider change | Schema versioning in `migrations.ts` handles re-creation of vec table with new dimensions |
| Large knowledge bases degrading search performance | `LIMIT * 3` in sub-queries caps scan size; add `PRAGMA journal_mode=WAL` for concurrent read performance |
| Concurrent writes from multiple agents to single DB | WAL mode allows concurrent readers + single writer; `better-sqlite3` is synchronous so writes are serialized within the Node.js process |
| OpenClaw skill API changes | `skill.json` manifest is minimal and stable; handler signature is a single function |
| FTS5 not compiled into user's SQLite | `better-sqlite3` bundles its own SQLite with FTS5 enabled — no system SQLite dependency |

---

## Out of Scope

- Gamma-core integration (event bus notifications on knowledge changes)
- Embedding model fine-tuning or selection UI
- Knowledge graph relationships between entries
- Permission policies for cross-agent search (e.g., ACL rules for `shared: true` queries — future Phase 6 Security & Permission Manager work)
- Web UI for knowledge browsing (future: could be a gamma-ui app)
