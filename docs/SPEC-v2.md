# Gamma Runtime v2 — MVP Specification

> Multi-agent team orchestration platform powered by Claude Code CLI.
> Local-first, subscription-based, no external LLM gateways.

---

## 1. Vision

A web application where users create **teams of AI agents**, assign tasks, and watch agents collaboratively develop software through a visible workflow. Each agent is a persistent Claude Code session running locally. The Team Lead (Architect) decomposes work into stages and tasks, delegates to specialized agents (Backend Dev, Frontend Dev, QA), reviews results, and drives the project to completion — all visible in real-time.

**Demo scenario**: User says to Architect: _"Build an MVP banking website with auth and dashboard"_. Architect creates an implementation plan, breaks it into tasks, delegates to Backend Dev and Frontend Dev, reviews their output, then hands off to QA for verification. The entire flow is visible in the UI.

---

## 2. Core Principles

| Principle | Description |
|-----------|-------------|
| **Local-first** | Everything runs via `docker compose up`. No cloud dependencies except Claude API (via Max subscription). |
| **Subscription-powered** | All LLM calls go through Claude Code CLI using the user's Max subscription. No API keys needed. |
| **Session persistence** | Teams, agents, conversations, and tasks survive app restarts. |
| **Visible workflow** | Every agent action, thought, and task transition is traceable in the UI. |
| **Simplicity over features** | Minimal viable architecture. No WebSocket relay, no binary protocols, no Ed25519 handshake. |

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    Browser (React)                   │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │ Team Map │  │ Chat     │  │ Task Board        │  │
│  │ (agents) │  │ Panel    │  │ (Kanban/timeline) │  │
│  └──────────┘  └──────────┘  └───────────────────┘  │
└────────────────────┬────────────────────────────────┘
                     │ REST + SSE
┌────────────────────┴────────────────────────────────┐
│               NestJS Backend (Fastify)               │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ Teams   │ │ Agents   │ │ Tasks  │ │ Orchestr. │  │
│  │ Module  │ │ Module   │ │ Module │ │ Module    │  │
│  └─────────┘ └──────────┘ └────────┘ └───────────┘  │
│  ┌─────────┐ ┌──────────┐ ┌────────────────────────┐ │
│  │ SSE     │ │ Trace    │ │ Claude CLI Adapter     │ │
│  │ (EventBus)│ Module   │ │ (child_process.spawn)  │ │
│  └─────────┘ └──────────┘ └────────────────────────┘ │
└────────┬────────────────────────────────────────────┘
         │
    ┌────┴────┐
    │ Postgres│         (No Redis — single instance,
    │ (state) │          in-memory EventBus for SSE)
    └─────────┘
         │
    ┌────┴──────────────────┐
    │  Claude Code CLI × N  │
    │  (one process per     │
    │   active agent)       │
    └───────────────────────┘
```

> **Design decision: No Redis.** This is a single-instance local app. SSE events
> flow through an in-memory EventBus (NestJS `EventEmitter2` or RxJS `Subject`).
> Trace events persist to Postgres. Redis can be added later if horizontal scaling
> is ever needed — the EventBus interface stays the same.

---

## 4. Data Model

### 4.1 Teams

```sql
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,        -- "team_<ULID>"
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  status      TEXT DEFAULT 'active'    -- active | archived
    CHECK (status IN ('active', 'archived')),
  created_at  INTEGER NOT NULL,        -- ms timestamp
  updated_at  INTEGER NOT NULL
);
```

### 4.2 Agents

```sql
CREATE TABLE agents (
  id              TEXT PRIMARY KEY,    -- "agent_<ULID>"
  name            TEXT NOT NULL,
  role_id         TEXT NOT NULL,       -- from roles-manifest.json, e.g. "engineering/engineering-senior-developer"
  specialization  TEXT DEFAULT '',     -- free-text, e.g., "Senior React Developer"
  description     TEXT DEFAULT '',
  avatar_emoji    TEXT DEFAULT '🤖',
  status          TEXT DEFAULT 'idle'  -- idle | running | error | archived
    CHECK (status IN ('idle', 'running', 'error', 'archived')),
  team_id         TEXT REFERENCES teams(id) ON DELETE SET NULL,
  is_leader       INTEGER DEFAULT 0,  -- 1 = team leader
  session_id      TEXT,               -- Claude Code session ID (for --resume)
  workspace_path  TEXT,               -- agent's working directory
  context_tokens  INTEGER DEFAULT 0,  -- last known total tokens in session
  context_window  INTEGER DEFAULT 1000000, -- model context window size
  total_turns     INTEGER DEFAULT 0,  -- cumulative turns across all runs
  last_active_at  INTEGER,            -- ms timestamp of last activity
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

### 4.3 Projects

```sql
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,        -- "proj_<ULID>"
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  team_id     TEXT NOT NULL REFERENCES teams(id),
  status      TEXT DEFAULT 'planning'  -- planning | active | completed | failed
    CHECK (status IN ('planning', 'active', 'completed', 'failed')),
  plan        TEXT,                    -- JSON: implementation plan from architect
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

### 4.4 Tasks

```sql
CREATE TABLE tasks (
  id              TEXT PRIMARY KEY,    -- "task_<ULID>"
  title           TEXT NOT NULL,
  description     TEXT DEFAULT '',
  project_id      TEXT REFERENCES projects(id),
  team_id         TEXT NOT NULL REFERENCES teams(id),
  stage           TEXT DEFAULT 'backlog',  -- backlog | planning | in_progress | review | done | failed
    CHECK (stage IN ('backlog', 'planning', 'in_progress', 'review', 'done', 'failed')),
  kind            TEXT DEFAULT 'generic',  -- generic | backend | frontend | qa | design | devops
    CHECK (kind IN ('generic', 'backend', 'frontend', 'qa', 'design', 'devops')),
  assigned_to     TEXT REFERENCES agents(id),
  created_by      TEXT REFERENCES agents(id),
  priority        INTEGER DEFAULT 0,       -- higher = more important
  result          TEXT,                     -- JSON: agent's output/summary
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
```

### 4.5 Trace Events

```sql
CREATE TABLE trace_events (
  id          TEXT PRIMARY KEY,        -- "evt_<ULID>"
  agent_id    TEXT NOT NULL REFERENCES agents(id),
  team_id     TEXT REFERENCES teams(id),
  task_id     TEXT REFERENCES tasks(id),
  kind        TEXT NOT NULL,           -- see §7.2
  content     TEXT,                    -- JSON payload
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_trace_agent ON trace_events(agent_id, created_at);
CREATE INDEX idx_trace_team  ON trace_events(team_id, created_at);
CREATE INDEX idx_trace_task  ON trace_events(task_id, created_at);
```

---

## 5. Claude Code CLI Adapter

The core integration layer. Wraps Claude Code CLI as a managed subprocess.

### 5.1 Non-Interactive Execution (CRITICAL)

Claude Code CLI **must** run in fully non-interactive mode. If the CLI prompts
for input (permission dialogs, y/N confirmations), the spawned process will
hang indefinitely until `AGENT_TIMEOUT_MS` kills it.

**Required flags for every invocation:**

```bash
claude -p "message here" \               # print mode (non-interactive, exits on completion)
  --permission-mode bypassPermissions \  # never prompt for tool approval
  --output-format stream-json \          # NDJSON streaming output
  --verbose \                            # include thinking tokens
  --max-turns 50 \                       # safety limit on agentic loops
  --cwd /path/to/workspace              # agent's working directory
```

| Flag | Why it's required |
|------|-------------------|
| `-p` | Print mode — runs, returns output, exits. No interactive REPL. |
| `--permission-mode bypassPermissions` | Auto-approves all tool calls. Without this, CLI may prompt for y/N and hang the process. |
| `--output-format stream-json` | Structured NDJSON output we can parse. |
| `--verbose` | Includes thinking blocks in the stream. |
| `--max-turns 50` | Prevents infinite agentic loops. Only works in `-p` mode. |

**Additional useful flags:**
- `--system-prompt "..."` — override system prompt (alternative to CLAUDE.md)
- `--append-system-prompt "..."` — add instructions while keeping defaults
- `--resume SESSION_ID` — resume a previous session
- `--max-budget-usd 5.00` — cost limit per run (safety)
- `--allowedTools "Bash,Read,Edit,Write,Glob,Grep"` — restrict available tools
- `--no-session-persistence` — don't save session (for ephemeral runs)

**Why NOT `--bare`?** The `--bare` flag disables OAuth (Max subscription auth)
and only allows `ANTHROPIC_API_KEY` env var. Since we use Max subscription,
`--bare` is incompatible. Without `--bare`, the CLI will load host MCP servers
and hooks — acceptable for local MVP.

**What happens WITHOUT these flags:**
- No `--permission-mode bypassPermissions` → CLI prompts "Allow Bash? [y/N]" → stdin hangs → timeout
- No `-p` → CLI enters interactive REPL → waits for keyboard input → hangs

### 5.2 Interface

```typescript
interface StreamChunk {
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'result';
  content: string;
  toolName?: string;      // for tool_use
  toolInput?: unknown;    // for tool_use
  sessionId?: string;     // returned in 'result' chunk
}

interface RunResult {
  sessionId: string;
  text: string;           // final response text
  durationMs: number;
}
```

### 5.3 Implementation Strategy

Each agent run spawns a Claude Code CLI process:

```typescript
// New conversation
const proc = spawn('claude', [
  '-p', message,
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json',
  '--verbose',
  '--max-turns', '50',
  '--cwd', workspacePath,
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,  // Create new process group (for clean kill, see §5.6)
});
```

For **resuming** an existing conversation:
```typescript
const proc = spawn('claude', [
  '--resume', sessionId,
  '-p', message,
  '--permission-mode', 'bypassPermissions',
  '--output-format', 'stream-json',
  '--verbose',
  '--max-turns', '50',
  '--cwd', workspacePath,
], {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: true,
});
```

### 5.4 NDJSON Stream Parsing & Resilience

The `stream-json` output format emits one JSON object per line. The format is
**not contractually stable** — it may change across CLI versions.

**Defensive parsing strategy:**

```typescript
// 1. Read stdout line-by-line
// 2. Skip blank lines
// 3. Try JSON.parse — if it fails, log and skip (don't crash)
// 4. Classify by known fields; unknown types → emit as 'unknown' and log
// 5. Pin CLI version in package.json / Dockerfile to avoid surprise breakage

for await (const line of readline.createInterface({ input: proc.stdout })) {
  if (!line.trim()) continue;
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    logger.warn('Unparseable CLI output line, skipping', { line: line.slice(0, 200) });
    continue;  // never crash on bad output
  }
  const chunk = classifyChunk(parsed);  // map to StreamChunk
  yield chunk;
}
```

**Version pinning:** Lock Claude Code CLI version in the project (e.g., via
Dockerfile `npm install -g @anthropic-ai/claude-code@2.1.89`). Update
intentionally, test parser against new output format before upgrading.

### 5.5 Session Pool

```typescript
class SessionPool {
  private running = 0;
  private queue: Array<{ resolve: () => void }> = [];
  private processes: Map<string, ChildProcess> = new Map();  // agentId → proc

  // Max concurrent sessions (configurable, default: 2)
  private maxConcurrent = parseInt(process.env.MAX_CONCURRENT_AGENTS ?? '2');

  async acquire(): Promise<void>;    // wait if at capacity
  release(): void;                    // decrement, dequeue next
  register(agentId: string, proc: ChildProcess): void;
  unregister(agentId: string): void;
  abortAll(): void;                   // kill all process groups (see §5.6)
  get stats(): { running: number; queued: number };
}
```

**Queue behavior**: If all slots are occupied, new requests wait in FIFO queue. When a session completes, next queued agent is activated.

### 5.6 Process Management & Zombie Prevention

**Problem**: `proc.kill('SIGTERM')` only kills the direct child. Claude Code may
spawn sub-processes (Node.js workers, tool executors) that become orphans.

**Solution**: Spawn with `detached: true`, kill the entire **process group**.

```typescript
function killProcessGroup(proc: ChildProcess): void {
  if (proc.pid) {
    try {
      // Kill entire process group (negative PID = group)
      process.kill(-proc.pid, 'SIGTERM');
    } catch (e) {
      // ESRCH = process already exited — safe to ignore
      if ((e as NodeJS.ErrnoException).code !== 'ESRCH') throw e;
    }
  }
}

// Timeout handler
const timeout = setTimeout(() => {
  logger.warn('Agent timed out, killing process group', { agentId, pid: proc.pid });
  killProcessGroup(proc);
}, AGENT_TIMEOUT_MS);

// Always clean up on exit
proc.on('exit', (code, signal) => {
  clearTimeout(timeout);
  pool.unregister(agentId);
  // Verify no orphans: check /proc or `pgrep -g <pgid>` (optional paranoia)
});
```

**Graceful shutdown** (SIGTERM to backend):
```typescript
async onApplicationShutdown(): Promise<void> {
  // 1. Kill all process groups
  for (const [agentId, proc] of this.pool.processes) {
    killProcessGroup(proc);
  }
  // 2. Wait up to 5s for processes to exit
  await Promise.race([
    Promise.all([...this.pool.processes.values()].map(p =>
      new Promise(r => p.on('exit', r))
    )),
    new Promise(r => setTimeout(r, 5000)),
  ]);
  // 3. SIGKILL any survivors
  for (const [, proc] of this.pool.processes) {
    if (!proc.killed) process.kill(-proc.pid!, 'SIGKILL');
  }
}
```

### 5.7 System Prompt Injection

Each agent receives its system prompt via the `--system-prompt` flag, injected
directly as a CLI argument. This avoids relying on CLAUDE.md file discovery.

```typescript
const systemPrompt = this.claudeMdGenerator.generate(agent, team, members);

const args = [
  '-p', message,
  '--permission-mode', 'bypassPermissions',
  '--system-prompt', systemPrompt,   // inject role + team context directly
  '--output-format', 'stream-json',
  '--verbose',
  '--max-turns', '50',
  '--cwd', projectDir,           // shared project/ directory
];
```

This avoids file placement issues entirely. The full CLAUDE.md template is in §10.3.

---

## 6. Orchestration Engine & Agent Tools

### 6.1 Architecture: Tool-Driven Orchestration

Agents interact with the Gamma system through **gamma-tools** — a set of HTTP
endpoints on the backend that agents call via `curl` from their Bash tool.
The team leader decides the workflow; the orchestrator is a minimal event loop.

```
User Message
    │
    ▼
Orchestrator starts Leader (Claude CLI session)
    │
    ▼
Leader thinks, then calls gamma-tools via Bash:
    │
    ├── curl POST /api/internal/assign-task → Backend Dev gets a task
    ├── curl POST /api/internal/assign-task → Frontend Dev gets a task
    │
    │   (Backend spawns as CLI, works, calls:)
    │   curl POST /api/internal/update-task --status done
    │
    │   (Frontend spawns as CLI, works, calls:)
    │   curl POST /api/internal/update-task --status done
    │
    ├── curl GET /api/internal/list-tasks → Leader sees all done
    ├── curl POST /api/internal/send-message → "Great work team!"
    └── curl POST /api/internal/mark-done → Project complete
```

**The workflow is NOT hardcoded.** The leader decides what to do based on their
role prompt. An architect leader will plan→delegate→review. A marketing leader
will research→strategize→execute. Same orchestrator code, different behavior.

### 6.2 Gamma Tools (Internal API)

HTTP endpoints called by agents via `curl`. No auth — localhost only.

#### Task Management

| Endpoint | Method | Description | Who calls |
|----------|--------|-------------|-----------|
| `/api/internal/assign-task` | POST | Create task and assign to agent | Leader |
| `/api/internal/update-task` | POST | Update task status/result | Any agent |
| `/api/internal/list-tasks` | GET | List tasks (filter by status, assignee) | Any agent |
| `/api/internal/get-task` | GET | Get task details | Any agent |

**assign-task** body:
```json
{
  "teamId": "team_xxx",
  "to": "Backend Dev",
  "title": "Create REST API",
  "description": "Build user auth endpoints with JWT...",
  "kind": "backend",
  "priority": 1
}
```
Response: `{ "success": true, "taskId": "task_xxx" }`

Side effect: backend creates task in DB, spawns the assigned agent's CLI
process with the task description as prompt. Agent starts working immediately.

**update-task** body:
```json
{
  "taskId": "task_xxx",
  "status": "done",
  "summary": "Created /src/api/auth.ts with login/register endpoints",
  "filesChanged": ["src/api/auth.ts", "src/models/user.ts"]
}
```

#### Inter-Agent Communication

| Endpoint | Method | Description | Who calls |
|----------|--------|-------------|-----------|
| `/api/internal/send-message` | POST | Send message to another agent | Any agent |
| `/api/internal/read-messages` | GET | Read inbox messages | Any agent |
| `/api/internal/broadcast` | POST | Message all team members | Leader |

**send-message** body:
```json
{
  "from": "agent_xxx",
  "to": "Backend Dev",
  "message": "Please also add password reset endpoint"
}
```
Response: `{ "success": true, "messageId": "msg_xxx" }`

Side effect: message stored in DB. If recipient agent is running, message is
injected into their session. If idle, message waits in inbox for next run.

#### Team & Project

| Endpoint | Method | Description | Who calls |
|----------|--------|-------------|-----------|
| `/api/internal/list-agents` | GET | List team members + statuses | Any agent |
| `/api/internal/mark-done` | POST | Mark project as completed | Leader |
| `/api/internal/request-review` | POST | Ask leader to review work | Any agent |

#### Agent Self-Management

| Endpoint | Method | Description | Who calls |
|----------|--------|-------------|-----------|
| `/api/internal/report-status` | POST | Report progress/blockers | Any agent |
| `/api/internal/read-context` | GET | Get project context, prior results | Any agent |

### 6.3 How Agents Call Tools

Agents have Bash tool built into Claude Code. Their system prompt includes:

```markdown
## System Tools

You can interact with the Gamma system using curl commands to http://localhost:3001/api/internal.

### Assign a task to a team member:
curl -s -X POST http://localhost:3001/api/internal/assign-task \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","to":"Agent Name","title":"...","description":"...","kind":"backend"}'

### Update your task status:
curl -s -X POST http://localhost:3001/api/internal/update-task \
  -H "Content-Type: application/json" \
  -d '{"taskId":"TASK_ID","status":"done","summary":"..."}'

### Send a message to another agent:
curl -s -X POST http://localhost:3001/api/internal/send-message \
  -H "Content-Type: application/json" \
  -d '{"from":"YOUR_AGENT_ID","to":"Agent Name","message":"..."}'

### Check your messages:
curl -s http://localhost:3001/api/internal/read-messages?agentId=YOUR_AGENT_ID

### List tasks:
curl -s "http://localhost:3001/api/internal/list-tasks?teamId=TEAM_ID&status=in_progress"

### List team members:
curl -s "http://localhost:3001/api/internal/list-agents?teamId=TEAM_ID"

### Mark project as done (leader only):
curl -s -X POST http://localhost:3001/api/internal/mark-done \
  -H "Content-Type: application/json" \
  -d '{"teamId":"TEAM_ID","summary":"..."}'
```

The `TEAM_ID` and `YOUR_AGENT_ID` placeholders are replaced with real values
when the system prompt is generated (see §10.3).

### 6.4 Orchestrator Service (Minimal)

The orchestrator is now a thin event loop:

```typescript
class OrchestratorService {
  /**
   * User sends message to team.
   * 1. Start leader's CLI session with the message
   * 2. Stream output, emit trace events
   * 3. Leader calls gamma-tools via Bash → triggers side effects
   * 4. When leader finishes, check if project is marked done
   */
  async handleTeamMessage(teamId: string, message: string): Promise<void>;

  /**
   * Called by /api/internal/assign-task.
   * 1. Create task in DB
   * 2. Find agent by name/role in team
   * 3. Acquire session from pool (queue if full)
   * 4. Spawn agent CLI with task description
   * 5. Stream output, emit trace events
   * 6. Agent calls update-task when done → triggers completion
   */
  async spawnAgentForTask(task: Task, agent: Agent): Promise<void>;

  /**
   * Called when agent completes (CLI process exits).
   * 1. If agent didn't call update-task, auto-mark as done/failed
   * 2. Notify leader via message inbox
   * 3. Release session pool slot
   */
  async onAgentComplete(agentId: string, exitCode: number): Promise<void>;
}
```

### 6.5 Task Lifecycle State Machine

```
backlog → in_progress → done
              │
              └──→ failed
```

Simplified for tool-driven flow. Transitions happen via gamma-tools calls:

| Transition | Trigger |
|-----------|---------|
| (none) → backlog | Leader calls `assign-task` |
| backlog → in_progress | Orchestrator spawns agent CLI |
| in_progress → done | Agent calls `update-task` with status=done |
| in_progress → failed | Agent calls `update-task` with status=failed, OR timeout |

No separate "review" or "planning" stages — the leader handles review
through read-messages/list-tasks and can assign follow-up tasks if needed.

### 6.6 Inter-Agent Communication Flow

```
Leader assigns task to Backend Dev
  → Backend Dev spawns, works on code
  → Backend Dev calls: send-message(to: "Frontend Dev", "API is at /api/v1/...")
  → Backend Dev calls: update-task(status: done, summary: "...")
  
Frontend Dev spawns for their task
  → Checks inbox: read-messages → sees message from Backend Dev
  → Uses that info to build UI against the API
  → Calls: update-task(status: done)

Leader checks: list-tasks(status: done) → all done
  → Calls: mark-done(summary: "Banking MVP complete")
```

Agents communicate through the message inbox. Messages persist in DB and are
available whenever the recipient runs `read-messages`.

---

## 7. Event System & Tracing

### 7.1 Architecture

```
Agent Process → Backend (parse output) → Trace DB + In-Memory EventBus → SSE → UI
```

**EventBus**: NestJS `EventEmitter2` (or RxJS `Subject`). In-memory only.
Events are emitted to SSE listeners AND persisted to Postgres `trace_events` table.
No Redis needed — single backend instance, events don't need to survive restarts
(trace history is in Postgres).

### 7.2 Event Kinds

| Kind | Description | Source |
|------|-------------|--------|
| `agent.started` | Agent session activated | Orchestrator |
| `agent.thinking` | Agent is reasoning (thinking block) | CLI output stream |
| `agent.message` | Agent produced text output | CLI output stream |
| `agent.tool_use` | Agent invoked a tool | CLI output stream |
| `agent.tool_result` | Tool returned a result | CLI output stream |
| `agent.completed` | Agent finished current task | Orchestrator |
| `agent.error` | Agent encountered an error | CLI stderr / timeout |
| `task.created` | New task created | Orchestrator |
| `task.assigned` | Task assigned to agent | Orchestrator |
| `task.stage_changed` | Task moved to new stage | Orchestrator |
| `task.completed` | Task finished (done/failed) | Orchestrator |
| `team.message` | User sent message to team | API |
| `orchestrator.stage_start` | Pipeline stage began | Orchestrator |
| `orchestrator.stage_end` | Pipeline stage completed | Orchestrator |
| `orchestrator.review` | Review cycle initiated | Orchestrator |

### 7.3 SSE Channels

| Channel | Path | Content |
|---------|------|---------|
| Team feed | `GET /api/teams/:id/stream` | All events for a team |
| Agent feed | `GET /api/agents/:id/stream` | Events for specific agent |
| Global feed | `GET /api/stream` | All system events |

---

## 8. REST API

### 8.1 Teams (UI ↔ Backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams` | List all teams |
| `POST` | `/api/teams` | Create team (optionally with leader) |
| `GET` | `/api/teams/:id` | Get team with members |
| `PATCH` | `/api/teams/:id` | Update team metadata |
| `DELETE` | `/api/teams/:id` | Archive team (see §12) |
| `POST` | `/api/teams/:id/message` | Send message to team (triggers orchestration) |
| `GET` | `/api/teams/:id/chat` | Get chat history (paginated) |
| `GET` | `/api/teams/:id/stream` | SSE: real-time team events |

### 8.2 Agents (UI ↔ Backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/agents` | List all agents |
| `POST` | `/api/agents` | Create agent |
| `GET` | `/api/agents/:id` | Get agent details |
| `PATCH` | `/api/agents/:id` | Update agent |
| `DELETE` | `/api/agents/:id` | Archive agent (see §12) |
| `POST` | `/api/agents/:id/reset-session` | Clear session, reset context (see §15) |
| `GET` | `/api/agents/:id/stream` | SSE: agent trace stream |
| `GET` | `/api/agents/roles` | List available roles from manifest |

### 8.3 Tasks (UI ↔ Backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/tasks` | List tasks (filter: team, project, status, kind) |
| `GET` | `/api/tasks/:id` | Get task with trace events |

### 8.4 System (UI ↔ Backend)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check + pool stats |
| `POST` | `/api/emergency-stop` | Abort all running agents (see §12.3) |
| `GET` | `/api/stream` | SSE: global event stream |

### 8.5 Internal API (Agents ↔ Backend via gamma-tools)

Called by agents via `curl` from Bash tool. No auth. Localhost only.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/internal/assign-task` | Create + assign task, spawn agent |
| `POST` | `/api/internal/update-task` | Update task status/result |
| `GET` | `/api/internal/list-tasks` | List tasks (query: teamId, status, assignee) |
| `GET` | `/api/internal/get-task/:id` | Get single task details |
| `POST` | `/api/internal/send-message` | Send message to another agent's inbox |
| `GET` | `/api/internal/read-messages` | Read inbox (query: agentId, since) |
| `POST` | `/api/internal/broadcast` | Message all team members |
| `GET` | `/api/internal/list-agents` | List team members + statuses |
| `POST` | `/api/internal/mark-done` | Mark project as completed |
| `POST` | `/api/internal/request-review` | Ask leader to review work |
| `POST` | `/api/internal/report-status` | Report progress/blockers |
| `GET` | `/api/internal/read-context` | Get project context + prior results |

All internal endpoints return JSON: `{ "success": true, ... }` or `{ "success": false, "error": "..." }`

### 8.6 Team App (Static File Server)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams/:id/app/status` | Check if app exists, files, last modified |
| `GET` | `/api/teams/:id/app/*` | Serve static files from project/app/ |

---

## 9. Frontend

### 9.1 Pages / Views

**Main Layout**: Single-page app with sidebar navigation.

```
┌──────┬──────────────────────────────────────┐
│      │                                      │
│  S   │          Main Content Area           │
│  I   │                                      │
│  D   │  ┌────────────────────────────────┐  │
│  E   │  │  Team Map / Chat / Tasks       │  │
│  B   │  │                                │  │
│  A   │  │                                │  │
│  R   │  └────────────────────────────────┘  │
│      │                                      │
│      │  ┌────────────────────────────────┐  │
│      │  │  Trace / Activity Panel        │  │
│      │  └────────────────────────────────┘  │
└──────┴──────────────────────────────────────┘
```

### 9.2 Sidebar Navigation

| Icon | Label | View |
|------|-------|------|
| 🏠 | Home | Dashboard: overview of all teams |
| 📋 | Tasks | Kanban board (all tasks across teams) |
| 📊 | Trace | Global activity/trace viewer |

### 9.3 Key Views

#### Dashboard (Home)
- Cards for each team: name, member count, active tasks, status
- Each team card: hover reveals X button (delete) → Delete Team confirmation modal
- Quick action: "Create Team" button
- Recent activity feed (last 20 events)

#### Team Detail View
Split into 3 panels:

**Team Detail header**: back arrow, team name + description, "+ Add Agent" button, "Delete Team" button (red)

**Left Panel — Team Map** (React Flow or simple HTML/CSS):
- Visual hierarchy: Leader at top, team members below
- Nodes show: avatar, name, role, status indicator (idle/running/error), context usage bar
- Status color: green=idle, blue=running, red=error, gray=archived
- "+" button to add agent
- Click agent → Agent Detail panel (slide-in below the map)

**Center Panel — Chat**:
- Chat with team leader (primary interaction)
- Messages from user (right-aligned)
- Messages from leader (left-aligned, with avatar)
- Inline display of: task creation events, agent delegation, status updates
- Input box at bottom

**Right Panel — Task Board**:
- Columns: Backlog | In Progress | Review | Done
- Task cards: title, assigned agent avatar, kind badge, priority
- Click card → task detail modal (description, trace, result)

#### Agent Detail Panel (slide-in or modal)
- Agent info: name, role, specialization, status
- **Context usage bar**: colored progress bar (green/yellow/orange/red)
  - Shows: "78% — 780K / 1M tokens"
  - Green (<50%), Yellow (50-80%), Orange (80-95%), Red (>95%)
- **Session info**: total turns, last active time
- **Actions**: [Reset Session] — clears session, resets context to 0
- Current task (if any)
- Session history: scrollable list of messages/tool calls
- Live streaming output when agent is running
- Thinking blocks (collapsible)
- Tool calls with inputs/outputs (collapsible)

#### Trace Viewer
- Filterable event log (by team, agent, task, event kind)
- Timeline view: events on a timeline with agent swim lanes
- Each event expandable to show full content/payload

### 9.4 Modals

**Create Team Modal**:
- Team name (text input)
- Team description (text area)
- Leader name (text input, default: role name)
- Leader role: category dropdown (default: "Leadership") → role list
- Leader specialization (text input, optional, e.g., "Full-stack architect")
- → Creates team + leader agent atomically

**Add Agent Modal**:
- Agent name (text input)
- Role: category dropdown (default: "Engineering") → role list
- Specialization (text input, optional)
- → Creates agent and assigns to current team

**Task Detail Modal**:
- Title, description, kind, priority
- Assigned agent
- Stage timeline (visual progress)
- Trace events for this task
- Result (when completed)

**Delete Team Confirmation Modal** (triggered from team card X button or Team Detail header):
- Warning text: "Are you sure you want to delete {team name}?"
- Impact list: kill running agents, archive all agents, fail tasks, archive team
- "Cancel" and "Delete Team" (red) buttons

**Delete Agent Confirmation Modal** (triggered from Agent Detail panel):
- Warning text: "Are you sure you want to delete {agent name}?"
- Impact list: kill if running, return tasks to backlog, update team prompts, archive
- "Cancel" and "Delete Agent" (red) buttons

### 9.5 Tech Stack (Frontend)

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Framework | React 18 + Vite | Same as gamma-ui, proven |
| State | Zustand | Lightweight, already known |
| Styling | Tailwind CSS | Fast to build, no component library overhead |
| Team Map | React Flow (simple mode) OR pure HTML/CSS flex | React Flow if time permits, otherwise CSS grid |
| SSE | Native EventSource + custom hook | Simple, no library needed |
| HTTP | fetch (native) | No axios dependency |
| Routing | React Router v6 | Standard |
| Icons | Lucide React | Lightweight, tree-shakable |

---

## 10. Agent Roles & System Prompts

### 10.1 Role System

Roles are loaded from `community-roles/` — **161 role files** across 14 categories (engineering, design, testing, etc.). Each role is a Markdown file with YAML frontmatter:

```yaml
---
name: Senior Developer
description: Premium implementation specialist
color: green
emoji: 💎
vibe: Premium full-stack craftsperson
---
# Developer Agent Personality
You are **EngineeringSeniorDeveloper**, a senior full-stack developer...
## Your Identity & Memory
## Critical Rules You Must Follow
## Your Implementation Process
...
```

**Role manifest**: `data/roles-manifest.json` — an index of all 161 roles with `id`, `fileName`, `name`, `description`, `color`, `emoji`, `vibe`.

**Role selection flow**:
1. Frontend fetches `GET /api/agents/roles` → returns roles **grouped by category**
2. User picks a category first, then a role within it
3. Backend reads the full role Markdown file from `community-roles/{fileName}`
4. Role content is injected into the agent's system prompt (see §10.3)

### 10.1.1 Role Categories

Roles are grouped by the first segment of their `id` (e.g., `engineering/...` → "Engineering").
Additionally, a virtual **"Leadership"** category is provided for team leader selection.

| Category | Count | Examples |
|----------|-------|---------|
| **Leadership** (virtual) | ~10 | Software Architect, Project Shepherd, Senior PM, Product Manager, Agents Orchestrator, Studio Producer |
| Engineering | 23 | Backend Architect, Senior Developer, Code Reviewer, AI Engineer |
| Design | 8 | UI Designer, UX Architect, Brand Guardian |
| Testing | 8 | Accessibility Auditor, API Tester, Performance Benchmarker |
| Project Management | 6 | Project Shepherd, Studio Producer, Senior PM |
| Product | 5 | Product Manager, Sprint Prioritizer, Trend Researcher |
| Marketing | 27 | SEO Specialist, Content Creator, Growth Hacker |
| Sales | 8 | Sales Coach, Deal Strategist, Account Strategist |
| Specialized | 27 | Agents Orchestrator, Workflow Architect, Salesforce Architect |
| Game Development | 20 | Game Designer, Unity Architect, Level Designer |
| Paid Media | 7 | PPC Strategist, Paid Social Strategist |
| Spatial Computing | 6 | visionOS Engineer, XR Interface Architect |
| Academic | 5 | Historian, Psychologist, Narratologist |
| Support | 6 | Finance Tracker, Legal Compliance, Analytics Reporter |
| Job Hunting | 5 | Squad Leader, Scout, Reporter |

**Leadership category** is curated — hand-picked roles suitable for team leaders:
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
```

**API response format**:
```json
{
  "categories": [
    {
      "id": "leadership",
      "name": "Leadership",
      "description": "Roles suitable for team leaders",
      "roles": [
        { "id": "engineering/engineering-software-architect", "name": "Software Architect", "emoji": "🏛️", ... },
        ...
      ]
    },
    {
      "id": "engineering",
      "name": "Engineering",
      "roles": [ ... ]
    },
    ...
  ]
}
```

**UI: Role Picker** (in Create Team and Add Agent modals):
```
┌─ Select Role ─────────────────────────┐
│                                       │
│  [Leadership ▼]  ← category dropdown  │
│                                       │
│  🏛️ Software Architect               │
│     Expert in system design, DDD...   │
│                                       │
│  📝 Senior Project Manager            │
│     Converts specs to tasks...        │
│                                       │
│  🧭 Product Manager                   │
│     Holistic product leader...        │
│                                       │
│  🎛️ Agents Orchestrator              │
│     Autonomous pipeline manager...    │
│                                       │
└───────────────────────────────────────┘
```

When creating a **team** (choosing leader): default category = "Leadership".
When **adding agent** to team: default category = "Engineering".

**Built-in task kind mapping** (for task dispatcher):

| Category | Task Kinds |
|----------|-----------|
| `engineering/*` | backend, frontend, generic |
| `design/*` | design, frontend |
| `testing/*` | qa, generic |
| `project-management/*` | planning, review, generic |
| `product/*` | planning, generic |
| `*` (fallback) | generic |

### 10.2 Dynamic CLAUDE.md Generation

Each agent gets a **dynamically generated CLAUDE.md** placed in its workspace directory. This file is rebuilt whenever the team composition changes (agent added/removed).

The CLAUDE.md combines:
1. **Role prompt** — the full community-roles Markdown content
2. **Team context** — who's in the team, hierarchy, communication protocol
3. **System instructions** — output format, workspace rules

### 10.3 System Prompt Template (CLAUDE.md per agent workspace)

```markdown
# Agent Identity

You are **{agent.name}**, a **{agent.specialization}** on team **"{team.name}"**.

## Your Role

{FULL CONTENT OF community-roles/{roleFileName}.md — inserted verbatim}

---

## Team Context

You are part of team **"{team.name}"** ({team.description}).

### Your position
- **You report to**: {leader.name} ({leader.role}) {if not leader}
- **You are the team leader.** {if leader}

### Team members
{for each member in team:}
- **{member.name}** ({member.role}: {member.specialization}) — status: {member.status}
{end for}

### Communication
You do NOT communicate directly with other agents. The orchestration system
manages all task routing. When you complete work, your output is automatically
shared with the team leader for review.

If you need something from a teammate, mention it in your summary output
and the orchestrator will handle delegation.

## Working Directory

- **Project directory**: {team.workspacePath}/project/ — all code goes here
- **Plans directory**: {team.workspacePath}/plans/ — architecture docs and reviews
- **Your notes**: {team.workspacePath}/agents/{agent.id}/notes/

## Output Protocol

When you complete a task, end your response with a JSON summary block:

​```json
{
  "status": "completed" | "failed" | "needs_clarification",
  "summary": "Brief description of what was done",
  "files_changed": ["path/to/file1", "path/to/file2"],
  "notes": "Any concerns, blockers, or suggestions for the team"
}
​```

## Guidelines
- Write clean, production-quality code
- Follow existing project conventions
- Do not modify files outside your assigned scope unless necessary
- If you encounter a blocker, report it in the summary — do NOT stop silently
- Read existing code before making changes
```

### 10.4 Leader-Specific Prompt Addition (appended for team leaders)

```markdown
## Leadership Responsibilities

You are the **team leader**. You are responsible for:
1. Breaking down user requests into actionable tasks for your team
2. Reviewing completed work from team members
3. Ensuring quality and consistency across all deliverables

### Task Decomposition Protocol

When given a project request, create an implementation plan.
Respond with a JSON plan block:

​```json
{
  "plan": {
    "name": "Project name",
    "description": "Brief description",
    "stages": [
      {
        "name": "Stage name",
        "order": 1,
        "tasks": [
          {
            "title": "Task title",
            "description": "Detailed description with clear acceptance criteria",
            "kind": "backend|frontend|qa|design|devops|generic",
            "priority": 1
          }
        ]
      }
    ]
  }
}
​```

Match task `kind` to your team members' specializations:
{for each member in team (non-leader):}
- {member.name} ({member.role}) → best for: {member.taskKinds}
{end for}

### Review Protocol

When reviewing team output, respond with:

​```json
{
  "review": {
    "approved": true | false,
    "feedback": [
      { "task_id": "...", "status": "approved|changes_requested|failed", "comment": "..." }
    ],
    "summary": "Overall assessment"
  }
}
​```
```

### 10.5 CLAUDE.md Regeneration

The agent's CLAUDE.md is **regenerated** when:
- Agent is first created (initial generation)
- A new agent is added to the team (team context changes)
- An agent is removed from the team
- Team metadata changes (name, description)

This ensures every agent always has an up-to-date view of their team.

---

## 11. Workspace Layout

```
/data/workspaces/                     ← mounted Docker volume
  └── {team_id}/
      ├── project/                    ← shared project directory (all agents read/write here)
      │   ├── src/
      │   ├── package.json
      │   └── ...
      ├── plans/                      ← architect's plans and reviews
      │   ├── implementation-plan.md
      │   └── review-001.md
      └── agents/
          ├── {agent_id}/             ← per-agent workspace
          │   ├── CLAUDE.md           ← agent system prompt
          │   └── notes/              ← agent's scratch space
          └── ...
```

Each agent's `--cwd` is set to `project/` (shared). System prompt is injected
via `--system-prompt` flag (see §5.7), not via CLAUDE.md file on disk.

---

## 12. Team App (Work Results Viewer)

### 12.1 Concept

Each team can produce a **Team App** — a static HTML application that visualizes
the team's work results. The leader creates it as a final deliverable by
writing files to `project/app/`. The backend serves these files, and the
frontend displays them in an iframe.

**Examples by team type:**
- **Dev team** → generated app itself (banking dashboard, TODO app, etc.)
- **Job hunting team** → HTML page with curated vacancies, adapted resumes, briefings
- **Video/content team** → gallery of generated assets with approve/reject buttons
- **Research team** → structured report with findings, links, recommendations

### 12.2 How It Works

```
1. Team works on tasks (normal flow)
2. Leader collects results from all agents
3. Leader creates report/app:
   → curl gamma-tools or directly writes files via Bash tool
   → Files go to: {workspace}/project/app/index.html (+ css, js, assets)
4. Backend serves: GET /api/teams/:id/app/* → static files from workspace
5. UI shows "View App" button → iframe loads the app
```

### 12.3 Workspace App Directory

```
/data/workspaces/{team_id}/
  └── project/
      ├── src/              ← source code (if dev team)
      ├── app/              ← team app output (served via iframe)
      │   ├── index.html    ← entry point
      │   ├── style.css     ← optional
      │   └── data.json     ← optional structured data
      └── ...
```

### 12.4 Backend: Static File Server

```typescript
// Single route that serves files from team's app/ directory
@Get('/api/teams/:id/app/*')
async serveApp(@Param('id') teamId: string, @Req() req, @Res() reply) {
  const team = await this.teams.findById(teamId);
  const filePath = req.params['*'] || 'index.html';
  const fullPath = join(team.workspacePath, 'project/app', filePath);
  // Security: ensure path doesn't escape app/ directory (path traversal guard)
  // Serve file with correct MIME type
}
```

### 12.5 Frontend: App Viewer

**In Team Detail** — new tab or button next to Chat:

```
┌─ Team Detail ────────────────────────────────────────┐
│  [Chat]  [Task Board]  [View App]                    │
│                                                       │
│  ┌─────────────────────────────────────────────┐     │
│  │                                             │     │
│  │            iframe: team app                 │     │
│  │     /api/teams/team_xxx/app/index.html      │     │
│  │                                             │     │
│  └─────────────────────────────────────────────┘     │
│                                                       │
│  App status: ✅ Available (last updated 2 min ago)    │
│  [Open in New Tab]  [Refresh]                        │
└───────────────────────────────────────────────────────┘
```

If no `app/index.html` exists → show placeholder: "No app yet. The team leader
can create one by writing files to project/app/."

### 12.6 System Prompt Addition

Added to **leader's** system prompt (§10.4):

```markdown
## Team App (Work Reports)

You can create a visual report or application for the user to review your
team's work. Write HTML files to the `project/app/` directory.

### How to create a team app:
1. Collect results from your team (via list-tasks, read-messages)
2. Create `project/app/index.html` with a visual summary
3. The user will see it in the "View App" tab

### Guidelines:
- Use a single self-contained HTML file (inline CSS/JS) for simplicity
- Make it visually clean and readable
- Include: summary of work done, key deliverables, any files created
- For dev teams: link to or embed the actual app
- For research teams: structured findings with sources
- You can include data in a separate data.json and fetch it

### Example structure:
project/app/
  ├── index.html    ← main report/app page
  ├── style.css     ← optional external styles
  └── data.json     ← optional structured data
```

Added to **worker agents'** system prompt:

```markdown
## Work Reports

Your team leader may ask you to contribute to the team report. If asked,
write your section as HTML or provide structured data that the leader can
incorporate into the team app at `project/app/`.
```

### 12.7 Internal API Addition

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams/:id/app-status` | Check if app exists, last modified time |

Response:
```json
{
  "exists": true,
  "lastModified": 1712345678000,
  "files": ["index.html", "style.css", "data.json"],
  "sizeBytes": 45230
}
```

### 12.8 Scope

| Feature | MVP | Future |
|---------|-----|--------|
| Static HTML serving from project/app/ | Yes | — |
| iframe viewer in Team Detail | Yes | — |
| Leader creates app via Bash tool | Yes | — |
| "View App" button + "Open in New Tab" | Yes | — |
| Hot reload on file changes | No | WebSocket file watcher |
| App templates per team type | No | Template library |
| Approve/reject/publish workflow | No | Action buttons in app |
| Dynamic React app compilation | No | Scaffold pipeline (v1) |

---

## 13. Lifecycle & Deletion Logic


### 13.1 Delete Agent

**Trigger**: `DELETE /api/agents/:id`

**Steps**:
1. If agent status is `running` → abort its CLI process (kill process group)
2. Set agent status to `archived` in DB (soft delete, never hard delete)
3. Unassign agent from any `in_progress` tasks → set those tasks back to `backlog`
4. Regenerate CLAUDE.md for remaining team members (via `--system-prompt` content update)
5. Emit trace event: `agent.archived`
6. **Keep workspace directory** on disk (may contain useful notes/context)

**UI**: Agent disappears from team map. Tasks reassigned back to backlog.

### 13.2 Delete Team

**Trigger**: `DELETE /api/teams/:id`

**Steps**:
1. If any team agent is `running` → abort all CLI processes for the team
2. Archive all agents in the team (same as delete agent, but skip CLAUDE.md regen)
3. Set all team tasks to `failed` (with result: "team archived")
4. Set all team projects to `failed`
5. Set team status to `archived` (soft delete)
6. Emit trace event: `team.archived`
7. **Keep workspace directory** on disk

**UI**: Team card disappears from dashboard. Can optionally show archived teams with a filter.

### 13.3 Emergency Stop

**Trigger**: `POST /api/emergency-stop`

**Steps**:
1. Kill ALL running CLI process groups (via SessionPool.abortAll())
2. Set all `running` agents to `error` in DB
3. Set all `in_progress` tasks to `failed` (result: "emergency stop")
4. Emit trace event: `system.emergency_stop`

**Recovery**: User can manually re-trigger tasks or send a new message to the team.

### 13.4 Edge Cases

**User sends message while pipeline is running:**
- Return HTTP 409 Conflict: `{ error: "Pipeline is already running for this team" }`
- Frontend disables chat input while pipeline is active
- Backend tracks pipeline state per team: `pipelinesRunning: Map<teamId, boolean>`

**No agent matches task kind:**
- Orchestrator assigns task to the team leader (architect handles anything)
- Emit trace event: `task.assigned` with note "no specialist available, assigned to leader"

**Agent fails mid-task (timeout/crash):**
- Task → `failed` with error details in result
- Agent → `error` status
- Pipeline continues with remaining tasks (don't abort entire pipeline for one failure)
- Architect reviews all results including failures in the review cycle

**Session ID invalid on resume (expired/cleaned):**
- Catch the CLI error
- Create new session (omit `--resume` flag)
- Update `session_id` in DB with the new one
- Log warning but don't fail

---

## 14. Messaging & Chat

### 14.1 Agent Inbox (inter-agent messages)

```sql
CREATE TABLE agent_messages (
  id          TEXT PRIMARY KEY,        -- "amsg_<ULID>"
  team_id     TEXT NOT NULL REFERENCES teams(id),
  from_agent  TEXT REFERENCES agents(id), -- null = system message
  to_agent    TEXT NOT NULL REFERENCES agents(id),
  content     TEXT NOT NULL,
  read        INTEGER DEFAULT 0,       -- 0=unread, 1=read
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_amsg_to ON agent_messages(to_agent, read, created_at);
```

Used by `send-message`, `read-messages`, `broadcast` internal API endpoints.

### 14.2 Chat Messages (user ↔ team)

```sql
CREATE TABLE chat_messages (
  id          TEXT PRIMARY KEY,        -- "msg_<ULID>"
  team_id     TEXT NOT NULL REFERENCES teams(id),
  role        TEXT NOT NULL,           -- "user" | "assistant" | "system"
    CHECK (role IN ('user', 'assistant', 'system')),
  agent_id    TEXT REFERENCES agents(id), -- which agent sent (null for user/system)
  content     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_chat_team ON chat_messages(team_id, created_at);
```

### 14.3 Chat Flow

1. User sends message → stored as `role: "user"` in chat_messages
2. Orchestrator starts leader → leader's text responses stored as `role: "assistant"`
3. System events (task assigned, agent started, etc.) stored as `role: "system"`
4. Frontend fetches history: `GET /api/teams/:id/chat` → ordered by created_at
5. Live updates via SSE (team stream)

### 14.4 Chat API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams/:id/chat` | Get chat history (paginated) |
| `POST` | `/api/teams/:id/message` | Send message (already in §8.1) |

---

## 15. Infrastructure

### 15.1 Docker Compose (Postgres only)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: gamma
      POSTGRES_USER: gamma
      POSTGRES_PASSWORD: gamma_local
    ports: ["5432:5432"]
    volumes:
      - pgdata:/var/lib/postgresql/data

  # NOTE: No Redis. Single-instance backend uses in-memory EventBus.
  # Redis can be added later if horizontal scaling is needed.

volumes:
  pgdata:
```

> **Backend and frontend run on the host** (not in Docker) for MVP.
> Reason: Claude Code CLI must be installed on the host with an active Max
> subscription login. Running it inside a container would require mounting
> `~/.claude` and the CLI binary, adding fragile coupling. Docker is only
> used for Postgres — the one service that benefits from containerization.

**Dev startup:**
```bash
docker compose up -d                  # Start Postgres
pnpm --filter @gamma/core dev         # Backend on :3001 (host)
pnpm --filter @gamma/web dev          # Frontend on :5173 (host)
```

### 15.2 Prerequisites

- Docker & Docker Compose (for Postgres only)
- Node.js >= 22, pnpm
- Claude Code CLI installed on host (`npm install -g @anthropic-ai/claude-code`)
- Active Claude Max subscription (logged in via `claude auth login`)
- Verify: `claude --version` and `claude -p "say ok" --output-format json` returns a response

---

## 16. Session Management

### 15.0 Session Lifecycle

```
Agent created        → session_id = NULL (no session)
First task assigned  → CLI runs WITHOUT --resume → new session
                     → result event returns session_id
                     → UPDATE agents SET session_id = 'xxx'
Subsequent tasks     → CLI runs WITH --resume → continues session
                     → Agent remembers prior work
After N tasks        → context_tokens grows toward context_window
                     → UI shows context usage bar
Context > 80%       → UI shows yellow warning
Context > 95%       → UI shows red alert: "Consider resetting session"
User clicks Reset    → session_id = NULL, context_tokens = 0, total_turns = 0
Next task            → Fresh session (no --resume), agent starts clean
```

### 15.0.1 Context Tracking

After each CLI run, the `result` event contains usage data:
```json
{
  "usage": { "input_tokens": 15234, "cache_read_input_tokens": 45000, ... },
  "modelUsage": { "claude-opus-4-6[1m]": { "contextWindow": 1000000 } }
}
```

Backend computes and stores:
```typescript
const totalTokens = usage.input_tokens + usage.cache_read_input_tokens
                  + usage.cache_creation_input_tokens + usage.output_tokens;
const contextWindow = modelUsage[model].contextWindow;

await agents.updateUsage(agent.id, {
  contextTokens: totalTokens,
  contextWindow,
  totalTurns: agent.totalTurns + result.numTurns,
  lastActiveAt: Date.now(),
});
```

### 15.0.2 Reset Session

**Trigger**: `POST /api/agents/:id/reset-session`

**Steps**:
1. If agent is running → reject (409 Conflict)
2. `UPDATE agents SET session_id = NULL, context_tokens = 0, total_turns = 0`
3. Emit trace: `agent.session_reset`

**What is preserved**: role, team membership, files in project/ directory.
**What is lost**: conversation history (agent "forgets" prior tasks).

The agent's system prompt still contains role + team context, and it can read
existing code in the project directory — so it's not starting from zero.

### 15.0.3 Agent REST API Addition

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/agents/:id/reset-session` | Clear session, reset context counters |

### 15.0.4 UI Display

**Team Map node**:
```
┌─────────────────────┐
│ ⚙️ Backend Dev      │
│ idle                │
│ ████████░░ 78%      │  ← context usage bar
└─────────────────────┘
```

Colors: green (<50%), yellow (50-80%), orange (80-95%), red (>95%).

**Agent Detail Panel**:
```
Context Usage:  ████████████░░░ 78% (780K / 1M tokens)
Session Turns:  24
Last Active:    5 min ago
Session ID:     af6a86cc-6b8e-...

[Reset Session]  [Delete Agent]
```

---

## 17. Session Persistence & Recovery

### 15.1 What Persists Where

| Data | Storage | Survives restart? |
|------|---------|-------------------|
| Teams, Agents, Tasks, Projects | Postgres | Yes |
| Claude conversation history | Claude Code internal (`~/.claude/`) | Yes (via session_id) |
| Agent session_id mapping | Postgres (`agents.session_id`) | Yes |
| Trace events (all) | Postgres (`trace_events`) | Yes |
| Active session pool | In-memory (SessionPool) | No — rebuilt on startup |
| SSE event bus | In-memory (EventEmitter2) | No — clients reconnect and fetch history from DB |

### 15.2 Startup Recovery

On backend startup:
1. Load all teams and agents from Postgres
2. Set all agent statuses to `idle` (any previously `running` agents were interrupted)
3. No sessions are pre-warmed — they activate on demand (when a message is sent)
4. When a message is sent to an agent with an existing `session_id`, the CLI resumes that session

### 15.3 Graceful Shutdown

On SIGTERM:
1. Abort all active Claude CLI processes (kill process groups)
2. Set running agents to `idle` in DB
3. Set `in_progress` tasks to `failed` (they were interrupted)
4. Close Postgres connection

---

## 18. Configuration

### 16.1 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Backend HTTP port |
| `DATABASE_URL` | `postgres://gamma:gamma_local@localhost:5432/gamma` | Postgres connection string |
| `WORKSPACE_ROOT` | `./data/workspaces` | Root directory for agent workspaces |
| `MAX_CONCURRENT_AGENTS` | `2` | Max parallel Claude Code sessions |
| `AGENT_TIMEOUT_MS` | `300000` | Per-task timeout (5 min default) |
| `CLAUDE_CLI_PATH` | `claude` | Path to Claude Code CLI binary |
| `CLAUDE_MAX_TURNS` | `50` | Max agentic turns per CLI invocation |
| `CLAUDE_MAX_BUDGET_USD` | — | Optional: cost limit per agent run (not needed with Max subscription) |

---

## 19. Development Plan (10 days)

### Phase 1: Foundation (Days 1-3)

| Day | Task |
|-----|------|
| 1 | Docker Compose setup (Postgres). DB schema + migrations. Basic NestJS scaffold with Fastify. Health endpoint. |
| 2 | Claude CLI Adapter: spawn, stream NDJSON, parse chunks, timeout, abort. Session pool with queue. Integration test with real CLI. |
| 3 | Teams + Agents CRUD (Postgres repos, REST controllers). Workspace directory creation. CLAUDE.md generation per agent. |

### Phase 2: Orchestration (Days 4-6)

| Day | Task |
|-----|------|
| 4 | Orchestrator service: receive team message → route to leader → parse plan JSON. Task creation from plan. |
| 5 | Task dispatcher: assign tasks by kind↔role. Agent execution loop: inject context → run CLI → capture result → update task. |
| 6 | Review cycle: collect results → send to architect → parse review → rework or complete. Full pipeline end-to-end test. |

### Phase 3: Real-time & UI (Days 7-9)

| Day | Task |
|-----|------|
| 7 | SSE module: EventBus → SSE endpoints. Trace event persistence. Frontend scaffold: React + Vite + Tailwind + Router. |
| 8 | UI: Dashboard, Team Detail (map + chat + task board). Create Team / Add Agent modals. SSE hooks for live updates. |
| 9 | UI: Agent detail panel with streaming output. Trace viewer. Task detail modal. Polish and responsive layout. |

### Phase 4: Demo & Polish (Day 10)

| Day | Task |
|-----|------|
| 10 | Demo scenario end-to-end: "Build a banking MVP". Fix bugs. Record demo if needed. |

---

## 20. Scope Boundaries (What's NOT in MVP)

| Feature | Status | Reason |
|---------|--------|--------|
| Live app preview in browser | Out | Complex scaffold pipeline, not needed for demo |
| Multiple projects per team | Out | MVP = one active project per team |
| Agent-to-agent direct chat | Out | Orchestrator mediates all communication |
| User authentication | Out | Local-only, single user |
| File browser / code editor in UI | Out | Agents work via CLI; results visible in trace |
| Blueprint system | Out | Manual team creation sufficient for demo |
| Custom tool definitions | Out | Claude Code built-in tools are sufficient |
| Parallel agent execution | Out* | *Sequential is safer for MVP; parallel if time permits |
| WebSocket (duplex) | Out | SSE is sufficient for server→client push |

---

## 21. Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| **CLI hangs on permission prompt** | Always use `-p --permission-mode bypassPermissions`. Never spawn without these flags. Unit test verifies flags are present. Do NOT use `--bare` — it disables Max subscription OAuth. |
| **CLI output format changes** | Pin CLI version (npm/Dockerfile). Defensive NDJSON parser: skip unparseable lines, log warnings, never crash. Abstract behind adapter — single file to update. |
| **Zombie processes on kill** | Spawn with `detached: true`, kill via `process.kill(-pid, 'SIGTERM')` (process group). Graceful shutdown: SIGTERM → 5s wait → SIGKILL. See §5.6. |
| **CLI rate limits (Max subscription)** | Sequential execution, configurable concurrency limit (`MAX_CONCURRENT_AGENTS`). Queue excess requests. |
| **Long-running agent tasks** | `AGENT_TIMEOUT_MS` (default 5 min) + `--max-turns 50`. Dual safety net. With Max subscription, no cost concern. |
| **Agent produces invalid JSON (plan/review)** | Retry with explicit instruction to fix format (max 1 retry). Fallback: regex extraction of JSON blocks. Last resort: treat as chat text. |
| **Concurrent file access conflicts** | Sequential task execution per stage. Shared project dir with convention-based file scoping per agent role. |
| **Session ID invalidation** | Claude Code cleans sessions after 30 days. On `--resume` failure, catch error, create new session, update DB. |
| **EventBus memory pressure** | Events are fire-and-forget (no buffering). SSE clients that disconnect are cleaned up. Trace persists to DB only. |

---

## 22. Migration from gamma-runtime v1

This is a **clean rewrite**, not a refactoring. From v1 we carry forward:

| Keep (concepts) | Drop |
|-----------------|------|
| Team + Agent data model | OpenClaw Gateway (entire module) |
| Task state machine | WebSocket binary protocol |
| SSE for real-time updates | Ed25519 handshake |
| Agent role system (community-roles/) | Session key translation |
| Trace/activity events | HTTP/2 + TLS complexity |
| Kanban task board UI | App scaffold pipeline |
| | Window manager / desktop OS metaphor |
| | Redis (replaced by in-memory EventBus) |
| | Complex session registry |

The codebase starts fresh in a new directory. Selectively copy proven patterns (Redis stream helpers, SSE batching, Zustand stores) but rewrite from scratch.

---

## Appendix A: Claude Code CLI Flags Reference

### Standard invocation (new conversation):
```bash
claude -p "your task description here" \
  --permission-mode bypassPermissions \
  --output-format stream-json \
  --verbose \
  --max-turns 50 \
  --cwd /path/to/workspace
```

### With system prompt (for agent role injection):
```bash
claude -p "your task" \
  --permission-mode bypassPermissions \
  --system-prompt "You are a backend developer..." \
  --output-format stream-json \
  --verbose \
  --max-turns 50 \
  --cwd /path/to/workspace
```

### Resume existing session:
```bash
claude --resume SESSION_ID \
  -p "follow-up message" \
  --permission-mode bypassPermissions \
  --output-format stream-json \
  --verbose \
  --max-turns 50 \
  --cwd /path/to/workspace
```

### One-shot structured JSON (for plan/review parsing):
```bash
claude -p "create implementation plan" \
  --permission-mode bypassPermissions \
  --output-format json \
  --max-turns 30 \
  --cwd /path/to/workspace
# Returns single JSON: { result, session_id, usage, status }
```

### With tool restrictions:
```bash
claude -p "task" \
  --permission-mode bypassPermissions \
  --allowedTools "Bash,Read,Edit,Write,Glob,Grep" \
  --output-format stream-json --verbose \
  --cwd /path
```

### Debug: list sessions
```bash
claude sessions list --output-format json
```

### Key flags summary:

| Flag | Required? | Purpose |
|------|-----------|---------|
| `--bare` | **NO** | Disables OAuth/Max subscription auth. Only use with API keys. |
| `-p "msg"` | Yes | Non-interactive print mode |
| `--permission-mode bypassPermissions` | Yes | Prevent y/N prompts that hang the process |
| `--output-format stream-json` | Yes | NDJSON streaming for real-time trace |
| `--verbose` | Recommended | Include thinking tokens in stream |
| `--max-turns N` | Recommended | Safety limit on agentic loops |
| `--max-budget-usd N` | Optional | Cost limit per run (not needed with Max subscription) |
| `--cwd /path` | Yes | Agent's working directory |
| `--resume ID` | When resuming | Continue previous conversation |
| `--system-prompt "..."` | Optional | Override system prompt |
| `--allowedTools "..."` | Optional | Restrict available tools |
| `--no-session-persistence` | Optional | Don't save session (ephemeral runs) |

### stream-json output types (observed, not contractually stable):
```jsonc
// Text content
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}

// Tool use
{"type":"assistant","message":{"content":[{"type":"tool_use","id":"...","name":"Edit","input":{...}}]}}

// Tool result
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"...","content":"..."}]}}

// Final result (always last)
{"type":"result","session_id":"uuid","cost_usd":0.05,"duration_ms":12345,"is_error":false}

// System events (retries, errors)
{"type":"system","subtype":"api_retry","attempt":1,"error_status":429}
```

## Appendix B: Example Demo Script

```
1. Open browser → Dashboard is empty
2. Click "Create Team" → Name: "Alpha Squad", Leader: Architect, Spec: "Full-stack architect"
3. Team appears on dashboard → Click into it
4. Add agents: "Backend Dev" (backend-dev), "Frontend Dev" (frontend-dev), "QA Lead" (qa)
5. Team map shows: Architect → Backend Dev, Frontend Dev, QA Lead
6. Type in chat: "Build a simple banking dashboard with login page and account overview"
7. Watch:
   a. Architect thinks... creates implementation plan (visible in trace)
   b. Tasks appear on Kanban board (Backlog → Planning)
   c. Backend Dev starts working (status: running, streaming output visible)
   d. Frontend Dev starts after backend (or parallel if configured)
   e. Architect reviews (tasks move to Review)
   f. QA runs checks
   g. Tasks move to Done
8. Result: working code in /data/workspaces/team_xxx/project/
```
