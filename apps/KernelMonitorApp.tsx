import React, { useEffect, useRef, useState, useCallback } from "react";

// ── Types (from @gamma/types — inlined for zero-dep frontend use) ────────

interface WindowSession {
  windowId: string;
  appId: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  status: string;
}

interface SSELogEntry {
  id: number;
  ts: number;
  data: Record<string, unknown>;
}

// ── Config ───────────────────────────────────────────────────────────────

const API_BASE = "http://localhost:3001";

// ── Styles ───────────────────────────────────────────────────────────────

const ROOT: React.CSSProperties = {
  background: "#0a0a0a",
  color: "#00ff41",
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace",
  fontSize: 12,
  height: "100%",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const HEADER: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #1a3a1a",
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
  color: "#00ff41",
  opacity: 0.6,
  marginBottom: 8,
};

const PANEL: React.CSSProperties = {
  padding: "12px 16px",
  borderBottom: "1px solid #1a3a1a",
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
  borderBottom: "1px solid #1a3a1a",
  color: "#00ff41",
  opacity: 0.5,
  fontWeight: 600,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const TD: React.CSSProperties = {
  padding: "4px 8px",
  borderBottom: "1px solid rgba(0,255,65,0.05)",
  color: "#00cc33",
};

const BTN: React.CSSProperties = {
  background: "rgba(0,255,65,0.1)",
  border: "1px solid rgba(0,255,65,0.3)",
  color: "#00ff41",
  padding: "6px 14px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
  transition: "all 0.15s",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  background: "rgba(255,60,60,0.1)",
  border: "1px solid rgba(255,60,60,0.3)",
  color: "#ff4444",
};

const INPUT: React.CSSProperties = {
  background: "rgba(0,255,65,0.05)",
  border: "1px solid rgba(0,255,65,0.2)",
  color: "#00ff41",
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
  background: "rgba(0,255,65,0.03)",
  border: "1px solid rgba(0,255,65,0.08)",
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

  const addLog = (data: Record<string, unknown>) => {
    logIdRef.current++;
    setLogs((prev) => [
      ...prev.slice(-200), // keep last 200 entries
      { id: logIdRef.current, ts: Date.now(), data },
    ]);
  };

  // Auto-scroll log area
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
      }
    };
  }, []);

  // ── Push test event via backend (simulate agent output) ────────────

  const pushTestEvent = async () => {
    try {
      // We'll push directly via the sessions send endpoint or redis
      // For now, use a simple approach: create the event description
      addLog({
        event: "MANUAL_PUSH",
        hint: `Run: redis-cli XADD gamma:sse:${windowId} '*' type assistant_delta windowId ${windowId} runId test-run text "Hello from debug"`,
      });
    } catch {
      // silent
    }
  };

  // ── Render ─────────────────────────────────────────────────────────

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString("en-US", { hour12: false }) + "." + String(d.getMilliseconds()).padStart(3, "0");
  };

  return (
    <div style={ROOT}>
      {/* Header */}
      <div style={HEADER}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>🔬</span>
          <span style={{ fontWeight: 700, fontSize: 13 }}>Kernel Monitor</span>
          <span style={{ opacity: 0.3, fontSize: 10 }}>v1.4</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              ...STATUS_DOT,
              background: sseConnected ? "#00ff41" : "#ff4444",
              boxShadow: sseConnected
                ? "0 0 6px rgba(0,255,65,0.5)"
                : "0 0 6px rgba(255,68,68,0.5)",
            }}
          />
          <span style={{ fontSize: 11, opacity: 0.7 }}>
            SSE: {sseConnected ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>

      {/* Sessions Panel */}
      <div style={PANEL}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={SECTION_TITLE}>Active Sessions ({sessions.length})</div>
          <button
            style={{ ...BTN, opacity: loading ? 0.5 : 1 }}
            onClick={spawnSession}
            disabled={loading}
          >
            + Spawn Mock Session
          </button>
        </div>

        {sessions.length > 0 ? (
          <table style={TABLE}>
            <thead>
              <tr>
                <th style={TH}>Window ID</th>
                <th style={TH}>App</th>
                <th style={TH}>Session Key</th>
                <th style={TH}>Status</th>
                <th style={TH}>Age</th>
                <th style={TH}></th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.windowId}>
                  <td style={TD}>{s.windowId}</td>
                  <td style={TD}>{s.appId}</td>
                  <td style={{ ...TD, opacity: 0.6, fontSize: 10 }}>{s.sessionKey}</td>
                  <td style={TD}>
                    <span
                      style={{
                        padding: "2px 6px",
                        borderRadius: 3,
                        fontSize: 10,
                        background:
                          s.status === "running"
                            ? "rgba(0,255,65,0.15)"
                            : s.status === "error"
                              ? "rgba(255,60,60,0.15)"
                              : "rgba(255,255,255,0.05)",
                        color:
                          s.status === "running"
                            ? "#00ff41"
                            : s.status === "error"
                              ? "#ff4444"
                              : "#666",
                      }}
                    >
                      {s.status}
                    </span>
                  </td>
                  <td style={{ ...TD, opacity: 0.5 }}>
                    {Math.round((Date.now() - s.createdAt) / 1000)}s
                  </td>
                  <td style={TD}>
                    <button
                      style={{ ...BTN_DANGER, padding: "2px 8px", fontSize: 10 }}
                      onClick={() => deleteSession(s.windowId)}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ opacity: 0.3, fontSize: 11, padding: "8px 0" }}>
            No active sessions. Click "Spawn Mock Session" to create one.
          </div>
        )}
      </div>

      {/* SSE Debugger Panel */}
      <div style={{ ...PANEL, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ ...SECTION_TITLE, marginBottom: 0 }}>SSE Stream</div>
        <input
          style={INPUT}
          value={windowId}
          onChange={(e) => setWindowId(e.target.value)}
          placeholder="windowId"
        />
        {!sseConnected ? (
          <button style={BTN} onClick={connectSSE}>
            ▶ Connect
          </button>
        ) : (
          <button style={BTN_DANGER} onClick={disconnectSSE}>
            ■ Disconnect
          </button>
        )}
        <button style={{ ...BTN, opacity: 0.6 }} onClick={pushTestEvent}>
          📡 Test Hint
        </button>
        <button
          style={{ ...BTN, opacity: 0.6 }}
          onClick={() => setLogs([])}
        >
          🗑 Clear
        </button>
      </div>

      {/* Log Area */}
      <div ref={logRef} style={LOG_AREA}>
        {logs.length === 0 && (
          <div style={{ opacity: 0.2, textAlign: "center", paddingTop: 40 }}>
            SSE events will appear here...
          </div>
        )}
        {logs.map((entry) => (
          <div key={entry.id} style={LOG_ENTRY}>
            <span style={{ color: "#00aa33", opacity: 0.5 }}>
              [{formatTime(entry.ts)}]
            </span>{" "}
            <span style={{ color: "#44ffaa" }}>
              {(entry.data.type as string) ?? (entry.data.event as string) ?? "???"}
            </span>
            {"\n"}
            {JSON.stringify(entry.data, null, 2)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default KernelMonitorApp;
