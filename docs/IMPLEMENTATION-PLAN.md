# Gamma Runtime v2 — Implementation Plan

> Step-by-step guide for building the MVP from scratch.
> Each step has: what to build, exact files to create, dependencies, and acceptance criteria.

---

## Pre-requisites

Before starting, verify:
```bash
claude --version        # Claude Code CLI installed
docker compose version  # Docker Compose v2+
node --version          # Node.js >= 22
pnpm --version          # pnpm installed

# CRITICAL: verify CLI works non-interactively
claude -p "say ok" --permission-mode bypassPermissions --output-format json
# Should return JSON with "result" field, NOT prompt for anything
```

---

## Phase 1: Foundation (Steps 1–6)

### Step 1: Project Scaffold & Docker Infrastructure

**Goal**: Empty monorepo builds and Docker services start.

**Create files**:
```
v2/
├── docker-compose.yml              # Postgres 16 only (no Redis)
├── package.json                    # pnpm workspace root
├── pnpm-workspace.yaml             # workspace config
├── tsconfig.base.json              # shared TS config
├── .env.example                    # env template
├── .gitignore
├── CLAUDE.md                       # Project-level instructions for agents
├── apps/
│   ├── core/                       # NestJS backend
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── nest-cli.json
│   │   └── src/
│   │       ├── main.ts             # Fastify bootstrap, port 3001
│   │       ├── app.module.ts       # Root module
│   │       └── app.controller.ts   # GET /api/health
│   └── web/                        # React frontend
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── index.html
│       ├── tailwind.config.js
│       ├── postcss.config.js
│       └── src/
│           ├── main.tsx
│           ├── App.tsx             # Router shell
│           └── index.css           # Tailwind imports
└── scripts/
    └── init-db.sql                 # Schema (all tables from spec §4)
```

**docker-compose.yml services**:
- `postgres`: image postgres:16-alpine, port 5432, volume `pgdata`, init script mount
- No Redis — in-memory EventBus for SSE (see spec §3)

**Acceptance criteria**:
- [ ] `docker compose up -d` starts Postgres
- [ ] `psql` connects, tables exist (teams, agents, projects, tasks, trace_events)
- [ ] `pnpm install` succeeds at root
- [ ] `pnpm --filter @gamma/core dev` starts NestJS on port 3001
- [ ] `curl http://localhost:3001/api/health` returns `{"status":"ok"}`
- [ ] `pnpm --filter @gamma/web dev` starts Vite on port 5173
- [ ] Browser shows blank React app with "Gamma v2" text

---

### Step 2: Database Layer (Repositories)

**Goal**: Type-safe Postgres access for all 5 tables.

**Dependencies**: Step 1

**Create files**:
```
apps/core/src/
├── database/
│   ├── database.module.ts          # Provides Pool, runs migrations on init
│   ├── database.service.ts         # pg Pool wrapper, query helper
│   └── migrations/
│       └── 001-init.sql            # Full schema (copy from init-db.sql)
├── common/
│   ├── ulid.ts                     # ULID generator: teamId(), agentId(), taskId(), etc.
│   └── types.ts                    # Shared TS types: Team, Agent, Task, Project, TraceEvent
└── repositories/
    ├── teams.repository.ts         # CRUD: create, findAll, findById, update, archive
    ├── agents.repository.ts        # CRUD + findByTeam, updateStatus, updateSessionId, updateUsage, resetSession, archiveByTeam
    ├── projects.repository.ts      # CRUD + findByTeam, failByTeam
    ├── tasks.repository.ts         # CRUD + findByProject, findByTeam, updateStage, setResult, failByTeam, unassignAgent
    ├── trace.repository.ts         # insert, findByAgent, findByTeam, findByTask
    └── chat.repository.ts          # insert, findByTeam (paginated), deleteByTeam
```

**Tech choice**: Use `pg` (node-postgres) directly — no ORM. Prepared statements, parameterized queries.

**Tables** (7 total):
- `teams` — team CRUD
- `agents` — agent CRUD, `role_id` stores full manifest ID (e.g., "engineering/engineering-senior-developer")
- `projects` — one active project per team
- `tasks` — task lifecycle, no `parent_task_id` (sub-tasks out of scope)
- `trace_events` — event log
- `chat_messages` — chat history (user/assistant/system messages per team)
- `agent_messages` — inter-agent inbox (from, to, content, read flag)

**Acceptance criteria**:
- [ ] DatabaseModule connects to Postgres on startup, logs success
- [ ] Migration runs automatically, creates all 7 tables
- [ ] Each repository has working CRUD with parameterized queries
- [ ] Unit test: create team → create agent in team → query agent by team → works

---

### Step 3: Teams & Agents REST API

**Goal**: Full CRUD for teams and agents via REST.

**Dependencies**: Step 2

**Create files**:
```
apps/core/src/
├── teams/
│   ├── teams.module.ts
│   ├── teams.controller.ts         # Routes from spec §8.1 (except message + stream)
│   ├── teams.service.ts            # Business logic, workspace creation
│   └── dto/
│       ├── create-team.dto.ts      # { name, description, leaderRoleId?, leaderName?, leaderSpec? }
│       └── update-team.dto.ts      # { name?, description? }
├── agents/
│   ├── agents.module.ts
│   ├── agents.controller.ts        # Routes from spec §8.2 (except stream)
│   ├── agents.service.ts           # Business logic, orchestrates role + workspace + CLAUDE.md
│   ├── roles.service.ts            # Load roles-manifest.json, read role .md files
│   ├── workspace.service.ts        # Create dirs, generate CLAUDE.md
│   ├── claude-md.generator.ts      # Dynamic CLAUDE.md builder (role + team context + system instructions)
│   └── dto/
│       ├── create-agent.dto.ts     # { name, roleId, specialization?, teamId }
│       └── update-agent.dto.ts     # { name?, specialization?, description? }
```

**Role system** (roles.service.ts):
```typescript
const LEADERSHIP_ROLE_IDS = [
  'engineering/engineering-software-architect',
  'engineering/engineering-backend-architect',
  'project-management/project-management-project-shepherd',
  'project-management/project-manager-senior',
  'project-management/project-management-studio-producer',
  'product/product-manager',
  'specialized/agents-orchestrator',
  'specialized/specialized-workflow-architect',
  'job-hunting/job-hunting-squad-leader',
];

class RolesService {
  private manifest: RoleManifestEntry[];

  /** Load manifest from data/roles-manifest.json on init */
  onModuleInit(): void;

  /** Return roles grouped by category (+ virtual "leadership" category) */
  getGrouped(): { categories: RoleCategory[] };

  /** Find role by id (e.g., "engineering/engineering-senior-developer") */
  findById(roleId: string): RoleManifestEntry | null;

  /** Read full role prompt markdown from community-roles/{fileName} */
  getRolePrompt(roleId: string): Promise<string>;
}
```

**CLAUDE.md generator** (claude-md.generator.ts):
```typescript
class ClaudeMdGenerator {
  /**
   * Build the full CLAUDE.md content for an agent.
   * Combines: role prompt + team context + system instructions.
   * See spec §10.3 for full template.
   */
  generate(opts: {
    agent: Agent;
    team: Team;
    teamMembers: Agent[];
    rolePrompt: string;        // full markdown from community-roles/
    isLeader: boolean;
  }): string;

  /**
   * Regenerate CLAUDE.md for ALL agents in a team.
   * Called when team composition changes (agent added/removed).
   */
  async regenerateTeam(teamId: string): Promise<void>;
}
```

**Key behaviors**:
- `POST /api/teams` with `leaderRoleId` → atomic: create team + create leader agent
- `POST /api/agents` → create agent, create workspace, generate CLAUDE.md with team context
- Adding/removing agent → **regenerate CLAUDE.md for all team members** (team context changed)
- `DELETE /api/agents/:id` → set status=archived + regenerate team CLAUDE.md files
- `GET /api/agents/roles` → return full manifest (161 roles from community-roles/)

**CLAUDE.md content** (built by generator):
```
1. Role prompt (verbatim from community-roles/*.md)
2. Team context section:
   - Team name and description
   - Agent's position (leader or subordinate to X)
   - List of all team members with roles and specializations
   - Communication protocol
3. Working directory paths
4. Output protocol (JSON summary block)
5. Leader-specific additions (if is_leader): task decomposition + review protocols
```

**Workspace creation** (WorkspaceService):
```
{WORKSPACE_ROOT}/{teamId}/
  ├── project/           ← created on team creation (shared code dir)
  ├── plans/             ← architect's plans and reviews
  └── agents/{agentId}/
      ├── CLAUDE.md      ← dynamically generated (role + team context)
      └── notes/         ← agent scratch space
```

**Acceptance criteria**:
- [ ] `GET /api/agents/roles` returns roles **grouped by category** (15 categories including virtual "Leadership")
- [ ] Leadership category contains curated leader-suitable roles (Software Architect, Senior PM, etc.)
- [ ] Each category has: id, name, roles[]
- [ ] `POST /api/teams` creates team + optional leader, returns team with members
- [ ] `GET /api/teams/:id` returns team with nested agents array
- [ ] `POST /api/agents` creates agent, workspace dir exists on disk
- [ ] CLAUDE.md contains: full role prompt from community-roles + team context + member list + output protocol
- [ ] Leader's CLAUDE.md additionally contains: task decomposition + review protocols
- [ ] Adding a second agent to team → ALL team members' CLAUDE.md files are regenerated with updated member list
- [ ] Removing agent → remaining agents' CLAUDE.md files updated (removed agent no longer listed)
- [ ] `DELETE /api/agents/:id` sets status=archived, regenerates team prompts
- [ ] Deleting agent that has `in_progress` tasks → tasks reset to `backlog`
- [ ] `DELETE /api/teams/:id` archives team + all agents, fails all tasks/projects
- [ ] Deleting team while agent is running → agent process killed first, then archived
- [ ] `POST /api/agents/:id/reset-session` clears session_id, resets context_tokens and total_turns
- [ ] Reset while agent is running → 409 Conflict
- [ ] After reset, next run starts fresh session (no --resume)

---

### Step 4: Claude CLI Adapter

**Goal**: Spawn Claude Code CLI in non-interactive mode, stream output, manage sessions and processes.

**Dependencies**: Step 1 (just Node.js, no DB needed)

**Create files**:
```
apps/core/src/
├── claude/
│   ├── claude.module.ts
│   ├── claude-cli.adapter.ts       # Core: spawn, stream, parse NDJSON
│   ├── session-pool.service.ts     # Concurrency control, queue, process registry
│   ├── ndjson-parser.ts            # Defensive NDJSON line parser (never crashes)
│   ├── types.ts                    # StreamChunk, RunResult interfaces
│   └── __tests__/
│       ├── claude-cli.adapter.spec.ts   # Integration test with real CLI
│       └── ndjson-parser.spec.ts        # Unit test for parser resilience
```

**claude-cli.adapter.ts** — Key implementation:

```typescript
class ClaudeCliAdapter {
  /**
   * Start a new conversation or resume an existing one.
   * Returns an async generator of StreamChunks.
   *
   * CRITICAL: Always spawns with -p --permission-mode bypassPermissions
   * Do NOT use --bare — it disables OAuth/Max subscription auth.
   * to prevent interactive prompts that would hang the process.
   */
  async *run(opts: {
    message: string;
    cwd: string;
    systemPrompt?: string;  // generated prompt content (injected via --system-prompt)
    sessionId?: string;     // if provided, resumes session via --resume
    timeoutMs?: number;     // default: AGENT_TIMEOUT_MS
    maxTurns?: number;      // default: CLAUDE_MAX_TURNS
  }): AsyncGenerator<StreamChunk> {
    // 1. Build args (ALWAYS include non-interactive flags):
    //    ['-p', message,
    //     '--permission-mode', 'bypassPermissions',
    //     '--system-prompt', systemPrompt,  // role + team context injected here
    //     '--output-format', 'stream-json',
    //     '--verbose',
    //     '--max-turns', String(maxTurns),
    //     '--cwd', cwd]
    //    If sessionId: add ['--resume', sessionId] BEFORE -p
    // 3. Spawn with { detached: true } for process group management
    // 4. Read stdout line-by-line via ndjson-parser (defensive, never crashes)
    // 5. Yield StreamChunks for each parsed line
    // 6. On process exit, yield { type: 'result' } with sessionId
    // 7. On timeout, kill PROCESS GROUP (not just pid), yield { type: 'error' }
  }

  /**
   * Kill an agent's process group. See spec §5.6.
   */
  killProcessGroup(proc: ChildProcess): void {
    if (proc.pid) {
      try { process.kill(-proc.pid, 'SIGTERM'); }
      catch (e) { if ((e as any).code !== 'ESRCH') throw e; }
    }
  }
}
```

**ndjson-parser.ts** — Defensive parser (see spec §5.4):
```typescript
/**
 * Parse a single line of NDJSON from Claude CLI.
 * NEVER throws. Returns null for unparseable lines.
 * Logs warnings for unexpected formats.
 */
function parseLine(line: string, logger: Logger): StreamChunk | null {
  if (!line.trim()) return null;
  try {
    const obj = JSON.parse(line);
    return classifyChunk(obj);
  } catch {
    logger.warn('Unparseable CLI output', { line: line.slice(0, 200) });
    return null;
  }
}

/**
 * Classify a parsed JSON object into a StreamChunk type.
 * Handles known types; unknown types become { type: 'unknown' }.
 */
function classifyChunk(obj: unknown): StreamChunk { ... }
```

**session-pool.service.ts** — With process registry:
```typescript
class SessionPoolService implements OnApplicationShutdown {
  private running = 0;
  private queue: Array<{ resolve: () => void }> = [];
  private processes: Map<string, ChildProcess> = new Map();  // agentId → proc
  private maxConcurrent: number; // from env

  async acquire(): Promise<void>;   // wait if at capacity
  release(): void;                   // decrement, dequeue next
  register(agentId: string, proc: ChildProcess): void;
  unregister(agentId: string): void;
  get stats(): { running: number; queued: number };

  /** Kill ALL process groups — for emergency stop and graceful shutdown */
  async abortAll(): Promise<void> {
    // 1. SIGTERM all process groups
    // 2. Wait 5s for graceful exit
    // 3. SIGKILL any survivors
    // See spec §5.6
  }

  /** NestJS lifecycle hook */
  async onApplicationShutdown(): Promise<void> {
    await this.abortAll();
  }
}
```

**Acceptance criteria**:
- [ ] `ClaudeCliAdapter.run()` spawns `claude -p "say hello" --permission-mode bypassPermissions --system-prompt "..." --output-format stream-json --verbose`
- [ ] **Never hangs**: CLI does not prompt for permissions (verify with a command that triggers tool use)
- [ ] `--system-prompt` correctly injects the agent's role and team context
- [ ] Yields StreamChunks with correct types (text, tool_use, result)
- [ ] SessionId is captured from the `result` chunk
- [ ] Resuming with sessionId works: `--resume <id>` flag is passed
- [ ] Timeout kills entire process group (not just child pid)
- [ ] `ndjson-parser` handles: valid JSON, blank lines, garbage text, partial JSON, binary data — without crashing
- [ ] SessionPool limits concurrent runs (test: queue 3, max=1, they run sequentially)
- [ ] `abortAll()` kills all running processes within 5 seconds
- [ ] Spawned processes use `{ detached: true }` (verified in test)
- [ ] `result` chunk parsed for: session_id, usage tokens, contextWindow, numTurns
- [ ] RunResult includes usage data for context tracking

---

### Step 5: Event Bus & SSE Module

**Goal**: In-memory event bus + Server-Sent Events streaming to browser. No Redis.

**Dependencies**: Step 1

**Create files**:
```
apps/core/src/
├── events/
│   ├── events.module.ts
│   ├── event-bus.service.ts        # In-memory EventEmitter2 wrapper
│   └── types.ts                    # GammaEvent interface, event kinds enum
├── sse/
│   ├── sse.module.ts
│   ├── sse.controller.ts           # GET /api/stream, /api/teams/:id/stream, /api/agents/:id/stream
│   └── sse.service.ts              # Subscribe to EventBus, push to SSE clients
```

**EventBus** — in-memory, NestJS EventEmitter2:
```typescript
@Injectable()
class EventBusService {
  constructor(private emitter: EventEmitter2) {}

  /** Emit event to all in-memory listeners */
  emit(event: GammaEvent): void {
    this.emitter.emit('gamma.event', event);
    if (event.teamId) this.emitter.emit(`gamma.team.${event.teamId}`, event);
    if (event.agentId) this.emitter.emit(`gamma.agent.${event.agentId}`, event);
  }

  /** Subscribe to all events (for global SSE stream) */
  onAll(handler: (event: GammaEvent) => void): () => void { ... }

  /** Subscribe to team-scoped events */
  onTeam(teamId: string, handler: (event: GammaEvent) => void): () => void { ... }

  /** Subscribe to agent-scoped events */
  onAgent(agentId: string, handler: (event: GammaEvent) => void): () => void { ... }
}

interface GammaEvent {
  id: string;            // ULID
  kind: string;          // event kind (spec §7.2)
  teamId?: string;
  agentId?: string;
  taskId?: string;
  content?: unknown;     // JSON-serializable payload
  createdAt: number;     // ms timestamp
}
```

**SSE Controller** — uses Fastify raw reply for streaming:
```typescript
@Get('/api/stream')
async globalStream(@Res() reply: FastifyReply) {
  // 1. Set SSE headers (Content-Type: text/event-stream, no-cache, keep-alive)
  // 2. Subscribe to EventBus.onAll()
  // 3. On each event: write `data: ${JSON.stringify(event)}\n\n`
  // 4. On client disconnect (req.raw.on('close')): unsubscribe from EventBus
  // 5. Send heartbeat comment every 30s to keep connection alive
}

@Get('/api/teams/:id/stream')
async teamStream(@Param('id') teamId: string, @Res() reply: FastifyReply) {
  // Same pattern, but subscribe to EventBus.onTeam(teamId)
}
```

**Why no Redis?**
- Single backend instance — no need for cross-process pub/sub
- EventEmitter2 is zero-config, zero-latency, zero-dependencies
- Trace events persist to Postgres (Step 6) for history — EventBus is fire-and-forget
- If client disconnects and reconnects, they fetch recent history from Postgres via REST

**Acceptance criteria**:
- [ ] `GET /api/stream` returns `Content-Type: text/event-stream`
- [ ] `EventBusService.emit({ kind: 'test', content: { msg: 'hello' } })` → event appears in stream
- [ ] `curl http://localhost:3001/api/stream` shows events in real-time
- [ ] Team-scoped stream only shows events for that team
- [ ] Client disconnect unsubscribes from EventBus (no memory leaks)
- [ ] Heartbeat keeps connection alive every 30s

---

### Step 6: Trace Module

**Goal**: Persist all trace events to Postgres, query by agent/team/task.

**Dependencies**: Steps 2, 5

**Create files**:
```
apps/core/src/
├── trace/
│   ├── trace.module.ts
│   ├── trace.service.ts            # Write to DB + emit to SSE
│   └── trace.controller.ts         # GET /api/trace?teamId=&agentId=&taskId=&kind=&limit=
```

**TraceService**:
```typescript
class TraceService {
  async record(event: {
    agentId: string;
    teamId?: string;
    taskId?: string;
    kind: string;         // spec §7.2
    content?: unknown;
  }): Promise<TraceEvent> {
    // 1. Insert into trace_events table
    // 2. Emit to SSE (via SseService)
    // 3. Return created event
  }

  async query(filters: {
    teamId?: string;
    agentId?: string;
    taskId?: string;
    kind?: string;
    limit?: number;       // default 100
    since?: number;       // ms timestamp
  }): Promise<TraceEvent[]>;
}
```

**Acceptance criteria**:
- [ ] `TraceService.record()` writes to DB and emits SSE event
- [ ] `GET /api/trace?agentId=xxx` returns trace events for that agent
- [ ] Events are ordered by created_at DESC
- [ ] Filtering by multiple params works (AND logic)

---

## Phase 2: Orchestration (Steps 7–9)

### Step 7: Internal API (gamma-tools endpoints)

**Goal**: Backend endpoints that agents call via curl to interact with the system.

**Dependencies**: Steps 2, 5, 6

**Create files**:
```
apps/core/src/
├── internal/
│   ├── internal.module.ts
│   ├── internal.controller.ts      # All /api/internal/* routes
│   ├── internal.service.ts         # Business logic for agent actions
│   └── dto/
│       ├── assign-task.dto.ts      # { teamId, to, title, description, kind?, priority? }
│       ├── update-task.dto.ts      # { taskId, status, summary?, filesChanged? }
│       ├── send-message.dto.ts     # { from, to, message }
│       └── mark-done.dto.ts        # { teamId, summary }
├── messages/
│   ├── messages.module.ts
│   ├── messages.service.ts         # Agent inbox CRUD
│   └── messages.repository.ts      # agent_messages table queries
```

**Internal API endpoints** (all under `/api/internal/`):

```typescript
// Task management
@Post('assign-task')      // Create task, trigger agent spawn
@Post('update-task')      // Agent reports task status
@Get('list-tasks')        // Query tasks by team/status/assignee
@Get('get-task/:id')      // Single task details

// Messaging
@Post('send-message')     // Agent → agent inbox
@Get('read-messages')     // Read inbox (query: agentId, since)
@Post('broadcast')        // Leader → all team members

// Team & project
@Get('list-agents')       // Team members + statuses
@Post('mark-done')        // Leader marks project complete
@Post('request-review')   // Agent asks leader to review
@Post('report-status')    // Agent reports progress/blockers
@Get('read-context')      // Get project context + prior task results
```

**Key behavior: `assign-task` triggers agent spawn**:
```typescript
async assignTask(dto: AssignTaskDto): Promise<{ success: boolean; taskId: string }> {
  // 1. Find agent by name or role in team
  // 2. Create task in DB (status: backlog)
  // 3. Emit trace: task.created
  // 4. Trigger orchestrator.spawnAgentForTask() (async, don't wait)
  // 5. Return taskId immediately
}
```

**Acceptance criteria**:
- [ ] `curl POST /api/internal/assign-task` → creates task in DB, returns taskId
- [ ] `curl POST /api/internal/update-task` → updates task status
- [ ] `curl POST /api/internal/send-message` → creates message in agent_messages table
- [ ] `curl GET /api/internal/read-messages?agentId=xxx` → returns unread messages, marks as read
- [ ] `curl GET /api/internal/list-tasks?teamId=xxx` → returns tasks filtered by query
- [ ] `curl GET /api/internal/list-agents?teamId=xxx` → returns agents with statuses
- [ ] `curl POST /api/internal/mark-done` → sets project status to completed
- [ ] All endpoints return `{ success: true, ... }` or `{ success: false, error: "..." }`
- [ ] All endpoints emit trace events via EventBus

---

### Step 8: Orchestrator — Leader Session & Agent Spawning

**Goal**: User message → leader runs → leader calls gamma-tools → agents spawn and work.

**Dependencies**: Steps 4, 7

**Create files**:
```
apps/core/src/
├── orchestrator/
│   ├── orchestrator.module.ts
│   ├── orchestrator.service.ts     # Minimal event loop: start leader, react to events
│   └── prompt-builder.ts           # Build system prompts with gamma-tools docs
├── chat/
│   ├── chat.module.ts
│   ├── chat.service.ts             # Chat history persistence
│   └── chat.repository.ts          # chat_messages table
```

**Orchestrator flow**:
```typescript
class OrchestratorService {
  private runningPipelines = new Set<string>(); // teamIds with active leaders

  async handleTeamMessage(teamId: string, message: string): Promise<void> {
    // 1. Guard: if pipeline already running → 409
    if (this.runningPipelines.has(teamId)) throw new ConflictException();
    this.runningPipelines.add(teamId);

    // 2. Save user message to chat
    await this.chat.save({ teamId, role: 'user', content: message });

    // 3. Find leader, build system prompt (includes gamma-tools docs)
    const leader = await this.agents.findLeader(teamId);
    const systemPrompt = this.promptBuilder.buildLeaderPrompt(leader, team, members);

    // 4. Run leader CLI session
    let responseText = '';
    for await (const chunk of this.claude.run({
      message,
      systemPrompt,
      sessionId: leader.sessionId,
      cwd: projectDir,
    })) {
      // 5. Stream trace events to SSE
      await this.trace.record({ kind: `agent.${chunk.type}`, agentId: leader.id, ... });
      if (chunk.type === 'text') responseText += chunk.content;
      if (chunk.type === 'result') {
        await this.agents.updateSessionId(leader.id, chunk.sessionId);
      }
    }

    // 6. Save leader response to chat
    await this.chat.save({ teamId, role: 'assistant', agentId: leader.id, content: responseText });
    this.runningPipelines.delete(teamId);
  }

  /**
   * Called by InternalService when assign-task is called.
   * Spawns agent CLI in background (does NOT block leader).
   */
  async spawnAgentForTask(task: Task, agent: Agent): Promise<void> {
    await this.pool.acquire();
    await this.agents.updateStatus(agent.id, 'running');
    await this.tasks.updateStatus(task.id, 'in_progress');

    const systemPrompt = this.promptBuilder.buildAgentPrompt(agent, team, members, task);

    // Run in background — don't await
    this.runAgentInBackground(agent, task, systemPrompt);
  }

  private async runAgentInBackground(agent, task, systemPrompt) {
    try {
      for await (const chunk of this.claude.run({ ... })) {
        await this.trace.record({ ... });
      }
    } finally {
      await this.agents.updateStatus(agent.id, 'idle');
      this.pool.release();
      // If agent didn't call update-task, auto-complete
    }
  }
}
```

**Acceptance criteria**:
- [ ] `POST /api/teams/:id/message` → leader starts, streams output via SSE
- [ ] Leader calls `curl /api/internal/assign-task` → new agent spawns in background
- [ ] Multiple agents can run concurrently (up to MAX_CONCURRENT_AGENTS)
- [ ] Agent calls `curl /api/internal/update-task` → task status updates in DB, visible in UI
- [ ] Agent calls `curl /api/internal/send-message` → message stored in inbox
- [ ] Chat messages (user + leader responses) persisted to `chat_messages`
- [ ] `GET /api/teams/:id/chat` returns paginated chat history
- [ ] SSE stream shows events in real-time
- [ ] Sending message while leader is running → HTTP 409 Conflict
- [ ] Timeout: agent killed after AGENT_TIMEOUT_MS, task → failed
- [ ] After each agent run: context_tokens, total_turns, last_active_at updated in DB
- [ ] Context usage emitted in trace events → visible via SSE in UI

---

### Step 9: Team App (Static File Server + Viewer)

**Goal**: Agents create HTML reports/apps, backend serves them, frontend shows in iframe.

**Dependencies**: Steps 3, 7

**Create files**:
```
apps/core/src/
├── team-app/
│   ├── team-app.module.ts
│   ├── team-app.controller.ts      # GET /api/teams/:id/app/* (static file server)
│   └── team-app.service.ts         # app-status, path validation, MIME types
```

**team-app.controller.ts**:
```typescript
@Controller('api/teams/:id/app')
class TeamAppController {
  @Get('status')
  async getStatus(@Param('id') teamId: string) {
    // Check if project/app/index.html exists
    // Return: { exists, lastModified, files[], sizeBytes }
  }

  @Get('*')
  async serveFile(@Param('id') teamId: string, @Req() req, @Res() reply) {
    const filePath = req.params['*'] || 'index.html';
    // 1. Resolve team workspace path
    // 2. Security: ensure resolved path is within project/app/ (no ../ traversal)
    // 3. Read file, detect MIME type
    // 4. Serve with correct Content-Type
  }
}
```

**System prompt additions** (added to prompt-builder.ts):
- Leader prompt: instructions to create `project/app/index.html` as work report
- Worker prompt: mention they can contribute HTML/data for the team app

**Frontend** (in Step 12, Team Detail view):
- Tab: "View App" alongside Chat and Task Board
- If app exists: iframe loading `/api/teams/:id/app/index.html`
- If no app: placeholder text
- Buttons: "Open in New Tab", "Refresh"

**Acceptance criteria**:
- [ ] `GET /api/teams/:id/app/index.html` serves HTML file from workspace
- [ ] `GET /api/teams/:id/app/style.css` serves CSS with correct MIME type
- [ ] Path traversal blocked: `../../../etc/passwd` returns 403
- [ ] `GET /api/teams/:id/app/status` returns { exists, lastModified, files }
- [ ] Non-existent file returns 404
- [ ] Leader's system prompt includes instructions for creating team app

---

### Step 10: System Prompt Builder & End-to-End Test

**Goal**: Build rich system prompts with gamma-tools docs. Test full cycle.

**Dependencies**: Step 8

**Create/update files**:
```
apps/core/src/
├── orchestrator/
│   └── prompt-builder.ts           # Build system prompts with tool docs + team context
```

**prompt-builder.ts** — generates system prompts per agent (see spec §10.3 + §6.3):
```typescript
class PromptBuilder {
  /**
   * Combines: role prompt + team context + gamma-tools documentation.
   * Replaces TEAM_ID and YOUR_AGENT_ID placeholders with real values.
   */
  buildLeaderPrompt(leader: Agent, team: Team, members: Agent[]): string {
    return [
      this.getRolePrompt(leader.roleId),      // from community-roles/
      this.buildTeamContext(leader, team, members),
      this.buildLeaderInstructions(),          // task decomposition, review
      this.buildGammaToolsDocs(team.id, leader.id), // curl examples with real IDs
    ].join('\n\n---\n\n');
  }

  buildAgentPrompt(agent: Agent, team: Team, members: Agent[], task: Task): string {
    return [
      this.getRolePrompt(agent.roleId),
      this.buildTeamContext(agent, team, members),
      this.buildTaskContext(task),              // task description + prior results
      this.buildGammaToolsDocs(team.id, agent.id), // subset: update-task, send-message, read-messages
    ].join('\n\n---\n\n');
  }
}
```

**End-to-end test** (manual or integration):
```
1. Create team with leader (architect role)
2. Add backend-dev agent to team
3. POST /api/teams/:id/message "Create a hello world Express app"
4. Leader receives message, calls:
   curl POST /api/internal/assign-task { to: "Backend Dev", title: "Express app", ... }
5. Backend Dev spawns, writes code, calls:
   curl POST /api/internal/update-task { status: "done", summary: "..." }
6. Leader sees result (via list-tasks or read-messages), calls:
   curl POST /api/internal/mark-done { summary: "Done!" }
7. Project marked complete. Chat shows full conversation.
```

**Acceptance criteria**:
- [ ] System prompt includes gamma-tools curl examples with real team/agent IDs
- [ ] Leader prompt includes leader-specific instructions (assign-task, mark-done)
- [ ] Worker prompt includes worker-specific instructions (update-task, send-message)
- [ ] Full E2E: user message → leader → assign-task → agent works → update-task → mark-done
- [ ] All events visible in SSE stream
- [ ] Chat history shows user message + leader responses
- [ ] Tasks visible in DB with correct statuses

---

## Phase 3: Frontend (Steps 10–13)

### Step 11: Frontend Foundation & Dashboard

**Goal**: Working React app with routing, layout, and team dashboard.

**Dependencies**: Steps 1, 3 (backend API for teams)

**Create files**:
```
apps/web/src/
├── main.tsx
├── App.tsx                         # Layout + Router
├── api/
│   └── client.ts                   # fetch wrapper: get, post, patch, del, sse
├── hooks/
│   ├── useTeams.ts                 # GET /api/teams
│   ├── useAgents.ts                # GET /api/agents
│   └── useSse.ts                   # EventSource hook
├── store/
│   └── useStore.ts                 # Zustand: teams, agents, selectedTeam, notifications
├── components/
│   ├── Layout.tsx                  # Sidebar + main content area
│   ├── Sidebar.tsx                 # Navigation links
│   └── StatusBadge.tsx             # Colored status indicator
├── pages/
│   ├── Dashboard.tsx               # Team cards + Create Team button
│   └── NotFound.tsx
```

**Layout**:
```
┌─────────────────────────────────────────┐
│  Gamma v2              [Emergency Stop] │  ← header
├──────┬──────────────────────────────────┤
│      │                                  │
│ Home │    Dashboard / Team Detail       │  ← main area
│ Tasks│                                  │
│ Trace│                                  │
│      │                                  │
└──────┴──────────────────────────────────┘
```

**Dashboard**: Grid of team cards
```
┌─────────────────┐  ┌─────────────────┐
│ 🏗️ Alpha Squad  │  │  + Create Team  │
│ 3 agents        │  │                 │
│ 5 active tasks  │  │                 │
│ Status: active  │  │                 │
└─────────────────┘  └─────────────────┘
```

**Acceptance criteria**:
- [ ] App loads at localhost:5173 with sidebar layout
- [ ] Dashboard shows list of teams (fetched from API)
- [ ] "Create Team" card/button is visible
- [ ] Sidebar links: Home, Tasks, Trace (stubs)
- [ ] API client handles errors gracefully

---

### Step 12: Create Team & Add Agent Modals

**Goal**: User can create teams with leaders and add agents.

**Dependencies**: Step 10

**Create files**:
```
apps/web/src/
├── components/
│   ├── CreateTeamModal.tsx         # Form: name, description, leader role/spec
│   ├── AddAgentModal.tsx           # Form: name, role, specialization
│   └── Modal.tsx                   # Reusable modal wrapper
```

**CreateTeamModal fields**:
- Team name (required)
- Description (optional)
- Leader name (required, default: role name from manifest)
- Leader role: **category dropdown** (default: "Leadership") → **role list** within category
- Leader specialization (text, optional, e.g., "Full-stack architect")

**Submit**: `POST /api/teams` with `{ name, description, leaderRoleId, leaderName, leaderSpecialization }`

**AddAgentModal fields**:
- Name (required)
- Role: **category dropdown** (default: "Engineering") → **role list** within category
- Specialization (optional text)

**Submit**: `POST /api/agents` with `{ name, roleId, specialization, teamId }`

**Role picker component** (reusable in both modals):
- Two-step selection: category dropdown → role cards/list
- Each role card shows: emoji, name, description (truncated), vibe
- Search/filter within category (optional, nice-to-have)

**Acceptance criteria**:
- [ ] Click "Create Team" → modal opens
- [ ] Fill form, submit → team created, appears on dashboard
- [ ] Click into team → can add agents
- [ ] Agent appears in team member list after creation
- [ ] Validation: required fields show error if empty
- [ ] Modal closes on success, shows error on failure

---

### Step 13: Team Detail View (Map + Chat + Tasks + App Viewer)

**Goal**: Main working view — see team, chat with architect, track tasks.

**Dependencies**: Steps 10, 11, 7 (backend orchestration)

**Create files**:
```
apps/web/src/
├── pages/
│   └── TeamDetail.tsx              # Three-panel layout
├── components/
│   ├── TeamMap.tsx                  # Agent hierarchy visualization
│   ├── AgentNode.tsx               # Single agent card in map
│   ├── ChatPanel.tsx               # Chat with team leader
│   ├── ChatMessage.tsx             # Single message bubble
│   ├── TaskBoard.tsx               # Kanban columns
│   ├── TaskCard.tsx                # Single task card
│   └── TaskDetailModal.tsx         # Task detail on click
├── hooks/
│   ├── useTeamDetail.ts            # GET /api/teams/:id (with members)
│   ├── useTeamTasks.ts             # GET /api/tasks?teamId=:id
│   ├── useTeamChat.ts              # POST message + SSE for responses
│   └── useTeamSse.ts               # SSE /api/teams/:id/stream
```

**Three-panel layout**:
```
┌─────────────┬──────────────────┬─────────────────┐
│  Team Map   │    Chat Panel    │   Task Board    │
│             │                  │                 │
│  🏗️ Lead   │  User: Build a   │  Backlog   | IP │
│   ├─⚙️ BE  │  banking app     │  ┌──────┐  ┌──┐│
│   ├─🎨 FE  │                  │  │Task 1│  │ 2││
│   └─🧪 QA  │  🏗️: Here's my  │  └──────┘  └──┘│
│             │  plan...         │                 │
│             │                  │  Review  | Done │
│             │  [input box]     │           ┌──┐  │
│             │                  │           │ 3│  │
└─────────────┴──────────────────┴───────────┴──┘──┘
```

**TeamMap**: Simple CSS grid/flex layout (not React Flow for MVP):
- Leader node at top, connected by lines to member nodes below
- Each node: emoji + name + role + status dot (color) + context usage bar
- Context bar colors: green (<50%), yellow (50-80%), orange (80-95%), red (>95%)
- Status dot animates (pulse) when agent is running
- Click node → show agent detail (future: slide-in panel)

**ChatPanel**:
- Displays conversation messages
- Input box at bottom → `POST /api/teams/:id/message`
- SSE hook updates chat with: architect responses, task creation events, status changes
- System messages (task created, agent started, etc.) shown inline as gray cards

**TaskBoard**: 4 columns Kanban
- Backlog, In Progress, Review, Done
- Cards: title, assigned agent emoji, kind badge
- Click card → TaskDetailModal (description, result, trace)

**Acceptance criteria**:
- [ ] Navigate to `/teams/:id` → three panels render
- [ ] Team map shows leader + members with correct roles
- [ ] Agent status dots update in real-time via SSE
- [ ] Type message in chat → architect responds (streamed via SSE)
- [ ] Tasks appear on board when architect creates plan
- [ ] Tasks move between columns as agents work
- [ ] Click task → modal shows description, assigned agent, result
- [ ] "View App" tab: if `project/app/index.html` exists → iframe renders it
- [ ] "View App" tab: if no app → placeholder with instructions
- [ ] "Open in New Tab" button opens `/api/teams/:id/app/index.html` in new window
- [ ] App status indicator: "Available" (green) / "Not created" (gray)

---

### Step 14: Agent Detail & Trace Viewer

**Goal**: See what each agent is doing/thinking. Global trace view.

**Dependencies**: Step 12

**Create files**:
```
apps/web/src/
├── components/
│   ├── AgentDetailPanel.tsx        # Slide-in panel from team map
│   ├── TraceEvent.tsx              # Single trace event row
│   ├── ThinkingBlock.tsx           # Collapsible thinking content
│   └── ToolCallBlock.tsx           # Collapsible tool call with input/output
├── pages/
│   └── TraceViewer.tsx             # Global trace page with filters
├── hooks/
│   └── useTrace.ts                 # GET /api/trace + SSE updates
```

**AgentDetailPanel** (opens when clicking agent in TeamMap):
- Header: name, role, specialization, status badge
- **Context usage**: progress bar (78% — 780K / 1M tokens), colored by threshold
- **Session info**: turns count, last active time, session ID (truncated)
- **Actions**: [Reset Session] button, [Delete Agent] button
- Current task (if running): title, progress
- Stream view: scrollable list of trace events for this agent
  - `agent.thinking` → ThinkingBlock (gray, collapsible, italic)
  - `agent.message` → text content
  - `agent.tool_use` → ToolCallBlock (tool name, input preview, expandable)
  - `agent.tool_result` → result preview (expandable)
- Auto-scrolls to bottom when new events arrive

**TraceViewer page** (`/trace`):
- Filters bar: team dropdown, agent dropdown, event kind dropdown, date range
- Event list: timestamp | agent emoji+name | event kind badge | content preview
- Click row → expand to see full content
- Auto-updates via SSE

**Acceptance criteria**:
- [ ] Click agent in team map → panel slides in with agent details
- [ ] When agent is running, trace events stream in real-time
- [ ] Thinking blocks are collapsible
- [ ] Tool calls show name and input/output
- [ ] `/trace` page shows all events with working filters
- [ ] Events auto-update via SSE without page refresh

---

## Phase 4: Integration & Demo (Step 14)

### Step 15: End-to-End Demo Flow

**Goal**: Full demo scenario works: create team → give task → watch agents work → see result.

**Dependencies**: All previous steps

**Tasks**:
1. **Verify full flow**: Create team with architect + backend-dev + frontend-dev + qa
2. **Test message**: "Build a simple TODO app with React frontend and Express backend"
3. **Verify**: Architect creates plan → tasks created → agents work sequentially → architect reviews → done
4. **Check**: Code exists in workspace/project/ directory
5. **Polish**:
   - Error handling for all API calls (frontend toast notifications)
   - Loading states (skeletons or spinners)
   - Empty states ("No teams yet", "No tasks")
   - Emergency stop button works (kills all processes)
   - Graceful shutdown
6. **Write README.md** with:
   - Quick start (docker compose up, etc.)
   - Architecture diagram
   - Demo walkthrough
   - Configuration reference

**Acceptance criteria**:
- [ ] `docker compose up` starts all services
- [ ] Open browser → create team → add agents → send task → watch full pipeline
- [ ] Agents write actual code to project directory
- [ ] All trace events visible in UI
- [ ] Task board reflects current state accurately
- [ ] No crashes during normal flow
- [ ] Emergency stop aborts everything within 5 seconds

---

## File Count Summary

| Phase | New Files | Description |
|-------|-----------|-------------|
| Step 1 | ~20 | Scaffold, Docker, configs |
| Step 2 | ~8 | Database layer (7 tables) |
| Step 3 | ~14 | Teams + Agents API + role system |
| Step 4 | ~5 | Claude CLI adapter |
| Step 5 | ~5 | EventBus + SSE module |
| Step 6 | ~3 | Trace module |
| Step 7 | ~8 | Internal API (gamma-tools endpoints) + messaging |
| Step 8 | ~5 | Orchestrator + chat service |
| Step 9 | ~3 | Team App (static server + viewer) |
| Step 10 | ~2 | Prompt builder + E2E test |
| Step 11 | ~10 | Frontend foundation |
| Step 12 | ~3 | Modals |
| Step 13 | ~12 | Team detail view + app viewer |
| Step 14 | ~6 | Agent detail + trace |
| Step 15 | ~2 | README + polish |
| **Total** | **~105 files** | |

---

## Key Decisions Log

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DB | Postgres (not SQLite) | Docker-native, concurrent access, better for production demo |
| ORM | None (raw pg) | Fewer dependencies, full SQL control, faster to write for 5 tables |
| Event bus | In-memory EventEmitter2 (no Redis) | Single instance, no cross-process needs. Redis is overkill and adds a failure point. |
| SSE delivery | EventBus → SSE controller | Events flow in-memory. Trace persists to Postgres for history replay on reconnect. |
| CLI mode | `-p --permission-mode bypassPermissions` | Prevents interactive prompts. Do NOT use `--bare` (breaks Max subscription OAuth). |
| NDJSON parsing | Defensive (skip bad lines, never crash) | CLI output format is not contractually stable. Parser absorbs breakage gracefully. |
| CLI version | Pinned in package.json | Prevents surprise format changes on auto-update. |
| Process management | `detached: true` + kill process group (`-pid`) | Prevents zombie processes. `proc.kill()` alone doesn't reach grandchild processes. |
| Frontend styling | Tailwind | Fast iteration, no component library learning curve |
| Team map | CSS grid (not React Flow) | Simpler for MVP, React Flow can be added later |
| Agent communication | Orchestrator-mediated | Simpler than peer-to-peer, more reliable, easier to trace |
| Task execution | Sequential per stage | Avoids file conflicts, simpler reasoning, safer for demo |
| Backend/frontend | Run on host (not Docker) | Claude Code CLI needs host access (Max subscription login in ~/.claude). Only Postgres in Docker. |
| No HTTP/2 | Correct | Unnecessary complexity for localhost demo |
| No auth | Correct | Single-user local tool |

---

## CLAUDE.md for the v2 Project

Place this at `v2/CLAUDE.md` so Claude Code (and agents) understand the project:

```markdown
# Gamma Runtime v2

Multi-agent team orchestration platform. NestJS backend + React frontend.

## Quick Commands
pnpm install                         # install all deps
docker compose up -d                 # start Postgres
pnpm --filter @gamma/core dev        # backend (port 3001)
pnpm --filter @gamma/web dev         # frontend (port 5173)

## Architecture
- apps/core/ — NestJS 10 + Fastify backend
- apps/web/ — React 18 + Vite + Tailwind frontend
- Agent execution via Claude Code CLI (child_process.spawn)
- Postgres for persistent state, in-memory EventEmitter2 for SSE events

## Key Modules (backend)
- claude/ — CLI adapter (-p --permission-mode bypassPermissions), session pool, process group management
- orchestrator/ — agent loop, task dispatch, review cycle
- teams/ — team CRUD
- agents/ — agent CRUD, workspace management
- events/ — in-memory EventBus (EventEmitter2)
- sse/ — Server-Sent Events (subscribes to EventBus)
- trace/ — event persistence to Postgres + query
- repositories/ — raw pg queries for all 5 tables

## Critical: CLI invocation
Every Claude Code CLI spawn MUST use: -p --permission-mode bypassPermissions
Do NOT use --bare — it disables OAuth and breaks Max subscription auth.
Without these, the process WILL hang waiting for interactive input.
Processes MUST be spawned with { detached: true } and killed via process group (-pid).
```
