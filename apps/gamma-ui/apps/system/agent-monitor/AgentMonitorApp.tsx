import React, { useState, useCallback, useEffect, useRef } from "react";
import type { AgentStatus, SessionRecord } from "@gamma/types";
import { useSessionRegistry } from "../../../hooks/useSessionRegistry";
import { systemAuthHeaders } from "../../../lib/auth";
import { API_BASE } from "../../../constants/api";
import { fmtTime, fmtTokens } from "../../../lib/format";
import { ConfirmModal, AlertModal } from "../../../components/ui/ConfirmModal";

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


// Sensitivity warning banner
const SENSITIVE_BANNER: React.CSSProperties = {
  margin: "8px 14px 0",
  padding: "6px 10px",
  background: "rgba(234, 179, 8, 0.12)",
  border: "1px solid rgba(234, 179, 8, 0.35)",
  borderRadius: 4,
  fontSize: 10,
  color: "#ca8a04",
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexShrink: 0,
};

// ── Context size cap ───────────────────────────────────────────────────────

/** Characters shown in the initial truncated view (≈64 KB). */
const CONTEXT_DISPLAY_LIMIT = 64 * 1024;

// ── Auth guard ────────────────────────────────────────────────────────────

/**
 * Minimum token value length to accept as valid.
 * Rejects empty strings, whitespace-only values, and implausibly short tokens.
 *
 * NOTE: This is a client-side heuristic only. Actual token validity is enforced
 * server-side. The source of truth is `systemAuthHeaders()` from `useSessionRegistry`;
 * callers should ensure that hook is kept up to date on auth state changes.
 */
const MIN_TOKEN_LENGTH = 8;

/**
 * Returns auth headers if they contain at least one plausibly valid token value,
 * or null if the headers are absent, empty, or contain only whitespace/short strings.
 * Every privileged API call must check the return value and abort on null.
 */
function getValidatedAuthHeaders(): Record<string, string> | null {
  const headers = systemAuthHeaders();
  if (!headers || Object.keys(headers).length === 0) return null;
  const hasValidToken = Object.values(headers).some(
    (v) => typeof v === "string" && v.trim().length >= MIN_TOKEN_LENGTH,
  );
  return hasValidToken ? headers : null;
}


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

// ── Inspector panel ───────────────────────────────────────────────────────

interface InspectorProps {
  record: SessionRecord;
  /**
   * Called when the user requests a kill. The actual confirmation dialog and
   * privileged API call are handled by the parent — this is NOT a direct kill.
   */
  onKillRequest: (sessionKey: string) => void;
  killingKeys: ReadonlySet<string>;
}

function Inspector({ record, onKillRequest, killingKeys }: InspectorProps): React.ReactElement {
  // `context` holds the display slice (≤ CONTEXT_DISPLAY_LIMIT chars).
  // `fullContextRef` holds the full raw string for the "Show full" path —
  // stored in a ref to avoid a second fetch and unnecessary re-renders.
  const [context, setContext] = useState<string | null>(null);
  const fullContextRef = useRef<string>("");
  const [contextTruncated, setContextTruncated] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [authErrorModal, setAuthErrorModal] = useState(false);

  const isKilling = killingKeys.has(record.sessionKey);

  // AbortController ref — cancelled on unmount or when sessionKey changes
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Reset context when inspecting a new session
    setContext(null);
    fullContextRef.current = "";
    setContextError(null);
    setContextLoading(false);
    setContextTruncated(false);
    setShowFull(false);
    return () => {
      abortRef.current?.abort();
    };
  }, [record.sessionKey]);

  const loadContext = useCallback(() => {
    const authHeaders = getValidatedAuthHeaders();
    if (!authHeaders) {
      setAuthErrorModal(true);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setContextLoading(true);
    setContextError(null);
    setShowFull(false);

    fetch(`${API_BASE}/api/sessions/${encodeURIComponent(record.sessionKey)}/context`, {
      headers: authHeaders,
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<{ context: string }>;
      })
      .then((data) => {
        const raw = data.context ?? "";
        fullContextRef.current = raw;
        const truncated = raw.length > CONTEXT_DISPLAY_LIMIT;
        setContext(truncated ? raw.slice(0, CONTEXT_DISPLAY_LIMIT) : raw);
        setContextTruncated(truncated);
        setContextLoading(false);
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setContextError(err instanceof Error ? err.message : "Failed to load context");
        setContextLoading(false);
      });
  }, [record.sessionKey]);

  const handleCopy = () => {
    const text = showFull ? fullContextRef.current : (context ?? "");
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  // Display the full raw string when expanded, otherwise the truncated slice
  const displayedContext = context !== null
    ? (showFull ? fullContextRef.current : context)
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {authErrorModal && (
        <AlertModal
          title="Authentication Error"
          message="Authentication headers are missing or invalid. Cannot perform this action. Please re-authenticate and try again."
          onClose={() => setAuthErrorModal(false)}
        />
      )}

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
          disabled={isKilling}
          onClick={() => onKillRequest(record.sessionKey)}
        >
          {isKilling ? "Killing…" : "Kill Session"}
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
      {displayedContext !== null ? (
        <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
          {/* Sensitivity warning — shown whenever context is visible */}
          <div style={SENSITIVE_BANNER}>
            <span>⚠</span>
            <span>
              <strong>Sensitive content.</strong> This may include credentials, API keys, or private
              operational instructions. Do not share or screenshot this view.
            </span>
          </div>
          <pre style={CONTEXT_BLOCK}><code>{displayedContext}</code></pre>
          {contextTruncated && !showFull && (
            <div style={{ padding: "6px 14px 10px", fontSize: 11, opacity: 0.7, flexShrink: 0 }}>
              Showing first 64 KB.{" "}
              <button
                type="button"
                style={{ ...BTN_GHOST, padding: "2px 8px" }}
                onClick={() => setShowFull(true)}
              >
                Show full ({Math.round(fullContextRef.current.length / 1024)} KB — may be slow)
              </button>
            </div>
          )}
        </div>
      ) : !contextError && (
        <div style={{ padding: "14px", fontSize: 11, opacity: 0.5 }}>
          Click "Load Context" to inspect the system prompt.
        </div>
      )}
    </div>
  );
}

// ── Confirm modal state helpers ────────────────────────────────────────────

/**
 * Modal display data (title, message, styling) is kept in React state so the
 * modal re-renders when it opens/closes. The confirm *callback* is stored in a
 * ref — this avoids the stale-closure hazard that arises when an async callback
 * (capturing `refresh`, `showAlert`, etc.) is placed directly in state and those
 * dependencies change between when the modal is opened and when the user clicks
 * Confirm.
 */
interface ConfirmModalState {
  title: string;
  message: string;
  danger?: boolean;
}

// ── Main component ────────────────────────────────────────────────────────

export function AgentMonitorApp(): React.ReactElement {
  const { records, loading, error, refresh } = useSessionRegistry();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [killingKeys, setKillingKeys] = useState<ReadonlySet<string>>(new Set());
  const [flushing, setFlushing] = useState(false);

  // Modal state: display data in state, callback in ref (avoids stale closures)
  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);
  const confirmCallbackRef = useRef<(() => void) | null>(null);
  const [alertModal, setAlertModal] = useState<{ title: string; message: string } | null>(null);

  const selectedRecord = records.find((r) => r.sessionKey === selectedKey) ?? null;

  useEffect(() => {
    if (selectedKey && !selectedRecord) setSelectedKey(null);
  }, [selectedKey, selectedRecord]);

  const showAlert = useCallback((title: string, message: string) => {
    setAlertModal({ title, message });
  }, []);

  /** Open a confirm modal. The callback ref is set synchronously before state update. */
  const openConfirm = useCallback((
    display: ConfirmModalState,
    onConfirm: () => void,
  ) => {
    confirmCallbackRef.current = onConfirm;
    setConfirmModal(display);
  }, []);

  const handleConfirm = useCallback(() => {
    setConfirmModal(null);
    confirmCallbackRef.current?.();
    confirmCallbackRef.current = null;
  }, []);

  const handleCancelConfirm = useCallback(() => {
    setConfirmModal(null);
    confirmCallbackRef.current = null;
  }, []);

  const handleFlush = useCallback(() => {
    openConfirm(
      {
        title: "Clear Stale Records",
        message: "Clear all stale registry records?\n\nThis removes all session-registry and session-context entries from Redis.",
        danger: true,
      },
      async () => {
        const authHeaders = getValidatedAuthHeaders();
        if (!authHeaders) {
          showAlert("Authentication Error", "Authentication headers are missing or invalid. Cannot flush registry.");
          return;
        }

        setFlushing(true);
        try {
          const res = await fetch(`${API_BASE}/api/sessions/registry/flush`, {
            method: "DELETE",
            headers: authHeaders,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as Record<string, unknown>;
            showAlert("Flush Failed", String(body["message"] ?? res.statusText));
          } else {
            refresh();
          }
        } catch (err: unknown) {
          showAlert("Flush Failed", err instanceof Error ? err.message : String(err));
        } finally {
          setFlushing(false);
        }
      },
    );
  }, [openConfirm, refresh, showAlert]);

  const handleKillRequest = useCallback((sessionKey: string) => {
    openConfirm(
      {
        title: "Kill Session",
        message: `Kill session "${sessionKey}"?\n\nThis will abort any running agent task.`,
        danger: true,
      },
      async () => {
        const authHeaders = getValidatedAuthHeaders();
        if (!authHeaders) {
          showAlert("Authentication Error", "Authentication headers are missing or invalid. Cannot kill session.");
          return;
        }

        setKillingKeys((prev) => new Set([...prev, sessionKey]));
        try {
          const res = await fetch(
            `${API_BASE}/api/sessions/${encodeURIComponent(sessionKey)}/kill`,
            {
              method: "POST",
              headers: { ...authHeaders, "Content-Type": "application/json" },
              body: JSON.stringify({}),
            },
          );
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as Record<string, unknown>;
            const msg = String(body["message"] ?? body["error"] ?? res.statusText);
            showAlert("Kill Failed", msg);
          } else {
            refresh();
          }
        } catch (err: unknown) {
          showAlert("Kill Failed", err instanceof Error ? err.message : String(err));
        } finally {
          setKillingKeys((prev) => {
            const next = new Set(prev);
            next.delete(sessionKey);
            return next;
          });
        }
      },
    );
  }, [openConfirm, refresh, showAlert]);

  return (
    <div style={ROOT}>
      {/* Modals */}
      {confirmModal && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel="Confirm"
          danger={confirmModal.danger}
          onConfirm={handleConfirm}
          onCancel={handleCancelConfirm}
        />
      )}
      {alertModal && (
        <AlertModal
          title={alertModal.title}
          message={alertModal.message}
          onClose={() => setAlertModal(null)}
        />
      )}

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
                  const rowBg = isSelected ? "var(--color-surface-muted)" : "transparent";
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
              onKillRequest={handleKillRequest}
              killingKeys={killingKeys}
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
