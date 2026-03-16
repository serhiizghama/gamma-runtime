import React, { useEffect, useRef, useCallback, useState, useMemo, memo } from "react";
import { create } from "zustand";
import type { ActivityEvent, AgentRegistryEntry, GammaSSEEvent, SpawnAgentDto, AgentRole } from "@gamma/types";
import { systemAuthHeaders } from "../../../lib/auth";
import { API_BASE } from "../../../constants/api";
import { useSecureSse } from "../../../hooks/useSecureSse";
import { fmtTime, truncate, relativeTime } from "../../../lib/format";

// ─── Event color coding ───────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  tool_call_start:     "#ffd787",
  tool_call_end:       "#ffd787",
  message_sent:        "#5fd7ff",
  message_completed:   "#87d7ff",
  context_injected:    "#d7afff",
  lifecycle_start:     "#5fff87",
  lifecycle_end:       "#888",
  lifecycle_error:     "#ff5f5f",
  emergency_stop:      "#ff5f5f",
  agent_registered:    "#87ffd7",
  agent_deregistered:  "#d787ff",
  agent_status_change: "#888",
  hierarchy_change:    "#d7afff",
  system_event:        "#d787ff",
  file_change:         "#87ffd7",
};

function getEventColor(kind: string, severity: string): string {
  if (severity === "error") return "#ff5f5f";
  return KIND_COLORS[kind] ?? "#aaa";
}

const KIND_ICONS: Record<string, string> = {
  tool_call_start:     "⚙",
  tool_call_end:       "⚙",
  message_sent:        "→",
  message_completed:   "✦",
  context_injected:    "↯",
  lifecycle_start:     "▶",
  lifecycle_end:       "■",
  lifecycle_error:     "✕",
  emergency_stop:      "☠",
  agent_registered:    "+",
  agent_deregistered:  "−",
  agent_status_change: "◦",
  hierarchy_change:    "⇅",
  system_event:        "⚡",
  file_change:         "✎",
};

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ").toUpperCase();
}

// ─── Payload smart-rendering helpers ─────────────────────────────────────────

/** Status colors for agent_status_change payloads */
const STATUS_PAYLOAD_COLORS: Record<string, string> = {
  running: "#5fff87",
  idle:    "#ffd787",
  paused:  "#ff9f43",
  resumed: "#5fd7ff",
  error:   "#ff5f5f",
};

/**
 * Render a concise, human-readable detail string for a given event kind.
 * Falls back to truncated raw payload when parsing isn't meaningful.
 */
function renderPayloadDetail(ev: ActivityEvent): React.ReactNode {
  const { kind, payload, toolName, targetAgentId, appId, severity } = ev;

  // ── tool_call_start: show tool name + key args ──────────────────────────
  if (kind === "tool_call_start" && payload) {
    const color = severity === "error" ? "#ff5f5f" : "#ffd787";
    const args = tryParseJson(payload);
    if (args && typeof args === "object" && !Array.isArray(args)) {
      // Pick 2 most meaningful keys to show inline
      const entries = Object.entries(args as Record<string, unknown>)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .slice(0, 2)
        .map(([k, v]) => {
          const vs = typeof v === "string" ? v : JSON.stringify(v);
          return `${k}=${truncate(vs, 40)}`;
        });
      if (entries.length > 0) {
        return <span style={{ color }}>{entries.join(" · ")}</span>;
      }
    }
    return payload ? <span style={{ color }}>{truncate(payload, 100)}</span> : null;
  }

  // ── tool_call_end: show ✅/❌ + truncated result ────────────────────────
  if (kind === "tool_call_end" && payload) {
    const ok = severity !== "error";
    const icon = ok ? "✓" : "✕";
    const iconColor = ok ? "#5fff87" : "#ff5f5f";
    const textColor = ok ? "var(--color-text-secondary)" : "#ff9f9f";
    // payload is JSON result — unwrap if it's a simple value
    const parsed = tryParseJson(payload);
    let display: string;
    if (parsed === null || parsed === undefined) {
      display = "—";
    } else if (typeof parsed === "string") {
      display = truncate(parsed, 80);
    } else if (typeof parsed === "object") {
      display = truncate(JSON.stringify(parsed), 80);
    } else {
      display = String(parsed);
    }
    return (
      <span>
        <span style={{ color: iconColor, fontWeight: 700, marginRight: 5 }}>{icon}</span>
        <span style={{ color: textColor }}>{display}</span>
      </span>
    );
  }

  // ── agent_status_change: colored status badge ───────────────────────────
  if (kind === "agent_status_change" && payload) {
    const color = STATUS_PAYLOAD_COLORS[payload.toLowerCase()] ?? "#aaa";
    return (
      <span
        style={{
          color,
          fontWeight: 700,
          fontSize: 9,
          letterSpacing: "0.06em",
          padding: "1px 5px",
          borderRadius: 3,
          background: `${color}18`,
          border: `1px solid ${color}40`,
        }}
      >
        {payload.toUpperCase()}
      </span>
    );
  }

  // ── context_injected: show size as a subtle badge ───────────────────────
  if (kind === "context_injected" && payload) {
    return <span style={{ color: "#d7afff", opacity: 0.75 }}>{payload}</span>;
  }

  // ── message_completed: show text snippet ───────────────────────────────
  if (kind === "message_completed" && payload) {
    return <span style={{ color: "var(--color-text-secondary)", fontStyle: "italic" }}>"{truncate(payload, 90)}"</span>;
  }

  // ── hierarchy_change ────────────────────────────────────────────────────
  if (kind === "hierarchy_change") {
    const parts: string[] = [];
    if (targetAgentId) parts.push(`→ ${targetAgentId}`);
    if (payload) parts.push(payload);
    return parts.length > 0 ? <span style={{ color: "#d7afff" }}>{parts.join(" ")}</span> : null;
  }

  // ── fallback: toolName + targetAgentId + appId + raw payload ───────────
  const parts: string[] = [];
  if (toolName) parts.push(toolName);
  if (targetAgentId) parts.push(`→ ${targetAgentId}`);
  if (payload) parts.push(payload);
  if (appId) parts.push(`[${appId}]`);
  if (parts.length === 0) return null;
  return <span style={{ color: "var(--color-text-secondary)" }}>{truncate(parts.join(" "), 140)}</span>;
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return undefined; }
}

// ─── Zustand store ────────────────────────────────────────────────────────────

interface ActivityStore {
  events: ActivityEvent[];
  // Maintained O(1) per push — no full-array scan on each new event.
  waitingAgents: ReadonlySet<string>;
  // Track tool_call_start ts by toolCallId for duration computation.
  toolStartTs: Map<string, number>;
  // Computed durations: toolCallId → ms
  toolDurations: Map<string, number>;
  push: (e: ActivityEvent) => void;
  pushMany: (events: ActivityEvent[]) => void;
  clear: () => void;
}

const MAX_EVENTS = 500;

const useActivityStore = create<ActivityStore>((set, get) => ({
  events: [],
  waitingAgents: new Set<string>(),
  toolStartTs: new Map(),
  toolDurations: new Map(),

  push: (e) =>
    set((s) => {
      const events = [e, ...s.events].slice(0, MAX_EVENTS);

      // waitingAgents — O(1) incremental update
      let waitingAgents = s.waitingAgents as Set<string>;
      if (e.kind === "message_sent" && e.agentId && !waitingAgents.has(e.agentId)) {
        waitingAgents = new Set(waitingAgents);
        waitingAgents.add(e.agentId);
      } else if (
        (e.kind === "message_completed" || e.kind === "lifecycle_end") &&
        e.agentId && waitingAgents.has(e.agentId)
      ) {
        waitingAgents = new Set(waitingAgents);
        waitingAgents.delete(e.agentId);
      }

      // tool durations — track start ts, compute on end
      let { toolStartTs, toolDurations } = s;
      if (e.kind === "tool_call_start" && e.toolCallId) {
        toolStartTs = new Map(toolStartTs);
        toolStartTs.set(e.toolCallId, e.ts);
      } else if (e.kind === "tool_call_end" && e.toolCallId && toolStartTs.has(e.toolCallId)) {
        const startTs = toolStartTs.get(e.toolCallId)!;
        const dur = e.ts - startTs;
        toolDurations = new Map(toolDurations);
        toolDurations.set(e.toolCallId, dur);
        toolStartTs = new Map(toolStartTs);
        toolStartTs.delete(e.toolCallId);
      }

      return { events, waitingAgents, toolStartTs, toolDurations };
    }),

  // Bulk-load historical events (backfill on mount).
  // Events come oldest-first from the API; store is newest-first.
  pushMany: (incoming) =>
    set((s) => {
      // De-dup against already-stored ids (SSE may have arrived first)
      const existingIds = new Set(s.events.map((e) => e.id));
      const fresh = incoming.filter((e) => !existingIds.has(e.id));
      if (fresh.length === 0) return s;

      // Rebuild toolStartTs + toolDurations from historical batch
      const toolStartTs = new Map(s.toolStartTs);
      const toolDurations = new Map(s.toolDurations);
      for (const e of fresh) {
        if (e.kind === "tool_call_start" && e.toolCallId) {
          toolStartTs.set(e.toolCallId, e.ts);
        } else if (e.kind === "tool_call_end" && e.toolCallId && toolStartTs.has(e.toolCallId)) {
          toolDurations.set(e.toolCallId, e.ts - toolStartTs.get(e.toolCallId)!);
          toolStartTs.delete(e.toolCallId);
        }
      }

      // Merge: existing (newer) + fresh (older), cap at MAX_EVENTS
      const merged = [...s.events, ...fresh]
        .sort((a, b) => b.ts - a.ts)
        .slice(0, MAX_EVENTS);

      return { events: merged, toolStartTs, toolDurations };
    }),

  clear: () =>
    set({
      events: [],
      waitingAgents: new Set(),
      toolStartTs: new Map(),
      toolDurations: new Map(),
    }),
}));

// ─── History backfill ─────────────────────────────────────────────────────────
// Fetches the last 200 events from REST on mount so the feed isn't empty
// when Director opens. SSE then continues from the latest event id.

async function fetchHistoricalActivity(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/system/activity?limit=200`, {
      headers: systemAuthHeaders(),
    });
    if (!res.ok) return;
    const data = (await res.json()) as ActivityEvent[];
    if (Array.isArray(data) && data.length > 0) {
      useActivityStore.getState().pushMany(data);
    }
  } catch {
    // Non-critical: SSE will populate the feed anyway
  }
}

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

// position: relative anchors SpawnModal's inset: 0 to this pane.
const AGENTS_PANE: React.CSSProperties = {
  flex: "0 0 240px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  position: "relative",
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

const AGENT_CTRL_BTN: React.CSSProperties = {
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 4,
  padding: "3px 10px",
  fontSize: 10,
  cursor: "pointer",
  fontFamily: "inherit",
};

const EMPTY_CHILDREN: AgentRegistryEntry[] = [];

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  const feedRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Auto-scroll to top (newest first) unless paused.
  useEffect(() => {
    if (!paused && feedRef.current) {
      feedRef.current.scrollTop = 0;
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

  // Stable toggle callback — avoids defeating React.memo on EventRow.
  const handleToggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

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
      <div ref={feedRef} style={SCROLL}>
        {filtered.length === 0 && (
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
        )}
        {filtered.map((ev) => (
          <EventRow
            key={ev.id}
            event={ev}
            isExpanded={expandedId === ev.id}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Expandable Event Row ─────────────────────────────────────────────────────

const EventRow = memo(function EventRow({
  event: ev,
  isExpanded,
  onToggle,
}: {
  event: ActivityEvent;
  isExpanded: boolean;
  onToggle: (id: string) => void;
}) {
  const toolDurations = useActivityStore((s) => s.toolDurations);
  const color = getEventColor(ev.kind, ev.severity);
  const icon = KIND_ICONS[ev.kind] ?? "·";
  const payloadNode = renderPayloadDetail(ev);

  // Duration badge for tool events
  const durMs = ev.toolCallId ? toolDurations.get(ev.toolCallId) : undefined;

  const handleClick = useCallback(() => onToggle(ev.id), [onToggle, ev.id]);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(JSON.stringify(ev, null, 2)).catch(() => {});
  }, [ev]);

  return (
    <div
      style={{
        borderBottom: "1px solid rgba(255,255,255,0.03)",
        cursor: "pointer",
        background: isExpanded ? "rgba(255,255,255,0.02)" : "transparent",
        transition: "background 0.1s",
      }}
      onClick={handleClick}
    >
      {/* Summary row */}
      <div
        style={{
          display: "flex",
          gap: 6,
          padding: "3px 12px",
          alignItems: "center",
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
          {fmtTime(ev.ts)}
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
            minWidth: 90,
            maxWidth: 130,
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
            minWidth: 105,
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: "0.04em",
          }}
        >
          {formatKind(ev.kind)}
        </span>
        {/* Smart payload detail */}
        {payloadNode && (
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 10,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {payloadNode}
          </span>
        )}
        {/* Duration badge for tool events */}
        {durMs !== undefined && (
          <span
            style={{
              flexShrink: 0,
              fontSize: 9,
              color: durMs > 5000 ? "#ff9f43" : durMs > 1000 ? "#ffd787" : "#87ffd7",
              fontVariantNumeric: "tabular-nums",
              opacity: 0.85,
              marginLeft: 4,
            }}
            title={`Tool execution: ${durMs}ms`}
          >
            {durMs >= 1000 ? `${(durMs / 1000).toFixed(1)}s` : `${durMs}ms`}
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
          {/* Structured fields before raw JSON */}
          <ExpandedEventDetail event={ev} durMs={durMs} />
          <pre
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-system)",
              fontSize: 10,
              color: "var(--color-text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              maxHeight: 220,
              overflow: "auto",
              borderTop: "1px solid rgba(255,255,255,0.04)",
              paddingTop: 6,
            }}
          >
            {JSON.stringify(ev, null, 2)}
          </pre>
          <button onClick={handleCopy} style={{ ...FEED_BTN, marginTop: 6, fontSize: 9 }}>
            Copy JSON
          </button>
        </div>
      )}
    </div>
  );
});

// ─── Expanded Event Detail (structured view) ──────────────────────────────────

function ExpandedEventDetail({ event: ev, durMs }: { event: ActivityEvent; durMs?: number }) {
  const rows: { label: string; value: React.ReactNode; color?: string }[] = [];

  if (ev.runId) rows.push({ label: "Run", value: ev.runId, color: "var(--color-text-muted)" });
  if (ev.windowId) rows.push({ label: "Window", value: ev.windowId, color: "var(--color-text-muted)" });
  if (ev.appId) rows.push({ label: "App", value: ev.appId });
  if (ev.toolName) rows.push({ label: "Tool", value: ev.toolName, color: "#ffd787" });
  if (ev.toolCallId) rows.push({ label: "Call ID", value: ev.toolCallId, color: "var(--color-text-muted)" });
  if (durMs !== undefined) {
    const col = durMs > 5000 ? "#ff9f43" : durMs > 1000 ? "#ffd787" : "#87ffd7";
    rows.push({ label: "Duration", value: durMs >= 1000 ? `${(durMs / 1000).toFixed(2)}s` : `${durMs}ms`, color: col });
  }

  // For tool events, try to pretty-print JSON payload
  if ((ev.kind === "tool_call_start" || ev.kind === "tool_call_end") && ev.payload) {
    const parsed = tryParseJson(ev.payload);
    if (parsed && typeof parsed === "object") {
      rows.push({
        label: ev.kind === "tool_call_start" ? "Args" : "Result",
        value: (
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-all", fontSize: 9, color: ev.severity === "error" ? "#ff9f9f" : "#87ffd7" }}>
            {JSON.stringify(parsed, null, 2).slice(0, 500)}
          </pre>
        ),
      });
    } else if (ev.payload) {
      rows.push({ label: ev.kind === "tool_call_start" ? "Args" : "Result", value: ev.payload });
    }
  } else if (ev.payload && !["agent_status_change", "context_injected", "message_completed"].includes(ev.kind)) {
    rows.push({ label: "Payload", value: ev.payload });
  }

  if (rows.length === 0) return null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", rowGap: 2, columnGap: 8, fontSize: 10 }}>
      {rows.map(({ label, value, color }) => (
        <React.Fragment key={label}>
          <span style={{ color: "var(--color-text-muted)", fontWeight: 600, alignSelf: "start" }}>{label}</span>
          <span style={{ color: color ?? "var(--color-text-secondary)", wordBreak: "break-all" }}>{value}</span>
        </React.Fragment>
      ))}
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
  const waitingAgents = useActivityStore((s) => s.waitingAgents);

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

  useAgentMonitor(setAgents);

  const agentMap = useMemo(() => new Map(agents.map((a) => [a.agentId, a])), [agents]);

  const roots = useMemo(
    () => agents.filter((a) => !a.supervisorId || !agentMap.has(a.supervisorId)),
    [agents, agentMap],
  );

  const childrenMap = useMemo(() => {
    const map = new Map<string, AgentRegistryEntry[]>();
    for (const agent of agents) {
      if (agent.supervisorId) {
        const arr = map.get(agent.supervisorId) ?? [];
        arr.push(agent);
        map.set(agent.supervisorId, arr);
      }
    }
    return map;
  }, [agents]);

  useEffect(() => {
    if (selected && !agentMap.has(selected)) setSelected(null);
  }, [agentMap, selected]);

  const selectedAgent = agents.find((a) => a.agentId === selected) ?? null;

  const [reassignError, setReassignError] = useState<string | null>(null);
  const reassignErrorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleReassign = useCallback(async (agentId: string, supervisorId: string | null) => {
    if (reassignErrorTimerRef.current) clearTimeout(reassignErrorTimerRef.current);
    setReassignError(null);
    try {
      const res = await fetch(`${API_BASE}/api/system/agents/${encodeURIComponent(agentId)}/hierarchy`, {
        method: "PATCH",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ supervisorId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        const msg = body.error ?? `HTTP ${res.status}`;
        setReassignError(msg);
        reassignErrorTimerRef.current = setTimeout(() => setReassignError(null), 4000);
        return;
      }
      fetchAgents();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Network error";
      setReassignError(msg);
      reassignErrorTimerRef.current = setTimeout(() => setReassignError(null), 4000);
    }
  }, [fetchAgents]);

  const handleKilled = useCallback(() => setSelected(null), []);

  useEffect(() => {
    return () => {
      if (reassignErrorTimerRef.current) clearTimeout(reassignErrorTimerRef.current);
    };
  }, []);

  return (
    <div style={AGENTS_PANE}>
      <div style={PANE_HEADER}>
        <span>Hierarchy ({agents.length})</span>
        <button
          onClick={() => setShowSpawn(true)}
          style={{ ...FEED_BTN, color: "#87ffd7", borderColor: "rgba(135,255,215,0.3)" }}
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
            childrenMap={childrenMap}
            waitingAgents={waitingAgents}
            visitedIds={new Set([root.agentId])}
          />
        ))}

        {reassignError && (
          <div style={{ padding: "6px 12px", color: "#ff5f5f", fontSize: 10 }}>
            Reassign failed: {reassignError}
          </div>
        )}

        {selectedAgent && (
          <AgentDetail
            agent={selectedAgent}
            agents={agents}
            onReassign={handleReassign}
            onRefresh={fetchAgents}
            onKilled={handleKilled}
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
  childrenMap,
  waitingAgents,
  visitedIds,
}: {
  agent: AgentRegistryEntry;
  depth: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  childrenMap: Map<string, AgentRegistryEntry[]>;
  waitingAgents: ReadonlySet<string>;
  visitedIds: Set<string>;
}) {
  const children = childrenMap.get(agent.agentId) ?? EMPTY_CHILDREN;
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
          {depth > 0 && (
            <span style={{ color: "var(--color-text-muted)", fontSize: 9, opacity: 0.4, marginRight: -2 }}>└</span>
          )}
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
            childrenMap={childrenMap}
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

  const [supervisorValue, setSupervisorValue] = useState(agent.supervisorId ?? "");
  useEffect(() => {
    setSupervisorValue(agent.supervisorId ?? "");
  }, [agent.agentId, agent.supervisorId]);

  const isPaused = agent.acceptsMessages === false;

  const handlePauseResume = useCallback(async () => {
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
  }, [agent.agentId, isPaused, onRefresh]);

  const handleKill = useCallback(async () => {
    if (!confirm(`Terminate agent "${agent.agentId}"?`)) return;
    setKilling(true);
    try {
      await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(agent.sessionKey)}/kill`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      onKilled();
      onRefresh();
    } catch { /* best-effort */ }
    setKilling(false);
  }, [agent.agentId, agent.sessionKey, onKilled, onRefresh]);

  const supervisorOptions = useMemo(
    () => agents.filter((a) => a.agentId !== agent.agentId).map((a) => a.agentId),
    [agents, agent.agentId],
  );

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
      {agent.acceptsMessages !== undefined && (
        <DetailRow label="IPC" value={agent.acceptsMessages ? "active" : "paused"} />
      )}
      <DetailRow label="App" value={agent.appId || "—"} />
      <DetailRow label="Supervisor" value={agent.supervisorId || "(root)"} />
      <DetailRow label="Heartbeat" value={agent.lastHeartbeat ? relativeTime(agent.lastHeartbeat) : "—"} />
      {agent.lastActivity && <DetailRow label="Activity" value={agent.lastActivity} />}

      <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
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

      <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
        <button
          onClick={() => void handlePauseResume()}
          disabled={toggling}
          style={{
            ...AGENT_CTRL_BTN,
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
            ...AGENT_CTRL_BTN,
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
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (closeTimerRef.current) clearTimeout(closeTimerRef.current); };
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
          minWidth: 300,
          maxWidth: 380,
          backdropFilter: "var(--glass-blur)",
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 16 }}>Spawn New Agent</div>

        <label style={LABEL_STYLE}>
          App ID
          <input style={INPUT_STYLE} value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="my-app" disabled={loading} />
        </label>

        <label style={LABEL_STYLE}>
          Supervisor
          <select style={INPUT_STYLE} value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)} disabled={loading}>
            <option value="">(root — no supervisor)</option>
            {agents.map((a) => <option key={a.agentId} value={a.agentId}>{a.agentId}</option>)}
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

        {error && <div style={{ color: "#ff5f5f", fontSize: 10, marginBottom: 8 }}>{error}</div>}
        {success && <div style={{ color: "#5fff87", fontSize: 10, marginBottom: 8 }}>Agent spawned successfully</div>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
          <button onClick={onClose} style={FEED_BTN} disabled={loading}>Cancel</button>
          <button
            onClick={() => void handleSpawn()}
            disabled={loading || success}
            style={{ ...FEED_BTN, color: "#5fff87", borderColor: "rgba(95,255,135,0.3)", fontWeight: 600 }}
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
        if (data.type === "keep_alive" || !data.kind) return;

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
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => { if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current); };
  }, []);

  const handlePanic = async () => {
    if (!confirm("⚠ EMERGENCY STOP\n\nThis will immediately abort ALL active agent sessions.\n\nContinue?")) return;
    setLoading(true);
    setLast(null);
    if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current);
    try {
      const res = await fetch(`${API_BASE}/api/system/panic`, { method: "POST", headers: systemAuthHeaders() });
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

  // Backfill historical events on first mount so the feed isn't empty.
  // Runs once; SSE picks up from there.
  useEffect(() => {
    void fetchHistoricalActivity();
  }, []);

  return (
    <div style={{ ...ROOT, position: "relative" }}>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
      <div style={HEADER}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.02em" }}>Director</span>
          <ConnectionBadge connected={connected} />
        </div>
        <PanicButton />
      </div>

      <div style={BODY}>
        <ActivityFeed />
        <AgentHierarchy />
      </div>

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

export { DirectorApp };
