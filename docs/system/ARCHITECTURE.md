# Gamma Agent Runtime — System Architecture

> Single Source of Truth for all AI agents and human contributors.
> Last updated: 2026-03-15

---

## 1. System Overview

Gamma Agent Runtime is a monorepo platform for long-lived LLM-agent orchestration. It provides full agent observability, real-time streaming, and a dynamic app generation pipeline — all surfaced through a desktop-style UI.

### Services

| Service | Package | Role |
|---------|---------|------|
| **gamma-core** | `@gamma/core` | NestJS 10 + Fastify backend. Manages agent sessions, WebSocket relay to OpenClaw Gateway, SSE streaming to browser, scaffold pipeline, file jail, and pre-flight snapshots. |
| **gamma-ui** | `@gamma/ui` | Vite + React frontend. Desktop OS shell with window manager, launchpad, dock, and embedded agent chat panels. |
| **gamma-watchdog** | `apps/gamma-watchdog` | Isolated Node.js daemon. Listens to `gamma:memory:bus` for `CRASH_REPORT` events. Executes FREEZE → ROLLBACK healing loop using `.bak_session` snapshots (preferred) or per-file `.bak` fallback. |

### Communication Channels

```
┌──────────┐   SSE (server→browser)    ┌──────────┐
│ gamma-ui │ ◄──────────────────────── │gamma-core│
│ (React)  │ ────────────────────────► │ (NestJS) │
└──────────┘   REST POST /api/*        └────┬─────┘
                                            │ WebSocket (bidirectional)
                                       ┌────▼──────────┐
                                       │ OpenClaw       │
                                       │ Gateway        │
                                       └────┬──────────┘
                                            │
                                       ┌────▼──────┐
                                       │   Redis   │
                                       │  Streams  │
                                       └───────────┘
```

- **Browser ↔ gamma-core**: SSE for real-time events (`/api/stream/:windowId`), REST for commands (`/api/sessions/:id/send`).
- **gamma-core ↔ OpenClaw**: Persistent WebSocket. Frames use `req`/`res`/`event` protocol with ULID-based correlation.
- **Redis Streams**: Event bus for cross-concern data (`gamma:sse:*` per-window streams, broadcast channels).

---

## 2. Directory Layout

```
gamma-runtime/                          ← monorepo root (package.json: "gamma-runtime")
├── apps/
│   ├── gamma-core/                     ← backend service
│   │   └── src/
│   │       ├── gateway/                ← WebSocket relay, session management
│   │       ├── scaffold/               ← app generation, file jail, snapshots
│   │       ├── sessions/               ← session lifecycle, registry, GC
│   │       ├── system/                 ← health, backup inventory, event log
│   │       ├── sse/                    ← SSE controller, stream batcher
│   │       └── pty/                    ← terminal emulation (node-pty)
│   ├── gamma-watchdog/                 ← crash detection & healing daemon
│   │   └── src/
│   │       ├── main.ts                 ← entry point
│   │       ├── healing-loop.ts         ← FREEZE → ROLLBACK orchestrator
│   │       ├── redis-listener.ts       ← CRASH_REPORT stream consumer
│   │       └── types.ts               ← CrashReport, SessionAbort, AgentFeedback
│   └── gamma-ui/                       ← frontend service
│       ├── components/                 ← React components (AgentChat, MessageList, WindowNode, etc.)
│       ├── hooks/                      ← useAgentStream, useThrottledValue, useSessionRegistry
│       ├── store/                      ← Zustand OS state (useOSStore)
│       └── apps/
│           ├── system/                 ← core tools (lowercase dirs)
│           │   ├── terminal/
│           │   ├── settings/
│           │   ├── browser/
│           │   ├── notes/
│           │   ├── kernel-monitor/
│           │   ├── agent-monitor/
│           │   └── sentinel/
│           └── private/                ← user-generated app bundles (the "jail")
│               └── {app-id}/
│                   ├── {AppName}.tsx
│                   ├── context.md
│                   └── agent-prompt.md
├── packages/
│   └── gamma-types/                    ← shared TypeScript types (GammaSSEEvent, etc.)
└── docs/
    ├── system/                         ← this document (Single Source of Truth)
    ├── architecture/                   ← active phase-specific design specs
    ├── active/                         ← in-progress implementation plans
    ├── archive/                        ← completed plans, specs, and RFCs
    ├── backlog/                        ← paused/future work items
    └── agents/                         ← agent persona definitions
```

### App Directory Conventions

- **`apps/system/`**: Core OS tools. Directories use **lowercase** names (`terminal`, `kernel-monitor`). These are never modified by agents.
- **`apps/private/`**: User-generated app bundles (the "jail"). Created by the scaffold tool. Agents can read/write here under `AppStorageService` jail enforcement.
- **App IDs**: Always lowercase kebab-case (`weather-dashboard`, `code-editor`). The `resolveAppRoot()` method checks `system/{appId}` first, then `private/{appId}`.

---

## 3. Agent Hierarchy

Two-tier agent model:

| Agent | Session Key | Scope |
|-------|-------------|-------|
| **System Architect** | `system-architect` | OS-level. Creates/deletes app bundles, queries system health. Cannot modify app internals. |
| **App Owner** | `app-owner-{appId}` | Per-app scoped. Modifies files within its app bundle only. Receives app-specific context. |

Each agent maps to an OpenClaw session. The System Architect delegates modification requests to the appropriate App Owner.

---

## 4. Stability Layer

### 4.1 Pre-flight Snapshots

Before every agent run on an app-owner session, `GatewayWsService.sendMessage()` triggers `AppStorageService.snapshotApp(appId)`:

1. `resolveAppRoot(appId)` locates the app directory (system/ or private/).
2. Any existing `{appDir}.bak_session` is removed (Strategy B: self-cleaning on next invocation).
3. `fs.cp(appDir, bakDir, { recursive: true })` creates a full directory snapshot.

This provides atomic rollback capability for multi-file agent operations.

### 4.2 Per-file Backups

`AppStorageService.writeFile()` creates a `.bak` copy of each file before overwriting — a fine-grained safety net independent of the session-level snapshot.

### 4.3 Tool Watchdog

`ToolWatchdogService` enforces a 30-second timeout on individual tool calls. On timeout, it emits a `lifecycle_error` event. This is independent of the streaming relay and does not interfere with real-time event delivery.

### 4.4 Gamma Watchdog (Sentinel)

`gamma-watchdog` is an isolated Node.js daemon (`apps/gamma-watchdog/`) that subscribes to `gamma:memory:bus` for `CRASH_REPORT` events. On crash detection it executes:

1. **FREEZE**: Publishes `SESSION_ABORT` to `gamma:watchdog:commands` Redis channel.
2. **ROLLBACK**: Restores from `.bak_session` directory snapshot (preferred) or falls back to per-file `.bak` copies.

The **Sentinel UI** (`apps/gamma-ui/apps/system/sentinel/SentinelApp.tsx`) provides real-time visibility into backup snapshots, per-file backups, and system events via the `GET /api/system/backups` endpoint.

### 4.5 SystemEventLog

`SystemEventLogService` (`apps/gamma-core/src/system/system-event-log.service.ts`) maintains an in-memory ring buffer (max 100 events) of system-level events (tool timeouts, watchdog actions, backup scans). Events are included in the backup inventory response and displayed in the Sentinel UI activity feed.

### 4.6 SystemMonitorService

`SystemMonitorService` (`apps/gamma-core/src/system/system-monitor.service.ts`) scans both system and private app directories for `.bak_session` snapshots and per-file `.bak` backups. Returns a `BackupInventory` with metadata (size, file count, timestamps) via `GET /api/system/backups` (guarded by `SystemAppGuard`).

---

## 5. UI Streaming Architecture

### The Problem (Solved)

Agent streaming events were accumulated in a React ref (`currentAssistantRef`) which does not trigger re-renders. The UI only updated on `lifecycle_end`.

### Current Design

`useAgentStream(windowId)` returns both `messages` (history) and `streamingMessage` (live):

```
SSE event arrives
  → ref updated (cumulative overwrite, immune to dropped packets)
  → scheduleStreamFlush() debounces at 100ms
    → setStreamingMessage({...}) triggers React re-render
    → MessageBubble receives updated text
    → useThrottledValue(100ms) prevents render storms

lifecycle_end
  → flush ref → setMessages([...prev, finalMsg])
  → setStreamingMessage(null)
```

**Key constants:**
- `STREAM_THROTTLE_MS = 100` — hook-level state flush cadence
- `useThrottledValue(100ms)` — component-level render throttle
- `BATCH_WINDOW_MS = 50` — backend SSE stream batcher debounce

**Tool events** (`tool_call`, `tool_result`) flush immediately via `flushStreamNow()` for instant feedback.

**Typing indicator** shows only while `status === "running"` AND `streamingMessage` is null (before first token arrives).

---

## 6. Path Resolution

### The Problem (Solved)

`__dirname` in compiled JS points into the `dist/` tree:
```
.../gamma-core/dist/apps/gamma-core/src/scaffold/
```

A naive `path.resolve(__dirname, '../../..')` landed inside `dist/apps/`, not the monorepo root.

### Current Design

`findRepoRoot(startDir)` walks up the directory tree from `__dirname` and identifies the monorepo root by finding a `package.json` with `"name": "gamma-runtime"`. This works identically under:
- **ts-node** (dev): `__dirname` = `.../gamma-core/src/scaffold/`
- **compiled** (prod): `__dirname` = `.../gamma-core/dist/apps/gamma-core/src/scaffold/`

Both resolve to `/Users/serhii/dev/personal/gamma-runtime`.

The `GAMMA_OS_REPO` environment variable can override this for non-standard deployments.

---

## 7. SSE Event Types

Defined in `packages/gamma-types/index.ts`:

| Event | Direction | Purpose |
|-------|-----------|---------|
| `lifecycle_start` | core → ui | Agent run begins |
| `lifecycle_end` | core → ui | Agent run completes (includes stopReason, tokenUsage) |
| `lifecycle_error` | core → ui | Agent run failed |
| `assistant_delta` / `assistant_update` | core → ui | Cumulative text update (both handled identically) |
| `thinking` | core → ui | Internal reasoning text (appended incrementally) |
| `tool_call` | core → ui | Tool invocation started |
| `tool_result` | core → ui | Tool execution completed |
| `user_message` | core → ui | Echo of user input (no optimistic UI) |
| `component_ready` | core → ui | App scaffold complete |
| `component_removed` | core → ui | App unloaded |
| `session_registry_update` | core → ui | Session list changed |
| `gateway_status` | core → ui | OpenClaw connectivity |
| `keep_alive` | core → ui | No-op heartbeat |

---

## 8. Development Protocol

### RFC Before Code

Any task of **medium complexity or higher** requires a Mini-RFC before implementation:

1. **Diagnose**: Identify the root cause with evidence (logs, code paths, file references).
2. **Propose**: Write a Mini-RFC explaining where the problem is, proposed changes, and what NOT to change.
3. **Verify Plan**: Include concrete steps to validate the fix.
4. **Wait for approval** before writing code.

This rule applies to all agents (System Architect, App Owners) and human contributors.

### Commit Hygiene

- Commits reference the subsystem: `fix(scaffold): ...`, `feat(streaming): ...`, `refactor(gateway): ...`
- No secrets in code or docs — use `<PLACEHOLDER>` or environment variables.
- Pre-flight type-check (`npx tsc --noEmit`) before committing.

---

## 9. Key File Reference

| File | Purpose |
|------|---------|
| `apps/gamma-core/src/gateway/gateway-ws.service.ts` | WebSocket relay, session management, pre-flight snapshot trigger |
| `apps/gamma-core/src/scaffold/app-storage.service.ts` | File jail, CRUD, snapshots, `findRepoRoot()` |
| `apps/gamma-core/src/sse/stream-batcher.ts` | 50ms SSE event debouncing |
| `apps/gamma-core/src/sse/sse.controller.ts` | SSE endpoint, Redis XREAD |
| `apps/gamma-core/src/gateway/tool-watchdog.service.ts` | 30s tool call timeout |
| `apps/gamma-core/src/sessions/session-registry.service.ts` | Session telemetry (tokens, status, run count) |
| `apps/gamma-core/src/system/system-monitor.service.ts` | Backup inventory scanner |
| `apps/gamma-core/src/system/system-event-log.service.ts` | In-memory event ring buffer |
| `apps/gamma-watchdog/src/healing-loop.ts` | FREEZE → ROLLBACK crash healer |
| `apps/gamma-ui/hooks/useAgentStream.ts` | SSE consumer, 100ms throttled streaming state |
| `apps/gamma-ui/hooks/useThrottledValue.ts` | Generic render throttle hook |
| `apps/gamma-ui/components/MessageList.tsx` | Chat message rendering, streaming bubble |
| `apps/gamma-ui/components/AgentChat.tsx` | Chat container (live + mock modes) |
| `apps/gamma-ui/components/ArchitectWindow.tsx` | System Architect slide-in panel |
| `apps/gamma-ui/components/WindowNode.tsx` | App window with embedded agent chat |
| `packages/gamma-types/index.ts` | Shared types (GammaSSEEvent, AgentStatus) |
