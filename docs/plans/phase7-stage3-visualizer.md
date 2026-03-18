# Phase 7 — Stage 3: Pipeline Visualizer (Syndicate Map)

> **Status:** Draft v3 (Deep Trace update)
> **Depends on:** Stage 1 (Agent Genesis) ✅, Stage 2 (IPC & Reporting) ✅
> **Target app:** `gamma-ui` — new system app `SyndicateMapApp`

---

## 1. Architecture Overview

### What already exists

| Layer | Asset | Location |
|-------|-------|----------|
| **Types** | `ActivityEvent`, `ActivityEventKind`, `AgentRegistryEntry`, `AgentRole`, `AgentStatus`, `MemoryBusEntry` | `@gamma/types` (`packages/gamma-types/index.ts`) |
| **Activity Stream** | Batched Redis Stream writer + REST catch-up + SSE live stream | `activity-stream.service.ts`, `@Sse('activity/stream')` in `system.controller.ts` |
| **Memory Bus** | Per-agent hierarchical trace (thinking → tool_call → tool_result) with `stepId`/`parentId` links | `gamma:memory:bus` Redis Stream, written by `gateway-ws.service.ts` |
| **Per-window SSE** | Real-time per-agent events (thinking, assistant, tools, lifecycle) | `gamma:sse:<windowId>` Redis Stream, read by `sse.controller.ts` |
| **Agent Registry** | Redis-backed directory with `supervisorId`, `status`, `role`, heartbeat, SSE broadcast (`agent_registry_update`) | `agent-registry.service.ts` |
| **Agent State DB** | SQLite `agents` table: `id`, `name`, `role_id`, `avatar_emoji`, `ui_color`, `status`, `workspace_path` | `agent-state.repository.ts` |
| **Task State DB** | SQLite `tasks` table: `id`, `source_agent_id`, `target_agent_id`, `status`, `payload`, `result` | `task-state.repository.ts` |
| **SSE Hook** | `useSecureSse(path, onMessage, ...)` — ticket-auth, reconnect | `hooks/useSecureSse.ts` |
| **Throttle** | `useThrottledValue(value, delayMs, flushSignal)` | `hooks/useThrottledValue.ts` |
| **Session Registry** | `useSessionRegistry()` — live SSE + REST catch-up | `hooks/useSessionRegistry.ts` |
| **Window Manager** | Zustand store, `openWindow()`, app registry, desktop | `store/useGammaStore.ts` |
| **Stream Batcher** | 50ms debounce for thinking/assistant_delta SSE events | `sse/stream-batcher.ts` |
| **Vite proxy** | `/api → localhost:3001`, SSE & WS passthrough | `vite.config.ts` |

### What does NOT exist yet

- React Flow or any graph visualization library
- Dagre / ELK layout engine
- `SyndicateMapApp` system app
- `useActivityStream` hook (live activity events for the visualizer)
- `useAgentGraph` hook (transforms registry + state into React Flow nodes/edges)
- Agent detail sidebar panel with Trace tab
- Edge animation for IPC events
- Layout persistence (localStorage)
- Level-of-detail zoom rendering
- Agent cluster/grouping logic
- Per-agent trace REST endpoint (Memory Bus query)
- Per-agent trace SSE endpoint (filtered per-window stream)
- `TraceTerminal` component for deep agent debugging

### Logging Strategy: Breadth vs. Depth

The Syndicate Map implements a deliberate **two-tier observability model**:

```
┌──────────────────────────────────────────────────────────┐
│                      BREADTH                              │
│            Global Activity Stream (The Pulse)             │
│                                                          │
│  Source: ActivityStreamService → gamma:system:activity    │
│  Events: lifecycle, IPC, status changes, tool starts     │
│  Scope:  ALL agents, summarized, max 5000 events         │
│  UI:     Map canvas animations + Director "Pulse" feed   │
│  Load:   Always-on SSE, shared across all consumers      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│                       DEPTH                               │
│            Per-Agent Trace (The Drill-Down)               │
│                                                          │
│  Source: Memory Bus → gamma:memory:bus (hierarchical)     │
│        + Per-window SSE → gamma:sse:<windowId> (live)     │
│  Events: thinking content, tool args/results (FULL),      │
│          assistant output, reasoning chains               │
│  Scope:  ONE agent, full detail, on-demand only           │
│  UI:     TraceTerminal tab in AgentDetailPanel sidebar    │
│  Load:   Fetched/streamed ONLY when user opens Trace tab  │
└──────────────────────────────────────────────────────────┘
```

**Critical rule:** Deep trace data (thinking blocks, full tool arguments, reasoning chains) is **never** sent to the global Activity Stream. The Activity Stream captures only high-level event markers with truncated payloads (max 200 chars). Full content lives in the Memory Bus and per-window SSE streams, consumed on-demand.

### Data flow

```
┌────────────────────────────────────────────────────────────┐
│                    gamma-core (NestJS)                      │
│                                                            │
│  ┌─ BREADTH (always-on) ─────────────────────────────────┐ │
│  │                                                       │ │
│  │  AgentRegistryService ──► SSE broadcast ───────────┐  │ │
│  │    (Redis Hash)          agent_registry_update      │  │ │
│  │                                                     │  │ │
│  │  ActivityStreamService ──► SSE stream ──────────────┤  │ │
│  │    (Redis Stream)         /api/system/activity/...  │  │ │
│  └─────────────────────────────────────────────────────┘  │ │
│                                                            │ │
│  ┌─ DEPTH (on-demand) ───────────────────────────────────┐ │
│  │                                                       │ │
│  │  Memory Bus ──► REST ──────────────────────────────┤  │ │
│  │    (Redis Stream)   GET /api/agents/:id/trace      │  │ │
│  │                                                     │  │ │
│  │  Per-window SSE ──► SSE stream ────────────────────┤  │ │
│  │    (Redis Stream)    /api/agents/:id/trace/stream  │  │ │
│  └─────────────────────────────────────────────────────┘  │ │
│                                                            │ │
│  ┌─ STATE (REST) ────────────────────────────────────────┐ │
│  │  AgentStateRepository ──► GET /api/agents             │ │
│  │  TaskStateRepository  ──► GET /api/agents/:id/tasks   │ │
│  │  Workspace FS         ──► GET /api/agents/:id/soul    │ │
│  └───────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────┐
│                    gamma-ui (React)                         │
│                                                            │
│  useAgentGraph()                                           │
│    ├── REST: GET /api/agents (initial load)                │
│    ├── SSE:  agent_registry_update (live status)           │
│    ├── Layout: dagre (auto) OR localStorage (manual)       │
│    └── output: { nodes, edges, layoutMode, zoomLevel }     │
│                                                            │
│  useActivityStream()  [BREADTH — always-on]                │
│    ├── SSE:  /api/system/activity/stream                   │
│    └── output: ActivityEvent[] (ring buffer, last 200)     │
│                                                            │
│  useAgentTrace()  [DEPTH — on-demand, per-agent]           │
│    ├── REST: GET /api/agents/:id/trace (historical)        │
│    ├── SSE:  /api/agents/:id/trace/stream (live tail)      │
│    └── output: TraceEntry[] (hierarchical execution tree)  │
│                                                            │
│  SyndicateMapApp                                           │
│    ├── <MapToolbar> (layout toggle, fit-view, etc.)        │
│    ├── <ReactFlow> canvas                                  │
│    │   ├── <AgentNode> (custom node w/ LOD + task badge)   │
│    │   ├── <AgentClusterNode> (collapsed group node)       │
│    │   ├── <IpcEdge> (SmoothStep, animated)                │
│    │   └── dagre auto-layout (when enabled)                │
│    └── <AgentDetailPanel> (sidebar)                        │
│        ├── Tab: Soul                                       │
│        ├── Tab: Tasks (REST-backed history)                │
│        ├── Tab: Activity (high-level events)               │
│        └── Tab: Trace (deep execution log, on-demand)      │
└────────────────────────────────────────────────────────────┘
```

---

## 2. New Dependencies

```jsonc
// apps/gamma-ui/package.json — additions
{
  "@xyflow/react": "^12",       // React Flow v12 (renamed from reactflow)
  "@dagrejs/dagre": "^1"        // Hierarchical layout engine
}
```

**Why dagre over ELK:**
- Our hierarchy is a simple tree (`supervisorId` → parent). Dagre handles trees natively with `rankdir: 'TB'`.
- ELK is heavier (~200 KB gzipped) and designed for complex constraint graphs we don't need.
- Dagre layout runs in <5ms for 50 nodes — no web worker required.

**No xterm.js needed for TraceTerminal** — the existing codebase already has xterm.js in `TerminalApp`, but the trace viewer is a read-only log display, not an interactive terminal. A simple monospace `<pre>` with auto-scroll is sufficient and avoids the xterm.js bundle cost (~300 KB) for a non-interactive use case. The DirectorApp's "Pulse" feed already demonstrates this pattern effectively.

---

## 3. Component Hierarchy

```
apps/system/syndicate-map/
├── SyndicateMapApp.tsx          # Main app shell (registered in INSTALLED_APPS)
├── components/
│   ├── AgentNode.tsx            # Custom React Flow node (LOD-aware, task badge)
│   ├── AgentClusterNode.tsx     # Collapsed group node for large subtrees
│   ├── IpcEdge.tsx              # Custom animated SmoothStep edge
│   ├── MapToolbar.tsx           # Layout toggle, fit-view, zoom controls
│   ├── AgentDetailPanel.tsx     # Right sidebar on node click (tabbed)
│   ├── ActivityFeed.tsx         # Filtered high-level event log (Breadth)
│   ├── TraceTerminal.tsx        # Deep per-agent execution log (Depth)
│   └── TaskList.tsx             # Full task history for selected agent
├── hooks/
│   ├── useAgentGraph.ts         # Registry → React Flow nodes/edges + layout
│   ├── useActivityStream.ts     # SSE activity stream consumer (Breadth)
│   ├── useAgentTrace.ts         # Per-agent trace consumer (Depth, on-demand)
│   └── useLayoutPersistence.ts  # localStorage read/write for manual positions
├── lib/
│   ├── layout.ts                # dagre wrapper (pure function)
│   └── clustering.ts            # Subtree collapse logic
└── types.ts                     # Local types (AgentNodeData, TraceEntry, LayoutMode, etc.)
```

---

## 4. Detailed Component Specs

### 4.1 `AgentNode` — Custom React Flow Node

Renders one agent on the canvas using data from both **SQLite** (identity) and **Redis** (live status). Implements **Level of Detail (LOD)** — rendering complexity scales with zoom level.

```typescript
interface AgentNodeData {
  // From SQLite (agents table) — loaded once via REST
  agentId: string;
  name: string;
  roleId: string;             // e.g. "dev/senior-developer"
  avatarEmoji: string;        // e.g. "🧠"
  uiColor: string;            // e.g. "#6366F1"

  // From Redis (agent registry) — updated live via SSE
  status: AgentStatus | 'offline';
  role: AgentRole;            // architect | app-owner | daemon

  // Task load (updated via SSE activity events + periodic REST refresh)
  inProgressTaskCount: number; // count of in_progress tasks

  // Animation state (local, from activity events)
  pulse: boolean;             // true during IPC send/receive flash
}
```

**Visual design:**
- **Border color:** `uiColor` from the role manifest
- **Glow effect:** `box-shadow: 0 0 12px ${uiColor}40` when status is `running`
- **Status indicator:** Small circle (top-right corner)
  - `IDLE` → green (`#22C55E`)
  - `RUNNING` → pulsing amber (`#F59E0B`)
  - `OFFLINE` → gray (`#6B7280`)
  - `CORRUPTED` / `error` → red (`#EF4444`)
- **Avatar:** Large emoji centered
- **Labels:** `name` (bold) and `role` badge below
- **Task badge** (bottom-right corner):
  - Displays `inProgressTaskCount` as a numeric pill
  - Hidden when count is `0`
  - Color: default accent (`#6366F1`) when 1–3
  - Color: danger red (`#EF4444`) + subtle pulse animation when > 3 (overload indicator)
  - Tooltip on hover: "N tasks in progress"

**Wrap with `React.memo`** — re-renders only when `data` reference changes.

#### Level of Detail (LOD) Strategy

The `AgentNode` renders differently based on the current React Flow viewport zoom level. The zoom value is read from `useStore(selector)` (React Flow internal store) and compared against two thresholds.

| Zoom Range | LOD Tier | What Renders |
|------------|----------|--------------|
| `zoom < 0.45` | **Minimal** | Colored circle (fill = `uiColor`) + status dot. No text, no badge. Node size shrinks to 40x40. Cheapest paint. |
| `0.45 <= zoom < 0.75` | **Compact** | Avatar emoji + status dot + task badge (if > 0). No name/role labels. Node size 80x80. |
| `zoom >= 0.75` | **Full** | Avatar, name, role badge, status dot, task badge, glow. Full 200x100 node. |

**Implementation:** A single component with early returns — not three separate components. The zoom value is read via `useStore((s) => s.transform[2])` and compared in the render body. This avoids registering per-node viewport listeners.

```tsx
const AgentNode = React.memo(function AgentNode({ data }: NodeProps<AgentNodeData>) {
  const zoom = useStore((s) => s.transform[2]);

  if (zoom < 0.45) return <MinimalDot data={data} />;
  if (zoom < 0.75) return <CompactCard data={data} />;
  return <FullCard data={data} />;
});
```

The `useStore` selector is stable (index access), so this does **not** cause re-renders on pan — only on zoom change.

### 4.2 `IpcEdge` — Custom Animated Edge (SmoothStep)

Connects agents via `supervisorId` relationships. Uses **SmoothStep** edge type for clean right-angle routing that avoids visual spaghetti in dense hierarchies.

```typescript
interface IpcEdgeData {
  animated: boolean;          // true when IPC event is active
  particleColor: string;      // source agent's uiColor
  direction: 'down' | 'up';  // delegation vs. report
}
```

**Why SmoothStep over default Bezier:**
- Bezier curves overlap and merge visually when multiple edges share similar start/end positions (common in star topologies where 5+ agents share one supervisor).
- SmoothStep routes edges in axis-aligned segments with rounded corners, creating clear visual separation even in dense areas.
- React Flow's `<SmoothStepEdge>` provides the `borderRadius` prop for corner rounding (default 5px, we use 8px).

**Animation approach:**
- Default: static, subtle dashed stroke (`strokeDasharray: "6 4"`, `opacity: 0.4`)
- On `ipc_message_sent`: 1.5s CSS animation — a colored dot traveling along the SVG path (uses `offset-path` + `offset-distance`). Edge opacity rises to 1.0 during animation.
- On `ipc_task_completed`: target node flashes green border for 1s
- On `ipc_task_failed`: target node flashes red border for 1s

**Edge source/target:** `supervisorId → agentId` (always top-down in dagre layout).

### 4.3 `AgentClusterNode` — Collapsed Group Node

When a single supervisor has **more than 10 direct children**, the subtree is eligible for automatic clustering to reduce visual clutter.

```typescript
interface AgentClusterData {
  supervisorId: string;
  childCount: number;
  children: AgentNodeData[];    // full data, used when expanding
  roleBreakdown: Record<AgentRole, number>; // e.g. { daemon: 8, 'app-owner': 3 }
  statusSummary: Record<string, number>;    // e.g. { running: 5, idle: 6 }
  collapsed: boolean;
}
```

**Visual design:**
- Stacked card appearance (3 overlapping cards offset by 4px)
- Shows: supervisor's emoji, `"12 agents"` label, mini status pie (colored dots proportional to status breakdown)
- Click: toggles `collapsed` — expands the cluster inline, re-runs dagre layout for that subtree
- Double-click: opens supervisor in `AgentDetailPanel`

**Cluster threshold:** configurable via `CLUSTER_THRESHOLD = 10` constant. Clusters are computed in `lib/clustering.ts` as a pure function before layout.

```typescript
// lib/clustering.ts
interface ClusterResult {
  visibleNodes: Node[];       // includes AgentClusterNode where collapsed
  hiddenNodeIds: Set<string>; // nodes inside collapsed clusters
  visibleEdges: Edge[];       // edges with hidden endpoints removed
}

export function applyClustering(
  nodes: Node<AgentNodeData>[],
  edges: Edge[],
  expandedClusters: Set<string>,  // supervisorIds the user has expanded
  threshold?: number,              // default: 10
): ClusterResult;
```

### 4.4 `AgentDetailPanel` — Sidebar

Opens on node click. Uses the existing sidebar pattern from `ArchitectWindow`.

**Tab layout:**

| Tab | Label | Data Source | Load Behavior |
|-----|-------|-------------|---------------|
| **Soul** | `Soul` | `GET /api/agents/:id/soul` | Fetch once on agent select |
| **Tasks** | `Tasks (N)` | `GET /api/agents/:id/tasks` (SQLite) | Fetch on tab open, auto-refresh 10s |
| **Activity** | `Activity` | `GET /api/system/activity?agentId=X` + live SSE tail | REST catch-up + live append |
| **Trace** | `Trace` | `GET /api/agents/:id/trace` + SSE `/api/agents/:id/trace/stream` | **On-demand only** — fetched when tab selected |

**Tab details:**

1. **Soul** — Avatar, name, role badge, status indicator, `uiColor` accent bar. SOUL.md content (first 2000 chars) rendered as markdown.

2. **Tasks** — `TaskList` component, **REST-backed from SQLite** (not the ephemeral ring buffer):
   - Fetched via `GET /api/agents/:id/tasks` (returns ALL tasks, not just active)
   - Sub-tabs: **Active** (`pending` + `in_progress`) | **Completed** | **Failed**
   - Each task row: `taskId` (truncated), source agent name, status badge, `created_at` relative time, payload summary (first 120 chars)
   - Auto-refreshes every 10s while panel is open (or on `ipc_task_completed`/`ipc_task_failed` activity event for this agent)

3. **Activity** — `ActivityFeed` component (high-level, Breadth tier):
   - **Primary source:** REST catch-up `GET /api/system/activity?agentId=<id>&limit=50` (see §9.5)
   - **Live tail:** filtered from the shared `useActivityStream` ring buffer for events arriving after the REST fetch
   - Shows the same event kinds as Director's "Pulse" — lifecycle, IPC, status changes — but filtered to one agent

4. **Trace** — `TraceTerminal` component (deep, Depth tier). See §4.7 for full spec.

### 4.5 `MapToolbar` — Layout Controls

Floating toolbar above the canvas (top-left, z-index above React Flow).

**Controls:**

| Control | Type | Behavior |
|---------|------|----------|
| **Layout Mode** | Toggle button: `Auto` / `Manual` | Switches between dagre auto-layout and free-drag with localStorage persistence |
| **Re-layout** | Icon button (grid icon) | Force re-run dagre layout (only enabled when `Auto` is active) |
| **Fit View** | Icon button (expand icon) | Calls `reactFlowInstance.fitView()` |
| **Zoom indicator** | Read-only label | Shows current zoom % (helps user understand LOD transitions) |

### 4.6 `SyndicateMapApp` — Main Shell

```tsx
export default function SyndicateMapApp() {
  const {
    nodes, edges,
    onNodesChange, onEdgesChange,
    layoutMode, setLayoutMode,
    zoomLevel,
  } = useAgentGraph();
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ flex: 1, position: 'relative' }}>
        <MapToolbar
          layoutMode={layoutMode}
          onLayoutModeChange={setLayoutMode}
          zoomLevel={zoomLevel}
        />
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, node) => setSelectedAgent(node.id)}
          onPaneClick={() => setSelectedAgent(null)}
          defaultEdgeOptions={{
            type: 'smoothstep',
            style: { strokeDasharray: '6 4', opacity: 0.4 },
          }}
          fitView
          minZoom={0.15}
          maxZoom={2.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant="dots" gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={miniMapColor}
            maskColor="rgba(0,0,0,0.6)"
          />
        </ReactFlow>
      </div>
      {selectedAgent && (
        <AgentDetailPanel
          agentId={selectedAgent}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
```

### 4.7 `TraceTerminal` — Deep Agent Execution Log

Read-only, monospace log viewer that displays the full internal execution trace for a selected agent. Activated **only when the user clicks the "Trace" tab** in the `AgentDetailPanel` — zero network cost until then.

```typescript
interface TraceTerminalProps {
  agentId: string;
  sessionKey: string;   // needed for Memory Bus filtering
  windowId: string;     // needed for per-window SSE stream
}
```

**Data sources (both on-demand):**

| Source | What It Contains | How It's Consumed |
|--------|------------------|-------------------|
| **Memory Bus** (`gamma:memory:bus`) | Hierarchical execution tree: thinking → tool_call → tool_result, with full content. Each entry has `stepId` + `parentId` for tree reconstruction. | REST: `GET /api/agents/:id/trace?limit=100` — returns `MemoryBusEntry[]` filtered by `sessionKey` |
| **Per-window SSE** (`gamma:sse:<windowId>`) | Live stream: thinking text, assistant deltas, tool calls/results as they happen in real-time. Already batched at 50ms by `StreamBatcher`. | SSE: `GET /api/agents/:id/trace/stream` — proxies the per-window SSE stream for this agent only |

**UI layout:**

```
┌─────────────────────────────────────────────────┐
│ TRACE · agent.01JFXYZ · running                  │
│ [Clear] [Auto-scroll: ON ▼] [Filter ▼]          │
├─────────────────────────────────────────────────┤
│                                                  │
│  14:23:01 💭 THINKING                            │
│  │ The user wants me to analyze the data...      │
│  │ I should use the vector_store tool first.     │
│  │                                               │
│  14:23:03 ⚙ TOOL_CALL  vector_store              │
│  │ { "query": "user preferences", "limit": 5 }  │
│  │                                               │
│  14:23:04 ✓ TOOL_RESULT  vector_store             │
│  │ [{ "id": "doc_1", "score": 0.92, ... }]      │
│  │                                               │
│  14:23:05 💭 THINKING                            │
│  │ Based on the results, I can see that...       │
│  │                                               │
│  14:23:07 📝 ASSISTANT                            │
│  │ Here's what I found in your knowledge base... │
│  │                                               │
│  ▼ (auto-scrolling)                              │
└─────────────────────────────────────────────────┘
```

**Entry rendering by kind:**

| MemoryBusEntry `kind` | Icon | Color | Content Display |
|------------------------|------|-------|-----------------|
| `thought` | `💭` | `#d7afff` (violet) | Full thinking text, no truncation |
| `tool_call` | `⚙` | `#ffd787` (yellow) | Tool name as header, full JSON arguments (collapsible if > 10 lines) |
| `tool_result` | `✓` / `✕` | `#87ffd7` (green) / `#ff5f5f` (red) | Full result JSON (collapsible if > 10 lines). Red if `isError` |
| `text` | `📝` | `#5fd7ff` (blue) | Assistant output text |

**Controls:**

| Control | Behavior |
|---------|----------|
| **Clear** | Clears the local display buffer. Does NOT delete Redis data. New events continue to appear. |
| **Auto-scroll** | Toggle. When ON (default): scrolls to bottom on each new entry. When OFF: user can scroll freely through history. Follows the DirectorApp's `paused` pattern. |
| **Filter** | Dropdown multi-select: `Thinking`, `Tool Calls`, `Tool Results`, `Output`. Default: all checked. Allows hiding verbose thinking blocks to focus on tool flow. |

**Lifecycle:**
1. User clicks "Trace" tab in sidebar → `useAgentTrace(agentId)` hook activates
2. Hook calls `GET /api/agents/:id/trace?limit=100` for historical entries
3. Hook opens SSE to `/api/agents/:id/trace/stream` for live tail
4. User switches away from "Trace" tab → hook deactivates, SSE disconnects
5. User closes sidebar → all hooks unmount, zero ongoing cost

**No xterm.js** — this is a read-only log viewer with monospace styling, matching the DirectorApp's established CSS-in-JS patterns (inline styles, `var(--font-system)`, `var(--glass-bg)`). The DirectorApp proves this approach works well for event streams. Using xterm.js for a read-only display would add ~300 KB of bundle size for capabilities we don't use (input handling, terminal emulation, escape sequences).

---

## 5. Hook Specifications

### 5.1 `useAgentGraph`

Combines REST + SSE to produce React Flow graph state. Manages layout mode and position persistence.

```typescript
type LayoutMode = 'auto' | 'manual';

interface UseAgentGraphReturn {
  nodes: Node<AgentNodeData>[];
  edges: Edge<IpcEdgeData>[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  layoutMode: LayoutMode;
  setLayoutMode: (mode: LayoutMode) => void;
  reLayout: () => void;             // force dagre re-run
  zoomLevel: number;                // current viewport zoom (for toolbar display)
  expandedClusters: Set<string>;
  toggleCluster: (supervisorId: string) => void;
  loading: boolean;
}
```

**Data sources:**

| Source | Method | Data |
|--------|--------|------|
| SQLite agents | `GET /api/agents` (REST, once + on registry change) | identity, `avatar_emoji`, `ui_color`, `role_id` |
| Redis registry | SSE `agent_registry_update` events | `status`, `role`, `supervisorId`, `lastHeartbeat` |

**Logic:**

1. On mount: fetch `GET /api/agents` → build initial node list
2. Subscribe to SSE broadcast (reuse `useSecureSse` on `/api/stream/agent-monitor`)
3. On `agent_registry_update` event:
   - Merge `status` and `inProgressTaskCount` updates into existing nodes (data-only patch, no re-layout)
   - Detect new/removed agents → topology change
   - Detect `supervisorId` changes → topology change
4. On topology change:
   - Run `applyClustering()` to detect collapsible subtrees
   - If `layoutMode === 'auto'`: run `applyDagreLayout()` on visible nodes/edges
   - If `layoutMode === 'manual'`: merge new nodes with saved positions from `useLayoutPersistence`; new nodes without saved positions get dagre-computed positions as their initial placement
5. Edges derived from `supervisorId`: `{ source: supervisorId, target: agentId, type: 'smoothstep' }`

**Performance:** Separate "topology" from "status" updates. Status changes patch `node.data` without re-layout or position changes.

#### Layout Mode Behavior

| Scenario | `auto` mode | `manual` mode |
|----------|-------------|---------------|
| App mount | Dagre layout → fitView | Load positions from localStorage; dagre for any nodes without saved position |
| New agent added | Re-run dagre for all nodes | New node gets dagre position; existing nodes untouched |
| Agent removed | Re-run dagre for all nodes | Node disappears; positions of others preserved |
| `supervisorId` change | Re-run dagre for all nodes | Only affected edge changes; positions preserved |
| Status change | Data patch only (no layout) | Data patch only (no layout) |
| User drags a node | Ignored (dagre overrides on next topology change) | Position saved to localStorage immediately (`onNodeDragStop`) |
| Switch `manual → auto` | Re-run dagre for all nodes | — |
| Switch `auto → manual` | — | Snapshot current positions into localStorage |

### 5.2 `useLayoutPersistence`

Persists node positions to `localStorage` for the manual layout mode.

```typescript
const STORAGE_KEY = 'gamma:syndicate-map:positions';

interface NodePositionMap {
  [nodeId: string]: { x: number; y: number };
}

interface UseLayoutPersistenceReturn {
  savedPositions: NodePositionMap;
  savePosition: (nodeId: string, pos: { x: number; y: number }) => void;
  saveAllPositions: (positions: NodePositionMap) => void;
  clearPositions: () => void;
}
```

**Storage format:** JSON object keyed by `agentId`. Stored under `gamma:syndicate-map:positions` in localStorage (consistent with existing `gamma-session` persistence key pattern in `useGammaStore`).

**Garbage collection:** On each save, prune entries for `agentId`s not present in the current node list (prevents stale entries from archived/deleted agents accumulating).

### 5.3 `useActivityStream`

Consumes the existing `@Sse('activity/stream')` endpoint. **Breadth tier — always-on, all agents.**

```typescript
interface UseActivityStreamReturn {
  events: ActivityEvent[];           // Ring buffer (last 200)
  getEventsForAgent(agentId: string): ActivityEvent[];
  lastEventId: string | null;       // Redis stream ID — for sidebar REST catch-up offset
}
```

**Implementation:**
1. REST catch-up: `GET /api/system/activity?limit=200`
2. SSE live: `useSecureSse({ path: '/api/system/activity/stream' })`
3. Store in `useRef<ActivityEvent[]>` ring buffer (max 200 entries, FIFO)
4. Expose `getEventsForAgent()` — filters by `agentId` or `targetAgentId`
5. Throttle state updates to 100ms via `useThrottledValue`
6. Track `lastEventId` so the sidebar knows from which point to use live events vs. REST history

### 5.4 `useAgentTrace`

Per-agent deep trace hook. **Depth tier — on-demand, single agent.**

```typescript
interface TraceEntry {
  // From MemoryBusEntry
  id: string;
  sessionKey: string;
  windowId: string;
  kind: 'thought' | 'tool_call' | 'tool_result' | 'text';
  content: string;         // FULL content — not truncated
  ts: number;
  stepId: string;
  parentId?: string;       // Links to parent step (for tree view)

  // Derived
  toolName?: string;       // Parsed from content for tool_call/tool_result
  isError?: boolean;       // Parsed from content for tool_result
  durationMs?: number;     // Computed: tool_result.ts - tool_call.ts
}

interface UseAgentTraceReturn {
  entries: TraceEntry[];
  loading: boolean;
  connected: boolean;      // SSE live tail connected
  clear: () => void;       // Clear local display buffer
}

function useAgentTrace(
  agentId: string | null,   // null = inactive (no fetch, no SSE)
  sessionKey?: string,
  windowId?: string,
): UseAgentTraceReturn;
```

**Lifecycle:**
1. When `agentId` becomes non-null (Trace tab selected):
   - Resolve `sessionKey` and `windowId` from the agent registry entry (already available in `useAgentGraph` node data)
   - REST fetch: `GET /api/agents/:id/trace?limit=100` → historical `TraceEntry[]`
   - Open SSE: `useSecureSse({ path: '/api/agents/:id/trace/stream', enabled: agentId != null })`
2. Incoming SSE events parsed into `TraceEntry` and appended to entries array
3. When `agentId` becomes null (tab deselected or sidebar closed):
   - SSE disconnects (via `enabled: false`)
   - Entries array cleared (no memory leak from stale trace data)

**Tool duration computation** (same pattern as Director's `toolDurations` map):
- On `tool_call`: store `toolCallId → ts` in a local Map
- On `tool_result`: lookup matching `tool_call` by `parentId`, compute `durationMs = tool_result.ts - tool_call.ts`

**Critical: no data leaks into Activity Stream.** This hook reads from Memory Bus and per-window SSE — completely separate Redis streams from `gamma:system:activity`. The two tiers never cross.

---

## 6. Layout Engine (`lib/layout.ts`)

Pure function — no React dependency. Easy to test.

```typescript
import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

const NODE_WIDTH = 200;
const NODE_HEIGHT = 100;
const CLUSTER_NODE_WIDTH = 160;
const CLUSTER_NODE_HEIGHT = 80;

export function applyDagreLayout(
  nodes: Node[],
  edges: Edge[],
): { nodes: Node[]; edges: Edge[] } {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', ranksep: 80, nodesep: 60 });

  for (const node of nodes) {
    const isCluster = node.type === 'agentCluster';
    g.setNode(node.id, {
      width: isCluster ? CLUSTER_NODE_WIDTH : NODE_WIDTH,
      height: isCluster ? CLUSTER_NODE_HEIGHT : NODE_HEIGHT,
    });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const layoutNodes = nodes.map((node) => {
    const pos = g.node(node.id);
    const w = node.type === 'agentCluster' ? CLUSTER_NODE_WIDTH : NODE_WIDTH;
    const h = node.type === 'agentCluster' ? CLUSTER_NODE_HEIGHT : NODE_HEIGHT;
    return {
      ...node,
      position: {
        x: pos.x - w / 2,
        y: pos.y - h / 2,
      },
    };
  });

  return { nodes: layoutNodes, edges };
}
```

---

## 7. Clustering Engine (`lib/clustering.ts`)

Pure function. Detects supervisor subtrees that exceed the cluster threshold and collapses them into a single `AgentClusterNode`.

```typescript
const DEFAULT_CLUSTER_THRESHOLD = 10;

interface ClusterResult {
  visibleNodes: Node[];       // includes AgentClusterNode where collapsed
  hiddenNodeIds: Set<string>; // nodes inside collapsed clusters
  visibleEdges: Edge[];       // edges with hidden endpoints removed
}

export function applyClustering(
  nodes: Node<AgentNodeData>[],
  edges: Edge[],
  expandedClusters: Set<string>,  // supervisorIds the user has explicitly expanded
  threshold = DEFAULT_CLUSTER_THRESHOLD,
): ClusterResult {
  // 1. Build adjacency: supervisorId → children[]
  // 2. For each supervisor with children.length > threshold:
  //    - If supervisorId is NOT in expandedClusters:
  //      - Replace all children with a single AgentClusterNode
  //      - Remove edges to/from hidden children
  //      - Add single edge: supervisor → clusterNode
  // 3. Return visible set
}
```

**Cluster expansion is local state** — stored in `useAgentGraph` as `expandedClusters: Set<string>`. Not persisted (resets on reload, which is fine — clusters are a zoom-out convenience, not a persistent layout choice).

**Nested clusters:** If a collapsed cluster's children themselves have children, those grandchildren are also hidden. Expanding a cluster reveals only its direct children — grandchildren may form their own clusters.

---

## 8. SSE Event Mapping

The visualizer does **not** use WebSocket directly. It consumes three SSE stream types — two always-on (Breadth) and one on-demand (Depth).

### Stream 1: Agent Registry Broadcast (`/api/stream/agent-monitor`) — Breadth

| SSE Event Type | Trigger | Visual Effect |
|----------------|---------|---------------|
| `agent_registry_update` | Agent registered/unregistered/status change | Update node status indicators + task badge; add/remove nodes; re-layout on topology change; re-cluster if threshold crossed |

### Stream 2: Activity Stream (`/api/system/activity/stream`) — Breadth

| Activity Event Kind | Trigger | Visual Effect |
|---------------------|---------|---------------|
| `ipc_message_sent` | `delegateTask()` called | Animated particle on edge from `agentId` → `targetAgentId`; pulse source node; increment target `inProgressTaskCount` |
| `ipc_task_completed` | `reportTaskStatus(completed)` | Flash target node green (1s); animated particle edge back up; decrement target `inProgressTaskCount`; refresh sidebar TaskList if open for this agent |
| `ipc_task_failed` | `reportTaskStatus(failed)` | Flash target node red (1s); animated particle edge back up; decrement target `inProgressTaskCount`; refresh sidebar TaskList if open for this agent |
| `agent_status_change` | Any status transition | Update node status indicator (fast-path, redundant with registry broadcast) |
| `lifecycle_start` | Agent run begins | Set node glow to `running` amber |
| `lifecycle_end` | Agent run completes | Set node glow to `idle` green |
| `tool_call_start` | Tool invocation | (Future) small tool icon appears on node |
| `tool_call_end` | Tool returns | (Future) tool icon disappears |

### Stream 3: Per-Agent Trace (`/api/agents/:id/trace/stream`) — Depth, On-Demand

| SSE Event Type | Content | Display in TraceTerminal |
|----------------|---------|--------------------------|
| `thinking` | Full reasoning text (cumulative) | `💭 THINKING` block with violet background |
| `tool_call` | Tool name + full JSON arguments | `⚙ TOOL_CALL tool_name` with yellow background |
| `tool_result` | Tool name + full JSON result + `isError` | `✓/✕ TOOL_RESULT tool_name` with green/red background |
| `assistant_delta` / `assistant_update` | Agent output text | `📝 ASSISTANT` block with blue background |
| `lifecycle_start` | Run begin marker | `▶ RUN STARTED` separator line |
| `lifecycle_end` | Run end + token usage | `■ RUN ENDED` separator line with token stats |
| `lifecycle_error` | Error message | `✕ ERROR` red block with error details |

**This stream is NOT the global activity stream.** It proxies the agent's per-window SSE stream (`gamma:sse:<windowId>`) which contains full, untruncated event data. The global activity stream only carries 200-char payload summaries.

### Animation State Machine (per edge)

```
IDLE ──[ipc_message_sent]──► ANIMATING_DOWN (1.5s)
                                    │
                              [timeout 1.5s]
                                    │
                                    ▼
                                  IDLE

IDLE ──[ipc_task_completed]──► ANIMATING_UP (1.5s) → IDLE
IDLE ──[ipc_task_failed]────► ANIMATING_UP_RED (1.5s) → IDLE
```

---

## 9. Backend Changes Required

### 9.1 New REST Endpoint: Agent Soul Summary

**File:** `apps/gamma-core/src/agents/agents.controller.ts`

```typescript
@Get(':id/soul')
async getAgentSoul(@Param('id') id: string): Promise<{ soul: string }> {
  // Read first 2000 chars of <workspace>/SOUL.md
}
```

### 9.2 New REST Endpoint: Agent Tasks (Full History)

**File:** `apps/gamma-core/src/agents/agents.controller.ts`

Returns **all tasks** for an agent (not just active), sourced from SQLite `tasks` table. This is the authoritative data source for the sidebar — not the ephemeral activity stream ring buffer.

```typescript
@Get(':id/tasks')
async getAgentTasks(
  @Param('id') id: string,
  @Query('status') status?: string,  // optional comma-separated filter: "pending,in_progress"
  @Query('limit') limit?: string,    // default: 50, max: 200
): Promise<TaskRecord[]> {
  // Query TaskStateRepository:
  //   - findByTarget(id) for tasks assigned TO this agent
  //   - findBySource(id) for tasks delegated BY this agent
  //   - Merge, deduplicate by id, sort by created_at DESC
  //   - Apply status filter if provided
  //   - Apply limit
}
```

### 9.3 Extend GET /api/agents Response

Currently returns `AgentInstanceDto`. Needs to include `avatar_emoji`, `ui_color` from SQLite if not already present. (Verify against existing `agents.controller.ts`.)

### 9.4 New REST Endpoint: Agent Trace (Memory Bus Query)

**File:** `apps/gamma-core/src/agents/agents.controller.ts`

Reads the agent's execution trace from the Memory Bus Redis Stream, filtered by `sessionKey`. This is the **Depth** data source — full thinking blocks, full tool arguments, full results. No truncation.

```typescript
@Get(':id/trace')
async getAgentTrace(
  @Param('id') id: string,
  @Query('limit') limit?: string,    // default: 100, max: 500
  @Query('since') since?: string,    // Redis stream ID for pagination
): Promise<MemoryBusEntry[]> {
  // 1. Resolve agent's sessionKey from AgentStateRepository or AgentRegistryService
  // 2. XRANGE gamma:memory:bus since..+ COUNT limit
  // 3. Filter entries where entry.sessionKey === agent's sessionKey
  // 4. Return filtered entries (newest last — chronological order)
}
```

**Why read from Memory Bus instead of filesystem logs:**
- Agent workspaces (`~/.openclaw/agents/<agentId>/`) contain persona files (SOUL.md, IDENTITY.md, etc.) but **no log files**. There is no disk-based logging per agent.
- The Memory Bus (`gamma:memory:bus`) already captures every execution step with hierarchical `stepId`/`parentId` linking — this is a complete execution trace.
- The Gateway WS service (`gateway-ws.service.ts`) writes to the Memory Bus on every thinking block, tool call, tool result, and assistant output via `pushMemoryBus()`.
- Filtering by `sessionKey` isolates one agent's trace from the shared stream.

**Performance note:** The Memory Bus stream retains events across all agents. Filtering by `sessionKey` is done in-app after `XRANGE`. For a single-agent trace fetch, this means reading N entries to find M matching ones. With the current MAXLEN ~5000 cap, worst case is scanning 5000 entries to find one agent's trace. This is acceptable for REST (<10ms in practice). If the bus grows, consider per-agent streams in a future iteration.

### 9.5 New SSE Endpoint: Agent Trace Stream (Live Tail)

**File:** `apps/gamma-core/src/agents/agents.controller.ts` (or `system.controller.ts`)

Proxies the agent's per-window SSE stream for real-time trace display. Uses the same XREAD BLOCK pattern as `sse.controller.ts` but scoped to one agent's `windowId`.

```typescript
@Sse(':id/trace/stream')
streamAgentTrace(
  @Param('id') id: string,
  @Query('ticket') ticket?: string,
): Observable<MessageEvent> {
  // 1. Validate SSE ticket
  // 2. Resolve agent's windowId from AgentRegistryService
  // 3. XREAD BLOCK on gamma:sse:<windowId> (same pattern as SseController)
  // 4. Forward events as SSE MessageEvents
  // 5. Include keep_alive heartbeat every 15s
  // 6. On subscriber teardown: close duplicate Redis connection
}
```

**Why proxy per-window SSE instead of creating a new stream:**
- The per-window SSE stream (`gamma:sse:<windowId>`) already contains all the data the TraceTerminal needs: thinking, tool_call, tool_result, assistant_delta, lifecycle events — with full content (not truncated).
- The `StreamBatcher` already debounces high-frequency events at 50ms.
- No new Redis writes needed — the Gateway already writes to this stream for the `SseController` to consume.
- The only difference from the standard `SseController` is that the Trace endpoint resolves `windowId` from the `agentId` URL parameter instead of taking it directly — this is a convenience wrapper.

**Authentication:** Same SSE ticket system used by `SseController` — `POST /api/system/sse-ticket` exchanges system token for a short-lived ticket, passed as `?ticket=` query param.

### 9.6 Extend GET /api/system/activity with Agent Filter

**File:** `apps/gamma-core/src/system/system.controller.ts`

Add optional `agentId` query parameter to the existing activity REST endpoint. This allows the sidebar's Activity tab to fetch **historical** high-level events for a specific agent.

```typescript
@Get('activity')
async getActivity(
  @Query('since') since?: string,
  @Query('limit') limit?: string,
  @Query('agentId') agentId?: string,  // NEW: filter by agentId or targetAgentId
): Promise<ActivityEvent[]> {
  const events = await this.activityStream.read(since || '-', ...);
  if (agentId) {
    return events.filter(e => e.agentId === agentId || e.targetAgentId === agentId);
  }
  return events;
}
```

> **Note:** Filtering is done in-app (post-read from Redis Stream) since Redis Streams don't support field-level filtering natively. For 200–500 events this is negligible. If the activity stream grows beyond 5000 events, consider a dedicated SQLite `activity_log` table with indexed `agentId` column.

---

## 10. App Registration

**File:** `apps/gamma-ui/constants/apps.ts`

```typescript
{ id: "syndicate-map", name: "Syndicate Map", icon: "🗺️" }
```

**File:** `apps/gamma-ui/components/WindowManager.tsx` (or equivalent app renderer)

Add lazy import for `SyndicateMapApp`.

---

## 11. Performance Budget

| Metric | Target | Strategy |
|--------|--------|----------|
| Canvas render (50 nodes) | <16ms (60 FPS) | `React.memo` on `AgentNode`, `IpcEdge`; LOD reduces paint cost at low zoom |
| Canvas render (100+ nodes) | <16ms (60 FPS) | Clustering collapses subtrees >10 children into single node; LOD minimal tier at low zoom |
| Layout recalculation | <10ms | dagre runs only on topology changes (add/remove node, supervisorId change, cluster toggle) |
| Activity stream updates | 100ms throttle | `useThrottledValue` on event buffer; batch state updates |
| Trace stream updates | 50ms (inherits batcher) | `StreamBatcher` already debounces per-window events |
| Edge animations | CSS only | `offset-path` animation — zero JS per frame |
| Node status updates | Patch `data` only | Shallow compare in `React.memo`; avoid full node object replacement |
| LOD tier switch | No layout recalc | Only changes component return; positions unchanged |
| Memory (activity buffer) | ~200 events max | Ring buffer with FIFO eviction |
| Memory (trace buffer) | ~500 entries max | Cleared on agent deselect or tab switch |
| Trace SSE connections | 0 when unused, 1 max | SSE opens only when Trace tab is active; closes on deselect |
| localStorage writes | Debounced 500ms | Position saves batched on `onNodeDragStop`, not on every pixel |
| SSE reconnect | 3s backoff | Existing `useSecureSse` handles this |

---

## 12. Step-by-Step Developer Tasks

### Phase A: Foundation (no visual output yet)

- [ ] **A1.** Install `@xyflow/react` and `@dagrejs/dagre` in `apps/gamma-ui`
- [ ] **A2.** Create `lib/layout.ts` — dagre wrapper function
- [ ] **A3.** Create `lib/clustering.ts` — subtree collapse logic
- [ ] **A4.** Create `hooks/useActivityStream.ts` — SSE consumer with ring buffer + `lastEventId`
- [ ] **A5.** Create `hooks/useLayoutPersistence.ts` — localStorage read/write for manual positions
- [ ] **A6.** Create `hooks/useAgentGraph.ts` — REST + SSE → nodes/edges + layout mode + clustering
- [ ] **A7.** Add backend endpoint `GET /api/agents/:id/soul`
- [ ] **A8.** Add backend endpoint `GET /api/agents/:id/tasks` (full history, not just active)
- [ ] **A9.** Add backend endpoint `GET /api/agents/:id/trace` (Memory Bus query filtered by sessionKey)
- [ ] **A10.** Add backend endpoint `@Sse(':id/trace/stream')` (per-agent live trace proxy)
- [ ] **A11.** Add `agentId` filter to `GET /api/system/activity`
- [ ] **A12.** Verify `GET /api/agents` returns `avatar_emoji`, `ui_color` fields

### Phase B: Canvas & Nodes

- [ ] **B1.** Create `AgentNode.tsx` — full LOD implementation (3 tiers: minimal / compact / full)
- [ ] **B2.** Create `AgentClusterNode.tsx` — collapsed group node with status summary
- [ ] **B3.** Create `IpcEdge.tsx` — SmoothStep edge with dashed stroke
- [ ] **B4.** Create `MapToolbar.tsx` — layout toggle (Auto/Manual), fit-view, re-layout, zoom indicator
- [ ] **B5.** Create `SyndicateMapApp.tsx` shell with `<ReactFlow>` canvas + toolbar + sidebar slot
- [ ] **B6.** Register app in `INSTALLED_APPS` and `WindowManager`
- [ ] **B7.** Test: launch app, verify agents appear as nodes in tree layout, drag works

### Phase C: Real-time Updates

- [ ] **C1.** Wire `agent_registry_update` SSE → live node status + task badge updates
- [ ] **C2.** Wire activity stream SSE → edge animations on `ipc_message_sent`
- [ ] **C3.** Implement node flash on `ipc_task_completed` / `ipc_task_failed`
- [ ] **C4.** Implement `lifecycle_start`/`lifecycle_end` → node glow transitions
- [ ] **C5.** Wire `inProgressTaskCount` live tracking (increment on `ipc_message_sent`, decrement on `ipc_task_completed`/`ipc_task_failed`)
- [ ] **C6.** Test: delegate a task between agents, verify particle animation + badge update

### Phase D: Sidebar & Detail Panel

- [ ] **D1.** Create `AgentDetailPanel.tsx` with header + 4 tabs (Soul / Tasks / Activity / Trace)
- [ ] **D2.** Create `TaskList.tsx` — REST-backed from `GET /api/agents/:id/tasks` with tab filtering
- [ ] **D3.** Create `ActivityFeed.tsx` — REST historical fetch + live tail from ring buffer
- [ ] **D4.** Integrate SOUL.md summary via `GET /api/agents/:id/soul`
- [ ] **D5.** Wire node click → sidebar open, pane click → sidebar close
- [ ] **D6.** Wire sidebar auto-refresh on relevant activity events
- [ ] **D7.** Create `hooks/useAgentTrace.ts` — on-demand Memory Bus REST + per-agent SSE tail
- [ ] **D8.** Create `TraceTerminal.tsx` — monospace log viewer with auto-scroll, clear, filter controls
- [ ] **D9.** Test: open Trace tab, verify thinking/tool/result entries stream in real-time
- [ ] **D10.** Test: close Trace tab, verify SSE disconnects (check network tab — zero ongoing requests)

### Phase E: Layout Persistence & Clustering

- [ ] **E1.** Implement Auto ↔ Manual layout toggle with toolbar
- [ ] **E2.** Persist manual positions to localStorage on `onNodeDragStop`
- [ ] **E3.** Restore positions from localStorage on mount (when manual mode)
- [ ] **E4.** Snapshot positions when switching `auto → manual`
- [ ] **E5.** Implement cluster collapse/expand toggle (click on cluster node)
- [ ] **E6.** Test: add 12 agents under one supervisor, verify cluster appears

### Phase F: Polish & Performance

- [ ] **F1.** Add `React.memo` to all custom node/edge components
- [ ] **F2.** Throttle activity stream state updates (100ms)
- [ ] **F3.** Verify LOD transitions are smooth (no layout jumps on zoom)
- [ ] **F4.** Test with 50+ mock agents — verify no frame drops
- [ ] **F5.** Test with 100+ agents — verify clustering keeps canvas usable
- [ ] **F6.** Add CSS transitions for status changes (smooth color transitions)
- [ ] **F7.** Handle edge case: agents with no `supervisorId` (root nodes — placed at top of dagre graph)
- [ ] **F8.** Handle edge case: orphaned agents (supervisorId points to archived/deleted agent)
- [ ] **F9.** Prune stale localStorage positions for removed agents
- [ ] **F10.** Verify trace SSE cleanup — no zombie connections after sidebar close

---

## 13. CSS Animation Reference

### Edge particle (IPC message traveling along edge)

```css
@keyframes ipc-particle {
  0%   { offset-distance: 0%; opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { offset-distance: 100%; opacity: 0; }
}

.ipc-particle {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--particle-color);
  box-shadow: 0 0 6px var(--particle-color);
  animation: ipc-particle 1.5s ease-in-out forwards;
  offset-path: path(var(--edge-path));
}
```

### Node status glow

```css
.agent-node[data-status="running"] {
  box-shadow: 0 0 12px var(--ui-color, #6366F1);
  transition: box-shadow 0.3s ease;
}

.agent-node[data-status="idle"] {
  box-shadow: none;
  transition: box-shadow 0.5s ease;
}

@keyframes node-flash-success {
  0%, 100% { border-color: var(--ui-color); }
  50%      { border-color: #22C55E; box-shadow: 0 0 16px #22C55E60; }
}

@keyframes node-flash-error {
  0%, 100% { border-color: var(--ui-color); }
  50%      { border-color: #EF4444; box-shadow: 0 0 16px #EF444460; }
}
```

### Task badge overload pulse

```css
.task-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--badge-color, #6366F1);
  color: white;
  position: absolute;
  bottom: -4px;
  right: -4px;
  min-width: 18px;
  text-align: center;
  transition: background 0.3s ease;
}

.task-badge[data-overload="true"] {
  background: #EF4444;
  animation: badge-pulse 1.5s ease-in-out infinite;
}

@keyframes badge-pulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.15); box-shadow: 0 0 8px #EF444480; }
}
```

### LOD transitions

```css
.agent-node {
  transition: width 0.2s ease, height 0.2s ease, opacity 0.15s ease;
}

/* Minimal tier: just a colored dot */
.agent-node--minimal {
  width: 40px;
  height: 40px;
  border-radius: 50%;
}

/* Compact tier: emoji + badge */
.agent-node--compact {
  width: 80px;
  height: 80px;
  border-radius: 12px;
}

/* Full tier: all details */
.agent-node--full {
  width: 200px;
  height: 100px;
  border-radius: 12px;
}
```

### TraceTerminal entry styling

```css
.trace-entry {
  padding: 6px 10px;
  border-left: 3px solid var(--entry-color);
  margin-bottom: 2px;
  font-family: var(--font-system);
  font-size: 12px;
  line-height: 1.5;
  background: rgba(0, 0, 0, 0.1);
  transition: background 0.15s ease;
}

.trace-entry:hover {
  background: rgba(0, 0, 0, 0.2);
}

.trace-entry--thought  { --entry-color: #d7afff; }
.trace-entry--tool     { --entry-color: #ffd787; }
.trace-entry--result   { --entry-color: #87ffd7; }
.trace-entry--error    { --entry-color: #ff5f5f; }
.trace-entry--text     { --entry-color: #5fd7ff; }

.trace-entry__header {
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 10px;
  opacity: 0.7;
  margin-bottom: 4px;
}

.trace-entry__content {
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 300px;
  overflow-y: auto;
}

.trace-entry__content--collapsed {
  max-height: 80px;
  overflow: hidden;
  mask-image: linear-gradient(to bottom, black 60%, transparent);
}

/* Separator lines for lifecycle events */
.trace-separator {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 10px;
  opacity: 0.5;
  font-family: var(--font-system);
}

.trace-separator::before,
.trace-separator::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--color-border-subtle);
}
```

---

## 14. Open Questions / Future Scope

1. **Task timeline:** A Gantt-style timeline view per agent could complement the spatial map for debugging long-running task chains.

2. **Sound effects:** Optional audio cue on IPC events (e.g., soft "ping" on task completion) — gated behind UI settings.

3. **Cross-tree edges:** Currently edges only follow `supervisorId` hierarchy. If we add peer-to-peer IPC (same-level agents communicating), we'll need transient "IPC-only" edges that appear on `ipc_message_sent` and fade after 3s — these would bypass the hierarchy and be drawn as curved Bezier to visually distinguish them from structural SmoothStep edges.

4. **Activity persistence:** If the Redis Stream's 5000-event cap becomes insufficient for sidebar history, introduce an SQLite `activity_log` table with indexed `agent_id` column. The `ActivityStreamService` would dual-write to both Redis (for live SSE) and SQLite (for historical queries).

5. **Cluster depth indicator:** For deeply nested hierarchies (3+ levels), consider showing a "depth badge" on cluster nodes indicating how many levels are collapsed beneath.

6. **Trace tree view:** The Memory Bus entries have `stepId`/`parentId` hierarchical links. A future enhancement could render the trace as a collapsible tree instead of a flat log — showing thinking → tool_call → tool_result nesting visually. This is deferred because the flat chronological view is simpler to implement and sufficient for initial debugging.

7. **Per-agent Memory Bus streams:** If scanning the shared `gamma:memory:bus` for one agent's entries becomes too expensive (>5000 total entries across all agents), consider introducing per-agent streams: `gamma:memory:bus:<sessionKey>`. The Gateway would dual-write to both the shared and per-agent streams. This is an optimization that can be added transparently — the REST endpoint interface stays the same.
