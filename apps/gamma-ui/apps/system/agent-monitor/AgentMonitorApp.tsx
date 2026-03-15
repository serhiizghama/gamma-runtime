import React, { useState, useCallback, useEffect } from "react";
import type { AgentStatus, SessionRecord } from "@gamma/types";
import { useSessionRegistry, systemAuthHeaders } from "../../../hooks/useSessionRegistry";
import { API_BASE } from "../../../constants/api";

// ── Styles ────────────────────────────────────────────────────────────────

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
  padding: "12px 16px",
  borderBottom: "1px solid var(--color-border-subtle)",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const BODY: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
};

const GRID_PANE: React.CSSProperties = {
  flex: "0 0 60%",
  display: "flex",
  flexDirection: "column",
  borderRight: "1px solid var(--color-border-subtle)",
  overflow: "hidden",
};

const INSPECTOR_PANE: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const PANE_HEADER: React.CSSProperties = {
  padding: "8px 14px",
  borderBottom: "1px solid var(--color-border-subtle)",
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  opacity: 0.6,
  flexShrink: 0,
};

const TABLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 11,
};

const TH: React.CSSProperties = {
  textAlign: "left",
  padding: "5px 10px",
  borderBottom: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-primary)",
  opacity: 0.5,
  fontWeight: 600,
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  whiteSpace: "nowrap",
};

const TD: React.CSSProperties = {
  padding: "5px 10px",
  borderBottom: "1px solid var(--color-border-subtle-strong)",
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: 120,
};

const BTN: React.CSSProperties = {
  background: "var(--color-surface-muted)",
  border: "1px solid var(--color-border-subtle)",
  color: "var(--color-text-primary)",
  padding: "5px 12px",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 11,
  fontFamily: "inherit",
};

const BTN_DANGER: React.CSSProperties = {
  ...BTN,
  background: "var(--button-danger-bg)",
  border: "1px solid var(--button-danger-border)",
  color: "var(--button-danger-fg)",
};

const BTN_GHOST: React.CSSProperties = {
  ...BTN,
  background: "var(--button-ghost-bg)",
  border: "1px solid var(--button-ghost-border)",
  color: "var(--button-ghost-fg)",
};

const CONTEXT_BLOCK: React.CSSProperties = {
  flex: 1,
  overflow: "auto",
  margin: "10px 14px",
  padding: "10px 12px",
  background: "var(--glass-bg)",
  border: "1px solid var(--glass-border)",
  borderRadius: 4,
  fontSize: 11,
  lineHeight: 1.6,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

const STATUS_DOT: React.CSSProperties = {
  display: "inline-block",
  width: 7,
  height: 7,
  borderRadius: "50%",
  marginRight: 5,
  flexShrink: 0,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function statusColor(status: AgentStatus): string {
  switch (status) {
    case "running": return "#eab308";
    case "idle":    return "#22c55e";
    case "error":   return "var(--color-accent-error)";
    case "aborted": return "#c9a227";
    default:        return "var(--color-text-muted)";
  }
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ── Inspector panel ───────────────────────────────────────────────────────

interface InspectorProps {
  record: SessionRecord;
  onKill: (sessionKey: string) => Promise<void>;
  killing: boolean;
}

function Inspector({ record, onKill, killing }: InspectorProps): React.ReactElement {
  const [context, setContext] = useState<string | null>(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadContext = useCallback(() => {
    setContextLoading(true);
    setContextError(null);

    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(record.sessionKey)}/context`, {
      headers: systemAuthHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ context: string }>;
      })
      .then((data) => {
        setContext(data.context);
        setContextLoading(false);
      })
      .catch((err: unknown) => {
        setContextError(err instanceof Error ? err.message : "Failed to load context");
        setContextLoading(false);
      });
  }, [record.sessionKey]);

  const handleCopy = () => {
    if (!context) return;
    navigator.clipboard.writeText(context).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Inspector header */}
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border-subtle)", flexShrink: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
          {record.appId || "—"} · {record.windowId || "—"}
        </div>
        <div style={{ fontSize: 10, opacity: 0.6, fontFamily: "var(--font-system)" }}>
          {record.sessionKey}
        </div>
      </div>

      {/* Kill + context controls */}
      <div style={{ padding: "8px 14px", borderBottom: "1px solid var(--color-border-subtle)", display: "flex", gap: 8, flexShrink: 0 }}>
        <button
          type="button"
          style={BTN_DANGER}
          disabled={killing}
          onClick={() => onKill(record.sessionKey)}
        >
          {killing ? "Killing…" : "Kill Session"}
        </button>
        <button
          type="button"
          style={BTN_GHOST}
          disabled={contextLoading}
          onClick={loadContext}
        >
          {contextLoading ? "Loading…" : "Load Context"}
        </button>
        {context && (
          <button type="button" style={BTN_GHOST} onClick={handleCopy}>
            {copied ? "Copied!" : "Copy"}
          </button>
        )}
      </div>

      {/* Context display */}
      {contextError && (
        <div style={{ padding: "10px 14px", color: "var(--color-accent-error)", fontSize: 11 }}>
          {contextError}
        </div>
      )}
      {context !== null ? (
        <pre style={CONTEXT_BLOCK}><code>{context}</code></pre>
      ) : !contextError && (
        <div style={{ padding: "14px", fontSize: 11, opacity: 0.5 }}>
          Click "Load Context" to inspect the system prompt.
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function AgentMonitorApp(): React.ReactElement {
  const { records, loading, error, refresh } = useSessionRegistry();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [killing, setKilling] = useState(false);
  const [flushing, setFlushing] = useState(false);

  const selectedRecord = records.find((r) => r.sessionKey === selectedKey) ?? null;

  // Deselect if session disappears from registry — useEffect avoids setState-during-render
  useEffect(() => {
    if (selectedKey && !selectedRecord) setSelectedKey(null);
  }, [selectedKey, selectedRecord]);

  const handleFlush = useCallback(async () => {
    if (!window.confirm("Clear all stale registry records?\n\nThis removes all session-registry and session-context entries from Redis.")) return;
    setFlushing(true);
    try {
      const res = await fetch(`${API_BASE}/api/sessions/registry/flush`, {
        method: "DELETE",
        headers: systemAuthHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        alert(`Flush failed: ${String(body["message"] ?? res.statusText)}`);
      } else {
        refresh();
      }
    } catch (err: unknown) {
      alert(`Flush failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setFlushing(false);
    }
  }, [refresh]);

  const handleKill = useCallback(async (sessionKey: string) => {
    if (!window.confirm(`Kill session "${sessionKey}"?\n\nThis will abort any running agent task.`)) return;

    setKilling(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}/kill`,
        {
          method: "POST",
          headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        const msg = String(body["message"] ?? body["error"] ?? res.statusText);
        alert(`Kill failed: ${msg}`);
      }
    } catch (err: unknown) {
      alert(`Kill failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setKilling(false);
    }
  }, []);

  return (
    <div style={ROOT}>
      {/* Header */}
      <header style={HEADER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Agent Monitor</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
            Session Registry · Token Usage · Lifecycle Controls
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, opacity: 0.6 }}>
            {loading ? "syncing…" : `${records.length} session${records.length !== 1 ? "s" : ""}`}
            {error && <span style={{ color: "var(--color-accent-error)", marginLeft: 8 }}>⚠ {error}</span>}
          </span>
          <button
            type="button"
            style={BTN_GHOST}
            disabled={flushing}
            onClick={handleFlush}
          >
            {flushing ? "Clearing…" : "Clear Stale Records"}
          </button>
        </div>
      </header>

      {/* Body: Grid + Inspector */}
      <div style={BODY}>
        {/* Data grid */}
        <div style={GRID_PANE}>
          <div style={PANE_HEADER}>Active Sessions</div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={TH}>Window</th>
                  <th style={TH}>App</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Runs</th>
                  <th style={{ ...TH, textAlign: "right" }}>In Tok</th>
                  <th style={{ ...TH, textAlign: "right" }}>Out Tok</th>
                  <th style={TH}>Last Active</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => {
                  const isSelected = r.sessionKey === selectedKey;
                  const rowBg = isSelected
                    ? "var(--color-surface-muted)"
                    : "transparent";
                  return (
                    <tr
                      key={r.sessionKey}
                      style={{ background: rowBg, cursor: "pointer" }}
                      onClick={() => setSelectedKey(isSelected ? null : r.sessionKey)}
                    >
                      <td style={{ ...TD, fontWeight: isSelected ? 600 : 400 }}>
                        {r.windowId || "—"}
                      </td>
                      <td style={TD}>{r.appId || "—"}</td>
                      <td style={{ ...TD, maxWidth: "none" }}>
                        <span style={{ display: "inline-flex", alignItems: "center" }}>
                          <span style={{ ...STATUS_DOT, backgroundColor: statusColor(r.status) }} />
                          {r.status}
                        </span>
                      </td>
                      <td style={{ ...TD, textAlign: "right" }}>{r.runCount}</td>
                      <td style={{ ...TD, textAlign: "right" }}>
                        {fmtTokens(r.tokenUsage.inputTokens)}
                      </td>
                      <td style={{ ...TD, textAlign: "right" }}>
                        {fmtTokens(r.tokenUsage.outputTokens)}
                      </td>
                      <td style={TD}>{fmtTime(r.lastActiveAt)}</td>
                    </tr>
                  );
                })}
                {records.length === 0 && !loading && (
                  <tr>
                    <td style={{ ...TD, opacity: 0.5 }} colSpan={7}>
                      No active sessions. Launch an app-owner window to see data.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Inspector */}
        <div style={INSPECTOR_PANE}>
          <div style={PANE_HEADER}>Inspector</div>
          {selectedRecord ? (
            <Inspector
              key={selectedRecord.sessionKey}
              record={selectedRecord}
              onKill={handleKill}
              killing={killing}
            />
          ) : (
            <div style={{ padding: 16, fontSize: 11, opacity: 0.5 }}>
              Select a session row to inspect its context and controls.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
