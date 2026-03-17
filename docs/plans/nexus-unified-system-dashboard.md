# Nexus — Unified System Dashboard: Implementation Plan

**Status:** Proposed
**Author:** System Architect
**Date:** 2026-03-17
**Priority:** Medium
**Parent:** Phase 5 — System UI Consolidation

---

## Problem

The Gamma system UI currently ships **three separate apps** that monitor overlapping aspects of the same runtime:

| App | File | Lines | Focus |
|-----|------|-------|-------|
| **Director** | `apps/system/director/DirectorApp.tsx` | ~1450 | Activity feed, agent hierarchy, spawn/reassign/pause, panic stop |
| **Agent Monitor** | `apps/system/agent-monitor/AgentMonitorApp.tsx` | ~650 | Session registry, token usage, system prompt inspection |
| **Sentinel** | `apps/system/sentinel/SentinelApp.tsx` | ~850 | Backup inventory, system events, agent table (read-only) |

### What overlaps

```
                 Director        Agent Monitor       Sentinel
                ┌──────────┐   ┌──────────────┐   ┌──────────┐
Agent list      │ ✅ tree   │   │ ✅ session tbl│   │ ✅ table  │
Status dots     │ ✅        │   │ ✅            │   │ ✅        │
Kill session    │ ✅        │   │ ✅            │   │ ❌        │
SSE connection  │ ✅ x2     │   │ ✅ x1         │   │ ✅ x1     │
Auth model      │ ✅ same   │   │ ✅ same       │   │ ✅ same   │
                └──────────┘   └──────────────┘   └──────────┘
```

**Pain points:**
1. **3 separate SSE connections** to the same backend when all three are open
2. **Duplicated agent/session display** — user sees the same data in 3 different places
3. **Context switching** — to kill a session you found in Director, you open Agent Monitor
4. **Duplicated inline CSS** — each app defines similar glassmorphic styles from scratch
5. **3 entries in the app launcher** for what is conceptually one tool

---

## Goal

Merge Director, Agent Monitor, and Sentinel into a **single tabbed application** called **Nexus** that provides unified system observability and control.

### Name candidates

| Name | Rationale | Verdict |
|------|-----------|---------|
| ~~Mission Control~~ | Overused, NASA vibes | Rejected by stakeholder |
| **Nexus** | "Central connection point" — fits unification perfectly | **Recommended** |
| Cortex | "Brain's processing center" — good for AI monitoring | Alternative |
| Watchtower | "Surveillance post" — security/monitoring feel | Alternative |
| Bastion | "Fortified position" — strong but defensive-only | Alternative |

> **Decision: TBD by user.** Plan uses "Nexus" as working title. Rename is a single constant change.

---

## Architecture

### Tab layout

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ⬡ NEXUS                              [LIVE ●]  Events: 342  [⛔ PANIC] │
├───────────┬───────────┬───────────┬──────────────────────────────────────┤
│ ● Activity│  ◉ Agents │ ○ Sessions│ ○ Backups                            │
├───────────┴───────────┴───────────┴──────────────────────────────────────┤
│                                                                          │
│                     ← Active tab content here →                          │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ Phase 5  │  Agents: 5 active  │  Sessions: 3  │  Tokens: 1.2M total     │
└──────────────────────────────────────────────────────────────────────────┘
```

### Tabs and their sources

```
Tab 1: ACTIVITY    ← Director's ActivityFeed
                     + Sentinel's SystemEvents (merged into one feed)
                     Filters: All | Errors | Tools | IPC | Lifecycle | System

Tab 2: AGENTS      ← Director's AgentHierarchy (tree + controls)
                     + Agent Monitor's token usage (in detail panel)
                     + Sentinel's capabilities (in detail panel)
                     + Agent Monitor's system prompt inspection (in detail panel)
                     Actions: Spawn, Reassign, Pause/Resume, Kill, Load Context

Tab 3: SESSIONS    ← Agent Monitor's session grid + inspector
                     + Clear Stale Records
                     (Alternative flat view — some users prefer table over tree)

Tab 4: BACKUPS     ← Sentinel's backup inventory
                     Session snapshots + File backups + stats
```

### Data flow

```
                         ┌─────────────────────────────┐
                         │     NexusApp (root)          │
                         │                              │
                         │  ┌─ useActivityStore ──────┐ │
                         │  │  Zustand, max 500 events│ │
                         │  └─────────────────────────┘ │
                         │                              │
                         │  ┌─ useNexusData() ────────┐ │
                         │  │  Single orchestrator:    │ │
                         │  │  • 1x SSE activity       │ │
                         │  │  • 1x SSE agent-monitor  │ │
                         │  │  • REST: /system/agents  │ │
                         │  │  • REST: /system/backups │ │
                         │  │  • REST: /sessions/active│ │
                         │  └───────┬─────────────────┘ │
                         │          │                    │
                         │    ┌─────┼─────┬──────┐      │
                         │    ▼     ▼     ▼      ▼      │
                         │  [Act] [Agt] [Ses] [Bkp]     │
                         └─────────────────────────────┘

SSE connections: 2 (down from 4)
  /api/system/activity/stream   → ActivityFeed
  /api/stream/agent-monitor     → AgentHierarchy + SessionRegistry

REST polling:
  /api/system/backups           → BackupsTab (10s, only when tab active)
  /api/system/agents            → AgentHierarchy (5s fallback)
```

---

## Section 1: File Structure

### 1.1 New files

```
apps/gamma-ui/apps/system/nexus/
├── NexusApp.tsx                 # Root component: header, tabs, status bar
├── tabs/
│   ├── ActivityTab.tsx          # Activity feed (from Director + Sentinel events)
│   ├── AgentsTab.tsx            # Agent hierarchy tree + enriched detail panel
│   ├── SessionsTab.tsx          # Session grid + inspector (from Agent Monitor)
│   └── BackupsTab.tsx           # Backup inventory (from Sentinel)
├── components/
│   ├── AgentTreeNode.tsx        # Recursive hierarchy tree node
│   ├── AgentDetail.tsx          # Enriched detail panel (tokens, prompt, controls)
│   ├── EventRow.tsx             # Activity event row (memoized)
│   ├── SessionInspector.tsx     # Session inspector with prompt loading
│   ├── SpawnModal.tsx           # Agent spawn dialog
│   └── PanicButton.tsx         # Emergency stop button
├── hooks/
│   ├── useNexusData.ts          # Orchestrates all SSE + REST data
│   └── useActivityStore.ts      # Zustand store (from Director, unchanged)
├── styles.ts                    # Shared CSS-in-JS constants
└── context.md                   # Architecture docs for agents
```

### 1.2 Files to delete (after migration)

```
apps/gamma-ui/apps/system/director/       # entire directory
apps/gamma-ui/apps/system/agent-monitor/   # entire directory
apps/gamma-ui/apps/system/sentinel/        # entire directory
```

### 1.3 Files to update

```
apps/gamma-ui/constants/apps.ts            # Replace 3 entries with 1 "nexus"
apps/gamma-ui/registry/systemApps.ts       # Replace 3 lazy imports with 1
```

---

## Section 2: Detailed Component Specs

### 2.1 NexusApp.tsx — Root

```tsx
// NexusApp.tsx — root component
// Responsible for: header, tab switching, status bar, panic button

import { useState, useMemo } from 'react';
import { ActivityTab } from './tabs/ActivityTab';
import { AgentsTab } from './tabs/AgentsTab';
import { SessionsTab } from './tabs/SessionsTab';
import { BackupsTab } from './tabs/BackupsTab';
import { PanicButton } from './components/PanicButton';
import { useNexusData } from './hooks/useNexusData';

type TabId = 'activity' | 'agents' | 'sessions' | 'backups';

export default function NexusApp() {
  const [activeTab, setActiveTab] = useState<TabId>('activity');
  const data = useNexusData({ activeTab });

  // Tab definitions
  const tabs: { id: TabId; label: string; badge?: number }[] = [
    { id: 'activity', label: 'Activity', badge: data.eventCount },
    { id: 'agents',   label: 'Agents',   badge: data.agents.length },
    { id: 'sessions', label: 'Sessions', badge: data.sessions.length },
    { id: 'backups',  label: 'Backups' },
  ];

  return (
    <div style={S.ROOT}>
      {/* ── Header ── */}
      <div style={S.HEADER}>
        <div style={S.TITLE_ROW}>
          <span style={S.TITLE}>⬡ Nexus</span>
          <ConnectionBadge connected={data.sseConnected} />
          <span style={S.EVENT_COUNT}>Events: {data.eventCount}</span>
          <PanicButton />
        </div>
        <div style={S.TAB_BAR}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              style={activeTab === t.id ? S.TAB_ACTIVE : S.TAB}
            >
              {t.label}
              {t.badge != null && <span style={S.BADGE}>{t.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab Content ── */}
      <div style={S.BODY}>
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'agents'   && <AgentsTab agents={data.agents} sessions={data.sessions} />}
        {activeTab === 'sessions' && <SessionsTab records={data.sessions} />}
        {activeTab === 'backups'  && <BackupsTab inventory={data.backups} />}
      </div>

      {/* ── Status Bar ── */}
      <div style={S.STATUS_BAR}>
        <span>Phase 5</span>
        <span>Agents: {data.agents.length} active</span>
        <span>Sessions: {data.sessions.length}</span>
        <span>Tokens: {fmtTokens(data.totalTokens)} total</span>
      </div>
    </div>
  );
}
```

### 2.2 useNexusData.ts — Central Data Orchestrator

```tsx
// useNexusData.ts
// Single hook that replaces 3 separate data-fetching patterns.
// Manages: 2 SSE connections + 3 REST polling endpoints.

interface UseNexusDataOptions {
  activeTab: TabId;
}

interface NexusData {
  // Activity
  eventCount: number;
  sseConnected: boolean;

  // Agents (from /api/system/agents + SSE)
  agents: AgentRegistryEntry[];

  // Sessions (from /api/sessions/active + SSE)
  sessions: SessionRecord[];

  // Backups (from /api/system/backups, polled only when tab active)
  backups: BackupInventory | null;

  // Derived
  totalTokens: number;
}

export function useNexusData({ activeTab }: UseNexusDataOptions): NexusData {
  // ── SSE 1: Activity stream (always active) ──
  const { connected, eventCount } = useActivityStream();

  // ── SSE 2: Agent monitor (always active) ──
  // Provides both agent registry updates AND session registry updates
  const { records: sessions, refresh: refreshSessions } = useSessionRegistry();

  // ── REST: Agent registry (5s poll fallback) ──
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  // ... fetch /api/system/agents every 5s ...

  // ── REST: Backups (10s poll, only when backups tab is active) ──
  const [backups, setBackups] = useState<BackupInventory | null>(null);
  // ... fetch /api/system/backups every 10s, enabled: activeTab === 'backups' ...

  // ── Derived: total token usage across all sessions ──
  const totalTokens = useMemo(
    () => sessions.reduce((sum, s) =>
      sum + (s.tokenUsage?.input ?? 0) + (s.tokenUsage?.output ?? 0), 0),
    [sessions]
  );

  return { eventCount, sseConnected: connected, agents, sessions, backups, totalTokens };
}
```

### 2.3 AgentsTab.tsx — The Key Merged View

This is where the three apps converge most. The agent detail panel combines data from all sources:

```tsx
// AgentsTab.tsx
// Left: hierarchy tree (from Director)
// Right: enriched detail panel (Director + Agent Monitor + Sentinel data)

interface AgentsTabProps {
  agents: AgentRegistryEntry[];
  sessions: SessionRecord[];  // for token usage enrichment
}

export function AgentsTab({ agents, sessions }: AgentsTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = agents.find(a => a.agentId === selectedId);

  // Match agent to its session for token data
  const matchedSession = sessions.find(s => s.sessionKey === selected?.sessionKey);

  return (
    <div style={S.TWO_PANE}>
      {/* Left: Hierarchy Tree (from Director) */}
      <div style={S.LEFT_PANE}>
        <div style={S.PANE_HEADER}>
          <span>Agent Hierarchy</span>
          <button onClick={openSpawnModal}>+ SPAWN</button>
        </div>
        <AgentTree
          agents={agents}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
      </div>

      {/* Right: Enriched Detail Panel */}
      <div style={S.RIGHT_PANE}>
        {selected ? (
          <AgentDetail
            agent={selected}
            session={matchedSession}     // ← from Agent Monitor
            allAgents={agents}
            onReassign={handleReassign}
            onPause={handlePause}
            onResume={handleResume}
            onKill={handleKill}
          />
        ) : (
          <EmptyState text="Select an agent to inspect" />
        )}
      </div>
    </div>
  );
}
```

### 2.4 AgentDetail.tsx — Enriched Detail Panel

```tsx
// AgentDetail.tsx
// Combines information from all three original apps into one panel.

interface AgentDetailProps {
  agent: AgentRegistryEntry;
  session: SessionRecord | undefined;  // token usage, system prompt
  allAgents: AgentRegistryEntry[];     // for supervisor dropdown
  onReassign: (agentId: string, newSupervisor: string) => void;
  onPause: (agentId: string) => void;
  onResume: (agentId: string) => void;
  onKill: (sessionKey: string) => void;
}

export function AgentDetail({ agent, session, allAgents, ...handlers }: AgentDetailProps) {
  const [context, setContext] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(false);

  // ── Section 1: Identity (from Director + Sentinel) ──
  // Agent ID, Role, Status, App ID, Window ID
  // Capabilities (from Sentinel's agent data)

  // ── Section 2: Performance (from Agent Monitor) ──
  // Token usage: input / output / cache
  // Run count
  // Last active timestamp

  // ── Section 3: Hierarchy (from Director) ──
  // Current supervisor (with reassign dropdown)
  // IPC state (active/paused)
  // Child agents count

  // ── Section 4: Context Inspection (from Agent Monitor) ──
  // [Load Context] button → fetches system prompt
  // Truncated display with [Show Full] toggle
  // [Copy] button
  // Security warning banner

  // ── Section 5: Controls (from Director + Agent Monitor) ──
  // [Reassign] [Pause/Resume] [Kill Session]

  return (
    <div style={S.DETAIL_PANEL}>
      {/* Section 1: Identity */}
      <div style={S.SECTION}>
        <DetailRow label="Agent" value={agent.agentId} />
        <DetailRow label="Role" value={<RoleBadge role={agent.role} />} />
        <DetailRow label="Status" value={<StatusBadge status={agent.status} />} />
        <DetailRow label="App" value={agent.appId} />
        {agent.capabilities?.length > 0 && (
          <DetailRow label="Capabilities" value={
            <div style={S.BADGE_ROW}>
              {agent.capabilities.map(c => <span key={c} style={S.CAP_BADGE}>{c}</span>)}
            </div>
          } />
        )}
      </div>

      {/* Section 2: Performance (only if session matched) */}
      {session && (
        <div style={S.SECTION}>
          <div style={S.SECTION_TITLE}>Performance</div>
          <DetailRow label="Runs" value={session.runCount} />
          <DetailRow label="Input Tokens" value={fmtTokens(session.tokenUsage?.input ?? 0)} />
          <DetailRow label="Output Tokens" value={fmtTokens(session.tokenUsage?.output ?? 0)} />
          <DetailRow label="Last Active" value={relativeTime(session.lastActiveAt)} />
        </div>
      )}

      {/* Section 3: Hierarchy */}
      <div style={S.SECTION}>
        <div style={S.SECTION_TITLE}>Hierarchy</div>
        <DetailRow label="Supervisor" value={
          <SupervisorDropdown
            current={agent.supervisorId}
            agents={allAgents}
            onChange={(newSup) => handlers.onReassign(agent.agentId, newSup)}
          />
        } />
        <DetailRow label="IPC" value={agent.acceptsMessages ? '✅ Active' : '⏸ Paused'} />
      </div>

      {/* Section 4: System Prompt */}
      <div style={S.SECTION}>
        <div style={S.SECTION_TITLE}>System Prompt</div>
        {!context ? (
          <button onClick={loadContext} disabled={contextLoading}>
            {contextLoading ? 'Loading...' : 'Load Context'}
          </button>
        ) : (
          <>
            <div style={S.WARN_BANNER}>⚠ May contain credentials</div>
            <pre style={S.CONTEXT_PRE}>{context}</pre>
            <button onClick={copyContext}>Copy</button>
          </>
        )}
      </div>

      {/* Section 5: Controls */}
      <div style={S.CONTROLS}>
        <button onClick={() => handlers.onPause(agent.agentId)} style={S.BTN}>
          {agent.acceptsMessages ? 'Pause IPC' : 'Resume IPC'}
        </button>
        <button onClick={() => handlers.onKill(agent.sessionKey)} style={S.BTN_DANGER}>
          Kill Session
        </button>
      </div>
    </div>
  );
}
```

### 2.5 ActivityTab.tsx — Merged Event Feed

```tsx
// ActivityTab.tsx
// Merges Director's activity feed + Sentinel's system events into one stream.
// The Sentinel system events (info/warn/error/critical) are mapped to
// ActivityEvent format with kind = "system_event".

// Filter buttons:
const FILTERS = [
  { id: 'all',       label: 'All' },
  { id: 'errors',    label: 'Errors' },
  { id: 'tools',     label: 'Tools' },
  { id: 'ipc',       label: 'IPC' },
  { id: 'lifecycle', label: 'Lifecycle' },
  { id: 'system',    label: 'System' },   // ← NEW: from Sentinel's events
] as const;

// Event rendering reuses Director's EventRow component with its
// smart payload rendering (tool args, status badges, duration, etc.)
```

### 2.6 SessionsTab.tsx — Session Grid

```tsx
// SessionsTab.tsx
// Moved almost verbatim from Agent Monitor.
// Left: session table (window, app, status, runs, tokens, last active)
// Right: inspector panel (context loading, kill, metadata)
// Bottom: [Clear Stale Records] button
//
// This tab exists separately from Agents because:
// 1. Sessions != Agents (an agent has a session, but session grid shows different columns)
// 2. Some users prefer flat table view over tree hierarchy
// 3. Session inspector focuses on debugging (system prompt, token details)
```

### 2.7 BackupsTab.tsx — Backup Inventory

```tsx
// BackupsTab.tsx
// Moved almost verbatim from Sentinel's Dashboard view.
// Left: session snapshots table (app, tier, files, size, date)
// Right: file backups table (app, path, size, date)
// Header: total size, last scan timestamp, refresh button
//
// Only polls /api/system/backups when this tab is active (saves resources).
```

---

## Section 3: Shared Styles

Currently each app duplicates ~100 lines of inline CSS. Extract shared constants:

```tsx
// styles.ts — shared CSS-in-JS constants for Nexus

export const S = {
  // Layout
  ROOT: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    background: 'var(--glass-bg)',
    backdropFilter: 'var(--glass-blur)',
    fontFamily: 'var(--font-system)',
    color: 'var(--color-text-primary)',
    overflow: 'hidden',
  } as React.CSSProperties,

  HEADER: { padding: '8px 12px', borderBottom: '1px solid var(--color-border-subtle)' },
  BODY: { flex: 1, overflow: 'hidden', display: 'flex' },
  STATUS_BAR: { padding: '4px 12px', fontSize: 11, borderTop: '1px solid var(--color-border-subtle)', display: 'flex', gap: 16 },

  // Tabs
  TAB_BAR: { display: 'flex', gap: 4, marginTop: 6 },
  TAB: { padding: '4px 12px', background: 'transparent', border: '1px solid transparent', color: 'var(--color-text-secondary)', cursor: 'pointer', borderRadius: 4, fontSize: 12 },
  TAB_ACTIVE: { padding: '4px 12px', background: 'rgba(255,255,255,0.06)', border: '1px solid var(--color-border-subtle)', color: 'var(--color-text-primary)', cursor: 'pointer', borderRadius: 4, fontSize: 12 },

  // Two-pane layout (used by Agents + Sessions)
  TWO_PANE: { display: 'flex', flex: 1, overflow: 'hidden' },
  LEFT_PANE: { flex: 1, borderRight: '1px solid var(--color-border-subtle)', overflow: 'auto' },
  RIGHT_PANE: { width: 320, overflow: 'auto', padding: '8px 12px' },

  // Status colors
  STATUS_COLORS: {
    running: '#5fff87',
    idle: '#ffd787',
    paused: '#87d7ff',
    error: '#ff5f5f',
    aborted: '#c9a227',
    offline: '#666',
  },

  // Role colors
  ROLE_COLORS: {
    architect: '#c792ea',
    'app-owner': '#82aaff',
    daemon: '#888',
  },

  // ... more shared constants
} as const;
```

---

## Section 4: Registration Updates

### 4.1 constants/apps.ts

```diff
  // Remove three entries:
- { id: 'agent-monitor', name: 'Agent Monitor', icon: '📡' },
- { id: 'sentinel',      name: 'Sentinel',      icon: '🛡️' },
- { id: 'director',      name: 'Director',       icon: '🎬' },
  // Add one:
+ { id: 'nexus',         name: 'Nexus',          icon: '⬡' },
```

### 4.2 registry/systemApps.ts

```diff
- registerSystemApp('agent-monitor', lazy(() => import('../apps/system/agent-monitor/AgentMonitorApp')));
- registerSystemApp('sentinel',      lazy(() => import('../apps/system/sentinel/SentinelApp')));
- registerSystemApp('director',      lazy(() => import('../apps/system/director/DirectorApp')));
+ registerSystemApp('nexus',         lazy(() => import('../apps/system/nexus/NexusApp')));
```

---

## Section 5: Migration Strategy

### Phase A: Build Nexus alongside originals (non-destructive)

1. Create `apps/system/nexus/` directory
2. Register `nexus` as a new system app (4th entry, alongside the originals)
3. Build `NexusApp.tsx` shell with tab switching
4. Migrate each tab one at a time:
   - **A.1:** `ActivityTab` — port Director's ActivityFeed + store + stream
   - **A.2:** `AgentsTab` — port Director's hierarchy tree + detail panel
   - **A.3:** `SessionsTab` — port Agent Monitor's grid + inspector
   - **A.4:** `BackupsTab` — port Sentinel's dashboard view
5. Enrich `AgentDetail` with cross-tab data (tokens, prompt, capabilities)
6. Test all functionality in Nexus while originals still work

### Phase B: Cut over

7. Remove director, agent-monitor, sentinel from `apps.ts` and `systemApps.ts`
8. Delete the three original directories
9. Update any references (e.g., `context.md` files, agent prompts that mention these apps)

### Phase C: Polish

10. Merge Activity feed: add `system` filter for Sentinel's system events
11. Optimize SSE: ensure only 2 connections total
12. Add status bar with aggregated metrics
13. Write `nexus/context.md` for agent self-documentation

---

## Section 6: API Endpoints (unchanged)

No backend changes required. Nexus consumes the same endpoints:

| Endpoint | Method | Used by Tab |
|----------|--------|-------------|
| `/api/system/activity/stream` | SSE | Activity |
| `/api/system/activity?limit=200` | GET | Activity (backfill) |
| `/api/system/agents` | GET | Agents (5s poll) |
| `/api/stream/agent-monitor` | SSE | Agents + Sessions |
| `/api/system/agents/{id}/hierarchy` | PATCH | Agents (reassign) |
| `/api/system/agents/{id}/pause` | POST | Agents |
| `/api/system/agents/{id}/resume` | POST | Agents |
| `/api/system/agents/spawn` | POST | Agents (spawn modal) |
| `/api/sessions/active` | GET | Sessions |
| `/api/sessions/{key}/context` | GET | Agents + Sessions (prompt) |
| `/api/sessions/{key}/kill` | POST | Agents + Sessions |
| `/api/sessions/registry/flush` | DELETE | Sessions |
| `/api/system/backups` | GET | Backups (10s poll) |
| `/api/system/panic` | POST | Header (panic button) |
| `/api/system/sse-ticket` | POST | SSE auth |

---

## Section 7: What Gets Better

| Metric | Before (3 apps) | After (Nexus) |
|--------|-----------------|---------------|
| SSE connections (all open) | 4 | 2 |
| App launcher entries | 3 | 1 |
| Total component files | 3 large monoliths | ~10 focused modules |
| Duplicated CSS lines | ~300 | 0 (shared `styles.ts`) |
| Context switches to kill an agent | Open Monitor → find → kill | Click agent → Kill |
| Token visibility from agent tree | ❌ (need Monitor) | ✅ (in detail panel) |
| System prompt from agent tree | ❌ (need Monitor) | ✅ (in detail panel) |

---

## Section 8: Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Large single component | Hard to maintain | Split into tab files + components/ |
| Tab switching re-renders | Performance | Keep SSE hooks at root; tabs receive data via props |
| Backup polling when hidden | Wasted requests | `enabled: activeTab === 'backups'` flag |
| Lost functionality during migration | Broken workflows | Phase A keeps originals running alongside Nexus |
| Name bikeshedding | Delays | Ship as "Nexus", rename later (1 constant) |

---

## Estimated Scope

- **New files:** ~10
- **Deleted files:** 3 (+ their context.md and agent-prompt.md)
- **Modified files:** 2 (apps.ts, systemApps.ts)
- **Shared hooks reused:** useSecureSse, useSessionRegistry, useActivityStore (Zustand)
- **Backend changes:** 0
