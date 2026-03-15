import React, { useEffect, useRef, useCallback, useState } from "react";
import { create } from "zustand";
import type { AgentRegistryEntry } from "@gamma/types";
import { systemAuthHeaders } from "../../../hooks/useSessionRegistry";
import { API_BASE } from "../../../constants/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  ts: number;
  kind: string;
  agentId: string;
  targetAgentId?: string;
  toolName?: string;
  payload?: string;
  severity: "info" | "warn" | "error";
}

// ─── Event color coding ───────────────────────────────────────────────────────

function getEventColor(kind: string, severity: string): string {
  if (severity === "error" || kind === "lifecycle_error" || kind === "emergency_stop") return "#ff5f5f";
  if (kind === "tool_call_start" || kind === "tool_call_end") return "#ffd787";
  if (kind === "message_sent") return "#5fd7ff";
  if (kind.startsWith("lifecycle") || kind.startsWith("agent_")) return "#888";
  if (kind === "file_change") return "#87ffd7";
  if (kind === "system_event") return "#d787ff";
  return "#aaa";
}

function formatKind(kind: string): string {
  return kind.replace(/_/g, " ").toUpperCase();
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

function truncate(s: string | undefined, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n) + "…" : s;
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
  flex: "0 0 220px",
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

const STATUS_DOT: Record<string, string> = {
  running: "#5fff87",
  idle:    "#ffd787",
  busy:    "#5fd7ff",
  error:   "#ff5f5f",
};

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed() {
  const events = useActivityStore((s) => s.events);
  const clear  = useActivityStore((s) => s.clear);
  const feedRef = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);

  pausedRef.current = paused;

  // Auto-scroll to top (newest first) unless paused
  useEffect(() => {
    if (!paused && feedRef.current) {
      feedRef.current.scrollTop = 0;
    }
  }, [events, paused]);

  return (
    <div style={FEED_PANE}>
      <div style={PANE_HEADER}>
        <span>Activity Stream</span>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => setPaused((p) => !p)}
            style={{
              background: "none",
              border: "1px solid var(--color-border-subtle)",
              color: paused ? "#ffd787" : "var(--color-text-muted)",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: "pointer",
              fontSize: 9,
            }}
          >
            {paused ? "RESUME" : "PAUSE"}
          </button>
          <button
            onClick={clear}
            style={{
              background: "none",
              border: "1px solid var(--color-border-subtle)",
              color: "var(--color-text-muted)",
              borderRadius: 4,
              padding: "1px 6px",
              cursor: "pointer",
              fontSize: 9,
            }}
          >
            CLEAR
          </button>
        </div>
      </div>
      <div ref={feedRef} style={SCROLL}>
        {events.length === 0 && (
          <div style={{ padding: "24px 12px", color: "var(--color-text-muted)", textAlign: "center" }}>
            Awaiting events…
          </div>
        )}
        {events.map((ev) => {
          const color = getEventColor(ev.kind, ev.severity);
          return (
            <div
              key={ev.id}
              style={{
                display: "flex",
                gap: 8,
                padding: "4px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                alignItems: "flex-start",
                lineHeight: 1.4,
              }}
            >
              {/* timestamp */}
              <span style={{ color: "var(--color-text-muted)", flexShrink: 0, fontSize: 10, marginTop: 1 }}>
                {formatTime(ev.ts)}
              </span>
              {/* source agent */}
              <span style={{ color: "#87ffd7", flexShrink: 0, minWidth: 90, fontSize: 10, marginTop: 1 }}>
                {truncate(ev.agentId, 18)}
              </span>
              {/* kind badge */}
              <span
                style={{
                  color,
                  flexShrink: 0,
                  minWidth: 120,
                  fontSize: 9,
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  marginTop: 2,
                }}
              >
                {formatKind(ev.kind)}
              </span>
              {/* payload */}
              {ev.payload && (
                <span style={{ color: "var(--color-text-secondary)", fontSize: 10, wordBreak: "break-all" }}>
                  {truncate(ev.payload, 120)}
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

  const fetchAgents = useCallback(() => {
    fetch(`${API_BASE}/api/system/agents`, { headers: systemAuthHeaders() })
      .then((r) => r.json())
      .then((data: AgentRegistryEntry[]) => setAgents(data))
      .catch(() => {/* best-effort */});
  }, []);

  useEffect(() => {
    fetchAgents();
    const t = setInterval(fetchAgents, 5000);
    return () => clearInterval(t);
  }, [fetchAgents]);

  return (
    <div style={AGENTS_PANE}>
      <div style={PANE_HEADER}>
        <span>Agents ({agents.length})</span>
      </div>
      <div style={SCROLL}>
        {agents.length === 0 && (
          <div style={{ padding: "16px 12px", color: "var(--color-text-muted)", textAlign: "center" }}>
            No agents
          </div>
        )}
        {agents.map((ag) => {
          const dot = STATUS_DOT[ag.status] ?? "#888";
          return (
            <div
              key={ag.agentId}
              style={{
                padding: "6px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: dot, flexShrink: 0,
                  boxShadow: `0 0 4px ${dot}`,
                }} />
                <span style={{ fontWeight: 600, fontSize: 11, color: "var(--color-text-primary)" }}>
                  {ag.agentId}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, paddingLeft: 13, color: "var(--color-text-muted)", fontSize: 10 }}>
                <span style={{ color: dot }}>{ag.status.toUpperCase()}</span>
                {ag.appId && <span>· {ag.appId}</span>}
              </div>
              {ag.lastActivity && (
                <div style={{ paddingLeft: 13, fontSize: 9, color: "var(--color-text-muted)", opacity: 0.6 }}>
                  {truncate(ag.lastActivity, 40)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SSE connection hook ──────────────────────────────────────────────────────

function useActivityStream() {
  const push = useActivityStore((s) => s.push);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const headers = systemAuthHeaders();
    const token = (headers as Record<string, string>)["X-Gamma-System-Token"] ?? "";
    const url = `${API_BASE}/api/system/activity/stream?token=${encodeURIComponent(token)}`;

    const connect = (): void => {
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data as string) as ActivityEvent;
          push(data);
        } catch { /* malformed — ignore */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        esRef.current = null;
        setTimeout(connect, 3000); // reconnect
      };
    };

    connect();
    return () => {
      esRef.current?.close();
      esRef.current = null;
    };
  }, [push]);

  return connected;
}

// ─── Panic Button ─────────────────────────────────────────────────────────────

function PanicButton() {
  const [loading, setLoading] = useState(false);
  const [last, setLast]       = useState<{ ok: boolean; killed?: number } | null>(null);

  const handlePanic = async () => {
    if (!confirm("⚠️ PANIC: This will kill ALL agent sessions. Continue?")) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/system/panic`, {
        method: "POST",
        headers: systemAuthHeaders(),
      });
      const body = (await res.json()) as { ok: boolean; killedCount: number };
      setLast({ ok: body.ok, killed: body.killedCount });
    } catch {
      setLast({ ok: false });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      {last && (
        <span style={{ fontSize: 10, color: last.ok ? "#5fff87" : "#ff5f5f" }}>
          {last.ok ? `✓ Killed ${last.killed ?? 0} session(s)` : "✗ Panic failed"}
        </span>
      )}
      <button
        onClick={() => void handlePanic()}
        disabled={loading}
        style={{
          background: loading ? "#7a2020" : "#c0392b",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          padding: "5px 14px",
          fontWeight: 700,
          fontSize: 11,
          cursor: loading ? "not-allowed" : "pointer",
          letterSpacing: "0.06em",
          boxShadow: "0 0 10px rgba(192,57,43,0.5)",
          transition: "background 0.15s",
        }}
      >
        {loading ? "EXECUTING…" : "🔴 PANIC"}
      </button>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────

export default function DirectorApp() {
  const connected = useActivityStream();

  return (
    <div style={ROOT}>
      {/* Header */}
      <div style={HEADER}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: "0.04em" }}>
            🎬 Director
          </span>
          <span
            style={{
              fontSize: 9,
              padding: "1px 7px",
              borderRadius: 10,
              background: connected ? "rgba(95,255,135,0.12)" : "rgba(255,95,95,0.12)",
              color: connected ? "#5fff87" : "#ff5f5f",
              border: `1px solid ${connected ? "rgba(95,255,135,0.25)" : "rgba(255,95,95,0.25)"}`,
              fontWeight: 600,
              letterSpacing: "0.06em",
            }}
          >
            {connected ? "LIVE" : "RECONNECTING…"}
          </span>
        </div>
        <PanicButton />
      </div>

      {/* Body */}
      <div style={BODY}>
        <ActivityFeed />
        <AgentMonitor />
      </div>
    </div>
  );
}
