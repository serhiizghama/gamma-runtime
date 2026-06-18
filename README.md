<div align="center">

# Gamma Runtime

### A local-first platform for orchestrating teams of AI agents

Create a team of AI agents, give them a goal in plain language, and watch them
plan, delegate, build, and review — collaboratively, in real time.

[![CI](https://github.com/serhiizghama/gamma-runtime/actions/workflows/ci.yml/badge.svg)](https://github.com/serhiizghama/gamma-runtime/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![NestJS](https://img.shields.io/badge/NestJS-10-E0234E?logo=nestjs&logoColor=white)](https://nestjs.com/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Node](https://img.shields.io/badge/Node-%E2%89%A522-339933?logo=node.js&logoColor=white)](https://nodejs.org/)

</div>

---

## Overview

**Gamma Runtime** is a multi-agent orchestration platform where each agent is a
persistent [Claude Code](https://claude.com/claude-code) CLI session running on
your machine. You assemble a team — a Team Lead plus specialists like Backend
Developer, Frontend Developer, and QA — then hand the lead a goal. The lead
decomposes the work into stages and tasks, delegates to the right specialists,
reviews their output, and drives the project to completion. Every thought, tool
call, message, and task transition streams to the browser as it happens.

There are **no external LLM gateways and no API keys**. All model calls go
through the local `claude` CLI under your existing subscription. State lives in a
local Postgres instance; everything runs with a single `docker compose up`.

> This project is the engineering artifact of an MSc thesis on browser-native
> multi-agent runtime systems.

### Why it's different

| Most agent frameworks                      | Gamma Runtime                                                         |
| ------------------------------------------ | --------------------------------------------------------------------- |
| Call an LLM API with your keys             | Drives the local `claude` CLI under your subscription — zero API keys |
| A single agent loops over tools            | A **team** of agents with a lead that delegates and reviews           |
| Opaque "black box" reasoning               | Every action streams live via SSE — fully traceable                   |
| Cloud-coupled                              | **Local-first** — one `docker compose up`, your data stays on disk    |
| Heavyweight infra (Redis, queues, brokers) | Single instance, in-memory event bus — deliberately minimal           |

---

## How it works

```
┌──────────────────────────────────────────────────────────┐
│                      Browser (React)                       │
│   ┌──────────┐    ┌────────────┐    ┌──────────────────┐   │
│   │ Agent Map│    │ Chat Panel │    │ Task Board (Kanban)│  │
│   └──────────┘    └────────────┘    └──────────────────┘   │
└───────────────────────────┬────────────────────────────────┘
                            │  REST + Server-Sent Events
┌───────────────────────────┴────────────────────────────────┐
│                  NestJS Backend (Fastify)                    │
│  ┌────────────┐ ┌──────────┐ ┌────────┐ ┌────────────────┐  │
│  │ Orchestrator│ │  Agents  │ │ Teams  │ │ Internal API   │  │
│  │  (the core) │ │          │ │        │ │ (agent-facing) │  │
│  └────────────┘ └──────────┘ └────────┘ └────────────────┘  │
│  ┌────────────┐ ┌──────────┐ ┌──────────────────────────┐   │
│  │ Event Bus  │ │  Trace   │ │ Claude CLI Adapter        │   │
│  │ (in-memory)│ │  (log)   │ │ (child_process.spawn)     │   │
│  └────────────┘ └──────────┘ └──────────────────────────┘   │
└────────┬─────────────────────────────────┬──────────────────┘
         │                                 │
   ┌─────┴─────┐                  ┌─────────┴──────────┐
   │ Postgres  │                  │  claude CLI × N    │
   │  (state)  │                  │ (one per active    │
   └───────────┘                  │  agent, isolated   │
                                  │  workspaces)       │
                                  └────────────────────┘
```

The orchestration loop:

1. You send a message to the team → `POST /api/teams/:id/message`.
2. The **Orchestrator** spawns the **Team Lead** as a `claude` CLI process.
3. The lead reads an auto-generated `CLAUDE.md` in its workspace (team context,
   task list, API docs) and decomposes the goal into tasks.
4. The lead delegates → `POST /api/internal/assign-task`.
5. The Orchestrator catches the `task.assigned` event and spawns a **worker
   agent** for it.
6. The worker completes its task → `POST /api/internal/update-task`.
7. When all tasks finish, the lead is **auto-woken** to review and continue.
8. Every step streams to the browser over SSE — live.

Agents coordinate by calling a small **internal REST API** (assign tasks, update
status, message peers, broadcast, read shared context) — the same way a human
team would use a tracker and a chat.

---

## Features

- 🧑‍🤝‍🧑 **Team-based orchestration** — a Team Lead decomposes goals, delegates to
  specialists, and reviews their work.
- 🔌 **Subscription-powered, no API keys** — every agent is a local `claude` CLI
  session; nothing leaves your machine except the calls Claude Code makes.
- 📡 **Real-time everything** — thoughts, tool use, messages, and task transitions
  stream to the UI via Server-Sent Events.
- 🗂️ **Visible task board** — a live Kanban (`backlog → planning → in_progress →
review → done`) reflecting what agents are actually doing.
- 🧩 **160+ community roles** — drop-in agent personalities across engineering,
  product, design, research, QA, marketing, and more.
- 🧵 **Isolated workspaces** — each agent gets its own sandboxed directory; shared
  files and plans live in a common team space.
- 🧾 **Immutable trace log** — a complete, replayable audit trail of every agent
  action.
- 🛑 **Emergency stop** — kill all running agent processes instantly (SIGTERM →
  SIGKILL).
- 🐳 **One-command setup** — `docker compose up` for Postgres, `pnpm dev` for the
  apps.

---

## Tech stack

| Layer         | Technology                                                           |
| ------------- | -------------------------------------------------------------------- |
| **Backend**   | NestJS 10 · Fastify · TypeScript · raw `pg` (no ORM) · EventEmitter2 |
| **Frontend**  | React 18 · Vite · Zustand · Tailwind CSS · TypeScript                |
| **Agents**    | Claude Code CLI (`--output-format stream-json`, spawned per agent)   |
| **Storage**   | PostgreSQL 16 (via Docker)                                           |
| **Transport** | REST + Server-Sent Events (no WebSockets, no Redis)                  |
| **Tooling**   | pnpm workspaces · ESLint 9 (flat config) · Prettier · GitHub Actions |

---

## Getting started

### Prerequisites

- **Node.js ≥ 22** and **pnpm 9** (`corepack enable` will provide pnpm)
- **Docker** (for Postgres)
- **[Claude Code CLI](https://claude.com/claude-code)** installed and
  authenticated (`claude` available on your `PATH`)

### Quick start

```bash
# 1. Clone and install
git clone https://github.com/serhiizghama/gamma-runtime.git
cd gamma-runtime
pnpm install

# 2. Configure environment
cp .env.example .env

# 3. Start Postgres
pnpm db:up

# 4. Run backend + frontend
pnpm dev
```

Then open **http://localhost:5173**. The backend listens on
**http://localhost:3001**.

> The schema is applied automatically on first boot — no manual migration step.

### Try it

Create a team, open the chat, and give the Team Lead a goal — for example:

> _"Build an MVP banking website with authentication and a dashboard."_

The lead will draft a plan, break it into tasks, delegate to the Backend and
Frontend developers, review their output, and hand off to QA — all visible in
the UI.

---

## Commands

```bash
pnpm dev              # Run backend + frontend together
pnpm dev:core         # Backend only (NestJS watch, port 3001)
pnpm dev:web          # Frontend only (Vite, port 5173)

pnpm build            # Build both apps
pnpm typecheck        # Type-check both apps (no emit)
pnpm lint             # ESLint across the workspace
pnpm format           # Format with Prettier
pnpm format:check     # Verify formatting (used in CI)

pnpm db:up            # Start Postgres
pnpm db:down          # Stop Postgres
pnpm db:reset         # Wipe and restart Postgres (drops all data)
```

---

## Project structure

```
gamma-runtime/
├── apps/
│   ├── core/                # NestJS backend (~5k LOC)
│   │   └── src/
│   │       ├── orchestrator/ # Spawns & coordinates agents — the heart
│   │       ├── claude/       # Claude CLI adapter + session pool
│   │       ├── internal/     # Agent-facing REST API
│   │       ├── sse/          # Server-Sent Events streaming
│   │       ├── events/       # In-memory event bus
│   │       ├── repositories/ # Data access (raw pg)
│   │       ├── agents/       # Agent CRUD, workspaces, roles
│   │       └── trace/        # Immutable activity log
│   └── web/                 # React frontend (~4.5k LOC)
│       └── src/
│           ├── pages/        # Dashboard, TeamDetail, TraceViewer
│           ├── hooks/        # SSE + data hooks
│           ├── store/        # Zustand state
│           └── api/          # Fetch client
├── community-roles/         # 160+ agent role definitions
├── scripts/                 # DB init & migrations
└── docker-compose.yml       # Postgres
```

### Key design decisions

- **IDs** are ULIDs with entity prefixes (`team_`, `agent_`, `task_`).
- **Timestamps** are millisecond epoch integers stored as `BIGINT`.
- **SQL** is always parameterized — never string-concatenated.
- **No Redis** — a single instance with an in-memory event bus keeps the
  architecture intentionally simple.

---

## License

Released under the [MIT License](./LICENSE) © 2026 Serhii Zghama.
