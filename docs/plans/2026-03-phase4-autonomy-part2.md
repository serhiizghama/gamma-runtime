# Phase 4.2 — The "Duty Architect" Loop (Automated Code Review)

**Status:** Planning
**Priority:** P2
**Depends on:** Phase 4.1 (Agent Discovery & Message Bus) ✅
**Date:** 2026-03-15

---

## 1. Objective

Implement an autonomous QA loop where a dedicated **App Inspector** agent reacts to file changes made by App Owner agents, reviews the modified code, and sends structured feedback via IPC — all without human intervention.

The core backend must remain lean: it only **emits events**, never performs reviews itself.

---

## 2. Architectural Approach

### 2.1 Event-Driven File Change Notifications

When an App Owner agent successfully writes a file via `fs_write`, the Gateway (`gateway-ws.service.ts`) already processes the `tool_result` at line ~816. We add a lightweight **post-write event emitter** at this point:

```
fs_write tool_result (success)
  │
  ▼
GatewayWsService emits event to Redis Stream
  │
  channel: gamma:system:file_changed
  │
  payload: { appId, sessionKey, filePath, timestamp }
  │
  ▼
App Inspector agent (consumer) reads the stream
  │
  ▼
Inspector reads the file, analyzes it, sends feedback via send_message
```

**Key design decisions:**

- **No review logic in the core.** The backend publishes a fact ("file X changed") — nothing more.
- **Redis Stream** (`gamma:system:file_changed`) for durability and replay — same pattern as `gamma:memory:bus`.
- **Stream MAXLEN ~500** — enough history for debugging, auto-evicts old entries.
- **Debounce at consumer level** — the Inspector agent batches rapid successive writes (e.g., scaffold generating 3 files) into a single review cycle.

### 2.2 Why a New System App, Not the System Architect

| Concern | System Architect | New App Inspector |
|---------|-----------------|-------------------|
| Separation of concerns | Already handles scaffolding, health, delegation | Single responsibility: code quality |
| Context window | Loaded with OS management context | Lean, focused review persona |
| Concurrent execution | Would need multiplexing | Independent session, no contention |
| Tool permissions | Full system access (exempt from jail) | Read-only + `send_message` only |
| Failure isolation | Inspector crash ≠ architect crash | ✅ |

**Decision:** Create a new **`app-inspector`** system agent.

### 2.3 App Inspector — Agent Design

**Session Key:** `app-inspector`
**Role in Agent Registry:** `daemon`
**Capabilities:** `['code_review', 'ipc']`

**Tool Allowlist:**
- `fs_read` — read the changed file (jail-scoped to target app's bundle)
- `fs_list` — list surrounding files for context
- `send_message` — send review feedback to the App Owner

**NOT allowed:** `fs_write`, `shell_exec`, `scaffold`, `unscaffold`

The Inspector is a **read-only observer** that communicates exclusively through IPC.

---

## 3. Communication Protocol

### 3.1 File Change Event (Backend → Redis Stream)

```typescript
// Published to gamma:system:file_changed
{
  appId: string;          // e.g., "weather-app"
  sessionKey: string;     // who wrote it, e.g., "app-owner-weather-app"
  filePath: string;       // relative path within app bundle
  toolCallId: string;     // correlation ID from the original fs_write
  windowId: string;       // for UI event routing
  timestamp: number;      // epoch ms
}
```

### 3.2 Review Feedback (Inspector → App Owner via MessageBus)

```typescript
// send_message from app-inspector to app-owner-<appId>
{
  to: "app-owner-weather-app",
  type: "notification",
  subject: "Code Review: WeatherApp.tsx",
  payload: {
    verdict: "needs_changes" | "approved",
    filePath: "WeatherApp.tsx",
    issues: [
      {
        severity: "error" | "warning" | "suggestion",
        line: number | null,
        message: string,
        category: "security" | "bug" | "architecture" | "performance" | "style"
      }
    ],
    summary: string  // one-liner for UI display
  }
}
```

### 3.3 Debounce Strategy

The Inspector agent maintains a **review window** per appId:

1. On receiving a `file_changed` event, start a 3-second cooldown timer for that appId.
2. If another event arrives for the same appId within the window, reset the timer.
3. When the timer fires, read ALL changed files for the app and perform a single batch review.

This prevents reviewing intermediate states during multi-file scaffold operations.

---

## 4. Execution Loops

### Loop 1: Backend Event Emitter

**Goal:** Emit `file_changed` events to Redis Stream when `fs_write` succeeds.

**Files to modify:**

| File | Change |
|------|--------|
| `apps/gamma-core/src/gateway/gateway-ws.service.ts` | After successful `fs_write` tool_result (line ~816), publish event to `gamma:system:file_changed` stream. Extract `appId` from `sessionKey` and `filePath` from the tool call arguments. Only emit for App Owner sessions (skip System Architect writes). |
| `libs/types/src/redis-keys.ts` | Add `FILE_CHANGED_STREAM = 'gamma:system:file_changed'` constant. |

**Acceptance Criteria:**
- [ ] When an App Owner writes a file via `fs_write`, a structured event appears in `gamma:system:file_changed` stream.
- [ ] System Architect `fs_write` calls do NOT produce events (to avoid review loops during scaffold).
- [ ] Event includes `appId`, `sessionKey`, `filePath`, `toolCallId`, `windowId`, `timestamp`.
- [ ] Stream enforces `MAXLEN ~500`.
- [ ] No performance regression on the `fs_write` hot path (publish is fire-and-forget, errors logged but never block).

---

### Loop 2: The App Inspector Agent

**Goal:** Scaffold the new `app-inspector` system agent with its persona, session lifecycle, and tool permissions.

**Files to create:**

| File | Purpose |
|------|---------|
| `docs/agents/app-inspector.md` | Agent persona & system prompt. Defines review criteria: security (XSS, injection), bugs (null refs, infinite loops), architecture violations (forbidden imports, direct DOM manipulation), and React anti-patterns. |

**Files to modify:**

| File | Change |
|------|--------|
| `apps/gamma-core/src/gateway/gateway-ws.service.ts` | Add `app-inspector` to the tool resolution logic (`resolveAllowedTools`). Allowlist: `fs_read`, `fs_list`, `send_message`. Handle `send_message` interception for the Inspector (currently only System Architect can use it). |
| `apps/gamma-core/src/sessions/sessions.service.ts` | Add initialization logic for `app-inspector` session — load persona from `docs/agents/app-inspector.md`, register in Agent Registry with role `daemon` and capabilities `['code_review', 'ipc']`. |
| `apps/gamma-core/src/gateway/tool-jail-guard.service.ts` | Add `app-inspector` exemption for cross-app `fs_read` — the Inspector needs to read ANY app's files, not just its own bundle. Keep `fs_write` blocked. |

**Acceptance Criteria:**
- [ ] `app-inspector` session can be created and initialized with its dedicated persona.
- [ ] Agent Registry shows `app-inspector` with role `daemon`, status `idle`, capabilities `['code_review', 'ipc']`.
- [ ] Inspector can `fs_read` files from any app bundle (cross-app read access).
- [ ] Inspector CANNOT `fs_write` to any location.
- [ ] Inspector can use `send_message` to communicate with App Owners.
- [ ] Inspector's system prompt includes structured review criteria and output format expectations.

---

### Loop 3: Stream Consumer & Review Trigger

**Goal:** Wire the Inspector to consume `file_changed` events and trigger automated reviews.

**Files to create:**

| File | Purpose |
|------|---------|
| `apps/gamma-core/src/messaging/file-change-consumer.service.ts` | NestJS service that polls `gamma:system:file_changed` via `XREAD BLOCK`. On receiving events, applies the debounce window (3s per appId), then triggers an Inspector agent run by sending a synthetic user message to the Inspector's session with the review context. |

**Files to modify:**

| File | Change |
|------|--------|
| `apps/gamma-core/src/messaging/messaging.module.ts` | Register `FileChangeConsumerService` as a provider. |
| `apps/gamma-core/src/sessions/sessions.service.ts` | Ensure Inspector session auto-starts on application bootstrap (or on first `file_changed` event — lazy initialization). |

**Integration Flow:**

```
gamma:system:file_changed (Redis Stream)
       │
       ▼
FileChangeConsumerService (XREAD BLOCK loop)
       │
       │  debounce 3s per appId
       ▼
Build review prompt:
  "Review the following file changes in app '{appId}':
   - {filePath1} (modified by {sessionKey})
   - {filePath2} (modified by {sessionKey})
   Read each file and provide your assessment."
       │
       ▼
Inject as user message into app-inspector session
       │
       ▼
Inspector agent runs:
  1. fs_read each file
  2. Analyze code
  3. send_message feedback to app-owner-{appId}
```

**Acceptance Criteria:**
- [ ] `FileChangeConsumerService` starts on module init and begins polling the stream.
- [ ] Multiple rapid writes to the same app are batched into a single review (3s debounce).
- [ ] Inspector receives a well-formed review prompt with file paths and app context.
- [ ] Inspector successfully reads the files, forms an assessment, and sends an IPC message.
- [ ] The App Owner's inbox contains the review message (verifiable via `MessageBusService.readInbox`).
- [ ] If Inspector is not yet initialized, lazy-init on first event (no crash on cold start).
- [ ] Consumer tracks `lastStreamId` for gap-free resumption after restart.
- [ ] Errors in the review cycle (Inspector timeout, read failure) are logged to `SystemEventLog` but never crash the consumer loop.

---

## 5. Non-Goals (Explicitly Out of Scope)

- **Automated rollback based on review.** The Inspector sends feedback only; it does not trigger rollbacks. That's a future enhancement.
- **App Owner auto-response to review.** App Owners don't yet poll their inbox automatically. Inbox consumption is a separate workstream.
- **UI for review results.** Review messages are stored in the IPC inbox. A future UI in Sentinel or Agent Monitor can surface them.
- **Review of System Architect writes.** Scaffold operations are trusted and exempt.

---

## 6. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Inspector enters infinite loop (reviews its own send_message as a "change") | Inspector has no `fs_write` permission — no file changes to trigger events. `send_message` does not produce `file_changed` events. |
| Review storms during bulk scaffold | Debounce window (3s) batches events. System Architect writes are excluded from event emission. |
| Inspector context window exhaustion on large files | Persona instructs Inspector to focus on the changed file only, not the entire app. Token budget monitoring via existing SessionRegistry telemetry. |
| Consumer crash leaves unprocessed events | Redis Stream persistence + `lastStreamId` tracking ensures no events are lost. Consumer restarts from last processed position. |

---

## 7. Success Metrics

1. **End-to-end latency:** From `fs_write` completion to review message in App Owner inbox < 15 seconds (excluding debounce window).
2. **Zero false triggers:** No review events for System Architect writes or non-fs_write tool calls.
3. **Consumer resilience:** Service restart recovers stream position; no duplicate reviews after restart.
4. **Review quality:** Inspector catches at least: XSS vulnerabilities, React hook violations, forbidden imports — validated via manual test scenarios.
