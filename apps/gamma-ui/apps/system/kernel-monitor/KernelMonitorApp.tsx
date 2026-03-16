import React, { useEffect, useRef, useState, useCallback } from "react";
import type { WindowSession } from "@gamma/types";
import { API_BASE } from "../../../constants/api";
import { systemAuthHeaders } from "../../../hooks/useSessionRegistry";

// ── Local UI types ────────────────────────────────────────────────────────

interface SSELogEntry {
  id: number;
  ts: number;
  data: Record<string, unknown>;
}

// ── Validation ────────────────────────────────────────────────────────────

/** Allowlist for user-supplied windowId — alphanumeric, dash, underscore, 1–64 chars. */
const WINDOW_ID_RE = /^[\w\-]{1,64}$/;

function isValidWindowId(id: string): boolean {
  return WINDOW_ID_RE.test(id);
}

// ── Config ───────────────────────────────────────────────────────────────

// API_BASE is imported from ../../../constants/api (shared project constant)

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
  const [windowIdError, setWindowIdError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const [logs, setLogs] = useState<SSELogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
  const logIdRef = useRef(0);

  // ── Fetch sessions ─────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, { headers: systemAuthHeaders() });
      if (res.ok) {
        const data = (await res.json()) as WindowSession[];
        setSessions(data);
      }
    } catch {
      // silent — backend may not be running
    }
  }, []);

  // [FIX] Pause polling when tab is hidden — N open windows = N polls otherwise.
  useEffect(() => {
    fetchSessions();

    let iv: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      if (iv) return;
      iv = setInterval(fetchSessions, 5000);
    };
    const stopPolling = () => {
      if (iv) { clearInterval(iv); iv = null; }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopPolling();
      else { fetchSessions(); startPolling(); }
    };

    startPolling();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchSessions]);

  // ── Spawn mock session ─────────────────────────────────────────────

  const spawnSession = async () => {
    setLoading(true);
    try {
      const id = `win-${Math.random().toString(36).slice(2, 8)}`;
      // [FIX] Removed hardcoded agentId:"debug" — backend assigns agent from sessionKey
      await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          windowId: id,
          appId: "kernel-monitor",
          sessionKey: `sess-${id}`,
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

  // [FIX] Confirmation gate before destructive DELETE
  const deleteSession = async (wid: string) => {
    if (!window.confirm(`Kill session "${wid}"?\n\nThis will abort any running agent task.`)) return;
    try {
      await fetch(`${API_BASE}/api/sessions/${encodeURIComponent(wid)}`, {
        method: "DELETE",
        headers: systemAuthHeaders(),
      });
      await fetchSessions();
    } catch {
      // silent
    }
  };

  // ── SSE connect / disconnect ───────────────────────────────────────

  const addLog = (data: Record<string, unknown>) => {
    logIdRef.current++;
    setLogs((prev) => [
      ...prev.slice(-199), // keep last 200 entries
      { id: logIdRef.current, ts: Date.now(), data },
    ]);
  };

  // [FIX] Extracted as stable ref-based helper so disconnectSSE can be called from onerror
  const disconnectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setSseConnected(false);
    addLog({ event: "SSE_DISCONNECTED" });
  }, []);

  const connectSSE = () => {
    // [FIX] Validate windowId before use in URL and logs
    if (!isValidWindowId(windowId)) {
      setWindowIdError("Window ID must be 1–64 alphanumeric/dash/underscore characters.");
      return;
    }
    setWindowIdError(null);

    // Close any existing connection first
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const es = new EventSource(`${API_BASE}/api/stream/${encodeURIComponent(windowId)}`);

    es.onopen = () => {
      setSseConnected(true);
      // [FIX] Log validated windowId only — no raw user input in log entries
      addLog({ event: "SSE_CONNECTED", windowId: windowId.slice(0, 64) });
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data as string) as Record<string, unknown>;
        addLog(parsed);
      } catch {
        addLog({ raw: e.data });
      }
    };

    // [FIX] Call es.close() on error to prevent zombie browser reconnect loop.
    // Then set ref to null so subsequent "Connect" clicks start clean.
    es.onerror = () => {
      es.close();
      esRef.current = null;
      setSseConnected(false);
      addLog({ event: "SSE_ERROR", message: "Connection lost" });
    };

    esRef.current = es;
  };

  useEffect(() => {
    if (!logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // SSE cleanup on unmount — prevent connection leak
  useEffect(() => {
    return () => { esRef.current?.close(); };
  }, []);

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
          <div style={{ fontSize: 11, opacity: 0.8, marginTop: 2 }}>
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
                  <span style={{ ...STATUS_DOT, backgroundColor: statusColor(s.status) }} />
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <div style={SECTION_TITLE}>SSE Stream</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 11 }}>Window ID</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  value={windowId}
                  onChange={(e) => { setWindowId(e.target.value); setWindowIdError(null); }}
                  spellCheck={false}
                  style={{ ...INPUT, borderColor: windowIdError ? "var(--monitor-border-error)" : undefined }}
                />
                {windowIdError && (
                  <span style={{ fontSize: 10, color: "var(--monitor-fg-error)" }}>{windowIdError}</span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" style={BTN} onClick={connectSSE} disabled={sseConnected}>
              Connect
            </button>
            <button type="button" style={BTN_DANGER} onClick={disconnectSSE} disabled={!sseConnected}>
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
              <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
                {new Date(entry.ts).toLocaleTimeString()} ·{" "}
                {String(entry.data["event"] ?? "message")}
              </div>
              <pre style={{ margin: 0, fontFamily: "inherit" }}>
                {JSON.stringify(entry.data, null, 2)}
              </pre>
            </div>
          ))}
          {logs.length === 0 && (
            <div style={{ ...LOG_ENTRY, opacity: 0.7, textAlign: "center" }}>
              No events yet. Connect to an SSE stream to start tailing events.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
