import React, { useEffect, useRef, useState, useCallback } from "react";
import type { WindowSession } from "@gamma/types";

// ── Local UI types ────────────────────────────────────────────────────────

interface SSELogEntry {
  id: number;
  ts: number;
  data: Record<string, unknown>;
}

// ── Config ───────────────────────────────────────────────────────────────

// Auto-detect: if accessing via Tailscale, use the same hostname for API
const API_BASE =
  window.location.hostname === "localhost" ||
  window.location.hostname === "127.0.0.1"
    ? "http://localhost:3001"
    : `http://${window.location.hostname}:3001`;

// ── Styles ───────────────────────────────────────────────────────────────

const ROOT: React.CSSProperties = {
  background: "var(--monitor-bg)",
  color: "var(--monitor-fg)",
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  fontSize: 12,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const HEADER: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--monitor-border)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const SECTION_TITLE: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--monitor-fg)",
  opacity: 0.6,
  marginBottom: 8,
};

const PANEL: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid var(--monitor-border)",
  flexShrink: 0,
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11,
};

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "4px 8px",
  borderBottom: "1px solid var(--monitor-border)",
  color: "var(--monitor-fg)",
  opacity: 0.5,
  fontWeight: 600,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const TD: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid var(--monitor-border-success-faint)",
  color: "var(--monitor-fg-muted)",
};

const BTN: React.CSSProperties = {
  background: "var(--monitor-surface-success)",
  border: "1px solid var(--monitor-border-success)",
  color: "var(--monitor-fg)",
  padding: "6px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
  transition: "all 0.15s",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  background: "var(--monitor-surface-error)",
  border: "1px solid var(--monitor-border-error)",
  color: "var(--monitor-fg-error)",
};

const INPUT: React.CSSProperties = {
  background: "var(--monitor-surface-success-faint)",
  border: "1px solid var(--monitor-border-success-faint)",
  color: "var(--monitor-fg)",
  padding: "6px 10px",
  borderRadius: 4,
  fontSize: 12,
  fontFamily: "inherit",
  outline: "none",
  width: 200,
};

const LOG_AREA: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: "8px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const LOG_ENTRY: React.CSSProperties = {
  background: "var(--monitor-surface-success-ghost)",
  border: "1px solid var(--monitor-border-success-ghost)",
  borderRadius: 4,
  padding: "6px 10px",
  fontSize: 11,
  whiteSpace: "pre-wrap",
  wordBreak: "break-all",
};

const STATUS_DOT: React.CSSProperties = {
  display: "inline-block",
  width: 8,
  height: 8,
  borderRadius: "50%",
  marginRight: 6,
};

// ── Component ────────────────────────────────────────────────────────────

export function KernelMonitorApp(): React.ReactElement {
  const [sessions, setSessions] = useState<WindowSession[]>([]);
  const [windowId, setWindowId] = useState("test-debug-001");
  const [sseConnected, setSseConnected] = useState(false);
  const [logs, setLogs] = useState<SSELogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);

  // ── Fetch sessions ─────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`);
      if (res.ok) {
        const data = (await res.json()) as WindowSession[];
        setSessions(data);
      }
    } catch {
      // silent — backend may not be running
    }
  }, []);

  useEffect(() => {
    fetchSessions();
    const iv = setInterval(fetchSessions, 5000);
    return () => clearInterval(iv);
  }, [fetchSessions]);

  // ── Spawn mock session ─────────────────────────────────────────────

  const spawnSession = async () => {
    setLoading(true);
    try {
      const id = `win-${Math.random().toString(36).slice(2, 8)}`;
      await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          windowId: id,
          appId: "kernel-monitor",
          sessionKey: `sess-${id}`,
          agentId: "debug",
        }),
      });
      await fetchSessions();
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  // ── Delete session ─────────────────────────────────────────────────

  const deleteSession = async (wid: string) => {
    try {
      await fetch(`${API_BASE}/api/sessions/${wid}`, { method: "DELETE" });
      await fetchSessions();
    } catch {
      // silent
    }
  };

  // ── SSE connect / disconnect ───────────────────────────────────────

  const addLog = (data: Record<string, unknown>) => {
    logIdRef.current++;
    setLogs((prev) => [
      ...prev.slice(-200), // keep last 200 entries
      { id: logIdRef.current, ts: Date.now(), data },
    ]);
  };

  const connectSSE = () => {
    if (esRef.current) {
      esRef.current.close();
    }

    const es = new EventSource(`${API_BASE}/api/stream/${windowId}`);

    es.onopen = () => {
      setSseConnected(true);
      addLog({ event: "SSE_CONNECTED", windowId });
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as Record<string, unknown>;
        addLog(parsed);
      } catch {
        addLog({ raw: e.data });
      }
    };

    es.onerror = () => {
      setSseConnected(false);
      addLog({ event: "SSE_ERROR", message: "Connection lost" });
    };

    esRef.current = es;
  };

  const disconnectSSE = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setSseConnected(false);
    addLog({ event: "SSE_DISCONNECTED" });
  };

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  const statusColor = (status: string): string => {
    switch (status) {
      case "idle":
        return "var(--monitor-status-idle)";
      case "running":
        return "var(--monitor-status-running)";
      case "error":
        return "var(--monitor-status-error)";
      default:
        return "var(--color-text-muted)";
    }
  };

  return (
    <div style={ROOT}>
      {/* Header */}
      <header style={HEADER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Gamma Kernel Monitor
          </div>
          <div
            style={{
              fontSize: 11,
              opacity: 0.8,
              marginTop: 2,
            }}
          >
            Sessions · SSE Streams · Lifecycle Events
          </div>
        </div>
        <button
          type="button"
          style={BTN}
          disabled={loading}
          onClick={spawnSession}
        >
          {loading ? "Spawning…" : "Spawn Mock Session"}
        </button>
      </header>

      {/* Sessions table */}
      <section style={PANEL}>
        <div style={SECTION_TITLE}>Active Sessions</div>
        <table style={TABLE}>
          <thead>
            <tr>
              <th style={TH}>Window</th>
              <th style={TH}>App</th>
              <th style={TH}>Status</th>
              <th style={TH}>Agent</th>
              <th style={TH}>Created</th>
              <th style={TH}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((s) => (
              <tr key={s.windowId}>
                <td style={TD}>{s.windowId}</td>
                <td style={TD}>{s.appId}</td>
                <td style={TD}>
                  <span
                    style={{
                      ...STATUS_DOT,
                      backgroundColor: statusColor(s.status),
                    }}
                  />
                  {s.status}
                </td>
                <td style={TD}>{s.agentId}</td>
                <td style={TD}>
                  {new Date(s.createdAt).toLocaleTimeString(undefined, {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </td>
                <td style={TD}>
                  <button
                    type="button"
                    style={BTN_DANGER}
                    onClick={() => deleteSession(s.windowId)}
                  >
                    Kill
                  </button>
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td style={{ ...TD, opacity: 0.7 }} colSpan={6}>
                  No active sessions. Use "Spawn Mock Session" above or create an
                  app-owner window.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* SSE control + logs */}
      <section style={PANEL}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <div>
            <div style={SECTION_TITLE}>SSE Stream</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11 }}>Window ID</span>
              <input
                value={windowId}
                onChange={(e) => setWindowId(e.target.value)}
                spellCheck={false}
                style={INPUT}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={BTN}
              onClick={connectSSE}
              disabled={sseConnected}
            >
              Connect
            </button>
            <button
              type="button"
              style={BTN_DANGER}
              onClick={disconnectSSE}
              disabled={!sseConnected}
            >
              Disconnect
            </button>
          </div>
        </div>
        <div
          ref={logRef}
          style={{
            ...LOG_AREA,
            maxHeight: 260,
            borderRadius: 4,
            border: "1px solid var(--monitor-border-overlay)",
            background: "var(--monitor-surface-overlay)",
          }}
        >
          {logs.map((entry) => (
            <div key={entry.id} style={LOG_ENTRY}>
              <div
                style={{
                  fontSize: 10,
                  opacity: 0.7,
                  marginBottom: 2,
                }}
              >
                {new Date(entry.ts).toLocaleTimeString()} ·{" "}
                {String(entry.data["event"] ?? "message")}
              </div>
              <pre
                style={{
                  margin: 0,
                  fontFamily: "inherit",
                }}
              >
                {JSON.stringify(entry.data, null, 2)}
              </pre>
            </div>
          ))}
          {logs.length === 0 && (
            <div
              style={{
                ...LOG_ENTRY,
                opacity: 0.7,
                textAlign: "center",
              }}
            >
              No events yet. Connect to an SSE stream to start tailing events.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

