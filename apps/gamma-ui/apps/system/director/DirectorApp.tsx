import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { create } from "zustand";
import { List as VirtualList } from "react-window";
import type { ActivityEvent, AgentRegistryEntry, GammaSSEEvent, SpawnAgentDto, AgentRole } from "@gamma/types";
import { systemAuthHeaders } from "../../../lib/auth";
import { API_BASE } from "../../../constants/api";
import { useSecureSse } from "../../../hooks/useSecureSse";

// ─── Event color coding ───────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  tool_call_start: "#ffd787",
  tool_call_end:   "#ffd787",
  message_sent:    "#5fd7ff",
  message_completed: "#87d7ff",
  context_injected:  "#d7afff",
  lifecycle_start: "#5fff87",
  lifecycle_end:   "#888",
  lifecycle_error: "#ff5f5f",
  emergency_stop:  "#ff5f5f",
  agent_registered:   "#87ffd7",
  agent_deregistered: "#d787ff",
  agent_status_change: "#888",
  hierarchy_change: "#d7afff",
  system_event:    "#d787ff",
};

function getEventColor(kind: string, severity: string): string {
  if (severity === "error") return "#ff5f5f";
  return KIND_COLORS[kind] ?? "#aaa";
}

const KIND_ICONS: Record<string, string> = {
  tool_call_start: "⚙",
  tool_call_end:   "⚙",
  message_sent:    "→",
  message_completed: "✦",
  context_injected:  "↯",
  lifecycle_start: "▶",
  lifecycle_end:   "■",
  lifecycle_error: "✕",
  emergency_stop:  "☠",
  agent_registered:   "+",
  agent_deregistered: "−",
  agent_status_change: "◦",
  hierarchy_change: "⇅",
  system_event:    "⚡",
};

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ").toUpperCase();
}

function formatTime(ts: number): string {
  if (!ts || ts <= 0) return "--:--:--";
  try {
    return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
  } catch {
    return "--:--:--";
  }
}

function relativeTime(ts: number): string {
  if (!ts || ts <= 0) return "—";
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 0) return "just now";
  if (diff < 2) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function buildDetail(ev: ActivityEvent): string {
  const parts: string[] = [];
  if (ev.toolName) parts.push(ev.toolName);
  if (ev.targetAgentId) parts.push(`→ ${ev.targetAgentId}`);
  if (ev.payload) parts.push(ev.payload);
  if (ev.appId) parts.push(`[${ev.appId}]`);
  return parts.join(" ");
}

// ─── Zustand store ────────────────────────────────────────────────────────────

interface ActivityStore {
  events: ActivityEvent[];
  push: (e: ActivityEvent) => void;
  clear: () => void;
}

const MAX_EVENTS = 500;

const useActivityStore = create<ActivityStore>((set) => ({
  events: [],
  push: (e) =>
    set((s) => ({
      events: [e, ...s.events].slice(0, MAX_EVENTS),
    })),
  clear: () => set({ events: [] }),
}));

// ─── Styles ───────────────────────────────────────────────────────────────────

const ROOT: React.CSSProperties = {
  background: "var(--glass-bg)",
  backdropFilter: "var(--glass-blur)",
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-system)",
  fontSize: 12,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const HEADER: React.CSSProperties = {
  padding: "10px 16px",
  borderBottom: "1px solid var(--color-border-subtle)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
  gap: 12,
};

const BODY: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const FEED_PANE: React.CSSProperties = {
  flex: "1 1 0",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  borderRight: "1px solid var(--color-border-subtle)",
};

const AGENTS_PANE: React.CSSProperties = {
  flex: "0 0 240px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const PANE_HEADER: React.CSSProperties = {
  padding: "6px 12px",
  borderBottom: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-muted)",
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const SCROLL: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
};

const STATUS_COLORS: Record<string, string> = {
  running: "#5fff87",
  idle:    "#ffd787",
  error:   "#ff5f5f",
  aborted: "#ff9f43",
  offline: "#666",
};

const FEED_BTN: React.CSSProperties = {
  background: "none",
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-muted)",
  borderRadius: 4,
  padding: "1px 6px",
  cursor: "pointer",
  fontSize: 9,
  fontFamily: "inherit",
};

const STATUS_BAR: React.CSSProperties = {
  padding: "4px 16px",
  borderTop: "1px solid var(--color-border-subtle)",
  display: "flex",
  alignItems: "center",
  gap: 16,
  fontSize: 10,
  color: "var(--color-text-muted)",
  flexShrink: 0,
};

// ─── Activity Feed ────────────────────────────────────────────────────────────

const EVENT_ROW_HEIGHT = 26;

function ActivityFeed() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<any>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-scroll to top (newest first) unless paused
  useEffect(() => {
    if (!paused && listRef.current) {
      listRef.current.scrollToRow({ index: 0, align: "start" });
    }
  }, [events.length, paused]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "errors") return events.filter((e) => e.severity === "error");
    if (filter === "tools") return events.filter((e) => e.kind.startsWith("tool_"));
    if (filter === "ipc") return events.filter((e) => e.kind === "message_sent" || e.kind === "message_completed");
    if (filter === "lifecycle") return events.filter((e) => e.kind.startsWith("lifecycle_"));
    return events;
  }, [events, filter]);

  // Build row component with stable ref to current filtered/expanded state
  const stateRef = useRef({ filtered, expandedId, setExpandedId });
  stateRef.current = { filtered, expandedId, setExpandedId };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const RowComponent = useMemo((): any => {
    return function EventRowVirtual({ index, style }: { index: number; style: React.CSSProperties }) {
      const { filtered: f, expandedId: eid, setExpandedId: setEid } = stateRef.current;
      const ev = f[index];
      if (!ev) return null;
      return (
        <div style={style}>
          <EventRow
            event={ev}
            isExpanded={false}
            onToggle={() => setEid(eid === ev.id ? null : ev.id)}
          />
        </div>
      );
    };
  }, []);

  // Expanded event detail panel
  const expandedEvent = expandedId ? filtered.find((e) => e.id === expandedId) : null;

  return (
    <div style={FEED_PANE}>
      <div style={PANE_HEADER}>
        <span>The Pulse ({events.length})</span>
        <div style={{ display: "flex", gap: 6 }}>
          {["all", "errors", "tools", "ipc", "lifecycle"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                ...FEED_BTN,
                color: filter === f ? "#fff" : "var(--color-text-muted)",
                background: filter === f ? "rgba(255,255,255,0.08)" : "none",
              }}
            >
              {f.toUpperCase()}
            </button>
          ))}
          <span style={{ width: 1, background: "var(--color-border-subtle)", margin: "0 2px" }} />
          <button
            onClick={() => setPaused((p) => !p)}
            style={{
              ...FEED_BTN,
              color: paused ? "#ffd787" : "var(--color-text-muted)",
            }}
          >
            {paused ? "▶ RESUME" : "⏸ PAUSE"}
          </button>
          <button onClick={clear} style={FEED_BTN}>
            CLEAR
          </button>
        </div>
      </div>
      <div style={{ ...SCROLL, display: "flex", flexDirection: "column" }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: "40px 12px",
              color: "var(--color-text-muted)",
              textAlign: "center",
              fontSize: 11,
            }}
          >
            {events.length === 0
              ? "Awaiting events… Activity will appear here as agents work."
              : "No events match the current filter."}
          </div>
        ) : (
          <VirtualList
            listRef={listRef}
            rowComponent={RowComponent}
            rowCount={filtered.length}
            rowHeight={EVENT_ROW_HEIGHT}
            rowProps={{} as never}
            overscanCount={10}
            style={{ flex: 1 }}
          >
            {/* Expanded detail overlay */}
            {expandedEvent && (
              <div
                style={{
                  position: "sticky",
                  bottom: 0,
                  background: "rgba(0,0,0,0.85)",
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                  padding: "8px 12px",
                  fontSize: 10,
                  maxHeight: 200,
                  overflow: "auto",
                  zIndex: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <span style={{ color: getEventColor(expandedEvent.kind, expandedEvent.severity), fontWeight: 600 }}>
                    {KIND_ICONS[expandedEvent.kind] ?? "·"} {formatKind(expandedEvent.kind)} — {expandedEvent.agentId}
                  </span>
                  <button onClick={() => setExpandedId(null)} style={{ ...FEED_BTN, fontSize: 9 }}>CLOSE</button>
                </div>
                <pre
                  style={{
                    margin: 0,
                    fontFamily: "var(--font-system)",
                    fontSize: 10,
                    color: "var(--color-text-secondary)",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all",
                  }}
                >
                  {JSON.stringify(expandedEvent, null, 2)}
                </pre>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(expandedEvent, null, 2)).catch(() => {});
                  }}
                  style={{ ...FEED_BTN, marginTop: 6, fontSize: 9 }}
                >
                  Copy JSON
                </button>
              </div>
            )}
          </VirtualList>
        )}
      </div>
    </div>
  );
}

// ─── Expandable Event Row ─────────────────────────────────────────────────────

function EventRow({
  event: ev,
  isExpanded,
  onToggle,
}: {
  event: ActivityEvent;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const color = getEventColor(ev.kind, ev.severity);
  const icon = KIND_ICONS[ev.kind] ?? "·";
  const detail = buildDetail(ev);

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        cursor: "pointer",
        background: isExpanded ? "rgba(255,255,255,0.02)" : "transparent",
        transition: "background 0.1s",
      }}
      onClick={onToggle}
    >
      {/* Summary row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          padding: "3px 12px",
          alignItems: "baseline",
          lineHeight: 1.5,
        }}
      >
        {/* Expand indicator */}
        <span style={{ color: "var(--color-text-muted)", fontSize: 8, flexShrink: 0, width: 8, opacity: 0.5 }}>
          {isExpanded ? "▾" : "▸"}
        </span>
        {/* Timestamp */}
        <span
          style={{
            color: "var(--color-text-muted)",
            flexShrink: 0,
            fontSize: 10,
            fontVariantNumeric: "tabular-nums",
            minWidth: 56,
          }}
          title={relativeTime(ev.ts)}
        >
          {formatTime(ev.ts)}
        </span>
        {/* Icon */}
        <span style={{ color, flexShrink: 0, width: 12, textAlign: "center", fontSize: 10 }}>
          {icon}
        </span>
        {/* Source agent */}
        <span
          style={{
            color: "#87ffd7",
            flexShrink: 0,
            minWidth: 100,
            maxWidth: 140,
            fontSize: 10,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={ev.agentId}
        >
          {ev.agentId}
        </span>
        {/* Kind badge */}
        <span
          style={{
            color,
            flexShrink: 0,
            minWidth: 110,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {formatKind(ev.kind)}
        </span>
        {/* Detail */}
        {detail && (
          <span
            style={{
              color: "var(--color-text-secondary)",
              fontSize: 10,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              minWidth: 0,
            }}
            title={detail}
          >
            {truncate(detail, 140)}
          </span>
        )}
      </div>

      {/* Expanded detail panel */}
      {isExpanded && (
        <div
          style={{
            padding: "6px 12px 8px 32px",
            background: "rgba(0,0,0,0.15)",
            borderTop: "1px solid rgba(255,255,255,0.04)",
            fontSize: 10,
            lineHeight: 1.5,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-system)",
              fontSize: 10,
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 200,
              overflow: "auto",
            }}
          >
            {JSON.stringify(ev, null, 2)}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(ev, null, 2)).catch(() => {});
            }}
            style={{
              ...FEED_BTN,
              marginTop: 6,
              fontSize: 9,
            }}
          >
            Copy JSON
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Agent Monitor SSE hook ───────────────────────────────────────────────────

function useAgentMonitor(onUpdate: (agents: AgentRegistryEntry[]) => void) {
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  const handleMessage = useCallback((ev: MessageEvent) => {
    try {
      const event = JSON.parse(ev.data as string) as GammaSSEEvent;
      if (event.type === "agent_registry_update") {
        onUpdateRef.current(event.agents);
      }
    } catch { /* ignore */ }
  }, []);

  useSecureSse({
    path: "/api/stream/agent-monitor",
    onMessage: handleMessage,
    reconnectMs: 4000,
    label: "AgentMonitor",
  });
}

// ─── Agent Hierarchy Panel ────────────────────────────────────────────────────

function AgentHierarchy() {
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showSpawn, setShowSpawn] = useState(false);
  const events = useActivityStore((s) => s.events);

  const fetchAgents = useCallback(() => {
    fetch(`${API_BASE}/api/system/agents`, { headers: systemAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<AgentRegistryEntry[]>;
      })
      .then((data) => setAgents(data))
      .catch(() => { /* polled every 5s — transient failures expected */ });
  }, []);

  useEffect(() => {
    fetchAgents();
    const t = setInterval(fetchAgents, 5000);
    return () => clearInterval(t);
  }, [fetchAgents]);

  // FIX: Replaced inline EventSource (no reconnect, no auth) with dedicated hook.
  useAgentMonitor(setAgents);

  // Build tree: find agents waiting for IPC responses
  // Events are stored newest-first, so iterate in reverse for chronological order
  const waitingAgents = useMemo(() => {
    const waiting = new Set<string>();
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.kind === "message_sent" && ev.agentId) waiting.add(ev.agentId);
      if (ev.kind === "message_completed" && ev.agentId) waiting.delete(ev.agentId);
      if (ev.kind === "lifecycle_end" && ev.agentId) waiting.delete(ev.agentId);
    }
    return waiting;
  }, [events]);

  // Build tree structure: roots are agents with no supervisor or supervisor not in list
  const agentMap = useMemo(() => new Map(agents.map((a) => [a.agentId, a])), [agents]);
  const roots = useMemo(() => {
    return agents.filter(
      (a) => !a.supervisorId || !agentMap.has(a.supervisorId),
    );
  }, [agents, agentMap]);

  const childrenOf = useCallback(
    (parentId: string) => agents.filter((a) => a.supervisorId === parentId),
    [agents],
  );

  // FIX: Deselect agent if it disappears from the registry (e.g. after kill).
  useEffect(() => {
    if (selected && !agentMap.has(selected)) {
      setSelected(null);
    }
  }, [agentMap, selected]);

  const selectedAgent = agents.find((a) => a.agentId === selected) ?? null;

  // FIX: Added error handling + user feedback for failed reassignment.
  const [reassignError, setReassignError] = useState<string | null>(null);
  const handleReassign = async (agentId: string, supervisorId: string | null) => {
    setReassignError(null);
    try {
      const res = await fetch(`${API_BASE}/api/system/agents/${encodeURIComponent(agentId)}/hierarchy`, {
        method: "PATCH",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ supervisorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setReassignError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      fetchAgents();
    } catch (err: unknown) {
      setReassignError(err instanceof Error ? err.message : "Network error");
    }
  };

  return (
    <div style={AGENTS_PANE}>
      <div style={PANE_HEADER}>
        <span>Hierarchy ({agents.length})</span>
        <button
          onClick={() => setShowSpawn(true)}
          style={{
            ...FEED_BTN,
            color: "#87ffd7",
            borderColor: "rgba(135,255,215,0.3)",
          }}
        >
          + SPAWN
        </button>
      </div>
      <div style={SCROLL}>
        {agents.length === 0 && (
          <div style={{ padding: "24px 12px", color: "var(--color-text-muted)", textAlign: "center", fontSize: 11 }}>
            No agents online
          </div>
        )}
        {roots.map((root) => (
          <AgentTreeNode
            key={root.agentId}
            agent={root}
            depth={0}
            selected={selected}
            onSelect={setSelected}
            childrenOf={childrenOf}
            waitingAgents={waitingAgents}
            visitedIds={new Set([root.agentId])}
          />
        ))}

        {/* Reassign error toast */}
        {reassignError && (
          <div style={{ padding: "6px 12px", color: "#ff5f5f", fontSize: 10 }}>
            Reassign failed: {reassignError}
          </div>
        )}

        {/* Selected agent detail */}
        {selectedAgent && (
          <AgentDetail
            agent={selectedAgent}
            agents={agents}
            onReassign={handleReassign}
            onRefresh={fetchAgents}
            onKilled={() => setSelected(null)}
          />
        )}
      </div>

      {showSpawn && (
        <SpawnModal
          agents={agents}
          onClose={() => setShowSpawn(false)}
          onSpawned={fetchAgents}
        />
      )}
    </div>
  );
}

// ─── Recursive Tree Node ──────────────────────────────────────────────────────

function AgentTreeNode({
  agent,
  depth,
  selected,
  onSelect,
  childrenOf,
  waitingAgents,
  visitedIds,
}: {
  agent: AgentRegistryEntry;
  depth: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  childrenOf: (id: string) => AgentRegistryEntry[];
  waitingAgents: Set<string>;
  // FIX: visitedIds prevents infinite recursion on circular supervisor references.
  visitedIds: Set<string>;
}) {
  const children = childrenOf(agent.agentId);
  const dotColor = STATUS_COLORS[agent.status] ?? "#666";
  const isSelected = agent.agentId === selected;
  const isWaiting = waitingAgents.has(agent.agentId);

  return (
    <>
      <div
        onClick={() => onSelect(isSelected ? null : agent.agentId)}
        style={{
          padding: "5px 12px",
          paddingLeft: 12 + depth * 16,
          borderBottom: "1px solid rgba(255,255,255,0.03)",
          cursor: "pointer",
          background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
          transition: "background 0.1s",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {/* Hierarchy connector */}
          {depth > 0 && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 9, opacity: 0.4, marginRight: -2 }}>└</span>
          )}
          {/* Glowing status dot with pulse for waiting */}
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: dotColor,
              flexShrink: 0,
              boxShadow: isWaiting
                ? `0 0 8px ${dotColor}, 0 0 3px ${dotColor}`
                : agent.status === "running"
                  ? `0 0 6px ${dotColor}, 0 0 2px ${dotColor}`
                  : `0 0 3px ${dotColor}`,
              animation: isWaiting ? "pulse 1.5s ease-in-out infinite" : undefined,
              transition: "box-shadow 0.3s",
            }}
          />
          <span
            style={{
              fontWeight: 600,
              fontSize: 11,
              color: "var(--color-text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
            }}
          >
            {agent.agentId}
          </span>
          {isWaiting && (
            <span style={{ fontSize: 8, color: "#ffd787", opacity: 0.8 }}>WAIT</span>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            paddingLeft: depth > 0 ? 22 : 13,
            color: "var(--color-text-muted)",
            fontSize: 10,
            marginTop: 1,
          }}
        >
          <span style={{ color: dotColor, fontWeight: 600 }}>{agent.status.toUpperCase()}</span>
          <span style={{ opacity: 0.5 }}>{agent.role}</span>
          {agent.appId && <span>· {agent.appId}</span>}
          {children.length > 0 && <span style={{ opacity: 0.4 }}>({children.length})</span>}
        </div>
      </div>
      {children.map((child) => {
        // FIX: Skip nodes already rendered in this branch to prevent infinite recursion.
        if (visitedIds.has(child.agentId)) return null;
        const nextVisited = new Set(visitedIds);
        nextVisited.add(child.agentId);
        return (
          <AgentTreeNode
            key={child.agentId}
            agent={child}
            depth={depth + 1}
            selected={selected}
            onSelect={onSelect}
            childrenOf={childrenOf}
            waitingAgents={waitingAgents}
            visitedIds={nextVisited}
          />
        );
      })}
    </>
  );
}

// ─── Agent Detail Panel ───────────────────────────────────────────────────────

function AgentDetail({
  agent,
  agents,
  onReassign,
  onRefresh,
  onKilled,
}: {
  agent: AgentRegistryEntry;
  agents: AgentRegistryEntry[];
  onReassign: (agentId: string, supervisorId: string | null) => Promise<void>;
  onRefresh: () => void;
  onKilled: () => void;
}) {
  const [reassigning, setReassigning] = useState(false);
  const [killing, setKilling] = useState(false);
  const [toggling, setToggling] = useState(false);

  // FIX: Controlled supervisor select — syncs when a different agent is selected.
  const [supervisorValue, setSupervisorValue] = useState(agent.supervisorId ?? "");
  useEffect(() => {
    setSupervisorValue(agent.supervisorId ?? "");
  }, [agent.agentId, agent.supervisorId]);

  const isPaused = !agent.acceptsMessages;

  const handlePauseResume = async () => {
    setToggling(true);
    try {
      const action = isPaused ? "resume" : "pause";
      await fetch(`${API_BASE}/api/system/agents/${encodeURIComponent(agent.agentId)}/${action}`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      onRefresh();
    } catch { /* best-effort */ }
    setToggling(false);
  };

  const handleKill = async () => {
    if (!confirm(`Terminate agent "${agent.agentId}"?`)) return;
    setKilling(true);
    try {
      await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(agent.sessionKey)}/kill`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      // FIX: Notify parent to deselect before refreshing, avoiding stale detail panel.
      onKilled();
      onRefresh();
    } catch { /* best-effort */ }
    setKilling(false);
  };

  const supervisorOptions = agents
    .filter((a) => a.agentId !== agent.agentId)
    .map((a) => a.agentId);

  const controlBtn: React.CSSProperties = {
    border: "1px solid var(--color-border-subtle)",
    borderRadius: 4,
    padding: "3px 10px",
    fontSize: 10,
    cursor: "pointer",
    fontFamily: "inherit",
  };

  return (
    <div
      style={{
        padding: "10px 12px",
        borderTop: "1px solid var(--color-border-subtle)",
        background: "rgba(0,0,0,0.15)",
        fontSize: 10,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>{agent.agentId}</div>
      <DetailRow label="Role" value={agent.role} />
      <DetailRow label="Status" value={agent.status} />
      <DetailRow label="IPC" value={agent.acceptsMessages ? "active" : "paused"} />
      <DetailRow label="App" value={agent.appId || "—"} />
      <DetailRow label="Supervisor" value={agent.supervisorId || "(root)"} />
      <DetailRow label="Heartbeat" value={agent.lastHeartbeat ? relativeTime(agent.lastHeartbeat) : "—"} />
      {agent.lastActivity && <DetailRow label="Activity" value={agent.lastActivity} />}

      {/* Reassign supervisor */}
      <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
        {/* FIX: Use controlled value instead of defaultValue so it resets when agent changes. */}
        <select
          style={{
            background: "var(--color-surface-muted)",
            border: "1px solid var(--color-border-subtle)",
            color: "var(--color-text-primary)",
            borderRadius: 4,
            padding: "2px 4px",
            fontSize: 10,
            fontFamily: "inherit",
            flex: 1,
          }}
          value={supervisorValue}
          onChange={(e) => {
            const newVal = e.target.value;
            setSupervisorValue(newVal);
            setReassigning(true);
            onReassign(agent.agentId, newVal || null).finally(() => setReassigning(false));
          }}
          disabled={reassigning}
        >
          <option value="">(root — no supervisor)</option>
          {supervisorOptions.map((id) => (
            <option key={id} value={id}>{id}</option>
          ))}
        </select>
      </div>

      {/* Pause / Resume / Terminate controls */}
      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <button
          onClick={() => void handlePauseResume()}
          disabled={toggling}
          style={{
            ...controlBtn,
            background: isPaused ? "rgba(95,255,135,0.12)" : "rgba(255,215,135,0.12)",
            color: isPaused ? "#5fff87" : "#ffd787",
            cursor: toggling ? "not-allowed" : "pointer",
          }}
        >
          {toggling ? "…" : isPaused ? "▶ Resume" : "⏸ Pause"}
        </button>
        <button
          onClick={() => void handleKill()}
          disabled={killing}
          style={{
            ...controlBtn,
            background: "var(--button-danger-bg, #7a2020)",
            borderColor: "var(--button-danger-border, rgba(255,80,80,0.4))",
            color: "var(--button-danger-fg, #fff)",
            cursor: killing ? "not-allowed" : "pointer",
          }}
        >
          {killing ? "Killing…" : "Terminate"}
        </button>
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 3, lineHeight: 1.4 }}>
      <span style={{ color: "var(--color-text-muted)", minWidth: 70, flexShrink: 0 }}>{label}</span>
      <span style={{ color: "var(--color-text-secondary)", wordBreak: "break-all" }}>{value}</span>
    </div>
  );
}

// ─── Spawn Modal ──────────────────────────────────────────────────────────────

function SpawnModal({
  agents,
  onClose,
  onSpawned,
}: {
  agents: AgentRegistryEntry[];
  onClose: () => void;
  onSpawned: () => void;
}) {
  const [appId, setAppId] = useState("");
  const [role] = useState<AgentRole>("app-owner");
  const [supervisorId, setSupervisorId] = useState("system-architect");
  const [initialPrompt, setInitialPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  // FIX: Store auto-close timeout ref for proper cleanup on unmount.
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleSpawn = async () => {
    if (!appId.trim()) { setError("App ID is required"); return; }
    setLoading(true);
    setError(null);
    try {
      const body: SpawnAgentDto = {
        appId: appId.trim(),
        role,
        supervisorId: supervisorId || undefined,
        initialPrompt: initialPrompt.trim() || undefined,
      };
      const res = await fetch(`${API_BASE}/api/system/agents/spawn`, {
        method: "POST",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { ok: boolean; sessionKey?: string; error?: string };
      if (!data.ok) {
        setError(data.error || "Spawn failed");
      } else {
        setSuccess(true);
        onSpawned();
        closeTimerRef.current = setTimeout(onClose, 1200);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--glass-bg, #1a1a2e)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: 8,
          padding: "20px 24px",
          minWidth: 320,
          maxWidth: 400,
          backdropFilter: "var(--glass-blur)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Spawn New Agent</div>

        <label style={LABEL_STYLE}>
          App ID
          <input
            style={INPUT_STYLE}
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder="my-app"
            disabled={loading}
          />
        </label>

        <label style={LABEL_STYLE}>
          Supervisor
          <select
            style={INPUT_STYLE}
            value={supervisorId}
            onChange={(e) => setSupervisorId(e.target.value)}
            disabled={loading}
          >
            <option value="">(root — no supervisor)</option>
            {agents.map((a) => (
              <option key={a.agentId} value={a.agentId}>{a.agentId}</option>
            ))}
          </select>
        </label>

        <label style={LABEL_STYLE}>
          Initial Prompt (optional)
          <textarea
            style={{ ...INPUT_STYLE, minHeight: 60, resize: "vertical" }}
            value={initialPrompt}
            onChange={(e) => setInitialPrompt(e.target.value)}
            placeholder="Build a weather dashboard..."
            disabled={loading}
          />
        </label>

        {error && (
          <div style={{ color: "#ff5f5f", fontSize: 10, marginBottom: 8 }}>{error}</div>
        )}
        {success && (
          <div style={{ color: "#5fff87", fontSize: 10, marginBottom: 8 }}>Agent spawned successfully</div>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={FEED_BTN} disabled={loading}>Cancel</button>
          <button
            onClick={() => void handleSpawn()}
            disabled={loading || success}
            style={{
              ...FEED_BTN,
              color: "#5fff87",
              borderColor: "rgba(95,255,135,0.3)",
              fontWeight: 600,
            }}
          >
            {loading ? "Spawning…" : "Spawn"}
          </button>
        </div>
      </div>
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 12,
  fontSize: 10,
  color: "var(--color-text-muted)",
  fontWeight: 600,
};

const INPUT_STYLE: React.CSSProperties = {
  background: "rgba(0,0,0,0.3)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  padding: "6px 8px",
  color: "var(--color-text-primary)",
  fontSize: 11,
  fontFamily: "inherit",
  outline: "none",
};

// ─── SSE connection hook ──────────────────────────────────────────────────────

function useActivityStream(): { connected: boolean; eventCount: number } {
  const push = useActivityStore((s) => s.push);
  const eventCount = useActivityStore((s) => s.events.length);

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data as string) as Record<string, unknown>;

        // Filter out keep_alive and malformed events
        if (data.type === "keep_alive" || !data.kind) return;

        // Validate & apply fallbacks for missing fields
        const event = data as unknown as ActivityEvent;
        if (!event.id) event.id = `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        if (!event.ts || typeof event.ts !== "number" || event.ts <= 0) event.ts = Date.now();
        if (!event.agentId) event.agentId = "unknown";
        if (!event.severity) event.severity = "info";

        push(event);
      } catch {
        console.warn("[Director] SSE parse error:", ev.data);
      }
    },
    [push],
  );

  const { connected } = useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleMessage,
    reconnectMs: 3000,
    label: "Director",
  });

  return { connected, eventCount };
}

// ─── Panic Button ─────────────────────────────────────────────────────────────

function PanicButton() {
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; killed?: number } | null>(null);
  // FIX: Store dismiss timer ref to clean up on unmount (prevents setState on unmounted component).
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    };
  }, []);

  const handlePanic = async () => {
    if (!confirm("⚠ EMERGENCY STOP\n\nThis will immediately abort ALL active agent sessions.\n\nContinue?")) return;
    setLoading(true);
    setLast(null);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    try {
      const res = await fetch(`${API_BASE}/api/system/panic`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      const body = (await res.json()) as { ok: boolean; killedCount: number };
      setLast({ ok: body.ok, killed: body.killedCount });
      dismissTimerRef.current = setTimeout(() => setLast(null), 5000);
    } catch {
      setLast({ ok: false });
      dismissTimerRef.current = setTimeout(() => setLast(null), 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {last && (
        <span style={{ fontSize: 10, color: last.ok ? "#5fff87" : "#ff5f5f", fontWeight: 600 }}>
          {last.ok ? `Killed ${last.killed ?? 0} session(s)` : "Panic failed"}
        </span>
      )}
      <button
        onClick={() => void handlePanic()}
        disabled={loading}
        style={{
          background: loading ? "#7a2020" : "#c0392b",
          color: "#fff",
          border: "1px solid rgba(255,80,80,0.4)",
          borderRadius: 6,
          padding: "5px 14px",
          fontWeight: 700,
          fontSize: 11,
          cursor: loading ? "not-allowed" : "pointer",
          letterSpacing: "0.06em",
          boxShadow: "0 0 8px rgba(192,57,43,0.4)",
          transition: "background 0.15s, box-shadow 0.15s",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          if (!loading) (e.target as HTMLButtonElement).style.boxShadow = "0 0 14px rgba(192,57,43,0.7)";
        }}
        onMouseLeave={(e) => {
          (e.target as HTMLButtonElement).style.boxShadow = "0 0 8px rgba(192,57,43,0.4)";
        }}
      >
        {loading ? "STOPPING…" : "PANIC STOP"}
      </button>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function DirectorApp() {
  const { connected, eventCount } = useActivityStream();

  return (
    <div style={{ ...ROOT, position: "relative" }}>
      {/* Pulse animation for waiting agents */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      {/* Header */}
      <div style={HEADER}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.02em" }}>
            Director
          </span>
          <ConnectionBadge connected={connected} />
        </div>
        <PanicButton />
      </div>

      {/* Body */}
      <div style={BODY}>
        <ActivityFeed />
        <AgentHierarchy />
      </div>

      {/* Status bar */}
      <div style={STATUS_BAR}>
        <span>{eventCount} event{eventCount !== 1 ? "s" : ""} buffered</span>
        <span style={{ opacity: 0.4 }}>max {MAX_EVENTS}</span>
        <span style={{ marginLeft: "auto", opacity: 0.5 }}>Phase 5 — Mission Control</span>
      </div>
    </div>
  );
}

// ─── Connection badge ─────────────────────────────────────────────────────────

function ConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span
      style={{
        fontSize: 9,
        padding: "2px 8px",
        borderRadius: 10,
        background: connected ? "rgba(95,255,135,0.1)" : "rgba(255,95,95,0.1)",
        color: connected ? "#5fff87" : "#ff5f5f",
        border: `1px solid ${connected ? "rgba(95,255,135,0.2)" : "rgba(255,95,95,0.2)"}`,
        fontWeight: 600,
        letterSpacing: "0.06em",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      <span
        style={{
          width: 5,
          height: 5,
          borderRadius: "50%",
          background: connected ? "#5fff87" : "#ff5f5f",
          boxShadow: connected ? "0 0 4px #5fff87" : "0 0 4px #ff5f5f",
        }}
      />
      {connected ? "LIVE" : "RECONNECTING"}
    </span>
  );
}

// ─── Named export for app registry ────────────────────────────────────────────

export { DirectorApp };
