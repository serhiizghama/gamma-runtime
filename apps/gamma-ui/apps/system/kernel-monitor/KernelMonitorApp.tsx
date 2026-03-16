import React, { useCallback, useEffect, useRef, useState } from "react";
import type { WindowSession } from "@gamma/types";
import { API_BASE } from "../../../constants/api";
// [FIX arch] Import auth utilities from the canonical lib/auth module, not from
// a hooks file. useSessionRegistry re-exports for back-compat; we import the
// source directly to match the architecture recommendation.
import { systemAuthHeaders, fetchSseTicket } from "../../../lib/auth";

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

const BTN_MUTED: React.CSSProperties = {
  ...BTN,
  background: "transparent",
  border: "1px solid var(--monitor-border)",
  opacity: 0.7,
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

// ── Modal styles (matches AgentMonitorApp) ───────────────────────────────

const MODAL_OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9999,
};

const MODAL_BOX: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border-subtle)",
  borderRadius: 8,
  padding: "20px 24px",
  maxWidth: 420,
  width: "100%",
  fontFamily: "var(--font-system)",
  fontSize: 13,
  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
};

const MODAL_TITLE: React.CSSProperties = {
  fontWeight: 700,
  marginBottom: 10,
  fontSize: 14,
};

const MODAL_BODY: React.CSSProperties = {
  opacity: 0.85,
  marginBottom: 18,
  lineHeight: 1.5,
};

const MODAL_ACTIONS: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
};

// ── ConfirmModal ─────────────────────────────────────────────────────────

// [FIX security] Replace window.confirm() with a custom modal consistent with
// the rest of the Gamma UI (AgentMonitorApp pattern). window.confirm() is:
//   1. Suppressed (returns false unconditionally) inside cross-origin iframes.
//   2. Deprecated in many embedded/PWA contexts.
//   3. Architecturally inconsistent with the rest of this codebase.

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps): React.ReactElement {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div style={MODAL_OVERLAY} onClick={onCancel}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_TITLE}>{title}</div>
        <div style={MODAL_BODY}>{message}</div>
        <div style={MODAL_ACTIONS}>
          <button type="button" style={BTN_MUTED} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            style={danger ? BTN_DANGER : BTN}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AlertModal ───────────────────────────────────────────────────────────

// [FIX logic] Surface errors from deleteSession instead of swallowing silently.

interface AlertModalProps {
  title: string;
  message: string;
  onClose: () => void;
}

function AlertModal({ title, message, onClose }: AlertModalProps): React.ReactElement {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div style={MODAL_OVERLAY} onClick={onClose}>
      <div style={MODAL_BOX} onClick={(e) => e.stopPropagation()}>
        <div style={MODAL_TITLE}>{title}</div>
        <div style={MODAL_BODY}>{message}</div>
        <div style={MODAL_ACTIONS}>
          <button type="button" style={BTN} onClick={onClose}>
            OK
          </button>
        </div>
      </div>
    </div>
  );
}

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
  const [sseConnected, setSseConnected] = useState(false);
  const [logs, setLogs] = useState<SSELogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  // [FIX security] Custom modal state replaces window.confirm()
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const confirmCallbackRef = useRef<(() => void) | null>(null);

  // [FIX logic] Error alert state for surfacing deleteSession / spawnSession failures
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null);

  const logRef = useRef<HTMLDivElement>(null);
  const esRef = useRef<EventSource | null>(null);
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

  // [FIX] Extracted as stable ref-based helper so disconnectSSE can be called from onerror
  const disconnectSSE = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setSseConnected(false);
    addLog({ event: "SSE_DISCONNECTED" });
  }, []);

  const connectSSE = async () => {
    // [FIX] Validate windowId before use in URL and logs
    if (!isValidWindowId(windowId)) {
      setWindowIdError(
        "Window ID must be 1–64 alphanumeric/dash/underscore characters.",
      );
      return;
    }
    setWindowIdError(null);

    // Close any existing connection first
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    // [FIX security] Obtain a short-lived SSE ticket before opening the EventSource.
    // EventSource does not support custom request headers, so we exchange the system
    // token for a single-use ticket (matching SentinelApp's pattern). If the ticket
    // endpoint is unavailable the stream falls back to unauthenticated — the server
    // is expected to enforce its own auth gate in that case.
    const streamPath = `/api/stream/${encodeURIComponent(windowId)}`;
    const ticketParam = await fetchSseTicket(streamPath);

    const es = new EventSource(`${API_BASE}${streamPath}${ticketParam}`);

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
    return () => {
      esRef.current?.close();
    };
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
