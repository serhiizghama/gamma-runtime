## Phase 7 — Stage 1: Agent Genesis (Stateful, Generative)

**Status:** Proposed  
**Author:** System Architect  
**Date:** 2026-03-17 (revised)  
**Scope:** Backend (NestJS core, OpenClaw Gateway, SQLite state DB), Generative Agent Workspaces

---

## 1. Architecture Overview (Stage 1)

Stage 1 turns Gamma into a **stateful, generative agent foundry**:

- **Platform Persistence — SQLite State DB (`gamma-state.db`)**  
  - Introduce a dedicated SQLite database, separate from `gamma-knowledge`, for **agent metadata and lifecycle state**.  
  - Agent metadata is no longer ephemeral Redis-only; `AgentRegistryService` becomes a **RAM cache + SQLite backing store**.  
  - On boot, `SessionsModule.onModuleInit()` re-hydrates the in-memory registry from `gamma-state.db`, ensuring agents survive process restarts at the identity level.

- **Generative Agent Instantiation (AI Creating AI)**  
  - `POST /agents` no longer simply binds an existing static role.  
  - Instead, it triggers a **Creator Agent / LLM workflow**: given a `role_file_name` and `agent_name`, Gamma synthesizes a full OpenClaw-compatible agent workspace:
    - `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `AGENTS.md`  
    - plus an empty `memory/` directory for future vector-store content.

- **OpenClaw Passports & Memory Isolation**  
  - Each agent receives a globally unique `agentId` that serves as its **OpenClaw passport**:  
    `agentId === sessionKey === gamma-knowledge._agentId`.  
  - The Gateway tool factory (`vector_store` plugin) uses this `agentId` to guarantee that **all vector DB operations are isolated per agent** by `_agentId`.

- **Graceful Teardown with Historical Footprint**  
  - `DELETE /agents/:id` performs a **soft delete**:
    - Aborts any running OpenClaw session via `SessionsService.abort(windowId)`.  
    - Marks the agent as `archived` in `gamma-state.db`.  
    - **Does not** delete vector chunks from `gamma-knowledge` — the agent’s knowledge remains for observability, analytics, and possible future resurrection.

Stage 1 does **not** introduce teams/corps or pipeline routing yet. It establishes:

- A reliable **stateful substrate** for agents.  
- A **generative pipeline** that can turn community role templates into fully-scaffolded Gamma agents.  
- A precise **identity contract** between gamma-core, OpenClaw, and the Knowledge Hub.

---

## 2. Platform Persistence — SQLite State DB

### 2.1 State DB Purpose & Separation

We introduce a dedicated SQLite database, e.g. `gamma-state.db`, responsible for **platform state**:

- Agents (identity, display metadata, lifecycle state).  
- Future: teams, corps, task definitions (later phases), but Stage 1 focuses on **agents only**.

This DB is **separate from**:

- `gamma-knowledge.db` (vector + FTS memory via `@gamma/openclaw-knowledge`).  
- Any in-memory structures in Redis (used for fast lookups and SSE streaming).

### 2.2 Schema: `agents` Table

**File:** `apps/gamma-core/src/state/state-db.ts` (new helper module wrapping `better-sqlite3`).

Minimal schema for Stage 1:

```sql
CREATE TABLE IF NOT EXISTS agents (
  id             TEXT PRIMARY KEY,        -- agentId / OpenClaw sessionKey
  name           TEXT NOT NULL,           -- display name in UI
  role_source    TEXT NOT NULL,           -- community role file used (e.g. "dev/senior-developer.md")
  avatar_emoji   TEXT NOT NULL,           -- e.g. "🧠", "👩‍💻"
  status         TEXT NOT NULL,           -- "active" | "archived"
  created_at     INTEGER NOT NULL,        -- unix ms
  updated_at     INTEGER NOT NULL,        -- unix ms
  workspace_path TEXT NOT NULL            -- absolute or repo-relative path to agent workspace
);
```

Optional index:

```sql
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);
```

### 2.3 State DB Access Layer (better-sqlite3, no ORM)

**File:** `apps/gamma-core/src/state/agent-state.repository.ts`

```typescript
export interface AgentStateRecord {
  id: string;
  name: string;
  roleSource: string;
  avatarEmoji: string;
  status: 'active' | 'archived';
  createdAt: number;
  updatedAt: number;
  workspacePath: string;
}

@Injectable()
export class AgentStateRepository {
  /**
   * Lightweight repository over a shared better-sqlite3 connection.
   * Uses raw SQL + prepared statements only (no Prisma/TypeORM) to keep
   * the NestJS core bundle small and startup fast.
   */
  constructor(private readonly db = getStateDb()) {}

  upsert(record: AgentStateRecord): void {
    // INSERT OR REPLACE INTO agents (...) VALUES (...)
  }

  markArchived(id: string, updatedAt: number): void {
    // UPDATE agents SET status='archived', updated_at=? WHERE id=?
  }

  findById(id: string): AgentStateRecord | null {
    // SELECT * FROM agents WHERE id=?
  }

  findAllActive(): AgentStateRecord[] {
    // SELECT * FROM agents WHERE status='active'
  }
}
```

### 2.4 Bootstrapping RAM Registry from SQLite (with FS validation)

**Hook:** `SessionsModule.onModuleInit()` (or a dedicated `StateBootstrapService` invoked from `AppModule`).

Boot sequence:

1. Open `gamma-state.db` and ensure the schema exists (`agents` table).  
2. Read `AgentStateRepository.findAllActive()`.  
3. For each record:
   - Compute expected workspace path, e.g. `<repoRoot>/agents/{agentId}` or `record.workspacePath`.  
   - If the directory **does not exist** on disk:
     - Log a warning: workspace missing for agent `{agentId}`.  
     - Update the row in SQLite to `status = 'archived'` or `'corrupted'` via `markArchived()` (Stage 1 can treat both as archived).  
     - **Skip** registering this agent into `AgentRegistryService`.  
   - If the directory exists:
     - Re-register the agent in `AgentRegistryService` with:
       - `agentId = record.id`  
       - `role = 'daemon'` (or refined later)  
       - `sessionKey = record.id`  
       - `windowId = ''` (no attached UI window yet)  
       - `status = 'offline'` (exists in state, but no live OpenClaw session).  
4. Log the number of valid agents loaded from state DB and the number of corrupted/missing ones that were auto-archived.

RAM is still the fast path for:

- `/api/system/agents` listing.  
- SSE updates.  
But **truth** for persistent identity is now `gamma-state.db`.

---

## 3. Generative Agent Instantiation Workflow

### 3.1 Source Role Library Assumptions

We assume that:

- There is already a local checkout of a community role library (e.g. `agency-agents`) under a configured path (e.g. `community-roles/`).  
- Each role is represented as a single source markdown file, e.g.:

```text
community-roles/
  dev/
    senior-developer.md
  media/
    script-writer.md
  operations/
    devops-automator.md
  ...
```

Stage 1 does **not** define how these are synced; it consumes them as read-only templates.

### 3.2 Agent Workspace Layout

When a new agent is instantiated, Gamma creates a dedicated workspace directory, e.g.:

```text
agents/
  <agentId>/
    SOUL.md
    IDENTITY.md
    TOOLS.md
    USER.md
    BOOTSTRAP.md
    HEARTBEAT.md
    AGENTS.md
    memory/             # empty dir; vector_store entries will reference this agentId
```

The workspace root (e.g. `<repoRoot>/agents/<agentId>`) is recorded in `gamma-state.db.agents.workspace_path`.

### 3.3 LLM / Creator Agent Contract (JSON-Structured Output)

We introduce a **Creator flow** that translates a community role file into this workspace layout.

Two implementation options (both supported by the same abstraction):

- Call an internal **Creator/System Agent** via existing OpenClaw / Gateway infrastructure.  
- Or call an LLM SDK directly from gamma-core as a backend-only operation.

**File:** `apps/gamma-core/src/agents/agent-creator.service.ts`

```typescript
export interface AgentWorkspaceFiles {
  soul: string;
  identity: string;
  tools: string;
  user: string;
  bootstrap: string;
  heartbeat: string;
  agents: string;
}

@Injectable()
export class AgentCreatorService {
  async generateWorkspaceFromRole(params: {
    roleFilePath: string;  // path to community role markdown
    agentName: string;     // user-provided display name
    agentId: string;       // pre-generated id (used in prompts)
  }): Promise<AgentWorkspaceFiles> {
    // 1. Read role markdown from disk.
    // 2. Build a strict JSON-mode prompt describing the desired file suite.
    // 3. Execute LLM call (Creator Agent or direct SDK) with JSON-only output enabled.
    // 4. JSON.parse the response and map fields to AgentWorkspaceFiles.
  }
}
```

**LLM Prompt Requirements (conceptual + safety):**

- Provide:
  - Raw community role markdown.  
  - The desired `agentName`.  
  - The fixed `agentId` to embed where necessary.  
  - Description of each target file and its purpose.  
  - Hard constraint: `TOOLS.md` must include `vector_store` with clear semantics.

- **Enforce JSON structured output**:
  - The Creator prompt MUST require a single top-level JSON object with **no prose before or after**.
  - Expected JSON schema:

    ```jsonc
    {
      "SOUL.md": "markdown content for SOUL",
      "IDENTITY.md": "markdown content for IDENTITY",
      "TOOLS.md": "markdown content for TOOLS (must describe vector_store and any other tools)",
      "USER.md": "markdown content for USER guidelines",
      "BOOTSTRAP.md": "markdown for initial boot steps",
      "HEARTBEAT.md": "markdown describing heartbeat / idle behavior",
      "AGENTS.md": "markdown describing related agents / roles"
    }
    ```

  - The Node.js backend:
    - Calls the LLM in JSON/structured-output mode where possible.  
    - Uses `JSON.parse()` on the raw string response.  
    - Writes the resulting values directly to corresponding files on disk.

### 3.4 Generated File Responsibilities

- **`SOUL.md`** — Core persona & behavior (similar to `docs/agents/system-architect.md`, but grounded in the community role).  
- **`IDENTITY.md`** — Backstory, traits, cognitive style; used mainly for richer prompts and UI introspection.  
- **`TOOLS.md`** — Tool contract:
  - Must explicitly list `vector_store`.  
  - May list additional Gamma tools (e.g. `fs_read`, `shell_exec`, `send_direct_message`) with usage rules.  
- **`USER.md`** — Guidelines on how the human user should interact with this agent (tone, expectations, good prompts, etc.).  
- **`BOOTSTRAP.md`** — Steps the agent should mentally execute on first activation (e.g. load prior knowledge, establish goals).  
- **`HEARTBEAT.md`** — How the agent should behave during idle / periodic checks (used later with cron/heartbeat loops).  
- **`AGENTS.md`** — Awareness of other potential roles/agents in the Gamma ecosystem (for future team formation).

### 3.5 Agent Factory API (Generative)

#### 3.5.1 Data Models / DTOs (`@gamma/types`)

```typescript
export interface CommunityRoleSummaryDto {
  /** e.g. "dev/senior-developer.md" */
  fileName: string;
  /** First-level heading or inferred name. */
  title: string;
  /** Optional categorization: "dev", "media", etc. */
  domain?: string;
  /** 1–3 sentence summary extracted from the source file. */
  summary: string;
}

export interface CreateAgentRequestDto {
  /** Relative path or identifier of the community role file, e.g. "dev/senior-developer.md". */
  roleFileName: string;
  /** Human-readable name for this particular agent instance. */
  agentName: string;
}

export interface AgentInstanceDto {
  /** Stable agent identifier (also OpenClaw sessionKey and _agentId in knowledge). */
  agentId: string;
  /** Human-readable name for display. */
  name: string;
  /** Role source file used during generation. */
  roleSource: string;
  /** Emoji avatar assigned at creation. */
  avatarEmoji: string;
  /** Absolute or repo-relative path to workspace. */
  workspacePath: string;
  /** Session/window identifiers for UI wiring (if a window is created). */
  sessionKey: string;
  windowId: string | null;
  /** Lifecycle status. */
  status: 'idle' | 'running' | 'aborted' | 'offline' | 'error' | 'archived';
}
```

#### 3.5.2 Agent Factory Service (with Generation + State DB)

**File:** `apps/gamma-core/src/agents/agent-factory.service.ts`

Responsibilities:

- Generate new agents from community roles.  
- Write generated workspaces to disk.  
- Persist agent metadata into `gamma-state.db`.  
- Register agents with `AgentRegistryService`.  
- Optionally create an OpenClaw session + `WindowSession`.  
- Implement soft deletion semantics.

Key identity decisions:

- `agentId` format: `agent.<ulid>` (opaque, no role slug baked in).  
- `sessionKey = agentId` (OpenClaw passport).  
- `windowId` optional; only created when we actually open a UI window for the agent.

```typescript
export interface CreateAgentOptions {
  roleFileName: string;
  agentName: string;
}

@Injectable()
export class AgentFactoryService {
  constructor(
    private readonly creator: AgentCreatorService,
    private readonly agentStateRepo: AgentStateRepository,
    private readonly sessions: SessionsService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  async createAgent(opts: CreateAgentOptions): Promise<AgentInstanceDto> {
    // 1. Generate agentId and avatarEmoji.
    // 2. Resolve community role path and validate.
    // 3. Call AgentCreatorService to synthesize workspace files.
    // 4. Write files to agents/<agentId>/ and create empty memory/ dir.
    // 5. Persist metadata in gamma-state.db (status='active').
    // 6. Register in AgentRegistryService with sessionKey=agentId, status='idle'.
    // 7. Return AgentInstanceDto (no window/session yet).
  }

  async deleteAgent(agentId: string): Promise<{ ok: boolean; reason?: string }> {
    // 1. Resolve agent from AgentStateRepository and AgentRegistryService.
    // 2. If the agent has a window/session, call SessionsService.abort(windowId).
    // 3. Mark the agent as 'archived' in gamma-state.db.
    // 4. Update registry status to 'offline' or remove from RAM index.
    // 5. Preserve all vector_store knowledge; do not delete.
  }
}
```

**OpenClaw session creation strategy (Stage 1):**

- Keep it **opt-in**: `createAgent` may or may not create a live Gateway session immediately.  
- When we do create one:
  - System prompt is constructed from the workspace files (see §4).  
  - `gatewayWs.createSession(agentId, systemPrompt, 'daemon')` is used.  
  - A `WindowSession` is registered via `SessionsService.create` if UI needs to attach.

#### 3.5.3 API Endpoints (NestJS Controller)

**File:** `apps/gamma-core/src/agents/agent-factory.controller.ts`  
**Module:** `AgentsModule` importing `MessagingModule`, `SessionsModule`, `StateModule`.

- **`GET /api/agents/roles`** — list community role templates for UI selection.

```http
GET /api/agents/roles
```

Response: `CommunityRoleSummaryDto[]`

- **`POST /api/agents`** — generative instantiation.

```http
POST /api/agents
Content-Type: application/json

{
  "roleFileName": "dev/senior-developer.md",
  "agentName": "Senior Dev #1"
}
```

Response: `AgentInstanceDto`

- **`DELETE /api/agents/:id`** — graceful soft teardown.

```http
DELETE /api/agents/:id
```

Behavior:

- Looks up agent in `AgentStateRepository` + `AgentRegistryService`.  
- If a `windowId`/session is associated, calls `SessionsService.abort(windowId)` (hard requirement).  
- Marks the agent as `archived` in `gamma-state.db`.  
- Keeps `agentId` stable in state DB for historical introspection.

> **Security:** Protect all `/api/agents/*` endpoints with `SystemAppGuard` or a similar guard; only Director / internal apps can create/destroy agents.

---

---

## 4. OpenClaw Passports & Knowledge Isolation

### 4.1 Existing Isolation Mechanism

The `gamma-knowledge` plugin already enforces per-agent isolation:

- `VectorStoreService.upsert()/upsertWithVector()` always stamp `metadata._agentId = ctx.agentId`.  
- Search queries filter by `_agentId` unless `shared: true` is explicitly requested.  
- The OpenClaw plugin’s `registerTool` factory sets:

```ts
skillCtx.agentId = ctx?.agentId ?? ctx?.sessionKey ?? 'unknown';
```

If `sessionKey = agentId`, then **all vector_store operations are naturally partitioned by agent**.

### 4.2 Passport Contract for Generative Agents

For every agent created via `POST /api/agents` in Stage 1:

- `agentId` is generated once and:
  - Saved in `gamma-state.db.agents.id`.  
  - Used as `sessionKey` when calling `gatewayWs.createSession()`.  
  - Stored in `AgentRegistryEntry.agentId` and `.sessionKey`.  
  - Implicitly used as `_agentId` in all knowledge metadata (because `skillCtx.agentId` resolves to the same id).

This **single identifier** is the agent’s **OpenClaw passport** and must never change for the lifetime of the agent (even when archived).

### 4.3 System Prompt Construction from Workspace

When creating an OpenClaw session for a generative agent, the system prompt is assembled from its workspace:

```text
[SYSTEM INJECTION] You are a long-lived Gamma agent with id={agentId} and name="{agentName}".

<SOUL.md>

--- IDENTITY ---
<IDENTITY.md>

--- TOOLS ---
<TOOLS.md>

--- USER GUIDELINES ---
<USER.md>

--- BOOTSTRAP ---
<BOOTSTRAP.md>

--- HEARTBEAT ---
<HEARTBEAT.md>
```

`AGENTS.md` may be used as additional context (e.g. via `system` or `context` fields) when team features arrive.

### 4.4 Memory Directory & Future Use

The `memory/` directory under each agent workspace is created empty in Stage 1 but serves as:

- A logical place to:
  - Export or snapshot vector-store state per agent.  
  - Store manual notes or pinned documents that will later be synced into `gamma-knowledge`.  
- A visual anchor in the filesystem tying together:
  - `gamma-state.db` (identity),  
  - agent workspace,  
  - `gamma-knowledge` records (via `_agentId`).

---

---

## 5. Step-by-Step Implementation Tasks

This section translates Stage 1 into **small, actionable tasks** for backend developers.

### 5.1 SQLite State DB

- **5.1.1 Add state DB helper**
  - [ ] Create `apps/gamma-core/src/state/state-db.ts` that:
    - Opens `gamma-state.db` at a configured path (e.g. `<repoRoot>/data/gamma-state.db`).  
    - Ensures `agents` table and indexes exist.  
    - Exposes a singleton `getStateDb()` returning a `better-sqlite3` instance.

- **5.1.2 Implement `AgentStateRepository`**
  - [ ] Add `agent-state.repository.ts` using `getStateDb()`.  
  - [ ] Implement `upsert`, `markArchived`, `findById`, `findAllActive`.  
  - [ ] Ensure all writes update `updated_at` and set `created_at` when inserting.

- **5.1.3 Wire repository module**
  - [ ] Create `StateModule` that provides `AgentStateRepository`.  
  - [ ] Import `StateModule` into `AgentsModule` and any other consumers as needed.

### 5.2 Bootstrapping Registry from State DB

- **5.2.1 Add bootstrap hook**
  - [ ] In `SessionsModule` (or root `AppModule`), implement `onModuleInit()` that:
    - Injects `AgentStateRepository` and `AgentRegistryService`.  
    - Calls `findAllActive()` and re-registers agents in `AgentRegistryService` with:
      - `status: 'offline'`, `sessionKey: id`, `agentId: id`, `windowId: ''`, `capabilities: []`.  
    - Logs e.g. `Hydrated N agents from gamma-state.db`.

- **5.2.2 Verify idempotency**
  - [ ] Ensure running bootstrap twice does not duplicate registry entries (registry uses `agentId` keys).

### 5.3 Agent Creator & Workspace Generation

- **5.3.1 Identify community roles root**
  - [ ] Add configuration (env or config service) for `COMMUNITY_ROLES_ROOT` (e.g. `<repoRoot>/community-roles`).  
  - [ ] Implement a small helper to resolve `roleFileName` → absolute path and validate existence.

- **5.3.2 Implement `AgentCreatorService`**
  - [ ] Read the source markdown from `roleFilePath`.  
  - [ ] Build LLM request payload including:
    - Raw role markdown.  
    - `agentName`, `agentId`.  
    - Detailed instructions for generating each target file.  
  - [ ] Choose an initial provider (Creator Agent via Gateway **or** direct SDK) and implement the call.  
  - [ ] Define and parse a strict JSON response into `AgentWorkspaceFiles`.  
  - [ ] Add robust logging and error handling (if generation fails, return an explicit error).

- **5.3.3 Write workspace to disk**
  - [ ] In `AgentFactoryService.createAgent`, after obtaining `AgentWorkspaceFiles`:
    - [ ] Create directory `agents/<agentId>/`.  
    - [ ] Write each file (`SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `USER.md`, `BOOTSTRAP.md`, `HEARTBEAT.md`, `AGENTS.md`).  
    - [ ] Create empty `memory/` directory.  
    - [ ] Store the workspace path in `gamma-state.db`.

- **5.3.4 Enforce `TOOLS.md` invariants**
  - [ ] After generation, verify that `TOOLS.md` includes a `vector_store` section.  
  - [ ] If missing, either:
    - Re-run generation with a stricter prompt, or  
    - Append a minimal `vector_store` definition programmatically and log a warning.

### 5.4 Agent Factory Service & API

- **5.4.1 Implement `AgentFactoryService.createAgent`**
  - [ ] Generate `agentId = "agent." + ulid()`.  
  - [ ] Assign an `avatarEmoji` from a small curated list.  
  - [ ] Resolve and validate `roleFileName` under `COMMUNITY_ROLES_ROOT`.  
  - [ ] Call `AgentCreatorService.generateWorkspaceFromRole`.  
  - [ ] Persist workspace to disk.  
  - [ ] Persist metadata via `AgentStateRepository.upsert` (`status: 'active'`).  
  - [ ] Register in `AgentRegistryService.register` with:
    - `agentId`, `role: 'daemon'`, `sessionKey: agentId`, `windowId: ''`, `status: 'idle'`, `acceptsMessages: true`.  
  - [ ] For Stage 1, **do not** auto-create a WindowSession; leave that to the UI when opening an agent window.  
  - [ ] Return `AgentInstanceDto`.

- **5.4.2 Implement `AgentFactoryService.deleteAgent`**
  - [ ] Look up agent in `AgentStateRepository.findById`.  
  - [ ] Look up registry entry for window/session association.  
  - [ ] If there is a `windowId`, call `SessionsService.abort(windowId)` to terminate any running OpenClaw processes (hard requirement).  
  - [ ] Mark the agent as `archived` in `gamma-state.db`.  
  - [ ] Update `AgentRegistryService.update(agentId, { status: 'offline', acceptsMessages: false })` or remove from registry, depending on Director UI needs.  
  - [ ] Do **not** touch any `vector_store` content; knowledge remains.

- **5.4.3 Implement `AgentsModule` + controller**
  - [ ] Create `AgentsModule` providing `AgentCreatorService`, `AgentFactoryService`, and importing `MessagingModule`, `SessionsModule`, `StateModule`.  
  - [ ] Create `agent-factory.controller.ts` with:
    - `GET /api/agents/roles` (reads from community roles root and returns `CommunityRoleSummaryDto[]`).  
    - `POST /api/agents` (calls `AgentFactoryService.createAgent`).  
    - `DELETE /api/agents/:id` (calls `AgentFactoryService.deleteAgent`).  
  - [ ] Protect routes with `SystemAppGuard`.

### 5.5 OpenClaw Passport & Knowledge Validation

- **5.5.1 Verify `agentId` propagation**
  - [ ] Ensure any session creation uses `sessionKey = agentId`.  
  - [ ] Confirm `AgentRegistryService.register` is called with that same `agentId`.  
  - [ ] Add a short comment in `AgentFactoryService` describing the passport contract.

- **5.5.2 End-to-end knowledge test**
  - [ ] Create an agent via `POST /api/agents`.  
  - [ ] Open an agent window and send a message that triggers `vector_store.upsert`.  
  - [ ] Inspect `gamma-knowledge` DB to verify that new chunks have `metadata._agentId = agentId`.  
  - [ ] Create a second agent and confirm searches are isolated unless `shared: true` is used.

### 5.6 Documentation & Developer UX

- **5.6.1 Document generative workflow**
  - [ ] Add a new doc (or section) explaining:
    - Community role source location.  
    - How `POST /api/agents` turns a role into a workspace.  
    - Workspace file semantics (`SOUL.md`, `IDENTITY.md`, etc.).

- **5.6.2 Operational notes**
  - [ ] Document how to inspect `gamma-state.db` for debugging.  
  - [ ] Document soft deletion semantics (why archived agents retain knowledge).

---

## 6. Out of Scope for Stage 1

- Automatic syncing of community roles from GitHub (we assume roles are already present locally).  
- Full Creator Agent orchestration UI — Stage 1 only exposes a backend API.  
- Team/corp composition, Pipeline Visualizer integration, and inter-agent messaging (`send_direct_message`).  
- Automatic resurrection of agents on boot (beyond rehydrating metadata into the registry).  
- Automatic garbage collection of archived agents’ workspaces or knowledge — these remain until explicit maintenance routines are introduced.

