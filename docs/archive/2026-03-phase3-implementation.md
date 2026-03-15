# Gamma OS — Phase 3 Implementation Plan
**Based on:** Frontend & Multi-Agent Architecture Specification v1.4  
**Status:** IN PROGRESS — Loops 6-8 implemented, Loop 9 partially complete.
**Last audit:** 2026-03-15  
**Execution model:** Loop-by-loop, task-by-task. Verify each task before proceeding to the next.

---

## How to Use This Plan

1. **Start a loop** by giving the agent a single task: *"Execute Loop 6 Task 6.1"*
2. **Verify the result** (endpoint responds, hook works, component renders, etc.)
3. **Only then proceed** to the next task — no skipping, no batching tasks without confirmation

---

## Loop 6 — OS Storage & State Persistence (P0)

> **Goal:** Give generated apps a secure, persistent key-value store backed by Redis, replacing the blocked `localStorage`.

---

### Task 6.1 — Backend App Data Endpoints

**What to build:**
- Create `kernel/src/app-data/app-data.controller.ts` with two endpoints:
  - `GET /api/app-data/:appId/:key` — read a stored value from Redis
  - `PUT /api/app-data/:appId/:key` — write a value to Redis
- Create `kernel/src/app-data/app-data.module.ts` and register it in `AppModule`
- Redis key schema: `gamma:app-data:<safeAppId>:<safeKey>` → JSON string
- Input sanitization:
  - `safeAppId = appId.replace(/[^a-z0-9-]/gi, '')`
  - `safeKey = key.replace(/[^a-z0-9_-]/gi, '')`
- Enforce limits:
  - Max value size: 64 KB per key (`JSON.stringify(value).length > 65536` → 400 Bad Request)
  - Max keys per app: 50 (check via `KEYS gamma:app-data:<appId>:*` before write → 429 if exceeded)
- `GET` returns `{ value: <T> | null }` — null if key doesn't exist
- `PUT` accepts `{ value: <T> }` body

**Acceptance criteria:**
- `PUT /api/app-data/weather/selectedCities` with `{ value: ["Hanoi", "Kyiv"] }` → `{ ok: true }`
- `GET /api/app-data/weather/selectedCities` → `{ value: ["Hanoi", "Kyiv"] }`
- `GET /api/app-data/weather/nonexistent` → `{ value: null }`
- `PUT` with 100 KB body → `400 Bad Request`
- `PUT` when app already has 50 keys → `429 Too Many Requests`
- `GET /api/app-data/../../etc/passwd/x` → sanitized to `etcpasswd` (harmless)
- TypeScript compiles with 0 errors

**Key spec reference:** Phase 3 §8.2–§8.5 (App Storage API)

**Files to create/update:**
```
kernel/src/app-data/
├── app-data.controller.ts    ← NEW
└── app-data.module.ts        ← NEW
kernel/src/app.module.ts      ← import AppDataModule
```

---

### Task 6.2 — Frontend OS Hook & Vite Alias

**What to build:**
- Create `web/hooks/useAppStorage.ts` — the `useAppStorage<T>(appId, key, initial)` hook:
  - On mount: `GET /api/app-data/:appId/:key`, hydrate state or use `initial`
  - On change: debounced `PUT` (500ms) to persist
  - Returns `[value, setValue, { loading, error }]`
- Create `web/hooks/os-api.ts` — barrel export: `export { useAppStorage } from './useAppStorage'`
- Update `web/vite.config.ts` — add `resolve.alias`: `'@gamma/os'` → `path.resolve(__dirname, 'hooks/os-api.ts')`
- The hook must auto-detect API base URL (localhost vs Tailscale hostname, same pattern as KernelMonitorApp)

**Acceptance criteria:**
- `import { useAppStorage } from '@gamma/os'` resolves without errors in any `.tsx` file under `web/`
- Create a test component that uses `useAppStorage('test', 'counter', 0)` → value persists across page reloads
- Debounce: rapid `setValue` calls within 500ms → only one `PUT` request fires
- `loading` is `true` during initial fetch, `false` after
- `error` is `null` on success, contains error message on failure
- After a simulated network failure, a subsequent successful `GET`/`PUT` clears `error` back to `null` (no stale error state)
- Rapid mount/unmount of the test component while calling `setValue` does not produce React warnings about state updates on unmounted components (debounce timer is correctly cleaned up)
- Hook works both when the kernel is exposed directly on `http://localhost:3001` and when it is served via same-origin proxy using relative `/api/...` paths (API base resolution matches Phase 3 §8.4 v1.4)
- `npm run dev` (Vite) starts without alias resolution errors

**Key spec reference:** Phase 3 §8.4 (Hook Implementation), §8.6 (Module Resolution)

**Files to create/update:**
```
web/hooks/
├── useAppStorage.ts    ← NEW
└── os-api.ts           ← NEW
web/vite.config.ts      ← update resolve.alias
```

---

## Loop 7 — App Bundle & Scaffold Pipeline (P0)

> **Goal:** Upgrade the scaffold pipeline from single-file apps to full Bundles (code + context + agent persona).

---

### Task 7.1 — Scaffold Bundle Generation

**What to build:**
- Update `ScaffoldRequest` interface (in `packages/gamma-types/index.ts`) to add:
  - `contextDoc?: string` — app context document
  - `agentPrompt?: string` — App Owner agent persona
- Update `ScaffoldService.scaffold()` to:
  - Create a bundle directory: `web/apps/generated/{appId}/`
  - Write `{PascalAppId}App.tsx` inside the bundle directory (not root of `generated/`)
  - Write `context.md` if `contextDoc` is provided
  - Write `agent-prompt.md` if `agentPrompt` is provided
  - Write assets to `assets/{appId}/` inside the bundle directory
  - All paths via `jailPath()` — no raw `path.join`
- Update `AppRegistryEntry` in Redis to include:
  - `bundlePath: string` — e.g., `"./web/apps/generated/weather/"`
  - `hasAgent: boolean` — `true` if `agentPrompt` was provided
  - `updatedAt: number` — timestamp, used as React key for hot-reload
- Update `modulePath` to point inside the bundle: `"./web/apps/generated/weather/WeatherApp"`
- **v1.3 — PATCH/Merge Semantics:** If `contextDoc` or `agentPrompt` is `undefined` in the request, the existing file on disk MUST be preserved (not deleted, not overwritten with empty). Only `sourceCode` is always required. This is critical for App Owner updates where the agent sends code + context but NOT its own persona.

**Acceptance criteria:**
- `POST /api/scaffold { appId: "weather", sourceCode: "...", contextDoc: "...", agentPrompt: "..." }` → creates:
  - `web/apps/generated/weather/WeatherApp.tsx`
  - `web/apps/generated/weather/context.md`
  - `web/apps/generated/weather/agent-prompt.md`
- `git log` in nested repo shows the commit with all three files
- Redis `gamma:app:registry` → entry includes `bundlePath`, `hasAgent: true`, `updatedAt`
- Scaffolding without `contextDoc` and `agentPrompt` still works (backward compatible)
- Calling scaffold again for the same `appId` updates `updatedAt` (for hot-reload)
- **PATCH test:** Scaffold with all three files, then scaffold again with only `sourceCode` + `contextDoc` (no `agentPrompt`) → `agent-prompt.md` is preserved on disk, unchanged
- **PATCH test:** Scaffold with only `sourceCode` (no `contextDoc`, no `agentPrompt`) → both `.md` files preserved
- All existing tests still pass, 0 TS errors

**Key spec reference:** Phase 3 §2.2 (Bundle Structure), §2.5 (Bundle Registration), §5.2–§5.4 (Updated Pipeline)

**Files to create/update:**
```
packages/gamma-types/index.ts                    ← update ScaffoldRequest
kernel/src/scaffold/scaffold.service.ts           ← update scaffold()
kernel/src/scaffold/scaffold.service.spec.ts      ← update tests
```

---

### Task 7.2 — Unscaffold Deep Cleanup

**What to build:**
- Update `ScaffoldService.remove()` to:
  1. Delete the entire bundle directory (`web/apps/generated/{appId}/`) — not just a single `.tsx` file
  2. Delete all Redis keys matching `gamma:app-data:<appId>:*` (user-persisted data)
  3. Kill the App Owner Gateway session immediately: call `sessionsService.remove('app-owner-{appId}')` — don't wait for 24h GC
  4. Git commit the removal, optional auto-push
  5. Remove from `gamma:app:registry`
  6. Broadcast `component_removed`
- `ScaffoldService` needs `SessionsService` injected (update module imports, handle circular dependency if needed via `forwardRef`)

**Acceptance criteria:**
- Scaffold an app with `contextDoc` + `agentPrompt` + assets → delete it → bundle directory fully gone
- `KEYS gamma:app-data:weather:*` → empty after delete
- If an App Owner session was active for the app → Gateway session killed on delete (verify via logs)
- If no App Owner session existed → delete completes without error
- Nested Git log shows removal commit
- SSE broadcasts `component_removed`
- All existing tests pass, 0 TS errors

**Key spec reference:** Phase 3 §5.5 (Unscaffold Cleanup v1.2)

**Files to create/update:**
```
kernel/src/scaffold/scaffold.service.ts           ← update remove()
kernel/src/scaffold/scaffold.module.ts            ← import SessionsModule if needed
kernel/src/scaffold/scaffold.service.spec.ts      ← update tests
```

---

## Loop 8 — UI Foundation & The Global Architect (P1)

> **Goal:** Build the core UI components for agent interaction and wire up the System Architect as the first usable agent.

---

### Task 8.1 — Reusable Chat Component

**What to build:**
- Create `web/components/AgentChat.tsx` — the unified chat interface
- Sub-components:
  - `ChatHeader` — title, status indicator (idle/running/error), accent color
  - `MessageList` — scrollable message history, renders markdown (via `react-markdown` + `remark-gfm`), auto-scroll to bottom
  - `ChatInput` — text input + send button, disabled while agent is running
- Props:
  - `windowId: string`
  - `title: string`
  - `variant: 'fullWindow' | 'embedded'`
  - `accentColor?: string` (default: `#00ff41`)
  - `placeholder?: string`
  - `onComponentReady?: (appId: string) => void`
- `fullWindow` variant: fills entire window, padding, full-height message area
- `embedded` variant: compact, 40% height, bottom-anchored, collapsible
- Style: dark theme consistent with KernelMonitorApp (monospace, `#0a0a0a` background, green accents)
- **UI only in this task** — no SSE/API wiring yet (use mock data for visual testing)

**Acceptance criteria:**
- `<AgentChat windowId="test" title="Test" variant="fullWindow" />` renders a full chat window
- `<AgentChat windowId="test" title="Test" variant="embedded" />` renders a compact bottom panel
- Message list renders user messages (right-aligned) and agent messages (left-aligned)
- Typing indicator shows when `status === "running"`
- Thinking trace renders as collapsible `💭 Thinking` block
- Tool calls render as `🔧 tool_name(args)` / `✅ tool_name → result` inline, with large argument/result payloads truncated to a short preview string (no multi‑KB JSON blobs in the DOM)
- Send button is disabled when input is empty or agent is running
- Auto-scrolls to bottom on new messages
- Markdown in agent messages is rendered using `react-markdown` + `remark-gfm` without `dangerouslySetInnerHTML`
- No TypeScript errors

**Key spec reference:** Phase 3 §4.3–§4.4 (Chat Component)

**Files to create:**
```
web/components/
├── AgentChat.tsx       ← NEW: main component
├── ChatHeader.tsx      ← NEW: title bar + status
├── ChatInput.tsx       ← NEW: input + send button
└── MessageList.tsx     ← NEW: scrollable message area
```

---

### Task 8.2 — Top Menu Bar

**What to build:**
- Create `web/components/MenuBar.tsx`
- Layout: `[Γ Logo] [System Status] [☰ Apps] [💬 Architect]`
- **Γ Logo:** Static text/icon, click → About modal (version, uptime)
- **System Status:** Polls `GET /api/system/health` every 30s
  - 🟢 OK / 🟡 Degraded / 🔴 Error
  - Click → health detail popup (CPU, RAM, Redis, Gateway metrics)
- **☰ Apps:** Opens Launchpad (calls existing `onOpenLaunchpad` callback)
- **💬 Architect:** Opens/focuses the System Architect chat window
- Style: fixed at top, `height: 28px`, dark background, subtle border bottom
- Integrate into `GammaOS.tsx` — render above the desktop/window manager

**Acceptance criteria:**
- Menu bar renders at the top of the screen, above all windows
- System health indicator shows real status from `GET /api/system/health` (or "offline" if backend unreachable)
- Clicking 💬 opens the System Architect window (or focuses it if already open)
- Clicking ☰ opens Launchpad
- Menu bar does not interfere with window dragging/resizing
- No TypeScript errors

**Key spec reference:** Phase 3 §4.1 (Top Menu Bar)

**Files to create/update:**
```
web/components/MenuBar.tsx     ← NEW
web/components/GammaOS.tsx     ← integrate MenuBar
web/store/useOSStore.ts        ← add systemHealth state if needed
```

---

### Task 8.3 — System Architect Integration

**What to build:**
- Wire `<AgentChat windowId="system-architect" variant="fullWindow" />` to live backend:
  - Connect to SSE via `useAgentStream("system-architect")`
  - Send messages via `POST /api/sessions/system-architect/send`
- Create the System Architect session on OS boot:
  - On first load, check if `system-architect` session exists (`GET /api/sessions`)
  - If not, create it: `POST /api/sessions { windowId: "system-architect", appId: "system-architect", sessionKey: "system-architect", agentId: "architect" }`
- Create `docs/agents/system-architect.md` persona file (content from Phase 3 §3.2)
- The Architect window should be a special window type in the OS store — always available via menu bar, cannot be closed (only minimized)

**Acceptance criteria:**
- Click 💬 in menu bar → System Architect chat window opens
- Type a message → it appears in the chat as `user_message`
- If Gateway is connected: agent responds with streaming text
- If Gateway is not connected: message is sent, but no agent response (graceful degradation)
- System Architect session survives F5 (session exists in Redis on page reload)
- Window can be minimized to dock, but not permanently closed
- No TypeScript errors

**Key spec reference:** Phase 3 §3.2 (System Architect Agent), §7.1 (Session Types)

**Files to create/update:**
```
docs/agents/system-architect.md             ← NEW: persona file
web/components/AgentChat.tsx                ← wire to useAgentStream + send API
web/hooks/useAgentStream.ts                 ← NEW or update existing
web/components/GammaOS.tsx                  ← boot session creation
web/store/useOSStore.ts                     ← architect window management
```

---

## Loop 9 — App Owners & Context Injection (P1)

> **Goal:** Give each generated app its own AI assistant, scoped strictly to that app's domain.

---

### Task 9.1 — Backend Context Injection

**What to build:**
- Update `SessionsService.sendMessage()` to detect `app-owner-*` window IDs
- When `windowId` starts with `app-owner-`:
  1. Extract `appId` from the window ID (`app-owner-weather` → `weather`)
  2. Read three files using **`scaffoldService.jailPath()`** (NOT raw `path.join`):
     - `{appId}/agent-prompt.md`
     - `{appId}/context.md`
     - `{appId}/{PascalAppId}App.tsx`
  3. Prepend file contents as system context to the user's message
  4. Forward the enriched message to Gateway
- If any file is missing (e.g., no `agent-prompt.md`), skip it gracefully — don't crash
- `ScaffoldService` must be injected into `SessionsService` (or use a shared `jailPath` utility)

**⚠️ Security:** ALL file reads in this flow MUST use `scaffoldService.jailPath()`. This prevents path traversal attacks where a malicious `appId` like `../../etc` could read system files.

**Acceptance criteria:**
- `POST /api/sessions/app-owner-weather/send { message: "make icons bigger" }` → Gateway receives enriched message containing `agent-prompt.md` + `context.md` + source code + user message
- If `agent-prompt.md` doesn't exist → message sent without persona prefix (no crash)
- If `context.md` or `agent-prompt.md` are missing, the enriched prompt is still constructed from the remaining available files (no crash), and the App Owner agent still responds to the user (graceful degradation)
- `POST /api/sessions/app-owner-../../etc/send` → `appId` sanitized, jailPath blocks traversal
- Regular (non-app-owner) session sends are unaffected
- 0 TS errors

**Key spec reference:** Phase 3 §6.1 (Context Injection), §6.2 (Response Handling)

**Files to create/update:**
```
kernel/src/sessions/sessions.service.ts     ← update sendMessage()
kernel/src/sessions/sessions.module.ts      ← import ScaffoldModule if needed
```

---

### Task 9.2 — Window Manager: AI Assistant Toggle

**What to build:**
- Add ✨ button to the window title bar (`TitleBar.tsx` or `WindowNode.tsx`)
- Button visible only when the app's `AppRegistryEntry.hasAgent === true`
- If `hasAgent` is false: button grayed out with tooltip "No agent configured"
- Click ✨ → toggles the embedded `<AgentChat />` panel at the bottom of the window
- Chat panel occupies 40% of window height, resizable via drag handle
- First click creates the App Owner session lazily:
  - `POST /api/sessions { windowId: "app-owner-{appId}", appId, sessionKey: "app-owner-{appId}", agentId: "app-owner" }`
- Panel state (open/closed) persists in the window's local state (Zustand)

**Acceptance criteria:**
- Scaffold an app with `agentPrompt` → window shows ✨ button in title bar
- Click ✨ → chat panel slides up from bottom of window
- Click ✨ again → chat panel collapses
- App without `agentPrompt` → ✨ button is grayed out, click does nothing
- Chat panel does not overlap with app content — app content area shrinks
- Panel is resizable between 20%–60% of window height
- No TypeScript errors

**Key spec reference:** Phase 3 §4.2 (Window Manager Enhancements)

**Files to create/update:**
```
web/components/TitleBar.tsx         ← add ✨ button
web/components/WindowNode.tsx       ← embedded AgentChat panel
web/store/useOSStore.ts             ← per-window agent panel state
```

---

### Task 9.3 — App Owner Integration & Hot-Reload

**What to build:**
- Wire embedded `<AgentChat />` in `WindowNode` to live backend:
  - SSE via `useAgentStream("app-owner-{appId}")`
  - Send via `POST /api/sessions/app-owner-{appId}/send`
- Implement the **Full Remount** hot-reload strategy:
  - Create `DynamicAppRenderer` component
  - **v1.3 — Vite-safe dynamic import:** Use a strongly-typed template literal anchored to the generated directory: `` import(`../../apps/generated/${appId}/${PascalId}App.tsx?t=${entry.updatedAt}`) ``. Do NOT use `/* @vite-ignore */` or fully dynamic paths — Rollup cannot statically analyze those and will fail in production builds.
  - Render with `<Component key={entry.updatedAt} />` — forces unmount/mount on update
  - On `component_ready` SSE event: update `updatedAt` in app registry store
- Ensure `useAppStorage` hooks in generated apps re-hydrate from Redis on remount (user data survives code updates)
- Handle loading state: show spinner while dynamic import resolves
- Handle error state: show error boundary if component fails to load

**Acceptance criteria:**
- Click ✨ on Weather App → chat opens → type "make background red" → agent updates code → `component_ready` fires → app remounts with new code
- User data persisted via `useAppStorage` survives the remount
- Rapid code updates (multiple `component_ready` events) → each triggers a clean remount, no stale state
- Component load failure → error boundary shows "Failed to load app" instead of blank window
- Dynamic import works with both `default` and named exports
- No TypeScript errors
 - If the app is deleted via unscaffold while its window is open, the window content smoothly transitions to an "Application removed" tombstone placeholder (as defined in the spec), without throwing any unhandled React errors or attempting further dynamic imports for that `appId`

**Key spec reference:** Phase 3 §6.3 (Hot-Reload Strategy), §6.2 (App Owner Response Handling)

**Files to create/update:**
```
web/components/DynamicAppRenderer.tsx     ← NEW: dynamic import + key-based remount
web/components/WindowNode.tsx             ← integrate DynamicAppRenderer + AgentChat
web/store/useOSStore.ts                   ← app registry with updatedAt
web/hooks/useAgentStream.ts               ← ensure it works for app-owner-* sessions
```

---

### Task 9.4 — Agent Tool Scoping

**What to build:**
- Configure OpenClaw/Gateway (or equivalent agent runtime) so that each session type receives only the tools defined for its role in the spec:
  - **System Architect (`windowId: "system-architect"`):** `scaffold`, `unscaffold`, `system_health`, `list_apps`, `read_file` (read-only filesystem access).
  - **App Owner sessions (`windowId: "app-owner-{appId}"`):** `update_app`, `read_context`, `list_assets`, `add_asset` — strictly scoped to their own bundle.
- Ensure that App Owner sessions:
  - Cannot call `scaffold`, `unscaffold`, `system_health`, `list_apps`, or any other global/system tools.
  - Can only modify files and app data inside their own bundle (`{appId}/...`) and `gamma:app-data:{appId}:*`, matching the jailPath and storage constraints from Phase 3.
- Wire tool configuration into the session initialization path:
  - When creating `system-architect` sessions, attach the System Architect toolset.
  - When creating `app-owner-{appId}` sessions, attach the App Owner toolset.

**Acceptance criteria:**
- In Gateway/tooling logs, `system-architect` sessions show access to `scaffold`, `unscaffold`, `system_health`, `list_apps`, and `read_file`, and can successfully call them.
- App Owner sessions (`app-owner-weather`, `app-owner-notes`, etc.) can successfully call `update_app`, `read_context`, `list_assets`, and `add_asset` for their own app.
- Attempts by an App Owner session to call `scaffold` or `system_health` are rejected by the Gateway/tooling layer (clear error or "tool not available"), and no such calls reach the kernel.
- There is no way for an App Owner to use any filesystem or Redis tool to access another app's files or `gamma:app-data:<otherAppId>:*` keys.
- 0 TS/config compile errors for the Gateway/tooling configuration.

**Key spec reference:** Phase 3 §7.2–§7.3 (Gateway Session Management & Tool Scoping)

**Files to create/update:**
```
gateway/agents/system-architect.config.(ts|json)   ← System Architect toolset
gateway/agents/app-owner.config.(ts|json)          ← App Owner toolset (scoped)
kernel/src/sessions/sessions.service.ts            ← ensure session metadata matches tool configs, if needed
```

---

## Dependency Installation Reference

```bash
# Backend (kernel/)
npm install @nestjs/schedule    # already installed in Phase 2 Task 4.4

# Frontend (web/)
npm install react-markdown remark-gfm    # safe markdown rendering for AgentChat MessageList
# No additional deps required for useAppStorage — it uses native fetch, Vite alias uses built-in resolve
```

---

## Verification Checklist

Before marking Phase 3 complete, verify:

- [x] Loop 6: `useAppStorage` persists data across reloads, Vite alias resolves `@gamma/os`
- [x] Loop 7: Scaffold creates full bundles (code + context + persona), unscaffold cleans everything
- [x] Loop 8: AgentChat renders both variants, MenuBar shows health, Architect chat works end-to-end
- [ ] Loop 9: App Owner context injection uses jailPath, ✨ toggle works, hot-reload remounts cleanly
- [ ] Integration: Create an app via Architect → modify it via App Owner → data persists → delete it → all resources cleaned
- [ ] Security: jailPath enforced on all reads/writes, no path traversal possible, no cross-app data access

---

## Reference

| Document | Location |
|---|---|
| Phase 3 Spec v1.4 | `docs/architecture/phase3-frontend.md` |
| Phase 2 Backend Spec v1.6 | `docs/architecture/phase2-backend.md` |
| Phase 2 Implementation Plan | `docs/plans/phase2-implementation.md` |
| This Plan | `docs/plans/phase3-implementation.md` |
| Project README | `README.md` |
