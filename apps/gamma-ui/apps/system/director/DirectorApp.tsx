import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import { create } from "zustand";
import type { AgentRegistryEntry, GammaSSEEvent } from "@gamma/types";
import { systemAuthHeaders } from "../../../hooks/useSessionRegistry";
import { API_BASE } from "../../../constants/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  ts: number;
  kind: string;
  agentId: string;
  targetAgentId?: string;
  windowId?: string;
  appId?: string;
  toolName?: string;
  toolCallId?: string;
  runId?: string;
  payload?: string;
  severity: "info" | "warn" | "error";
}

// ─── Event color coding ───────────────────────────────────────────────────────

const KIND_COLORS: Record<string, string> = {
  tool_call_start: "#ffd787",
  tool_call_end:   "#ffd787",
  message_sent:    "#5fd7ff",
  lifecycle_start: "#5fff87",
  lifecycle_end:   "#888",
  lifecycle_error: "#ff5f5f",
  emergency_stop:  "#ff5f5f",
  agent_registered:   "#87ffd7",
  agent_deregistered: "#d787ff",
  agent_status_change: "#888",
  file_change:     "#87ffd7",
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
  lifecycle_start: "▶",
  lifecycle_end:   "■",
  lifecycle_error: "✕",
  emergency_stop:  "☠",
  agent_registered:   "+",
  agent_deregistered: "−",
  agent_status_change: "◦",
  file_change:     "◇",
  system_event:    "⚡",
};

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ").toUpperCase();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function relativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
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

function ActivityFeed() {
  const events = useActivityStore((s) => s.events);
  const clear = useActivityStore((s) => s.clear);
  const feedRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  // Auto-scroll to top (newest first) unless paused
  useEffect(() => {
    if (!paused && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events.length, paused]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    if (filter === "errors") return events.filter((e) => e.severity === "error");
    if (filter === "tools") return events.filter((e) => e.kind.startsWith("tool_"));
    if (filter === "ipc") return events.filter((e) => e.kind === "message_sent");
    if (filter === "lifecycle") return events.filter((e) => e.kind.startsWith("lifecycle_"));
    return events;
  }, [events, filter]);

  return (
    <div style={FEED_PANE}>
      <div style={PANE_HEADER}>
        <span>The Pulse ({events.length})</span>
        <div style={{ display: "flex", gap: 6 }}>
          {/* Filter pills */}
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
        {filtered.map((ev) => {
          const color = getEventColor(ev.kind, ev.severity);
          const icon = KIND_ICONS[ev.kind] ?? "·";
          const detail = buildDetail(ev);
          return (
            <div
              key={ev.id}
              style={{
                display: "flex",
                gap: 8,
                padding: "3px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
                alignItems: "baseline",
                lineHeight: 1.5,
              }}
            >
              {/* Timestamp */}
              <span
                style={{
                  color: "var(--color-text-muted)",
                  flexShrink: 0,
                  fontSize: 10,
                  fontVariantNumeric: "tabular-nums",
                  minWidth: 60,
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
          );
        })}
      </div>
    </div>
  );
}

// ─── Agent Monitor Panel ──────────────────────────────────────────────────────

function AgentMonitor() {
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  const fetchAgents = useCallback(() => {
    fetch(`${API_BASE}/api/system/agents`, { headers: systemAuthHeaders() })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`);
        return r.json() as Promise<AgentRegistryEntry[]>;
      })
      .then((data) => setAgents(data))
      .catch(() => {/* best-effort */});
  }, []);

  // Initial fetch + poll every 5s
  useEffect(() => {
    fetchAgents();
    const t = setInterval(fetchAgents, 5000);
    return () => clearInterval(t);
  }, [fetchAgents]);

  // Also listen to SSE broadcast for instant updates
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/stream/agent-monitor`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data as string) as GammaSSEEvent;
        if (event.type === "agent_registry_update") {
          setAgents(event.agents);
        }
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  const selectedAgent = agents.find((a) => a.agentId === selected) ?? null;

  return (
    <div style={AGENTS_PANE}>
      <div style={PANE_HEADER}>
        <span>Agents ({agents.length})</span>
      </div>
      <div style={SCROLL}>
        {agents.length === 0 && (
          <div
            style={{
              padding: "24px 12px",
              color: "var(--color-text-muted)",
              textAlign: "center",
              fontSize: 11,
            }}
          >
            No agents online
          </div>
        )}
        {agents.map((ag) => {
          const dotColor = STATUS_COLORS[ag.status] ?? "#666";
          const isSelected = ag.agentId === selected;
          return (
            <div
              key={ag.agentId}
              onClick={() => setSelected(isSelected ? null : ag.agentId)}
              style={{
                padding: "7px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                cursor: "pointer",
                background: isSelected ? "rgba(255,255,255,0.05)" : "transparent",
                transition: "background 0.1s",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {/* Glowing status dot */}
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: dotColor,
                    flexShrink: 0,
                    boxShadow: ag.status === "running" ? `0 0 6px ${dotColor}, 0 0 2px ${dotColor}` : `0 0 3px ${dotColor}`,
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
                  }}
                >
                  {ag.agentId}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  paddingLeft: 14,
                  color: "var(--color-text-muted)",
                  fontSize: 10,
                  marginTop: 2,
                }}
              >
                <span style={{ color: dotColor, fontWeight: 600 }}>{ag.status.toUpperCase()}</span>
                <span style={{ opacity: 0.5 }}>{ag.role}</span>
                {ag.appId && <span>· {ag.appId}</span>}
              </div>
            </div>
          );
        })}

        {/* Selected agent detail */}
        {selectedAgent && (
          <div
            style={{
              padding: "10px 12px",
              borderTop: "1px solid var(--color-border-subtle)",
              background: "rgba(0,0,0,0.15)",
              fontSize: 10,
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 6 }}>
              {selectedAgent.agentId}
            </div>
            <DetailRow label="Role" value={selectedAgent.role} />
            <DetailRow label="Status" value={selectedAgent.status} />
            <DetailRow label="App" value={selectedAgent.appId || "—"} />
            <DetailRow label="Window" value={selectedAgent.windowId || "—"} />
            <DetailRow
              label="Heartbeat"
              value={selectedAgent.lastHeartbeat ? relativeTime(selectedAgent.lastHeartbeat) : "—"}
            />
            <DetailRow
              label="Capabilities"
              value={selectedAgent.capabilities.length > 0 ? selectedAgent.capabilities.join(", ") : "—"}
            />
            {selectedAgent.lastActivity && (
              <DetailRow label="Activity" value={selectedAgent.lastActivity} />
            )}
          </div>
        )}
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

// ─── SSE connection hook ──────────────────────────────────────────────────────

function useActivityStream(): { connected: boolean; eventCount: number } {
  const push = useActivityStore((s) => s.push);
  const eventCount = useActivityStore((s) => s.events.length);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;

    const connect = (): void => {
      if (destroyed) return;

      const url = `${API_BASE}/api/system/activity/stream`;
      console.log("[Director] SSE connecting:", url);

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        console.log("[Director] SSE connected");
        setConnected(true);
      };

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as Record<string, unknown>;

          // Filter out keep_alive and malformed events
          if (data.type === "keep_alive" || !data.kind) return;

          push(data as unknown as ActivityEvent);
        } catch {
          console.warn("[Director] SSE parse error:", ev.data);
        }
      };

      es.onerror = () => {
        console.warn("[Director] SSE error — will reconnect");
        setConnected(false);
        es.close();
        esRef.current = null;

        if (!destroyed) {
          reconnectTimerRef.current = setTimeout(connect, 3000);
        }
      };
    };

    connect();

    return () => {
      destroyed = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [push]);

  return { connected, eventCount };
}

// ─── Panic Button ─────────────────────────────────────────────────────────────

function PanicButton() {
  const [loading, setLoading] = useState(false);
  const [last, setLast] = useState<{ ok: boolean; killed?: number } | null>(null);

  const handlePanic = async () => {
    if (!confirm("⚠ EMERGENCY STOP\n\nThis will immediately abort ALL active agent sessions.\n\nContinue?")) return;
    setLoading(true);
    setLast(null);
    try {
      const res = await fetch(`${API_BASE}/api/system/panic`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      const body = (await res.json()) as { ok: boolean; killedCount: number };
      setLast({ ok: body.ok, killed: body.killedCount });
      // Auto-dismiss result after 5s
      setTimeout(() => setLast(null), 5000);
    } catch {
      setLast({ ok: false });
      setTimeout(() => setLast(null), 5000);
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
    <div style={ROOT}>
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
        <AgentMonitor />
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
