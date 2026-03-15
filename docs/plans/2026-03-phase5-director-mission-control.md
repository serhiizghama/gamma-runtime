# Phase 5: Director — Mission Control & Orchestration

> **Status:** Planning
> **Created:** 2026-03-16
> **Depends on:** Phase 4.2 (Stable Autonomy)

---

## 1. Objective

Move from "blind logs" to a high-level visual orchestration layer. The **Director** is a system application that gives the User real-time visibility into all agent interactions, hierarchy management, and lifecycle controls — the Mission Control Center of the Gamma Runtime.

---

## 2. Data Infrastructure — Global Activity Stream

### 2.1 Decision: Redis Stream `gamma:system:activity`

**Why Redis Stream (not dedicated WebSocket broadcast):**

- Already battle-tested pattern in the codebase (`gamma:sse:*`, `gamma:agent:*:inbox`)
- Persistence + replay for free (`XRANGE` catch-up on reconnect)
- Decoupled producers — any service can `XADD` without knowing who consumes
- SSE controller already does `XREAD BLOCK` multiplexing — we extend, not reinvent

### 2.2 ActivityEvent Schema

```typescript
// packages/gamma-types/index.ts

type ActivityEventKind =
  | 'agent_registered'      // agent joined the registry
  | 'agent_deregistered'    // agent left
  | 'agent_status_change'   // idle→running, running→error, etc.
  | 'message_sent'          // IPC message dispatched
  | 'message_received'      // IPC message consumed
  | 'tool_call_start'       // tool invocation began
  | 'tool_call_end'         // tool invocation resolved (success/error/timeout)
  | 'lifecycle_start'       // agent run started
  | 'lifecycle_end'         // agent run completed
  | 'hierarchy_change'      // supervisor assignment changed
  | 'file_change'           // file modified in jail
  | 'system_event';         // watchdog, rollback, health alert

interface ActivityEvent {
  id: string;                // ULID (assigned by producer)
  ts: number;                // Unix ms
  kind: ActivityEventKind;
  agentId: string;           // Primary actor
  targetAgentId?: string;    // Secondary actor (for IPC, hierarchy)
  windowId?: string;         // If bound to a window
  appId?: string;            // If bound to an app
  toolName?: string;         // For tool_call_start/end
  toolCallId?: string;       // Correlation ID
  payload?: string;          // JSON-stringified extra data
  severity: 'info' | 'warn' | 'error';
}
```

### 2.3 Redis Configuration

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Key | `gamma:system:activity` | Follows existing `gamma:system:*` convention |
| MAXLEN | `~ 5000` (approximate trimming) | ~30 min of high activity |
| Producers | `GatewayWsService`, `AgentRegistryService`, `MessageBusService`, `FileChangeConsumerService`, `ToolWatchdogService` | Instrumented at source |

### 2.4 ActivityStreamService

New module: `apps/gamma-core/src/activity/`

| Method | Purpose |
|--------|---------|
| `emit(event: Omit<ActivityEvent, 'id' \| 'ts'>)` | Assigns ULID + timestamp, `XADD` to stream |
| `read(since?: string, count?: number)` | `XRANGE` wrapper for REST catch-up |
| `subscribe(lastId?: string)` | Async generator wrapping `XREAD BLOCK` (for SSE) |

**Batching:** 50ms flush window (same pattern as `StreamBatcher`) to avoid write storms.

### 2.5 Instrumentation Points

| Service | Event | Trigger |
|---------|-------|---------|
| `AgentRegistryService.register()` | `agent_registered` | Agent joins |
| `AgentRegistryService.deregister()` | `agent_deregistered` | Agent leaves |
| `AgentRegistryService.updateStatus()` | `agent_status_change` | Status transition (debounced 1s) |
| `GatewayWsService` tool_call handler | `tool_call_start` | Tool invocation begins |
| `GatewayWsService` tool_result handler | `tool_call_end` | Tool invocation resolves |
| `GatewayWsService` lifecycle handlers | `lifecycle_start/end` | Agent run boundaries |
| `MessageBusService.send/broadcast()` | `message_sent` | IPC dispatch |
| `FileChangeConsumerService` | `file_change` | File modified in jail |
| `ToolWatchdogService` timeout handler | `tool_call_end` (severity: error) | Tool timeout |

> **Note:** `thinking` events are NOT published to activity stream (too noisy). They remain in per-window SSE only.

---

## 3. Backend — Orchestration API

### 3.1 Hierarchy Data Model

**New Redis structures:**

```
gamma:hierarchy:supervisors       Hash  { agentId → supervisorAgentId }
gamma:hierarchy:children:{id}     Set   { childAgentId, ... }
```

**New type:**

```typescript
interface AgentNode {
  agentId: string;
  role: AgentRole;
  status: AgentStatus | 'offline';
  appId?: string;
  supervisorId: string | null;    // null = root node
  childrenIds: string[];
  capabilities: string[];
  lastHeartbeat: number;
}
```

**Default hierarchy (auto-assigned on registration):**

| Agent | Default Supervisor |
|-------|--------------------|
| `system-architect` | `null` (root) |
| `inspector` | `system-architect` |
| `app-owner-*` | `system-architect` |

### 3.2 HierarchyService

Location: `apps/gamma-core/src/messaging/hierarchy.service.ts`

| Method | Purpose |
|--------|---------|
| `getTree(): AgentNode[]` | Full hierarchy as flat list (UI builds the tree) |
| `setSupervisor(agentId, supervisorId)` | Reassign parent. Validates no cycles. Emits `hierarchy_change` |
| `getChildren(agentId): string[]` | Direct reports |
| `getSupervisor(agentId): string \| null` | Immediate parent |
| `onAgentRegistered(agentId, role)` | Auto-assign default supervisor |
| `onAgentDeregistered(agentId)` | Remove from tree, orphan children → parent's parent |

### 3.3 Orchestration REST Controller

Location: `apps/gamma-core/src/orchestration/orchestration.controller.ts`

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/orchestration/tree` | GET | Returns full `AgentNode[]` hierarchy |
| `/api/orchestration/hierarchy` | PATCH | `{ agentId, supervisorId }` — reassign supervisor |
| `/api/orchestration/spawn` | POST | `{ role, appId?, config? }` — spawn new agent session |
| `/api/orchestration/agents/:id/pause` | POST | Suspend agent message consumption |
| `/api/orchestration/agents/:id/resume` | POST | Resume agent message consumption |
| `/api/orchestration/agents/:id/terminate` | POST | Graceful shutdown (abort + deregister) |
| `/api/orchestration/activity` | GET | `?since=&limit=` — paginated activity events |

All endpoints guarded by `SystemAppGuard`.

### 3.4 Hierarchy Enforcement in Prompts

`ContextInjectorService.getLiveContext()` appends a new `[HIERARCHY]` block:

```
[HIERARCHY]
Your supervisor: system-architect
Your direct reports: app-owner-notes, app-owner-weather
You may delegate tasks to your direct reports via send_message.
You must report errors and completion to your supervisor.
[/HIERARCHY]
```

This is **soft enforcement** via prompt — not hard enforcement. Hard enforcement (blocking unauthorized IPC) is deferred to Phase 6 (Security & Permission Manager).

---

## 4. Frontend — Director App UI

### 4.1 Layout

Location: `apps/gamma-ui/apps/system/director/DirectorApp.tsx`

```
┌─────────────────────────────────────────────────────────────┐
│  Director — Mission Control                    [filters] [⚙]│
├──────────┬──────────────────────────┬───────────────────────┤
│          │                          │                       │
│  AGENT   │     THE PULSE            │   AGENT DETAIL        │
│  TREE    │  (Activity Feed)         │   (Inspector)         │
│          │                          │                       │
│  ┌──┐    │  ● architect → tool_call │   agent-id: ...       │
│  │SA│    │    fs_read /private/...  │   status: running     │
│  └┬─┘    │  ● app-owner-notes →    │   supervisor: SA      │
│   ├─►INS │    lifecycle_start       │   tokens: 12.4k in    │
│   ├─►AO1 │  ● inspector →          │                       │
│   └─►AO2 │    message_sent → AO1   │   [Pause] [Kill]      │
│          │    "Review: 3 issues"    │   [Load Context]      │
│          │                          │   [Reassign ▾]        │
│          │                          │                       │
├──────────┴──────────────────────────┴───────────────────────┤
│  SA: idle │ INS: idle │ AO1: running │ AO2: error   │ 4 agt│
└─────────────────────────────────────────────────────────────┘
```

Three-column layout with collapsible left sidebar. Bottom status bar.

### 4.2 State Management

New Zustand store: `apps/gamma-ui/store/useDirectorStore.ts`

```typescript
interface DirectorStore {
  // Data
  agents: AgentNode[];
  activityFeed: ActivityEvent[];
  selectedAgentId: string | null;

  // Filters
  kindFilter: ActivityEventKind[] | null;   // null = show all
  agentFilter: string[] | null;             // null = show all
  severityFilter: 'all' | 'warn' | 'error';

  // UI state
  feedPaused: boolean;       // pause auto-scroll for reading history
  sidebarCollapsed: boolean;

  // Actions
  setAgents: (agents: AgentNode[]) => void;
  appendActivity: (events: ActivityEvent[]) => void;
  selectAgent: (id: string | null) => void;
  setKindFilter: (kinds: ActivityEventKind[] | null) => void;
  toggleFeedPaused: () => void;
  toggleSidebar: () => void;
}
```

### 4.3 SSE Integration — Activity Stream Hook

New hook: `apps/gamma-ui/hooks/useActivityStream.ts`

- New SSE endpoint: `GET /api/stream/activity?lastEventId=`
- Same `XREAD BLOCK` pattern as per-window streams
- Gap protection via `lastEventId` (existing pattern)
- Client-side ring buffer: max **500 events** (older ones evicted from store)

```typescript
function useActivityStream(opts?: { paused?: boolean }): {
  events: ActivityEvent[];
  connected: boolean;
}
```

### 4.4 Left Sidebar — Agent Tree

Component: `AgentTree.tsx`

- Renders `AgentNode[]` as an indented tree (hierarchy is strictly tree-shaped)
- Each node: role icon + agentId (truncated) + status dot (same colors as `AgentMonitorApp`)
- Click → selects agent → populates right inspector pane
- Drag-and-drop for supervisor reassignment → calls `PATCH /api/orchestration/hierarchy`
- Collapses on narrow windows
- Refreshes via `agent_registry_update` SSE events (already broadcast by `AgentRegistryService`)

### 4.5 Center Pane — The Pulse (Activity Feed)

Component: `ActivityPulse.tsx`

**Visual encoding by `kind`:**

| Kind | Icon | Color Accent | Detail Text |
|------|------|-------------|-------------|
| `tool_call_start` | wrench | `--color-accent-warning` | `agentId → toolName(args preview)` |
| `tool_call_end` | check / x | green / red | `toolName completed in Xms` |
| `message_sent` | arrow-right | `--color-accent-info` | `from → to: subject` |
| `lifecycle_start` | play | green | `agentId run started` |
| `lifecycle_end` | stop | neutral | `agentId run ended (reason, tokens)` |
| `agent_status_change` | circle | status color | `agentId: idle → running` |
| `file_change` | file | neutral | `appId: filename.tsx modified` |
| `system_event` | alert | red / yellow | severity-based message |

**Feed behavior:**

- Auto-scrolls to bottom unless `feedPaused` is true
- Clicking an event with `agentId` selects that agent in the tree
- Filter bar at top: kind pills (toggle), agent dropdown, severity selector
- **Virtualized list** (`react-window` or equivalent) for 500+ items
- Timestamps as relative ("2s ago") with absolute on hover

### 4.6 Right Pane — Agent Inspector

Component: `AgentInspector.tsx`

Extends patterns from existing `AgentMonitorApp` Inspector:

- **Header:** agentId, role badge, appId, windowId
- **Status:** status dot + label, supervisor link (clickable → selects in tree), children count
- **Telemetry:** token usage (in/out/cache), run count, last active, context % used
- **Controls:**
  - **Pause** — `POST /api/orchestration/agents/:id/pause`
  - **Resume** — `POST /api/orchestration/agents/:id/resume`
  - **Terminate** — `POST /api/orchestration/agents/:id/terminate` (with confirmation)
  - **Load Context** — `GET /api/sessions/:key/context` (existing endpoint)
  - **Reassign Supervisor** — dropdown → `PATCH /api/orchestration/hierarchy`
- **Mini Activity Feed:** last 50 events filtered to this agent only

### 4.7 Status Bar

Component: `DirectorStatusBar.tsx`

- Agent count by status: `SA: idle | INS: idle | AO1: running | AO2: error`
- Total token spend across all agents
- Activity stream connection indicator (green dot / red dot)
- Event throughput: `~12 events/s`

---

## 5. Security & Performance

### 5.1 High-Frequency Stream Handling

**Problem:** A busy system could generate 50+ events/sec.

**Backend mitigations:**

| Strategy | Detail |
|----------|--------|
| Batched XADD | `ActivityStreamService` buffers events for 50ms before flushing (same as `StreamBatcher`) |
| MAXLEN ~ 5000 | Approximate trimming prevents unbounded Redis growth |
| Selective emit | `thinking` events excluded from activity stream (too noisy) |
| Status dedup | `agent_status_change` debounced — skip if status unchanged within 1s |

**Frontend mitigations:**

| Strategy | Detail |
|----------|--------|
| Virtualized list | Only render visible rows (`react-window`) |
| Client ring buffer | Cap at 500 events in Zustand store |
| Throttled renders | Reuse `useThrottledValue(150ms)` for the feed array |
| Pause on scroll-up | Don't append new events to visible area while user reads history |

### 5.2 Security

| Control | Detail |
|---------|--------|
| Auth | All orchestration endpoints behind `SystemAppGuard` (`x-gamma-system: true`) |
| Cycle prevention | `setSupervisor()` validates no cycles, no self-supervision, no orphaning root |
| Spawn limits | Max 10 agents total (configurable). Prevents runaway creation |
| Role validation | Spawn requires valid `AgentRole` + `appId` for app-owner role |
| Read-only feed | Activity stream has no write path from frontend |

### 5.3 Graceful Degradation

- If `gamma:system:activity` stream is unavailable, services continue normally (`emit` is fire-and-forget with try/catch)
- Director shows "Activity stream disconnected" banner and falls back to polling agent registry
- SSE reconnection uses existing gap protection pattern (`lastEventId`)

---

## 6. Implementation Order

| Step | Scope | Module | Depends On |
|------|-------|--------|------------|
| **1** | Types | `gamma-types`: Add `ActivityEvent`, `ActivityEventKind`, `AgentNode` | — |
| **2** | Redis | `redis.constants.ts`: Add `SYSTEM_ACTIVITY` key | — |
| **3** | Backend | `ActivityStreamService` + `ActivityModule` | 1, 2 |
| **4** | Backend | Instrument existing services with `emit()` calls | 3 |
| **5** | Backend | `HierarchyService` (Redis Hash/Set backed) | 1 |
| **6** | Backend | `OrchestrationController` (REST endpoints) | 3, 5 |
| **7** | Backend | SSE endpoint for activity stream | 3 |
| **8** | Backend | Extend `ContextInjectorService` with `[HIERARCHY]` block | 5 |
| **9** | Frontend | `useDirectorStore` (Zustand) | 1 |
| **10** | Frontend | `useActivityStream` hook (SSE consumer) | 7, 9 |
| **11** | Frontend | `DirectorApp` shell + layout + app registry entry | 9 |
| **12** | Frontend | `AgentTree` component | 9, 6 |
| **13** | Frontend | `ActivityPulse` component (the feed) | 10 |
| **14** | Frontend | `AgentInspector` component (detail pane + controls) | 6, 9 |
| **15** | Frontend | `DirectorStatusBar` | 9, 10 |
| **16** | Polish | Filters, drag-and-drop reassignment, keyboard shortcuts | 12–15 |

**Scope:** ~15 files new, ~8 files modified. Heaviest work: Step 4 (instrumenting existing services) and Step 13 (activity feed with virtualization).

---

## 7. Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Redis Stream over WS broadcast | Persistence, replay, decoupled producers — matches existing codebase patterns |
| Flat `AgentNode[]` over nested tree | Simpler serialization, UI builds tree from `supervisorId` pointers |
| Soft hierarchy enforcement (prompt) | Hard enforcement deferred to Phase 6 Security. Prompt-based is sufficient for cooperative agents |
| Separate Zustand store | Director is a complex app — isolating state prevents bloating the global `useGammaStore` |
| No `thinking` in activity stream | Too noisy (hundreds of events per run). Stays in per-window SSE where it belongs |
| 500-event client ring buffer | Balances memory with useful history. Older events available via REST pagination |
