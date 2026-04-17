# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Gamma Runtime v2 — a local-first multi-agent team orchestration platform. Users create teams of AI agents (powered by Claude Code CLI), assign tasks via chat, and watch agents collaborate in real-time. No external LLM gateways — agents run as local `claude` CLI processes.

## Commands

```bash
# Development
pnpm dev              # Start both backend + frontend
pnpm dev:core         # Backend only (NestJS watch mode, port 3001)
pnpm dev:web          # Frontend only (Vite, port 5173)

# Database (Postgres via Docker)
pnpm db:up            # Start Postgres
pnpm db:down          # Stop Postgres
pnpm db:reset         # Wipe and restart (drops all data)

# Build
pnpm build            # Build both apps
pnpm build:core       # Backend only
pnpm build:web        # Frontend only
```

No test suite is wired up yet (Jest is installed in `apps/core` but there are no `*.spec.ts` files and no `test` script). If adding tests, you'll need to add the `test` script and config first.

## Architecture

**Monorepo** (pnpm workspaces): `apps/core` (NestJS 10 + Fastify) and `apps/web` (React 18 + Vite + Zustand + Tailwind).

### Backend (`apps/core/src/`)

Key modules and their responsibilities (selective — also present: `chat/`, `teams/`, `team-app/`, `database/`, `common/`, and the top-level `app.controller.ts`):

- **`orchestrator/`** — The heart of the system. Spawns leader agent on user message, spawns worker agents on task assignment, manages process lifecycle, auto-wakes leader when all tasks complete.
- **`claude/`** — `ClaudeCliAdapter` spawns `claude` CLI via `child_process.spawn()` with `--output-format stream-json`, yielding NDJSON `StreamChunk` objects via async generator. `SessionPoolService` enforces concurrency limits and handles emergency stop (SIGTERM/SIGKILL).
- **`internal/`** — REST API that agents call (via curl) to interact with the runtime: assign tasks, update task status, send messages to peers, read context. This is how agents coordinate.
- **`sse/`** — Server-Sent Events streaming. Frontend subscribes to `/api/sse/team/:id` or `/api/sse/agent/:id`. Backend publishes via EventBus (in-memory EventEmitter2, no Redis).
- **`events/`** — EventBusService wraps EventEmitter2 with three subscription levels: global, team-scoped, agent-scoped.
- **`repositories/`** — Data access layer (7 repos). Raw `pg` queries, no ORM.
- **`agents/`** — Agent CRUD, `WorkspaceService` (creates isolated dirs per agent), `RolesService` (loads roles from `community-roles/` YAML files).
- **`trace/`** — Immutable event log for all agent activity (thinking, tool use, completion, errors).

### Frontend (`apps/web/src/`)

- **State**: Zustand store (`store/useStore.ts`) for teams, agents, notifications
- **Real-time**: SSE hooks (`hooks/useSse.ts`, `hooks/useTeamSse.ts`) subscribe to backend events
- **Pages**: `Dashboard.tsx` (team list), `TeamDetail.tsx` (main workspace with chat + task board + agent map), `TraceViewer.tsx`
- **API client**: `api/client.ts` — fetch helpers (get, post, patch, del, sse)

### Data Flow

1. User sends message via ChatPanel -> `POST /api/teams/:id/message`
2. OrchestratorService spawns leader agent (Claude CLI process)
3. Leader reads CLAUDE.md in its workspace (contains team context, task list, API docs)
4. Leader delegates work via `POST /api/internal/assign-task`
5. Orchestrator detects `task.assigned` event -> spawns worker agent
6. Worker completes task -> calls `POST /api/internal/update-task`
7. All events stream to frontend via SSE in real-time

### Agent Workspace Layout

```
data/workspaces/{teamId}/
  project/          # Shared project files
  plans/            # Shared plans
  shared/           # Inter-agent shared files
  agents/{agentId}/ # Per-agent workspace (cwd for claude CLI)
    CLAUDE.md       # Auto-generated context (team, tasks, API docs)
    notes/          # Agent's scratch space
```

## Conventions

- **IDs**: ULID with entity prefix (`team_`, `agent_`, `task_`, `project_`). Generators in `common/ulid.ts`.
- **Timestamps**: Millisecond epoch integers (`Date.now()`), stored as BIGINT in Postgres.
- **SQL**: Always parameterized queries — never concatenate user input.
- **API prefix**: `/api/`
- **Task stages**: `backlog` -> `planning` -> `in_progress` -> `review` -> `done` (or `failed`)
- **Agent statuses**: `idle` | `running` | `error` | `archived`
- **No Redis**: Single-instance, in-memory EventEmitter2 for pub-sub.
- **Node**: v22+ required. Package manager: pnpm 9.x.

## Environment Variables

```
POSTGRES_HOST=localhost  POSTGRES_PORT=5432
POSTGRES_USER=gamma      POSTGRES_PASSWORD=gamma_dev  POSTGRES_DB=gamma_v2
CORE_PORT=3001
MAX_CONCURRENT_AGENTS=2
AGENT_TIMEOUT_MS=600000
```

## Key API Endpoints

**Public**: `/api/teams`, `/api/agents`, `/api/teams/:id/message` (triggers orchestration), `/api/emergency-stop`

**SSE**: `/api/sse/global`, `/api/sse/team/:teamId`, `/api/sse/agent/:agentId`

**Internal (agent-facing)**: `/api/internal/assign-task`, `/api/internal/update-task`, `/api/internal/send-message`, `/api/internal/read-messages`, `/api/internal/broadcast`, `/api/internal/list-agents`, `/api/internal/mark-done`, `/api/internal/read-context`

## Schema & Migrations

- Source-of-truth schema: `apps/core/src/database/migrations/001-init.sql` (applied by `DatabaseInitService` on boot).
- Ad-hoc migrations: `scripts/*.sql` — run manually against the running Postgres container when needed.
- To blow away state and start clean: `pnpm db:reset`.

## Design Docs

Before making large architectural changes, read:
- `docs/SPEC-v2.md` — product & system spec
- `docs/IMPLEMENTATION-PLAN.md` — build plan and sequencing

These explain *why* the runtime is shaped this way (local-first, no LLM gateway, CLI-as-agent, etc.).
