# Gamma Runtime — System Refactoring Roadmap

> **Generated:** 2026-03-16  
> **Scope:** `apps/gamma-core`, `apps/gamma-ui`, `packages/gamma-types`  
> **Objective:** Pay down technical debt, harden stability, and prepare the codebase for Phase 6 (Personal Knowledge RAG) with zero risk to existing features.

---

## Executive Summary

Gamma Agent Runtime is architecturally sound and functionally complete through Phase 5. The multi-agent orchestration, WebSocket gateway, Redis stream backbone, and desktop-style UI all work. However, the rapid pace of feature delivery has left behind predictable debt:

| Area | Health | Key Risk |
|------|--------|----------|
| **Security** | ⚠️ Needs Attention | Empty `safeId` in scaffold can delete jail root; missing auth on session/scaffold endpoints; no DTO validation anywhere |
| **Error Handling** | ⚠️ Needs Attention | 15+ swallowed promises across backend; no root error boundary in frontend; silent SSE failures |
| **Code Duplication** | ⚠️ Moderate | `flattenEntry`/`parseStreamFields` duplicated 4× each; SSE polling pattern duplicated; 5+ shared modal/button patterns in UI |
| **Test Coverage** | 🔴 Critical Gap | Only `scaffold.service.spec.ts` and `event-classifier.spec.ts` exist on backend; zero test files on frontend |
| **Type Safety** | ⚠️ Needs Attention | No runtime validation at API boundaries; 20+ unsafe `JSON.parse ... as T` casts; gamma-types has no build step |
| **Architecture** | ✅ Mostly Solid | One God service (`GatewayWsService` at 1732 lines); one circular dep (`Sessions ↔ Scaffold`); otherwise clean module separation |

**Overall verdict:** The system is stable for its current user base but carries unacceptable risk in the scaffold security path and lacks the safety net (tests, validation) needed before layering on Phase 6. The roadmap below is prioritized by blast radius and ROI.

---

## Phase 1: Critical Fixes & Security Hardening

> **Priority:** Immediate — these are silent bugs or exploitable gaps.  
> **Estimated effort:** 2–3 days  
> **Risk level:** Low (fixes are additive or tighten constraints)

### 1.1 Scaffold `safeId` Empty-String Vulnerability

**Severity: CRITICAL**

`scaffold.service.ts` sanitizes `appId` with `.replace(/[^a-zA-Z0-9_-]/g, "")`. If `appId` is composed entirely of illegal characters (e.g. `"!!!"`), `safeId` becomes `""`. This causes:

- `remove("")` → `removeDir(JAIL_ROOT)` → **deletes the entire private apps directory**
- `scaffold("")` → writes `App.tsx` directly into `JAIL_ROOT`

The same pattern exists in `scaffold-assets.controller.ts` where an empty `safeAppId` enables cross-app asset access.

**Files:**
- `apps/gamma-core/src/scaffold/scaffold.service.ts` (lines 95, 319)
- `apps/gamma-core/src/scaffold/scaffold-assets.controller.ts` (line 66)

**Fix:** Reject empty `safeId` immediately after sanitization:
```typescript
const safeId = appId.replace(/[^a-zA-Z0-9_-]/g, "");
if (!safeId) throw new BadRequestException("Invalid appId");
```

### 1.2 Missing Auth on Session & Scaffold Endpoints

**Severity: HIGH**

The following endpoints have no authentication guard:

| Controller | Endpoints | Risk |
|------------|-----------|------|
| `SessionsController` | `findAll`, `sync`, `send`, `abort`, `remove` | Any client can list, message, abort, or delete sessions |
| `ScaffoldController` | `getRegistry`, `scaffold`, `remove` | Unauthenticated app creation and deletion |
| `AppDataController` | `get`, `put` | Anyone can read/write app data for any `appId` |

**Files:**
- `apps/gamma-core/src/sessions/sessions.controller.ts` (lines 95–147)
- `apps/gamma-core/src/scaffold/scaffold.controller.ts` (lines 19–34)
- `apps/gamma-core/src/app-data/app-data.controller.ts` (lines 24–68)

**Fix:** Apply `SystemAppGuard` (or equivalent) to all privileged endpoints. For `AppDataController`, consider per-app authorization scoping.

### 1.3 Enable Global DTO Validation

**Severity: HIGH**

No `ValidationPipe` is configured. All `@Body()` parameters accept arbitrary JSON. `CreateSessionDto`, `SpawnAgentDto`, `ScaffoldRequest`, etc. are plain interfaces with zero class-validator decorators.

**Files:**
- `apps/gamma-core/src/main.ts` (missing `app.useGlobalPipes(...)`)
- `packages/gamma-types/index.ts` (DTOs are type-only)

**Fix:**
1. Add `app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }))` to `main.ts`.
2. Convert DTOs from interfaces to classes with class-validator decorators.
3. Use `@IsString()`, `@IsNotEmpty()`, `@Matches()` on fields like `appId`, `windowId`, `model`.

### 1.4 Bootstrap Crash Handling

**Severity: HIGH**

`bootstrap()` in `main.ts` has no try/catch. If cert loading, Redis connection, or NestJS factory creation fails, the process hangs as an unhandled rejection.

**File:** `apps/gamma-core/src/main.ts` (lines 10–60)

**Fix:** Wrap `bootstrap()` in try/catch, log the error, and call `process.exit(1)`.

### 1.5 Prototype Pollution via `JSON.parse`

**Severity: MEDIUM**

Multiple locations parse untrusted JSON (Redis values, SSE data, WebSocket frames) directly into typed objects. Keys like `__proto__` or `constructor.prototype` in stored data could modify object prototypes.

**Files:**
- `apps/gamma-core/src/app-data/app-data.controller.ts` (line 33)
- `apps/gamma-core/src/sse/sse.controller.ts`, `system.controller.ts`, `activity-stream.service.ts` (parseStreamFields)
- `apps/gamma-core/src/gateway/gateway-ws.service.ts` (lines 302, 363)
- `apps/gamma-ui/src/hooks/useAgentStream.ts` (line 82)

**Fix:** Add a safe JSON parse utility that strips dangerous keys, or migrate to Zod `.safeParse()` at all parse boundaries.

### 1.6 Inconsistent SSE Auth

**Severity: MEDIUM**

`useSessionRegistry` opens an EventSource to `/api/stream/agent-monitor` with no auth ticket, while other streams (`SentinelApp`, `DirectorApp`) use `fetchSseTicket`. Similarly, per-window agent streams in `useAgentStream` use no ticket.

**Files:**
- `apps/gamma-ui/src/hooks/useSessionRegistry.ts` (line 27)
- `apps/gamma-ui/src/hooks/useAgentStream.ts` (line 75)

**Fix:** Align all SSE connections to use ticket-based auth.

---

## Phase 2: Code Unification & DRY

> **Priority:** High — reduces surface area for future bugs.  
> **Estimated effort:** 3–4 days  
> **Risk level:** Low (extract-and-replace refactors with no behavior change)

### 2.1 Extract Shared Redis Utilities (Backend)

**Duplicated functions:**

| Function | Locations | Count |
|----------|-----------|-------|
| `flattenEntry(obj)` | `gateway-ws.service.ts:96`, `scaffold.service.ts:22`, `sessions.service.ts:53`, `activity-stream.service.ts:12` | 4× |
| `parseStreamFields(fields)` | `sse.controller.ts:154`, `system.controller.ts:257`, `activity-stream.service.ts:122` | 3× |
| `pascal(id)` | `scaffold.service.ts:15`, `sessions.service.ts:46` | 2× |

**Fix:** Create `src/common/redis.util.ts` with `flattenEntry` and `parseStreamFields`, and `src/common/string.util.ts` with `pascal`. Replace all inline copies.

### 2.2 Extract SSE Polling Service (Backend)

The SSE pattern (validate ticket → create blocking Redis client → poll loop → teardown) is duplicated between `sse.controller.ts` and `system.controller.ts` (60+ lines each).

**Fix:** Create a shared `SseStreamService` or helper that encapsulates:
- Ticket validation
- Blocking Redis client creation
- Polling loop with proper error handling
- Client disconnect cleanup

### 2.3 Extract Shared UI Components (Frontend)

**Duplicated patterns across `KernelMonitorApp`, `AgentMonitorApp`, `DirectorApp`, `SentinelApp`:**

| Pattern | Occurrences |
|---------|-------------|
| Modal overlay/box/title/body/actions styles | 4+ apps |
| Button styles (`BTN`, `BTN_DANGER`, `BTN_GHOST`) | 4+ apps |
| `formatTime`, `formatKind`, `relativeTime` helpers | 4+ apps |
| `setInterval(fetch..., 5000)` polling pattern | 3+ apps |
| Session creation logic (ensure backend session) | 3 components |

**Fix:**
1. Create `components/ui/ConfirmModal.tsx` — shared modal with configurable title, body, and actions.
2. Create `components/ui/Button.tsx` — shared button with `variant` prop (primary, danger, ghost).
3. Create `lib/format.ts` — shared formatting utilities.
4. Create `hooks/usePolling.ts` — generic polling hook: `usePolling(callback, intervalMs)`.
5. Create `hooks/useEnsureSession.ts` — centralized session creation logic.

### 2.4 Unify Agent Registry SSE (Frontend)

`DirectorApp.useAgentMonitor` and `SentinelApp.useAgentRegistry` both establish SSE connections and REST polling for agent data with different implementations.

**Fix:** Extract a shared `hooks/useAgentRegistryStream.ts` with unified auth, reconnect, and error handling.

### 2.5 Move `GWFrame` to gamma-types

`GWFrame` is defined locally in `gateway-ws.service.ts` (lines 76–86) while `GWFrameType` exists in gamma-types but is never used.

**Fix:** Define `GWFrame` in `packages/gamma-types/index.ts` using `GWFrameType`, import it in gateway-ws.service.

---

## Phase 3: Robustness & Error Handling

> **Priority:** Medium — prevents silent failures and improves debuggability.  
> **Estimated effort:** 3–4 days  
> **Risk level:** Low (additive changes: logging, boundaries, fallbacks)

### 3.1 Eliminate Swallowed Promises (Backend)

Replace empty `.catch(() => {})` with at minimum `.catch(err => this.logger.warn('...', err))`:

| File | Line(s) | Context |
|------|---------|---------|
| `gateway-ws.service.ts` | 413, 483, 544 | `applyUsageFromPayload`, heartbeat, Redis pipeline |
| `sse.controller.ts` | 129, 131 | `poll()`, `validateTicket` |
| `system.controller.ts` | 240, 242 | Same SSE pattern |
| `sessions.service.ts` | 335 | `emergency_stop` xadd |
| `tool-watchdog.service.ts` | 56 | `onTimeout` callback |
| `context-injector.service.ts` | 54–56 | `getAll()` fallback |
| `session-registry.service.ts` | 93 | Broadcast xadd |

For truly intentional swallows (best-effort broadcast), add a comment: `// best-effort: stream notification is non-critical`.

### 3.2 Add Root Error Boundary (Frontend)

**Severity: CRITICAL**

No error boundary exists. A crash in any component unmounts the entire app with a white screen.

**File:** `apps/gamma-ui/src/main.tsx`

**Fix:** Wrap `<Gamma />` in an error boundary component that:
- Catches render errors
- Shows a fallback UI with the error message
- Provides a "Reload" button
- Logs the error to console (or future telemetry)

### 3.3 Fix Resource Leaks (Frontend)

| Issue | Location | Fix |
|-------|----------|-----|
| EventSource leak on unmount | `DirectorApp.tsx:473–475` | Check a `destroyed` flag in the `.then` callback; close the EventSource if unmounted |
| `setTimeout` leak in BootScreen | `BootScreen.tsx:155–165` | Store timeout/RAF IDs in refs; clear both in effect cleanup |
| `setTimeout` leak in CodeBlockWithCopy | `MessageList.tsx:130` | Store timer in ref; clear on unmount |
| `setTimeout` leak in ToastNotification | `ToastNotification.tsx:21` | Store timer in ref; clear on unmount |
| KernelMonitor SSE connect race | `KernelMonitorApp.tsx:451` | Track pending async connection; close on unmount |

### 3.4 Improve WebSocket Disconnect Handling

`gateway-ws.service.ts:308–311` rejects all `pendingRequests` on disconnect, but inflight `chat.send` callers may not receive clear feedback.

**Fix:** Ensure disconnection errors propagate with a typed error code (e.g. `GATEWAY_DISCONNECTED`) so callers can distinguish from API errors.

### 3.5 Fix Redis Module Hard Exit

`redis.module.ts` (line 44) calls `process.exit(1)` on Redis connection failure with no graceful shutdown.

**Fix:** Use NestJS lifecycle shutdown hooks (`app.enableShutdownHooks()`) and consider retry/backoff before exiting.

### 3.6 Add Safe JSON Parsing Throughout

Replace all `JSON.parse(data) as SomeType` patterns with validated parsing. Create a shared utility:

```typescript
// packages/gamma-types/parse.ts
import { z } from "zod";

export function safeParse<T>(schema: z.ZodType<T>, raw: string): T | null {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
```

Key parse sites (20+ across the stack):
- `useAgentStream.ts:82` — `GammaSSEEvent`
- `useSessionRegistry.ts:31,77` — `GammaSSEEvent`, `SessionRecord[]`
- `DirectorApp.tsx:456,1069` — SSE events
- `gateway-ws.service.ts:302,363` — `GWFrame`, `WindowSession`
- `scaffold.service.ts:241` — `AppRegistryEntry`
- `sessions.service.ts:179,187` — `WindowSession`
- `app-data.controller.ts:33` — arbitrary stored JSON

### 3.7 Standardize API Error Responses

Currently mixed: some endpoints return `{ ok, error }`, some throw NestJS exceptions, some return raw arrays. Frontend parsing is inconsistent (`body.error`, `body["message"]`, etc.).

**Fix:**
1. Define `ApiError` and `ApiResult<T>` types in gamma-types.
2. Add a NestJS exception filter to normalize all error responses.
3. Add a frontend `parseApiError()` utility.

---

## Phase 4: Test Coverage Strategy

> **Priority:** Medium-High — prerequisite for safe Phase 6 development.  
> **Estimated effort:** 5–7 days  
> **Risk level:** Zero (additive)

### 4.1 Current State

| Package | Test Files | Coverage |
|---------|-----------|----------|
| `gamma-core` | `scaffold.service.spec.ts`, `event-classifier.spec.ts` | ~5% of services |
| `gamma-ui` | **None** | 0% |
| `gamma-types` | **None** | N/A (types only, but validation schemas will need tests) |

### 4.2 Priority Test Targets (Backend)

Tests ordered by blast radius — **highest risk first:**

| Priority | File | What to Test | Type |
|----------|------|-------------|------|
| **P0** | `ToolJailGuardService` | Path traversal prevention, jail boundary enforcement, symlink attacks | Unit |
| **P0** | `SessionsService` | Session lifecycle (create → message → abort → remove), panic behavior, concurrent operations | Unit |
| **P0** | `GatewayWsService` | Connection handshake, event routing, tool call handling, disconnect cleanup, reconnection | Unit + Integration |
| **P1** | `SessionsController` | Auth enforcement, input validation, error responses | Integration |
| **P1** | `ScaffoldService` | Scaffold creation, removal, registry operations, edge cases (empty safeId after fix) | Unit (extend existing) |
| **P1** | `ScaffoldAssetsController` | Path traversal protection for assets, empty safeAppId rejection | Integration |
| **P1** | `AppStorageService` | `jailPath`, `validateJailPath`, `rollbackApp` | Unit |
| **P2** | `SessionRegistryService` | Redis CRUD, serialization roundtrip, broadcast | Unit |
| **P2** | `AgentRegistryService` | Agent lifecycle, spawn/remove, registry queries | Unit |
| **P2** | `AppDataController` | Validation, limits, auth | Integration |
| **P2** | `PtyService` | Auth, token handling, session lifecycle, env sanitization | Unit |
| **P3** | `ToolWatchdogService` | Timeout enforcement, callback execution | Unit |
| **P3** | `ActivityStreamService` | Buffering, flush, stream parsing | Unit |
| **P3** | `MessageBusService` | Pub/sub, delivery guarantees | Unit |

### 4.3 Priority Test Targets (Frontend)

| Priority | File | What to Test | Type |
|----------|------|-------------|------|
| **P0** | `useAgentStream` | Phase transitions, message accumulation, tool calls, error/disconnect handling, cleanup | Hook unit test (vitest + testing-library) |
| **P0** | `useSessionRegistry` | REST fetch, SSE event handling, cleanup, unsubscribe | Hook unit test |
| **P1** | `useAppStorage` | Fetch, debounced persist, error states, unmount cleanup | Hook unit test |
| **P1** | `BrowserApp.normalizeUrl` / `isPrivateHost` | Allowed/blocked hosts, schemes, edge cases | Pure function unit test |
| **P1** | `useGammaStore` actions | Window CRUD, focus management, persist/hydrate | Store unit test |
| **P2** | `WindowNode` / `DynamicAppRenderer` | Mount/unmount lifecycle, error states | Component test |
| **P2** | `MessageList` / `ChatInput` | Rendering, interaction, edge cases | Component test |
| **P3** | `BootScreen` | Progress animation, fade, cleanup | Component test |

### 4.4 Testing Infrastructure Setup

1. **Backend:** NestJS ships with Jest; existing specs use it. No setup needed — just add specs.
2. **Frontend:** Add Vitest + `@testing-library/react` + `jsdom`:
   - Add `"test": "vitest run"` and `"test:watch": "vitest"` scripts to `gamma-ui/package.json`.
   - Add `vitest.config.ts` with jsdom environment.
3. **CI:** Add `pnpm test` to the CI pipeline once tests exist.

---

## Phase 5: Build & Configuration Cleanup

> **Priority:** Low-Medium — quality-of-life improvements.  
> **Estimated effort:** 1–2 days  
> **Risk level:** Low

### 5.1 Fix Root `typecheck` Command

`pnpm run typecheck` runs `pnpm --filter @gamma/ui typecheck`, but `gamma-ui` has no `typecheck` script. The root command silently fails.

**Fix:** Add `"typecheck": "tsc --noEmit"` to `apps/gamma-ui/package.json`. Also include `gamma-watchdog` in root typecheck.

### 5.2 Unify TypeScript Versions

| Package | Version |
|---------|---------|
| gamma-core | `^5.7.2` |
| gamma-ui | `^5.4.5` |
| gamma-watchdog | `^5.7.2` |

**Fix:** Align all to `^5.7.2` (or latest 5.x).

### 5.3 Stabilize gamma-types Build

`packages/gamma-types` has `"main": "index.ts"` — raw TypeScript with no build. It works via path aliases but is fragile. The NestJS build uses a `find ... -exec sed` hack to rewrite `.ts` → `.js` imports.

**Fix (choose one):**
- **Option A:** Add `tsup` or `tsc` build to gamma-types. Set `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`.
- **Option B:** Document that gamma-types is source-only and consumed via path aliases. Remove the sed hack and use proper tsconfig `paths` + `references`.

### 5.4 Align tsconfig Path Aliases

gamma-core uses `"@gamma/types": ["../../packages/gamma-types"]` while gamma-ui uses `"@gamma/types": ["../../packages/gamma-types/index.ts"]`. Both resolve to the same target.

**Fix:** Use the same path format in all packages (prefer without `/index.ts`).

### 5.5 Clean Up Dead Exports

| Item | Location | Action |
|------|----------|--------|
| `INITIAL_WINDOW_AGENT_STATE` | gamma-types:107 | Use in frontend hooks or remove |
| `GWFrameType` | gamma-types:243 | Use in `GWFrame` definition or remove |
| `StreamID` | gamma-types:395 | Use for Redis stream IDs or remove |

### 5.6 Remove Stray `console.log`

| File | Line |
|------|------|
| `session-registry.service.ts` | 226 |
| `gateway-ws.service.ts` | 1503 |

Replace with `this.logger.debug(...)` or remove.

---

## Execution Rules

These rules govern how we implement the phases above safely.

### Rule 1: One Phase at a Time

Complete and verify each phase before starting the next. Phases are ordered by risk — do not skip ahead.

### Rule 2: One File Per Commit

Each commit should touch the minimum number of files needed for a single logical change. This makes rollback trivial.

### Rule 3: Zero Behavior Change (Unless Fixing a Bug)

Refactors (Phase 2, 5) must not change observable behavior. Use the "strangler fig" pattern:
1. Create the new shared utility/component.
2. Replace one consumer at a time.
3. Verify behavior after each replacement.
4. Delete the old inline copy only after all consumers are migrated.

### Rule 4: Tests Before Refactors

For Phase 2+ refactors, write a test for the current behavior **before** extracting or changing code. This ensures the refactor doesn't break anything.

### Rule 5: Security Fixes Get Manual QA

Phase 1 changes (scaffold safeId, auth guards, validation) must be manually tested with adversarial inputs before merging:
- `appId` = `"!!!"`, `"../"`, `""`, `"../../../etc/passwd"`
- Missing/invalid body fields
- Requests without auth headers

### Rule 6: No Big-Bang Merges

Never merge a branch with 10+ file changes without incremental review. Break large PRs into stacked PRs of 3–5 files.

### Rule 7: Document Breaking Changes

If any change alters API contracts (even just adding required fields), update gamma-types first and coordinate frontend/backend changes in the same PR.

---

## Appendix: Full Findings Summary

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Security | 1 | 5 | 5 | 2 | 13 |
| Error Handling | 0 | 3 | 5 | 12 | 20 |
| Code Duplication | 0 | 1 | 5 | 3 | 9 |
| Architecture | 0 | 1 | 3 | 1 | 5 |
| Test Coverage | 1 | 4 | 6 | 3 | 14 |
| Type Safety | 0 | 3 | 10 | 4 | 17 |
| Performance | 0 | 1 | 3 | 5 | 9 |
| Accessibility | 0 | 1 | 3 | 4 | 8 |
| Build/Config | 1 | 2 | 1 | 3 | 7 |
| **Total** | **3** | **21** | **41** | **37** | **102** |
