# Gamma OS — Phase 2 Implementation Plan
**Based on:** Backend Integration Specification v1.6  
**Status:** Ready to execute  
**Execution model:** Loop-by-loop, task-by-task. Verify each task before proceeding to the next.

---

## How to Use This Plan

1. **Start a loop** by giving the agent a single task: *"Use spec v1.4, execute Loop 1 Task 1.1"*
2. **Verify the result** (server starts, Postman returns 200, Redis key exists, etc.)
3. **Only then proceed** to the next task — no skipping, no batching tasks without confirmation

---

## Loop 1 — Infrastructure & Transport (P0)

> **Goal:** Bootstrap the NestJS server. Verify it can reach Redis and OpenClaw Gateway before writing any business logic.

---

### Task 1.1 — NestJS Boilerplate & CORS

**What to build:**
- Initialize NestJS project with Fastify adapter (`@nestjs/platform-fastify`)
- Configure `@nestjs/config` to load `.env` variables
- Register `@fastify/cors` with the explicit origin allowlist from spec §11

**Acceptance criteria:**
- `npm run start:dev` boots without errors
- `GET /` returns `{ ok: true }`
- A request from `http://localhost:5173` is not blocked by CORS

**Key spec reference:** §11 (CORS & Security Policy), §12 (Environment Variables)

**Files to create:**
```
kernel/
├── src/app.module.ts
├── src/main.ts          ← Fastify adapter + CORS setup here
├── .env.example         ← Template; copy to .env for local use
└── package.json
```

---

### Task 1.2 — Redis Provider

**What to build:**
- Create `RedisModule` using `ioredis`
- Expose `REDIS_CLIENT` injection token globally
- Add `redis.ping()` check on startup — log "Redis connected" or throw

**Acceptance criteria:**
- Server starts and logs `[Redis] Connected to redis://localhost:6379`
- If Redis is down, server throws `RedisConnectionError` and exits with code 1

**Key spec reference:** §10 (Redis Key Schema)

**Files to create:**
```
src/redis/
├── redis.module.ts
└── redis.constants.ts   ← REDIS_CLIENT token
```

---

### Task 1.3 — Gateway Handshake (Ed25519)

**What to build:**
- Implement `GatewayWsService` with WebSocket connection to OpenClaw
- Handle `connect.challenge` frame from Gateway
- Sign the nonce using Ed25519 (`GAMMA_DEVICE_PRIVATE_KEY` from `.env`)
- Send `connect` request frame and wait for `hello-ok` response
- Implement automatic reconnect with exponential backoff (1s → 2s → 4s → max 30s)
- On disconnect: publish `gateway_status: "disconnected"` to `gamma:sse:broadcast`
- On reconnect: publish `gateway_status: "connected"` to `gamma:sse:broadcast`

**Acceptance criteria:**
- Server logs `[Gateway] Connected and authenticated`
- If Gateway is unreachable, server retries with backoff — does NOT crash
- Killing Gateway → server logs disconnect, then reconnects automatically

**Key spec reference:** §5 (WS Client), §7.2 (gateway_status events)

**Files to create:**
```
src/gateway/
├── gateway-ws.service.ts
├── event-classifier.ts
└── gateway.module.ts
```

---

## Loop 2 — Session Management & Event Bridge (P0)

> **Goal:** Teach the backend to map browser windows to OpenClaw agent sessions and classify all incoming events.

---

### Task 2.1 — Session CRUD & Redis Mapping

**What to build:**
- `POST /api/sessions` — create session, store `WindowSession` in `gamma:sessions` Redis Hash
- `DELETE /api/sessions/:windowId` — destroy session, clean up Redis
- `GET /api/sessions` — list all active sessions
- `SessionsService` with `findByWindowId()` helper used by all other services
- `GatewayWsService` in-memory routing:
  - `registerWindowSession(sessionKey, windowId)` called from `SessionsService.create()`
  - `unregisterWindowSession(sessionKey)` called from `SessionsService.remove()`
  - On startup, `GatewayWsService` reads `gamma:sessions` and restores the `sessionKey → windowId` map so events can be routed immediately after a restart

**Acceptance criteria:**
- `POST /api/sessions { windowId, appId, sessionKey, agentId }` → `201 { ok: true }`
- `GET /api/sessions` returns the created session
- `DELETE /api/sessions/:windowId` → session gone from Redis
- Redis key `gamma:sessions` contains the mapping as a JSON-serialized hash field
- Gateway event bridge successfully routes agent events to `gamma:sse:<windowId>` using the restored in-memory map

**Key spec reference:** §3.4 (WindowSession), §4 (API Surface)

**Files to create:**
```
src/sessions/
├── sessions.controller.ts
├── sessions.service.ts
└── sessions.module.ts
```

---

### Task 2.2 — Event Classifier

**What to build:**
- Implement `classifyGatewayEventKind(event: string): GatewayEventKind`
- Implement `isReasoningStream(stream: string): boolean`
- Export as pure functions from `event-classifier.ts`
- Add unit tests for both functions

**Acceptance criteria:**
- `classifyGatewayEventKind("agent")` → `"runtime-agent"`
- `classifyGatewayEventKind("heartbeat")` → `"summary-refresh"`
- `classifyGatewayEventKind("unknown")` → `"ignore"`
- `isReasoningStream("thinking")` → `true`
- `isReasoningStream("assistant")` → `false`

**Key spec reference:** §5.2 (Event Classification)

---

### Task 2.3 — Phase-Aware Event Bridge

**What to build:**
- Implement `handleAgentEvent(payload: GWAgentEventPayload)` in `GatewayWsService`
- Route by `stream` field:
  - `"lifecycle"` → push `lifecycle_start / lifecycle_end / lifecycle_error` to `gamma:sse:<windowId>`
  - `"thinking"` / reasoning streams → push `thinking` event + write to `gamma:memory:bus`
  - `"assistant"` → push `assistant_delta` event
  - `"tool"` → push `tool_call` or `tool_result` based on `data.phase` + write to `gamma:memory:bus`
- Write `stepId` and `parentId` on every memory bus entry (hierarchy support)
- On `lifecycle_end`: extract `tokenUsage` from Gateway payload if present

**Acceptance criteria:**
- Send a mock WS frame with `stream: "thinking"` → `gamma:sse:<windowId>` receives a `thinking` event
- Send a mock frame with `stream: "tool", phase: "call"` → Redis receives both SSE and memory bus entries
- Memory bus entries have `stepId` populated; `tool_result` entries have `parentId` pointing to their `tool_call`

**Key spec reference:** §6 (Phase-Aware Event Bridge), §3.2 (GWAgentEventPayload), §3.6 (MemoryBusEntry)

---

### Task 2.4 — Shared Types Extraction

**What to build:**
- Create a shared types package `packages/gamma-types/` at the monorepo root (or symlinked into both `src/` and the NestJS server)
- Move all Phase 2 interfaces out of `types/os.ts` into this shared package:
  - `AgentStatus`, `GammaSSEEvent`, `WindowAgentState`, `WindowStateSyncSnapshot`
  - `MemoryBusEntry`, `WindowSession`, `ScaffoldRequest`, `ScaffoldAsset`, `SystemHealthReport`
- Both frontend and backend import from `@gamma/types` instead of duplicating definitions
- Add a `tsconfig` path alias so both projects resolve `@gamma/types` without publishing to npm

**Why this matters:**
When `GammaSSEEvent` is updated (e.g., adding a new stream type in v1.5), the TypeScript compiler will immediately flag every handler that needs updating — in both frontend and backend — at build time, not at runtime.

**Structure:**
```
gamma-os/
├── packages/
│   └── gamma-types/
│       ├── index.ts        ← re-exports all shared interfaces
│       ├── events.ts       ← GammaSSEEvent union type
│       ├── state.ts        ← WindowAgentState, AgentStatus
│       ├── session.ts      ← WindowSession, WindowStateSyncSnapshot
│       ├── scaffold.ts     ← ScaffoldRequest, ScaffoldAsset
│       └── system.ts       ← SystemHealthReport
├── web/                    ← frontend (React) imports from @gamma/types
├── kernel/                 ← backend (NestJS) imports from @gamma/types
└── package.json            ← root workspace scripts
```

**Acceptance criteria:**
- Change `GammaSSEEvent` in `packages/gamma-types/events.ts` → TypeScript errors appear in both frontend and backend until all handlers are updated
- `npm run typecheck` in both projects passes with the shared types
- No copy-pasted interface definitions exist in `web/` or `kernel/src/`

**Key spec reference:** §3 (TypeScript Interfaces) — all interfaces in that section move here

---

## Loop 3 — Real-time Streaming & Batching (P1)

> **Goal:** Deliver live event data to the browser smoothly, without React re-render storms.

---

### Task 3.1 — SSE Multiplexer

**What to build:**
- `GET /api/stream/:windowId` — NestJS `@Sse()` endpoint
- Reads from two Redis Streams simultaneously: `gamma:sse:<windowId>` and `gamma:sse:broadcast`
- Uses `XREAD BLOCK 5000` for efficient blocking reads
- Tracks `lastId` per stream to avoid re-delivering old events
- On subscriber disconnect: close cleanly, no Redis leaks

**Acceptance criteria:**
- Open SSE in browser: `new EventSource("/api/stream/test-window")`
- Manually push to `gamma:sse:test-window` via Redis CLI → event appears in browser within 100ms
- Disconnect browser → no errors in server logs

**Key spec reference:** §7.1 (SSE Controller)

**Files to create:**
```
src/sse/
├── sse.controller.ts
└── sse.module.ts
```

---

### Task 3.2 — Stream Batching (50ms)

**What to build:**
- Implement `StreamBatcher` class (see spec §7.3)
- Debounce `thinking` and `assistant_delta` events by 50ms
- All other event types pass through immediately without buffering
- Integrate into SSE controller — replace direct `subscriber.next()` with `batcher.push(event)`

**Acceptance criteria:**
- Rapid-fire 10 `assistant_delta` events within 30ms → browser receives exactly 1 merged event
- A `tool_call` event fired between deltas passes through immediately (not batched)
- After 50ms silence, any buffered chunks are flushed

**Key spec reference:** §7.3 (Stream Throttling & Batching)

**Files to create:**
```
src/sse/stream-batcher.ts
```

---

### Task 3.3 — SSE Keep-Alive

**What to build:**
- Add `setInterval(15_000)` in SSE controller that sends `{ type: "keep_alive" }` events
- Clear interval on subscriber disconnect

**Acceptance criteria:**
- Leave SSE connection open for 20 seconds → browser receives at least one `keep_alive` event
- Browser rejects/ignores `keep_alive` gracefully (no reducer errors)
- Connection stays alive through 60s Nginx idle timeout simulation

**Key spec reference:** §7.1 (keep-alive section)

---

## Loop 4 — Resilience & Control (P2)

> **Goal:** Make the system F5-proof, abortable, and self-monitoring.

---

### Task 4.1 — Session Sync Snapshot

**What to build:**
- Event bridge writes live state to `gamma:state:<windowId>` Redis Hash on every agent event
  - Fields: `status`, `runId`, `streamText`, `thinkingTrace`, `pendingToolLines`, `lastEventAt`
  - TTL: 4 hours
- `GET /api/sessions/:windowId/sync` endpoint returning `WindowStateSyncSnapshot`
- Frontend `useAgentStream` hook reads sync endpoint on mount before opening SSE

**Acceptance criteria:**
- Start an agent run, then open a new browser tab to the same window
- New tab calls `/sync` → receives current `{ status: "running", streamText: "...", runId: "..." }`
- New tab opens SSE → continues receiving live events from where it left off

**Key spec reference:** §4.1 (Session Sync), §3.7 (WindowStateSyncSnapshot), §8.1 (useAgentStream sync phase)

---

### Task 4.2 — Agent Abort & Tool Watchdog

**What to build (two sub-tasks):**

**4.2a — Abort endpoint:**
- `POST /api/sessions/:windowId/abort` → sends `sessions.abort` frame to Gateway
- Immediately updates `gamma:state:<windowId>` to `status: "aborted"`
- Pushes `lifecycle_error` with message `"Run aborted by user"` to SSE stream

**4.2b — Tool Watchdog:**
- Implement `ToolWatchdogService` with `register()`, `resolve()`, `clearWindow()` methods
- 30-second timer per `tool_call`
- On timeout: push `lifecycle_error` + update Redis state to `"error"`
- On `tool_result` received in time: cancel the timer

**Acceptance criteria:**
- Call `POST /api/sessions/:windowId/abort` during a run → SSE delivers `lifecycle_error` within 500ms
- Start a run, fire a `tool_call` but never send a `tool_result` → after 30s, SSE delivers timeout error
- Frontend shows `status: "aborted"` or `status: "error"` appropriately

**Key spec reference:** §4.2 (Abort Endpoint), §6.2 (Tool Watchdog)

---

### Task 4.3 — System Health (M4 Metrics)

**What to build:**
- `GET /api/system/health` returning `SystemHealthReport`
- CPU: parse `sysctl -n vm.loadavg` via `execa`
- RAM: parse `vm_stat` output, convert pages → MB (page = 16 KB on M4)
- Redis: `redis.ping()` latency
- Gateway: `fetch /ping` to Gateway HTTP endpoint with 2s timeout

**Event Lag metric (observability addition):**

Add `eventLag` to the health report — the delta between when an event was emitted by OpenClaw Gateway and when it was written to Redis. This measures the latency of the data bus itself and is a useful academic benchmark.

```typescript
// In GatewayWsService — record arrival timestamp on every agent event:
private async handleAgentEvent(payload: GWAgentEventPayload) {
  const arrivedAt = Date.now();
  // payload.ts = Gateway-side timestamp (if present in OpenClaw protocol)
  const gatewayTs = (payload as Record<string, unknown>).ts as number | undefined;
  const lagMs = gatewayTs ? arrivedAt - gatewayTs : null;

  // Store rolling average in Redis
  if (lagMs !== null && lagMs >= 0) {
    await this.redis.lpush("gamma:metrics:event_lag", lagMs);
    await this.redis.ltrim("gamma:metrics:event_lag", 0, 99); // keep last 100 samples
  }
  // ... rest of handler
}
```

```typescript
// In SystemController.health():
const lagSamples = await this.redis.lrange("gamma:metrics:event_lag", 0, -1);
const lagNumbers = lagSamples.map(Number).filter(n => !isNaN(n));
const eventLag = lagNumbers.length > 0
  ? {
      avgMs: Math.round(lagNumbers.reduce((a, b) => a + b, 0) / lagNumbers.length),
      maxMs: Math.max(...lagNumbers),
      samples: lagNumbers.length,
    }
  : null;

return {
  ...existingMetrics,
  eventLag,  // null = no data yet (no agent runs recorded)
};
```

Updated `SystemHealthReport`:
```typescript
export interface SystemHealthReport {
  ts: number;
  status: "ok" | "degraded" | "error";
  cpu:      { usagePct: number };
  ram:      { usedMb: number; totalMb: number; usedPct: number };
  redis:    { connected: boolean; latencyMs: number };
  gateway:  { connected: boolean; latencyMs: number };
  /** v1.4+: Event bus latency — Gateway emit → Redis write delta */
  eventLag: { avgMs: number; maxMs: number; samples: number } | null;
}
```

Redis key: `gamma:metrics:event_lag` — List, keep last 100 samples, no TTL.

**Acceptance criteria:**
- `GET /api/system/health` → `{ status: "ok", cpu: { usagePct: N }, ram: { usedMb: N, totalMb: 16384 }, redis: { connected: true, latencyMs: N }, gateway: { connected: true, latencyMs: N }, eventLag: { avgMs: N, maxMs: N, samples: N } }`
- `eventLag: null` when no agent runs have occurred yet
- After 10+ events streamed: `eventLag.avgMs` is a realistic single-digit ms value on localhost
- Kill Redis → `{ status: "degraded", redis: { connected: false } }`
- Response time < 3 seconds (bounded by 2s Gateway timeout)

**Key spec reference:** §15 (System Health Endpoint)

---

### Task 4.4 — User Input & Session Garbage Collection (v1.6)

**What to build (three sub-tasks):**

**4.4a — User Input Endpoint:**
- `POST /api/sessions/:windowId/send` — accepts `{ message: string }`
- Echoes user message into `gamma:sse:<windowId>` as `user_message` event (instant UI feedback)
- Writes to `gamma:memory:bus` with `kind: "text"` for decision tree reconstruction
- Calls `gatewayWsService.sendMessage(sessionKey, message)` to forward to OpenClaw
- Updates `gamma:state:<windowId>.lastEventAt` for GC freshness tracking

**4.4b — Explicit Gateway Session Kill:**
- Update `DELETE /api/sessions/:windowId` to call `gatewayWsService.deleteSession(sessionKey)` before cleaning Redis
- `deleteSession()` sends `{ type: "req", method: "sessions.delete", params: { sessionKey } }` frame to Gateway
- Best-effort: 2s timeout, fire-and-forget if Gateway doesn't ack

**4.4c — Session Garbage Collector:**
- Install `@nestjs/schedule`
- Create `session-gc.service.ts` with `@Cron(CronExpression.EVERY_HOUR)` decorator
- Scan all sessions in `gamma:sessions` hash
- For each, check `gamma:state:<windowId>.lastEventAt` — if older than `SESSION_GC_TTL_HOURS` (default 24h), call `sessionsService.remove(windowId)` which triggers the explicit Gateway kill
- Log collected sessions count

**New WS methods in `GatewayWsService`:**
- `sendMessage(sessionKey, message)` — sends `sessions.send` frame, 5s ack timeout
- `deleteSession(sessionKey)` — sends `sessions.delete` frame, 2s ack timeout

**New env variable:**
- `SESSION_GC_TTL_HOURS` — default `24`

**Acceptance criteria:**
- `POST /api/sessions/:windowId/send { message: "hello" }` → SSE delivers `user_message` event within 100ms → Gateway starts agent run → `lifecycle_start` + streaming events flow back
- `DELETE /api/sessions/:windowId` → Gateway session is freed (verify via Gateway logs or session list)
- Create a session, wait > `SESSION_GC_TTL_HOURS` (or set to 0 for testing) → GC cron kills it → session gone from Redis + Gateway
- Kernel Monitor shows user message in the log feed

**Key spec reference:** §4.3 (User Input v1.6), §4.4 (Session Lifecycle & GC v1.6), §5.1 (WS Client methods)

**Files to create/update:**
```
kernel/src/sessions/
├── sessions.controller.ts      ← add POST :windowId/send
├── sessions.service.ts         ← update remove() with Gateway kill
├── session-gc.service.ts       ← NEW: cron GC service
└── sessions.module.ts          ← register ScheduleModule + GC service

kernel/src/gateway/
└── gateway-ws.service.ts       ← add sendMessage() + deleteSession()
```

**Dependencies to install:**
```bash
npm install @nestjs/schedule
```

---

## Loop 5 — Generative OS Extension (Scaffolding) (P1/P2)

> **Goal:** Give the Architect Agent the ability to generate, extend, and remove OS applications at runtime.

---

### Task 5.1 — Path Jail & Security Scan

**What to build:**
- `jailPath(relativePath: string): string` utility method in `ScaffoldService`
  - Resolves path, verifies it stays within `web/apps/generated/`
  - Throws `ForbiddenException` on traversal attempts
  - **v1.5.1:** Explicitly blocks any paths containing hidden directories or files (segments starting with `.`) to protect the nested `.git` repository from tampering
- Security scan in `validateSource()` — 9 deny patterns:
  - `eval()`, `innerHTML`, `outerHTML`, `document.write`
  - `localStorage`, `sessionStorage`
  - `require('child_process')`, `process.env`
  - External `fetch()` to non-localhost URLs
- Scan runs **before** AST parse — abort early on security violations

**Acceptance criteria:**
- `jailPath("../../src/main.tsx")` → throws `ForbiddenException`
- `jailPath("assets/weather/icon.png")` → returns valid absolute path within jail
- `jailPath(".git/config")` → throws `ForbiddenException` (v1.5.1: Git tamper protection)
- `jailPath(".git/hooks/pre-commit")` → throws `ForbiddenException`
- `jailPath(".env")` → throws `ForbiddenException`
- `validateSource("const x = eval('1+1')")` → `{ ok: false, errors: ["Security violation: eval()..."] }`
- Valid source → `{ ok: true, errors: [] }`

**Key spec reference:** §9.3 (Security Linting), §9.5 (Path Jail Guard v1.5.1)

---

### Task 5.2 — Scaffold Service, Nested Git & Smart Commit

**What to build:**
- **Nested Git Initialization (v1.5):**
  - On first scaffold, check if `web/apps/generated/` has its own `.git`
  - If not, `git init` → configure author → `checkoutLocalBranch(SCAFFOLD_GIT_BRANCH)` → initial commit
  - If repo exists, ensure correct branch is checked out
  - Main repo `.gitignore` already excludes `web/apps/generated/`
- **`POST /api/scaffold`** — full scaffold pipeline:
  1. Security scan → syntax validation → write to disk → nested git commit → SSE broadcast
  2. If `SCAFFOLD_AUTO_PUSH=true` → attempt `git push` to private remote (best-effort)
- **`DELETE /api/scaffold/:appId`** — unscaffold pipeline:
  1. Delete `.tsx` + assets → nested git commit → remove from registry → broadcast `component_removed`
- `simple-git` scoped to `web/apps/generated/` (NOT the monorepo root)
- Register/unregister app in `gamma:app:registry` Redis Hash

**New env variables:**
- `SCAFFOLD_GIT_BRANCH` — branch name for commits (default: `private-apps`)
- `SCAFFOLD_AUTO_PUSH` — auto-push after commit (default: `false`)
- `SCAFFOLD_PRIVATE_REPO_URL` — remote URL for the private apps repo (optional)

**Acceptance criteria:**
- First scaffold → `web/apps/generated/.git` exists, on branch `private-apps`
- `POST /api/scaffold { appId: "weather", sourceCode: "...", commit: true }` → file in `web/apps/generated/`, `git log` in nested repo shows commit, SSE delivers `component_ready`
- `DELETE /api/scaffold/weather` → file gone, nested git log shows removal, SSE delivers `component_removed`
- `cd web/apps/generated && git log --oneline` shows only generated app commits
- Main repo `git status` does NOT show generated app files
- Submitting code with `eval()` → `400 Bad Request` with validation errors

**Key spec reference:** §9.1 (Flow), §9.2 (ScaffoldService v1.5), §9.6 (App Deletion), §12 (Environment)

**Files to create/update:**
```
kernel/src/scaffold/
├── scaffold.controller.ts
├── scaffold.service.ts          ← update with ensureNestedGit()
├── scaffold-watcher.service.ts
└── scaffold.module.ts
```

---

### Task 5.3 — Static Asset Serving

**What to build:**
- `GET /api/assets/:appId/*` endpoint using `@fastify/static`
- Path jail: resolve asset path and verify it stays within `web/apps/generated/assets/`
- Support: PNG, JPEG, SVG, JSON, WOFF2 (MIME type auto-detection)
- `ScaffoldRequest.files[]` handling — write base64/utf8 assets to `web/apps/generated/assets/:appId/`

**Acceptance criteria:**
- Scaffold an app with a PNG asset → `GET /api/assets/weather/icons/sun.png` returns the image
- Attempt `GET /api/assets/../../../.env` → `403 Forbidden`
- Asset file not found → `404 Not Found`

**Key spec reference:** §9.4 (Asset Support), §9.5 (Path Jail Guard)

**Files to create:**
```
src/scaffold/scaffold-assets.controller.ts
```

---

## Dependency Installation Reference

```bash
# NestJS + Fastify
npm install @nestjs/platform-fastify @fastify/cors @fastify/static

# Redis
npm install ioredis

# Git integration
npm install simple-git

# Process runner (for system metrics)
npm install execa

# Crypto (Ed25519 signing)
npm install @noble/ed25519

# Dev dependencies
npm install --save-dev @typescript-eslint/typescript-estree

# Config
npm install @nestjs/config
```

---

## Verification Checklist

Before marking Phase 2 complete, verify:

- [ ] Loop 1: NestJS starts, connects to Redis, authenticates with Gateway
- [ ] Loop 2: Sessions CRUD works, event bridge routes all 5 stream types correctly
- [ ] Loop 3: SSE streams live, batching reduces re-renders, keep-alive fires every 15s
- [ ] Loop 4: F5 restores live state, abort works, health endpoint returns valid metrics, user input flows to agent, GC cleans orphaned sessions
- [ ] Loop 5: Scaffold creates/deletes apps in nested Git repo, security scan blocks dangerous code, assets served correctly
- [ ] Integration: Open Gamma OS, send a message in a window, see thinking + tool + text stream live
- [ ] Edge cases: Gateway disconnect → reconnect, tool timeout, F5 mid-stream, abort in flight

---

## Reference

| Document | Location |
|---|---|
| Backend Spec v1.6 | `docs/architecture/phase2-backend.md` |
| Frontend Architecture | `docs/architecture/phase1-os-core.md` |
| This Plan | `docs/plans/phase2-implementation.md` |
| Project README | `README.md` |
