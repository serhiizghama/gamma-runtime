import React, { useCallback, useEffect, useRef, useState } from "react";
import type { WindowSession } from "@gamma/types";
import { API_BASE } from "../../../constants/api";
// [FIX arch] Import auth utilities from the canonical lib/auth module, not from
// a hooks file. useSessionRegistry re-exports for back-compat; we import the
// source directly to match the architecture recommendation.
import { systemAuthHeaders } from "../../../lib/auth";
import { useSecureSse } from "../../../hooks/useSecureSse";
import { ConfirmModal, AlertModal } from "../../../components/ui/ConfirmModal";

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

// [FIX logic] Per-entry display cap for SSE log entries. A single large message
// could otherwise render an unbounded <pre> block. 4 KB is consistent with the
// CONTEXT_DISPLAY_LIMIT pattern in AgentMonitorApp.
const LOG_ENTRY_CHAR_LIMIT = 4 * 1024;

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


// ── Confirm-modal state helpers (AgentMonitorApp pattern) ────────────────

interface ConfirmModalState {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────

export function KernelMonitorApp(): React.ReactElement {
  const [sessions, setSessions] = useState<WindowSession[]>([]);
  const [windowId, setWindowId] = useState("test-debug-001");
  const [windowIdError, setWindowIdError] = useState<string | null>(null);
  const [sseEnabled, setSseEnabled] = useState(false);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [logs, setLogs] = useState<SSELogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // [FIX security] Custom modal state replaces window.confirm()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const confirmCallbackRef = useRef<(() => void) | null>(null);

  // [FIX logic] Error alert state for surfacing deleteSession / spawnSession failures
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  // ── Confirm modal helpers ──────────────────────────────────────────

  const openConfirm = useCallback(
    (display: ConfirmModalState, onConfirm: () => void) => {
      confirmCallbackRef.current = onConfirm;
      setConfirmModal(display);
    },
    [],
  );

  const handleConfirmOk = useCallback(() => {
    setConfirmModal(null);
    confirmCallbackRef.current?.();
    confirmCallbackRef.current = null;
  }, []);

  const handleConfirmCancel = useCallback(() => {
    setConfirmModal(null);
    confirmCallbackRef.current = null;
  }, []);

  // ── Fetch sessions ─────────────────────────────────────────────────

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions`, {
        headers: systemAuthHeaders(),
      });
      if (res.ok) {
        const data = (await res.json()) as WindowSession[];
        setSessions(data);
      }
      // 401/403/5xx: backend is running but rejected. Keep existing data visible;
      // the next polling cycle will retry. No silent discard — the table remains
      // stale but the user still sees the last-known state.
    } catch {
      // Network error (backend not reachable) — keep polling, stay silent.
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
      if (iv) {
        clearInterval(iv);
        iv = null;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") stopPolling();
      else {
        fetchSessions();
        startPolling();
      }
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
      // [FIX logic] Use crypto.randomUUID() instead of Math.random().toString(36).
      // Math.random() is a non-cryptographic PRNG — predictable and short (6 chars ≈ 2.1B
      // values). crypto.randomUUID() is cryptographically random and collision-resistant.
      const uuid = crypto.randomUUID();
      const id = `win-${uuid.slice(0, 8)}`;
      await fetch(`${API_BASE}/api/sessions`, {
        method: "POST",
        headers: { ...systemAuthHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          windowId: id,
          appId: "kernel-monitor",
          sessionKey: `sess-${uuid}`,
        }),
      });
      await fetchSessions();
    } catch (err) {
      // [FIX logic] Surface spawn errors to the user instead of swallowing silently.
      setAlertModal({
        title: "Spawn Failed",
        message:
          err instanceof Error
            ? err.message
            : "Could not spawn a mock session. Is the backend running?",
      });
    } finally {
      setLoading(false);
    }
  };

  // ── Delete session ─────────────────────────────────────────────────

  // [FIX security] Gate on a custom ConfirmModal instead of window.confirm().
  // window.confirm() is suppressed in cross-origin iframes (returns false
  // unconditionally) and is deprecated in many embedded contexts, making the
  // Kill button silently destructive when Gamma UI is embedded.
  const deleteSession = (wid: string) => {
    openConfirm(
      {
        title: "Kill Session",
        message: `Kill session "${wid}"?\n\nThis will abort any running agent task.`,
        confirmLabel: "Kill",
        danger: true,
      },
      async () => {
        try {
          const res = await fetch(
            `${API_BASE}/api/sessions/${encodeURIComponent(wid)}`,
            { method: "DELETE", headers: systemAuthHeaders() },
          );
          if (!res.ok) {
            // [FIX logic] Surface DELETE failures — the user needs to know if Kill
            // didn't work (401, 403, 500, etc.), especially for a destructive action.
            setAlertModal({
              title: "Kill Failed",
              message: `Server returned ${res.status} ${res.statusText}. The session may still be running.`,
            });
          }
          // Refresh regardless — the session may have been removed on the server side
          // even if the status code was unexpected.
          await fetchSessions();
        } catch (err) {
          setAlertModal({
            title: "Kill Failed",
            message:
              err instanceof Error
                ? err.message
                : "Network error. The session may still be running.",
          });
        }
      },
    );
  };

  // ── SSE connect / disconnect ───────────────────────────────────────

  const addLog = (data: Record<string, unknown>) => {
    logIdRef.current++;
    setLogs((prev) => [
      ...prev.slice(-199), // keep last 200 entries
      { id: logIdRef.current, ts: Date.now(), data },
    ]);
  };
  const handleConnect = () => {
    if (!isValidWindowId(windowId)) {
      setWindowIdError(
        "Window ID must be 1–64 alphanumeric/dash/underscore characters.",
      );
      return;
    }
    setWindowIdError(null);
    const streamPath = `/api/stream/${encodeURIComponent(windowId)}`;
    setActivePath(streamPath);
    setSseEnabled(true);
    addLog({ event: "SSE_CONNECTING", windowId: windowId.slice(0, 64) });
  };

  const handleDisconnect = () => {
    setSseEnabled(false);
    addLog({ event: "SSE_DISCONNECTED" });
  };

  const onMessage = useCallback(
    (ev: MessageEvent) => {
      try {
        const parsed = JSON.parse(ev.data as string) as Record<string, unknown>;
        addLog(parsed);
      } catch {
        addLog({ raw: ev.data });
      }
    },
    [],
  );

  const { connected: sseConnected } = useSecureSse({
    path: activePath ?? "/api/stream/__disabled__",
    onMessage,
    reconnectMs: 4000,
    label: "KernelMonitor",
    enabled: sseEnabled && !!activePath,
  });

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

  // ── Per-entry log display ──────────────────────────────────────────

  // [FIX logic] Cap individual log entry display at LOG_ENTRY_CHAR_LIMIT (4 KB).
  // addLog already caps total entries at 200; without a per-entry size cap a single
  // large SSE message could render an unbounded <pre> block.
  function renderLogData(data: Record<string, unknown>): {
    text: string;
    truncated: boolean;
  } {
    const full = JSON.stringify(data, null, 2);
    if (full.length <= LOG_ENTRY_CHAR_LIMIT) return { text: full, truncated: false };
    return {
      text: full.slice(0, LOG_ENTRY_CHAR_LIMIT),
      truncated: true,
    };
  }

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
                  No active sessions. Use "Spawn Mock Session" above or create
                  an app-owner window.
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
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <input
                  value={windowId}
                  onChange={(e) => {
                    setWindowId(e.target.value);
                    setWindowIdError(null);
                  }}
                  spellCheck={false}
                  style={{
                    ...INPUT,
                    borderColor: windowIdError
                      ? "var(--monitor-border-error)"
                      : undefined,
                  }}
                />
                {windowIdError && (
                  <span style={{ fontSize: 10, color: "var(--monitor-fg-error)" }}>
                    {windowIdError}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={BTN}
              onClick={handleConnect}
              disabled={sseConnected}
            >
              Connect
            </button>
            <button
              type="button"
              style={BTN_DANGER}
              onClick={handleDisconnect}
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
          {logs.map((entry) => {
            const { text, truncated } = renderLogData(entry.data);
            return (
              <div key={entry.id} style={LOG_ENTRY}>
                <div style={{ fontSize: 10, opacity: 0.7, marginBottom: 2 }}>
                  {new Date(entry.ts).toLocaleTimeString()} ·{" "}
                  {String(entry.data["event"] ?? "message")}
                </div>
                <pre style={{ margin: 0, fontFamily: "inherit" }}>{text}</pre>
                {/* [FIX logic] Truncation indicator when entry exceeds 4 KB cap */}
                {truncated && (
                  <div
                    style={{
                      fontSize: 10,
                      opacity: 0.6,
                      marginTop: 4,
                      fontStyle: "italic",
                    }}
                  >
                    … truncated at 4 KB
                  </div>
                )}
              </div>
            );
          })}
          {logs.length === 0 && (
            <div style={{ ...LOG_ENTRY, opacity: 0.7, textAlign: "center" }}>
              No events yet. Connect to an SSE stream to start tailing events.
            </div>
          )}
        </div>
      </section>

      {/* Confirm modal — replaces window.confirm() */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel={confirmModal.confirmLabel}
          danger={confirmModal.danger}
          onConfirm={handleConfirmOk}
          onCancel={handleConfirmCancel}
        />
      )}

      {/* Alert modal — surfaces errors that were previously swallowed */}
      {alertModal && (
        <AlertModal
          title={alertModal.title}
          message={alertModal.message}
          onClose={() => setAlertModal(null)}
        />
      )}
    </div>
  );
}
