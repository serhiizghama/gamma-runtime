# Stage 4 Implementation Plan: Agent Control Plane

> **Goal:** Introduce an observability and task-management layer that exposes real-time session telemetry, token consumption, and lifecycle controls — surfaced as a new built-in "Agent Monitor" system application.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│  Frontend: Agent Monitor App (web/apps/system/agent-monitor/)        │
│  ┌───────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │  Session Grid │  │ Inspector Panel │  │  Kill Session Button │  │
│  └───────┬───────┘  └────────┬────────┘  └──────────┬───────────┘  │
│          │                   │                       │              │
│          └──── GET /api/sessions/active  [sys-token] ┘              │
│                   SSE /api/stream/broadcast [sys-token]              │
│           lazy: GET /api/sessions/:sessionKey/context                │
└──────────────────────────────────────────────────────────────────────┘
                          │
┌──────────────────────────────────────────────────────────────────────┐
│  Kernel: Sessions Module (kernel/src/sessions/)                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SessionRegistryService (new)                                │   │
│  │  - HSET gamma:session-registry:<sessionKey> → SessionRecord  │   │
│  │  - SET  gamma:session-context:<sessionKey>  → full prompt    │   │
│  │  - HINCRBY / HSET for token accumulation                     │   │
│  │  - EXPIRE 86400s; refreshed on every active write            │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  GatewayWsService telemetry hook (existing)                  │   │
│  │  - Intercept lifecycle_end → parse usage → push to registry  │   │
│  └──────────────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  SessionGcService (existing, extended)                       │   │
│  │  - On window close → DEL registry + context keys             │   │
│  │  - onModuleInit → flush stale registry keys at boot          │   │
│  └──────────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────────┘
                          │
                    Redis (ioredis)
                    gamma:session-registry:<sessionKey>  (Hash, TTL 24h)
                    gamma:session-context:<sessionKey>   (String, TTL 24h)
```

---

## Phase 1 — Backend: Session Registry

### Task 1.1 — Add `SessionRecord` type to `@gamma/types`

- **Files:** `packages/gamma-types/index.ts`
- **Work:**
  - Add `export interface SessionRecord` with fields:
    ```typescript
    sessionKey: string         // primary key — Redis key suffix
    windowId: string           // which OS window owns this session
    appId: string
    status: AgentStatus
    createdAt: number          // epoch ms
    lastActiveAt: number       // epoch ms
    tokenUsage: TokenUsage
    systemPromptSnippet: string  // first 2000 chars — stored in main hash
    runCount: number           // total agent runs since session open
    ```
  - Add to `REDIS_KEYS`:
    ```typescript
    SESSION_REGISTRY_PREFIX: 'gamma:session-registry:',
    SESSION_CONTEXT_PREFIX:  'gamma:session-context:',
    ```
- **Acceptance Criteria:**
  - `@gamma/types` compiles clean in both kernel and web workspaces.
  - `SessionRecord` is importable from `@gamma/types` in kernel services.

---

### Task 1.2 — Create `SessionRegistryService`

- **Files:**
  - `kernel/src/sessions/session-registry.service.ts` _(new)_
  - `kernel/src/sessions/sessions.module.ts` _(add to providers)_
- **Work:**
  - Injectable NestJS service that receives `REDIS_CLIENT`.
  - Primary key is `sessionKey` (not `windowId`); `windowId` is stored as a plain field.
  - Methods:
    ```typescript
    upsert(record: Partial<SessionRecord> & { sessionKey: string }): Promise<void>
    // → HSET gamma:session-registry:<sessionKey> field value ...
    // → EXPIRE gamma:session-registry:<sessionKey> 86400  (refresh TTL on every write)

    setContext(sessionKey: string, fullPrompt: string): Promise<void>
    // → SET gamma:session-context:<sessionKey> <fullPrompt>
    // → EXPIRE gamma:session-context:<sessionKey> 86400

    getContext(sessionKey: string): Promise<string | null>
    // → GET gamma:session-context:<sessionKey>

    accumulateTokens(sessionKey: string, usage: TokenUsage): Promise<void>
    // → HINCRBY each flat token field individually
    // → EXPIRE gamma:session-registry:<sessionKey> 86400

    remove(sessionKey: string): Promise<void>
    // → DEL gamma:session-registry:<sessionKey>
    // → DEL gamma:session-context:<sessionKey>

    getAll(): Promise<SessionRecord[]>
    // → SCAN 0 MATCH gamma:session-registry:* + HGETALL each
    // (prefer SCAN over KEYS to avoid blocking Redis in production)

    getOne(sessionKey: string): Promise<SessionRecord | null>
    // → HGETALL gamma:session-registry:<sessionKey>
    ```
  - All numeric fields stored as strings (Redis limitation); `deserialize()` parses on read.
- **Acceptance Criteria:**
  - Unit-testable in isolation (no external deps beyond Redis mock).
  - `getAll()` returns `[]` on empty registry, never throws.
  - Both registry hash and context string carry a 24h TTL after every write.

---

### Task 1.3 — Wire registry into `SessionsService`

- **Files:** `kernel/src/sessions/sessions.service.ts`
- **Work:**
  - Inject `SessionRegistryService`.
  - On session create (`POST /api/sessions`): call `registry.upsert({ sessionKey, windowId, appId, status: 'idle', createdAt: Date.now(), lastActiveAt: Date.now(), tokenUsage: ZERO_TOKEN_USAGE, systemPromptSnippet: '', runCount: 0 })`.
  - When the system prompt is assembled (before first agent run):
    - Store snippet: `registry.upsert({ sessionKey, systemPromptSnippet: fullPrompt.slice(0, 2000) })`.
    - Store full context separately: `registry.setContext(sessionKey, fullPrompt)`.
  - On each agent run start: `registry.upsert({ sessionKey, status: 'running', lastActiveAt: Date.now() })` + HINCRBY `runCount`.
  - On agent run abort/error: `registry.upsert({ sessionKey, status: 'aborted'/'error', lastActiveAt: Date.now() })`.
  - On session delete (`DELETE /api/sessions/:windowId`): look up `sessionKey` from in-memory map, call `registry.remove(sessionKey)`.
- **Acceptance Criteria:**
  - After creating a session and sending one message, `getAll()` returns a record with `status: 'running'` → then `status: 'idle'`.
  - `systemPromptSnippet` is non-empty and truncated to ≤2000 chars; full context is accessible via `getContext()`.

---

### Task 1.4 — Extend `SessionGcService` to clean up registry & guard boot state

- **Files:** `kernel/src/sessions/session-gc.service.ts`, `kernel/src/sessions/sessions.module.ts`
- **Work:**
  - Inject `SessionRegistryService`.
  - Wherever GC currently kills a session (window-close event or orphan detection), add `await registry.remove(sessionKey)`. Pass `sessionKey`, not `windowId`. `remove()` is idempotent.
  - **Boot-time orphan flush** — implement `onModuleInit()` on `SessionsModule` (or a dedicated `SessionBootstrapService`):
    ```typescript
    async onModuleInit() {
      const records = await registry.getAll();
      const inMemoryKeys = new Set(this.sessionsService.getActiveSessionKeys());
      for (const record of records) {
        if (!inMemoryKeys.has(record.sessionKey)) {
          this.logger.warn(`Flushing stale registry entry: ${record.sessionKey}`);
          await registry.remove(record.sessionKey);
        }
      }
    }
    ```
  - This ensures that if the kernel crashes and restarts, orphaned `gamma:session-registry:*` keys (whose 24h TTL has not yet expired) are flushed immediately rather than appearing as ghost sessions in the monitor.
- **Acceptance Criteria:**
  - After a window is closed and GC fires, `gamma:session-registry:<sessionKey>` and `gamma:session-context:<sessionKey>` no longer exist in Redis.
  - After kernel restart with stale Redis keys present, those keys are deleted within the first second of startup.

---

## Phase 2 — Gateway Interception & Telemetry

### Task 2.1 — Parse `usage` from `lifecycle_end` in `GatewayWsService`

- **Files:** `kernel/src/gateway/gateway-ws.service.ts`
- **Work:**
  - Identify the existing branch that handles `GammaSSEEvent` of type `lifecycle_end`.
  - Extract `tokenUsage` and `sessionKey` from the event payload (already typed in `@gamma/types`).
  - Call `registry.accumulateTokens(sessionKey, tokenUsage)` and `registry.upsert({ sessionKey, status: 'idle', lastActiveAt: Date.now() })`.
  - If `lifecycle_end` arrives without `tokenUsage` (aborted run), upsert only status.
- **Acceptance Criteria:**
  - After a completed agent run, the registry record's `tokenUsage.inputTokens` and `outputTokens` are non-zero.
  - Tokens accumulate across multiple runs (HINCRBY, not overwrite).

### Task 2.2 — Push `session_registry_update` to SSE broadcast on each registry change

- **Files:**
  - `kernel/src/sessions/session-registry.service.ts`
  - `packages/gamma-types/index.ts`
- **Work:**
  - Add `{ type: 'session_registry_update'; records: SessionRecord[] }` variant to `GammaSSEEvent`.
  - In `SessionRegistryService`, after every mutating operation (`upsert`, `accumulateTokens`, `remove`), publish a snapshot of `getAll()` to `gamma:sse:broadcast` Redis stream (XADD, same pattern as existing broadcast events).
  - Frontend will receive live updates via the existing `useSystemEvents` hook.
- **Acceptance Criteria:**
  - Opening the Agent Monitor app shows live status transitions without polling.

---

## Phase 3 — Kernel API Layer

### Task 3.1 — Add `GET /api/sessions/active` endpoint

- **Files:**
  - `kernel/src/sessions/sessions.controller.ts`
  - `kernel/src/sessions/system-guard.ts` _(new — shared guard for privileged endpoints)_
- **Work:**
  - Add route `@Get('active')` _before_ any parameterized routes to avoid shadowing.
  - Handler calls `registry.getAll()` and returns the array as JSON. Response type: `SessionRecord[]`.
  - **System privilege guard:** Apply a `@UseGuards(SystemAppGuard)` decorator. `SystemAppGuard` reads an `X-Gamma-System-Token` header and validates it against a kernel-internal secret (e.g., a random UUID generated at boot and stored in a NestJS global constant). This prevents scaffolded user apps from calling this endpoint.
    - Token is injected into the Agent Monitor app's environment at registration time (e.g., exposed via a dedicated `GET /api/system/token` endpoint that itself checks the request origin, or simply hard-coded as a build-time env var).
    - Return `403 Forbidden` with `{ error: 'system privileges required' }` if the header is missing or wrong.
- **Acceptance Criteria:**
  - Request without valid `X-Gamma-System-Token` → `403`.
  - Request with valid token → JSON array.
  - Empty array (not 404 or error) when no sessions are active.

---

### Task 3.2 — Add `GET /api/sessions/:sessionKey/context` endpoint

- **Files:** `kernel/src/sessions/sessions.controller.ts`
- **Work:**
  - Add route `@Get(':sessionKey/context')`.
  - Apply `@UseGuards(SystemAppGuard)` (same guard as Task 3.1).
  - Call `registry.getContext(sessionKey)` — reads from `gamma:session-context:<sessionKey>` (Redis String).
  - Return `{ sessionKey, systemPrompt: string }`.
  - Return 404 with `{ error: 'context not found' }` if `getContext()` returns `null`.
  - **This endpoint is intentionally lazy** — it is only hit when the user explicitly opens the Inspector panel for a session, keeping the `/active` list response small.
- **Acceptance Criteria:**
  - Returns the full raw system prompt (not truncated) for a known session.
  - Returns 404 for unknown or expired `sessionKey`.
  - Protected by `SystemAppGuard` — returns 403 without valid token.

---

### Task 3.3 — Add `POST /api/sessions/:sessionKey/kill` endpoint

- **Files:** `kernel/src/sessions/sessions.controller.ts`, `kernel/src/sessions/sessions.service.ts`
- **Work:**
  - Add route `@Post(':sessionKey/kill')`.
  - Apply `@UseGuards(SystemAppGuard)`.
  - `SessionsService.killBySessionKey(sessionKey)`: look up the in-memory session map to find the associated `windowId`, then reuse the existing abort/terminate logic.
  - Sends abort signal to gateway, updates registry: `registry.upsert({ sessionKey, status: 'aborted', lastActiveAt: Date.now() })`.
  - Return `{ ok: true }` on success, `{ ok: false, error }` on failure (e.g., session not found = 404).
- **Acceptance Criteria:**
  - Killing a running session from the monitor stops the agent stream within 2 seconds.
  - The session's status in the registry transitions to `'aborted'`.
  - The SSE stream for the killed window receives an appropriate terminal event.
  - Protected by `SystemAppGuard` — returns 403 without valid token.

---

## Phase 4 — Frontend: Agent Monitor App

### Task 4.1 — Scaffold the Agent Monitor app shell

- **Files:**
  - `web/apps/system/agent-monitor/AgentMonitorApp.tsx` _(new)_
  - `web/apps/system/agent-monitor/context.md` _(new)_
  - `web/registry/systemApps.ts`
  - `web/constants/apps.ts`
- **Work:**
  - Create `AgentMonitorApp.tsx` as a lazy-loadable React component (same pattern as `KernelMonitorApp.tsx`).
  - Register it in `systemApps.ts` under id `agent-monitor`.
  - Add to `INSTALLED_APPS` in `apps.ts` with icon `Activity` (lucide-react) and display name "Agent Monitor".
  - Write `context.md` describing the app's purpose for the agent's context window.
- **Acceptance Criteria:**
  - "Agent Monitor" appears in the application launcher.
  - App opens as a resizable window.
  - No console errors on mount.

---

### Task 4.2 — Build the `useSessionRegistry` hook

- **Files:** `web/hooks/useSessionRegistry.ts` _(new)_
- **Work:**
  - Fetches initial data from `GET /api/sessions/active` on mount, passing `X-Gamma-System-Token` header.
  - Subscribes to `session_registry_update` events via the existing `useSystemEvents` hook pattern (broadcast SSE, which also requires the system token on the SSE connection — see Task 3.1 notes).
  - Returns `{ sessions: SessionRecord[], isLoading: boolean }`.
  - On `session_registry_update` event, replace state with the new `records` payload (full snapshot, no merge needed).
  - The system token is accessed from a module-level constant in the web app (e.g., `import { SYSTEM_TOKEN } from '../constants/system'`). The value is injected at build time via Vite's `define` or an env var — it must NOT be hard-coded in source.
- **Acceptance Criteria:**
  - Hook returns live data without polling.
  - Properly cleans up listeners on unmount.
  - Requests without the token header are rejected 403 by the kernel (verified in smoke tests).

---

### Task 4.3 — Build the Session Data Grid

- **Files:** `web/apps/system/agent-monitor/AgentMonitorApp.tsx`
- **Work:**
  - Display a table with columns:
    | Column | Source |
    |--------|--------|
    | Window ID | `record.windowId` (truncated) |
    | App | `record.appId` |
    | Status | `record.status` (colored badge: idle=gray, running=green, error=red, aborted=orange) |
    | Runs | `record.runCount` |
    | Input Tokens | `record.tokenUsage.inputTokens` |
    | Output Tokens | `record.tokenUsage.outputTokens` |
    | Cache Read | `record.tokenUsage.cacheReadTokens` |
    | Last Active | `record.lastActiveAt` (relative time, e.g., "2m ago") |
    | Actions | "Inspect" button + "Kill" button |
  - Use CSS variables from the existing design system (no new UI libraries).
  - Clicking a row selects it and opens the Inspector panel.
  - "Kill" button is disabled when `status !== 'running'`.
- **Acceptance Criteria:**
  - Table renders without layout overflow inside any standard window size.
  - Status badges update in real-time as events arrive.
  - Kill button is only active for running sessions.

---

### Task 4.4 — Build the Inspector Panel

- **Files:** `web/apps/system/agent-monitor/AgentMonitorApp.tsx` (or `InspectorPanel.tsx` sub-component)
- **Work:**
  - Rendered alongside the grid in a split-pane layout (grid left ~60%, inspector right ~40%).
  - On session row select: lazy-fetch `GET /api/sessions/:sessionKey/context` (with system token header) and display the raw `systemPrompt` in a scrollable, monospace pre/code block.
  - Show a loading spinner while fetching.
  - Show "No session selected" when nothing is highlighted.
  - Display summary metadata at the top: `windowId`, `appId`, `status`, `createdAt` (formatted date), `runCount`.
- **Acceptance Criteria:**
  - Context loads within 500ms for local sessions.
  - Long system prompts scroll independently without affecting the grid.
  - Selecting a different row replaces the inspector content.

---

### Task 4.5 — Implement Kill Session Action

- **Files:** `web/apps/system/agent-monitor/AgentMonitorApp.tsx`
- **Work:**
  - "Kill" button in the grid calls `POST /api/sessions/:sessionKey/kill` (with system token header).
  - Show a confirmation dialog before sending the request: "Kill agent session for `{appId}`? This will abort the current run."
  - On success: display a transient success toast (use existing notification system via `useOSStore`).
  - On failure: display an error toast with the `error` field from the response.
  - Button enters a loading state while the request is in-flight.
- **Acceptance Criteria:**
  - Confirmation dialog prevents accidental kills.
  - After kill, the session row status updates to `'aborted'` within 2 seconds (via SSE push).
  - Error responses are surfaced to the user, not swallowed.

---

### Task 4.6 — Styling and layout polish

- **Files:** `web/apps/system/agent-monitor/AgentMonitorApp.tsx` (or co-located `.css`)
- **Work:**
  - Follow the existing CSS variable system (`--bg-*`, `--text-*`, `--border-*`, `--accent-*`).
  - Match the visual language of `KernelMonitorApp` (monospace metrics, dark glass aesthetic).
  - Ensure the app is usable at minimum window size 600×400.
  - Add empty state illustration/text when no sessions are active: "No active agent sessions."
- **Acceptance Criteria:**
  - No hardcoded colors outside CSS variables.
  - Passes visual review at both minimum and maximized window sizes.

---

## Phase 5 — Quality & Integration

### Task 5.1 — End-to-end smoke test

- **Files:** _(manual QA checklist, no code)_
- **Checklist:**
  - [ ] Open Terminal app → send a message → Agent Monitor shows session with `status: running`.
  - [ ] Agent completes → status transitions to `idle`, tokens populated (non-zero `inputTokens`).
  - [ ] Open two apps → both sessions appear as separate rows, each with a distinct `sessionKey`.
  - [ ] Click "Inspect" on a session → full system prompt loads (not the 2000-char snippet).
  - [ ] Click "Kill" on running session → confirm dialog → session aborts → status `'aborted'`.
  - [ ] Close a window → its row disappears from the grid within 5 seconds; Redis keys deleted.
  - [ ] Restart the kernel with stale Redis keys present → keys flushed before first request.
  - [ ] Call `GET /api/sessions/active` without `X-Gamma-System-Token` → `403 Forbidden`.
  - [ ] Call `GET /api/sessions/:sessionKey/context` without token → `403 Forbidden`.
  - [ ] Reload the page → Agent Monitor fetches current registry correctly (initial GET).

---

### Task 5.2 — Add `SessionRecord` serialization guard to `SessionRegistryService`

- **Files:** `kernel/src/sessions/session-registry.service.ts`
- **Work:**
  - Since Redis stores everything as strings, add a private `deserialize(raw: Record<string, string>): SessionRecord` method that safely:
    - Parses numeric fields with `parseInt` / `parseFloat` (createdAt, lastActiveAt, runCount).
    - Parses flat token fields (`inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `contextUsedPct`) into a `TokenUsage` object.
    - Handles missing or `undefined` fields gracefully (default to `0`).
  - Ensure `getAll()` and `getOne()` always return well-formed `SessionRecord` objects, never raw Redis strings.
- **Acceptance Criteria:**
  - `tokenUsage.inputTokens` is type `number` in all API responses, not `"0"`.
  - A partially-written hash (e.g., kernel crash mid-write) deserializes safely without throwing.

---

### Task 5.3 — TypeScript compilation check

- **Files:** All modified files
- **Work:**
  - Run `pnpm -r tsc --noEmit` from the monorepo root.
  - Fix any `noUnusedLocals` / `noUnusedParameters` errors.
  - Ensure `@gamma/types` changes do not break existing consumers.
- **Acceptance Criteria:**
  - Zero TypeScript errors across all three workspaces (kernel, web, gamma-types).

---

## Implementation Order (Critical Path)

```
Task 1.1  →  Task 1.2  →  Task 1.3  →  Task 1.4
                                ↓
                          Task 2.1  →  Task 2.2
                                ↓
                    Task 3.1  +  Task 3.2  +  Task 3.3  (parallel)
                                ↓
             Task 4.1  →  Task 4.2  →  Task 4.3  →  Task 4.4  →  Task 4.5  →  Task 4.6
                                ↓
                          Task 5.1  +  Task 5.2  +  Task 5.3
```

---

## Redis Key Design

| Key Pattern | Type | TTL | Purpose |
|-------------|------|-----|---------|
| `gamma:session-registry:<sessionKey>` | Hash | 24h (refreshed on write) | Per-session telemetry record |
| `gamma:session-context:<sessionKey>` | String | 24h (refreshed on write) | Full raw system prompt (lazy-loaded) |

### `gamma:session-registry:<sessionKey>` Hash fields (all stored as strings)

```
sessionKey       "sk-abc123..."
windowId         "win_abc123"
appId            "terminal"
status           "running"
createdAt        "1710000000000"
lastActiveAt     "1710000030000"
runCount         "3"
inputTokens      "4200"
outputTokens     "850"
cacheReadTokens  "0"
cacheWriteTokens "0"
contextUsedPct   "12.5"
systemPromptSnippet  "<first 2000 chars of assembled system prompt>"
```

### `gamma:session-context:<sessionKey>` String value

```
<complete raw system prompt — potentially 50–200 KB>
```

> **Design notes:**
> - **Key by `sessionKey`** — sessions are independent entities; `windowId` is just metadata inside the hash.
> - **Flat token fields** — stored flat (not nested JSON) to allow atomic `HINCRBY` accumulation without read-modify-write cycles.
> - **Context separation** — the full prompt lives in a separate key so that `getAll()` (which fetches all registry hashes) never transfers the large payload. The Inspector only pulls context on explicit user interaction.
> - **TTL strategy** — 24h TTL acts as a safety net against leaks; GC and boot-time flush are the primary cleanup paths. TTL is refreshed (`EXPIRE`) on every write so active sessions never expire.

---

## Files Created / Modified Summary

| File | Status | Phase |
|------|--------|-------|
| `packages/gamma-types/index.ts` | Modified | 1.1, 2.2 |
| `kernel/src/sessions/session-registry.service.ts` | **New** | 1.2, 5.2 |
| `kernel/src/sessions/system-guard.ts` | **New** | 3.1 |
| `kernel/src/sessions/sessions.service.ts` | Modified | 1.3 |
| `kernel/src/sessions/session-gc.service.ts` | Modified | 1.4 |
| `kernel/src/sessions/sessions.module.ts` | Modified | 1.2, 1.4 |
| `kernel/src/sessions/sessions.controller.ts` | Modified | 3.1, 3.2, 3.3 |
| `kernel/src/gateway/gateway-ws.service.ts` | Modified | 2.1 |
| `web/apps/system/agent-monitor/AgentMonitorApp.tsx` | **New** | 4.1–4.6 |
| `web/apps/system/agent-monitor/context.md` | **New** | 4.1 |
| `web/hooks/useSessionRegistry.ts` | **New** | 4.2 |
| `web/constants/system.ts` | **New** | 4.2 |
| `web/registry/systemApps.ts` | Modified | 4.1 |
| `web/constants/apps.ts` | Modified | 4.1 |
