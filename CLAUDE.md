# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Gamma Agent Runtime — a browser-native, microkernel-based runtime for AI agents. LLMs act as runtime co-processors (not chatbots), each with its own lifecycle, memory space, and managed state. Agents autonomously scaffold, own, and operate micro-applications mounted in a live browser desktop. This is also an MSc thesis project.

## Build & Dev Commands

```bash
# Full dev environment (kills existing, starts core + ui + h2-proxy + watchdog)
./scripts/start-dev.sh

# Individual services
pnpm dev              # UI dev server (Vite, port 5173)
pnpm dev:core         # Backend dev server (NestJS --watch, port 3001)

# Build
pnpm build:types      # Must build types first — other packages depend on @gamma/types
pnpm build:core       # types + NestJS compile
pnpm build:ui         # types + Vite production build
pnpm build            # Everything: types → core → ui → watchdog

# Type checking
pnpm typecheck        # All workspaces (builds types first)

# Tests (backend only, Jest)
pnpm test                                          # All packages
cd apps/gamma-core && npx jest --config jest.config.ts path/to/file.spec.ts  # Single test

# Lint (backend only)
cd apps/gamma-core && npm run lint                  # ESLint with --fix

# PM2 (production)
pm2 start ecosystem.config.cjs
```

## Architecture

Three-tier monorepo: **gamma-ui** (React frontend) → **gamma-core** (NestJS backend) → **OpenClaw Gateway** (external LLM relay).

### Monorepo Layout

- `apps/gamma-core/` — NestJS 10 + Fastify 4 backend (HTTP/2 + TLS). Agent sessions, WebSocket relay, SSE streaming, scaffold pipeline, file jail, PTY terminal.
- `apps/gamma-ui/` — React 18 + Vite 5 frontend. Desktop OS shell with window manager, dynamic app renderer, Zustand state.
- `apps/gamma-watchdog/` — Node.js daemon. Listens to Redis memory bus for crash reports, executes FREEZE → ROLLBACK healing loop.
- `packages/gamma-types/` — Shared TypeScript types. **Single source of truth** for all cross-package types (`GammaSSEEvent`, `WindowSession`, etc.). Must be built before core/ui.
- `packages/smart-chunker/` — Document chunking utility.
- `docs/system/ARCHITECTURE.md` — Canonical architecture reference.

### Communication

- **Browser ↔ gamma-core**: SSE for real-time events (`GET /api/stream/:windowId`), REST for commands (`POST /api/sessions/:id/send`).
- **gamma-core ↔ OpenClaw**: Persistent WebSocket. Binary frames with `req`/`res`/`event` protocol, ULID correlation, Ed25519 handshake.
- **Redis Streams**: Event bus (`gamma:memory:bus` for cross-agent events, `gamma:sse:{windowId}` for per-window SSE). Persistent, replayable, ordered.

### Key Backend Modules (gamma-core/src/)

- `gateway/` — WebSocket relay to OpenClaw, session correlation, tool watchdog (30s timeout)
- `sessions/` — Session lifecycle, window↔session mapping, registry, GC cron
- `scaffold/` — App bundle generation (TSX compile), file jail, pre-flight snapshots, context injection
- `sse/` — SSE controller, stream batcher (50ms debounce for thinking/delta; immediate for lifecycle/tool)
- `tools/` — Tool registry, role-based allowlists, jail guard
- `messaging/` — Redis Streams message bus, agent registry
- `teams/` — Team state, collaboration features
- `state/` — Agent/team state repositories (SQLite)
- `pty/` — Terminal emulation via node-pty

### Agent Hierarchy

- **System Architect** — privileged global agent. Can scaffold/unscaffold apps, orchestrate multi-app workflows.
- **App Owner** — per-app isolated agent. Scoped to its own bundle directory only.
- **Daemon Agents** — background execution, limited tool access.

### Context Injection (3 Layers)

1. **Session-level** — built once at init from `agent-prompt.md`, `context.md`, app source
2. **First-message** — invisible `[SYSTEM CONTEXT]` block prepended on first run (working dir, fs access)
3. **Live context** — `[LIVE SYSTEM STATE]` appended to every message (active sessions, health, recent events)

### Stability Layer

- Pre-flight `.bak_session` snapshots before each agent run (atomic rollback)
- Per-file `.bak` copies before overwrites
- Tool watchdog: 30s timeout → `lifecycle_error`
- Session GC: cron cleanup of idle sessions

## Tech Stack

| Layer | Stack |
|-------|-------|
| Frontend | React 18, Vite 5, Zustand, Immer, xterm.js, @xyflow/react |
| Backend | NestJS 10, Fastify 4 (HTTP/2), TypeScript 5.4 |
| Data | Redis (ioredis 5) + Redis Streams, SQLite (better-sqlite3) |
| Crypto | @noble/ed25519 for gateway handshake |
| IDs | ULID (sortable, collision-free) |
| Package manager | pnpm workspaces |
| Process manager | PM2 |

## Environment Requirements

- Node.js >= 22, Redis >= 7, pnpm
- TLS certs in `/certs/` (generate via `./scripts/generate-certs.sh`)
- Backend config: `apps/gamma-core/.env` (see `.env.example`)
- H2 proxy (`scripts/h2-proxy.mjs`) bridges Vite HTTP ↔ Fastify HTTP/2

## Dev Logs

When running via `start-dev.sh`, logs are at:
- `/tmp/gamma-runtime-core.log`
- `/tmp/gamma-runtime-ui.log`
- `/tmp/gamma-runtime-h2-proxy.log`
- `/tmp/gamma-runtime-watchdog.log`

## Redis Key Conventions

- `gamma:sse:{windowId}` — per-window SSE stream
- `gamma:memory:bus` — global event bus
- `gamma:sessions:registry` — session registry hash
- `gamma:session-context:{sessionKey}` — full system prompt
- `gamma:app-storage:{appId}:{key}` — per-app K-V store
