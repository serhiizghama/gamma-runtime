import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type {
  BackupInventory,
  BackupSessionEntry,
  BackupFileEntry,
  SystemEvent,
  AgentRegistryEntry,
  GammaSSEEvent,
} from "@gamma/types";
// TODO(arch): `systemAuthHeaders` should be exported from a dedicated `src/lib/auth.ts`
// or `src/api/client.ts` utility — not as a side-export from a hooks module.
// Tracked: move systemAuthHeaders out of useSessionRegistry before next auth refactor.
import { systemAuthHeaders } from "../../../lib/auth";
import { API_BASE } from "../../../constants/api";
import { useSecureSse } from "../../../hooks/useSecureSse";
import { fmtTime, fmtDate, relativeTime } from "../../../lib/format";

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

const TAB_BAR: React.CSSProperties = {
  display: "flex",
  gap: 0,
  borderBottom: "1px solid var(--color-border-subtle)",
  flexShrink: 0,
  padding: "0 16px",
};

const BODY: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  flex: 1,
  overflow: "hidden",
};

const TABLES_ROW: React.CSSProperties = {
  display: "flex",
  flex: 1,
  overflow: "hidden",
  borderBottom: "1px solid var(--color-border-subtle)",
};

const FEED_PANE: React.CSSProperties = {
  flex: "0 0 180px",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const PANE: React.CSSProperties = {
  flex: 1,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const PANE_LEFT: React.CSSProperties = {
  ...PANE,
  borderRight: "1px solid var(--color-border-subtle)",
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
  maxWidth: 180,
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

const TIER_BADGE: React.CSSProperties = {
  display: "inline-block",
  padding: "1px 6px",
  borderRadius: 3,
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
};

const EMPTY: React.CSSProperties = {
  padding: 20,
  textAlign: "center",
  opacity: 0.45,
  fontSize: 11,
};

const ERROR_BANNER: React.CSSProperties = {
  padding: "10px 16px",
  background: "rgba(239, 68, 68, 0.1)",
  borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
  color: "#ef4444",
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const WARN_BANNER: React.CSSProperties = {
  padding: "6px 16px",
  background: "rgba(234, 179, 8, 0.08)",
  borderBottom: "1px solid rgba(234, 179, 8, 0.25)",
  color: "#eab308",
  fontSize: 11,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexShrink: 0,
};

const STAT_VALUE: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "#22c55e",
};

const STAT_LABEL: React.CSSProperties = {
  fontSize: 9,
  opacity: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginTop: 1,
};

// ── Helpers ───────────────────────────────────────────────────────────────

function fmtBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function tierStyle(tier: "system" | "private"): React.CSSProperties {
  return {
    ...TIER_BADGE,
    background: tier === "system" ? "rgba(59,130,246,0.15)" : "rgba(234,179,8,0.15)",
    color: tier === "system" ? "#60a5fa" : "#eab308",
  };
}

function eventColor(type: SystemEvent["type"]): string {
  switch (type) {
    case "info":     return "#22c55e";
    case "warn":     return "#eab308";
    case "error":    return "#ef4444";
    case "critical": return "#ef4444";
  }
}

const ROLE_COLORS: Record<string, { bg: string; fg: string }> = {
  architect:  { bg: "rgba(168,85,247,0.15)", fg: "#a855f7" },
  "app-owner": { bg: "rgba(59,130,246,0.15)", fg: "#60a5fa" },
  daemon:     { bg: "rgba(107,114,128,0.15)", fg: "#9ca3af" },
};

function roleBadgeStyle(role: string): React.CSSProperties {
  const c = ROLE_COLORS[role] ?? ROLE_COLORS.daemon;
  return { ...TIER_BADGE, background: c.bg, color: c.fg };
}

const STATUS_COLORS: Record<string, string> = {
  idle: "#22c55e",
  running: "#3b82f6",
  error: "#ef4444",
  aborted: "#eab308",
  offline: "#6b7280",
};

function statusDot(status: string): React.CSSProperties {
  return {
    display: "inline-block",
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: STATUS_COLORS[status] ?? "#6b7280",
    marginRight: 5,
    position: "relative",
    top: -1,
  };
}

// ── Tab types ─────────────────────────────────────────────────────────────

type SentinelTab = "dashboard" | "agents";

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 16px",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    cursor: "pointer",
    border: "none",
    borderBottom: active ? "2px solid var(--color-text-primary)" : "2px solid transparent",
    background: "transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
    fontFamily: "inherit",
    transition: "color 0.15s, border-color 0.15s",
  };
}

// ── Throttled fetch hook ──────────────────────────────────────────────────

const THROTTLE_MS = 100;

function useBackupInventory() {
  const [data, setData] = useState<BackupInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const lastFetchRef = useRef(0);
  // Invariant: mountedRef.current is true for the lifetime of a single effect run.
  // The cleanup of each run sets it to false and aborts the in-flight request;
  // the next run's body sets it back to true before scheduling the fetch.
  // The auto-refresh setInterval only triggers setRefreshTick, which re-enters
  // the fetch effect — it does not own mountedRef and does not need to.
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    const now = Date.now();
    const elapsed = now - lastFetchRef.current;
    const delay = elapsed < THROTTLE_MS ? THROTTLE_MS - elapsed : 0;

    const timer = setTimeout(() => {
      lastFetchRef.current = Date.now();
      setLoading(true);

      fetch(`${API_BASE}/api/system/backups`, {
        headers: systemAuthHeaders(),
        signal: controller.signal,
      })
        .then((res) => {
          if (res.status === 401 || res.status === 403) {
            throw new Error("Unauthorized — check VITE_GAMMA_SYSTEM_TOKEN");
          }
          if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
          return res.json() as Promise<BackupInventory>;
        })
        .then((inventory) => {
          if (mountedRef.current) {
            setData(inventory);
            setError(null);
            setLoading(false);
          }
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.name === "AbortError") return;
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : "Failed to fetch backups");
            setLoading(false);
          }
        });
    }, delay);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [refreshTick]);

  // Auto-refresh every 10s
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { data, loading, error, refresh };
}

// ── Agent Registry hook (REST + SSE live updates) ─────────────────────────

function useAgentRegistry() {
  const [agents, setAgents] = useState<AgentRegistryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // sseError is non-blocking: stale REST data remains visible when SSE fails.
  const [sseError, setSseError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // restMountedRef guards the REST fetch effect. Set true at each effect run start,
  // false at cleanup. AbortController cancels the in-flight request on cleanup.
  const restMountedRef = useRef(false);

  // REST fetch effect — re-runs on refreshTick (manual + auto-10s fallback)
  useEffect(() => {
    restMountedRef.current = true;
    const controller = new AbortController();

    fetch(`${API_BASE}/api/system/agents`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((res) => {
        if (res.status === 401 || res.status === 403) {
          throw new Error("Unauthorized — check VITE_GAMMA_SYSTEM_TOKEN");
        }
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<AgentRegistryEntry[]>;
      })
      .then((data) => {
        if (restMountedRef.current) {
          setAgents(data);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof Error && err.name === "AbortError") return;
        if (restMountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load agents");
          setLoading(false);
        }
      });

    return () => {
      restMountedRef.current = false;
      controller.abort();
    };
  }, [refreshTick]);

  // SSE live updates — now delegated to useSecureSse which handles ticket auth,
  // reconnects, and cleanup.
  const handleSseMessage = useCallback(
    (ev: MessageEvent) => {
      let event: GammaSSEEvent;
      try {
        event = JSON.parse(ev.data as string) as GammaSSEEvent;
      } catch {
        return;
      }

      if (event.type === "agent_registry_update") {
        // Validate shape before applying to state to prevent injected data from
        // corrupting the agent table if the SSE endpoint is ever compromised.
        if (!Array.isArray(event.agents)) {
          console.warn(
            "[Sentinel] agent_registry_update: event.agents is not an array — ignoring.",
            event,
          );
          return;
        }
        setSseError(null);
        setAgents(event.agents);
        setLoading(false);
      }
    },
    [],
  );

  useSecureSse({
    path: "/api/stream/agent-monitor",
    onMessage: handleSseMessage,
    reconnectMs: 4000,
    label: "SentinelAgents",
  });

  // Auto-refresh every 10s as fallback when SSE is silent or unavailable
  useEffect(() => {
    const id = setInterval(() => setRefreshTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  return { agents, loading, error, sseError, refresh };
}

// ── Sorted tables (memoized) ─────────────────────────────────────────────

function useSortedSessions(sessions: BackupSessionEntry[] | undefined) {
  return useMemo(
    () => (sessions ?? []).slice().sort((a, b) => b.createdAt - a.createdAt),
    [sessions],
  );
}

function useSortedFiles(files: BackupFileEntry[] | undefined) {
  return useMemo(
    () => (files ?? []).slice().sort((a, b) => b.modifiedAt - a.modifiedAt),
    [files],
  );
}

// ── Sub-components ────────────────────────────────────────────────────────

function SessionsTable({ sessions }: { sessions: BackupSessionEntry[] }): React.ReactElement {
  if (sessions.length === 0) {
    return <div style={EMPTY}>No pre-flight snapshots found.</div>;
  }

  return (
    <table style={TABLE}>
      <thead>
        <tr>
          <th style={TH}>App</th>
          <th style={TH}>Tier</th>
          <th style={{ ...TH, textAlign: "right" }}>Files</th>
          <th style={{ ...TH, textAlign: "right" }}>Size</th>
          <th style={TH}>Created</th>
        </tr>
      </thead>
      <tbody>
        {sessions.map((s) => (
          <tr key={s.bakSessionPath}>
            <td style={{ ...TD, fontWeight: 600 }}>{s.appId}</td>
            <td style={TD}><span style={tierStyle(s.tier)}>{s.tier}</span></td>
            <td style={{ ...TD, textAlign: "right" }}>{s.fileCount}</td>
            <td style={{ ...TD, textAlign: "right" }}>{fmtBytes(s.sizeBytes)}</td>
            <td style={TD}>{fmtDate(s.createdAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FilesTable({ files }: { files: BackupFileEntry[] }): React.ReactElement {
  if (files.length === 0) {
    return <div style={EMPTY}>No per-file backups found.</div>;
  }

  return (
    <table style={TABLE}>
      <thead>
        <tr>
          <th style={TH}>App</th>
          <th style={TH}>Tier</th>
          <th style={TH}>File</th>
          <th style={{ ...TH, textAlign: "right" }}>Size</th>
          <th style={TH}>Modified</th>
        </tr>
      </thead>
      <tbody>
        {files.map((f) => (
          <tr key={f.bakFile}>
            <td style={{ ...TD, fontWeight: 600 }}>{f.appId}</td>
            <td style={TD}><span style={tierStyle(f.tier)}>{f.tier}</span></td>
            <td style={{ ...TD, maxWidth: 220 }} title={f.originalFile}>{f.originalFile}</td>
            <td style={{ ...TD, textAlign: "right" }}>{fmtBytes(f.sizeBytes)}</td>
            <td style={TD}>{fmtDate(f.modifiedAt)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Activity feed ─────────────────────────────────────────────────────────

function ActivityFeed({ events }: { events: SystemEvent[] }): React.ReactElement {
  if (events.length === 0) {
    return <div style={EMPTY}>No system events recorded yet.</div>;
  }

  return (
    <div style={{ padding: "0 14px" }}>
      {events.map((ev, i) => (
        <div
          key={`${ev.ts}-${i}`}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 8,
            padding: "3px 0",
            borderBottom: "1px solid var(--color-border-subtle-strong)",
            fontSize: 11,
            ...(ev.type === "critical" ? {
              background: "rgba(239, 68, 68, 0.12)",
              padding: "3px 4px",
              borderRadius: 3,
              fontWeight: 600,
            } : {}),
          }}
        >
          <span
            style={{
              display: "inline-block",
              width: 6,
              height: 6,
              borderRadius: "50%",
              backgroundColor: eventColor(ev.type),
              flexShrink: 0,
              position: "relative",
              top: -1,
            }}
          />
          <span style={{ color: "var(--color-text-muted)", fontSize: 10, flexShrink: 0 }}>
            {fmtTime(ev.ts)}
          </span>
          <span style={{ color: "var(--color-text-secondary)" }}>{ev.message}</span>
        </div>
      ))}
    </div>
  );
}

// ── Agents view ───────────────────────────────────────────────────────────

function AgentsView({
  agents,
  loading,
  error,
  sseError,
  refresh,
}: {
  agents: AgentRegistryEntry[];
  loading: boolean;
  error: string | null;
  sseError: string | null;
  refresh: () => void;
}): React.ReactElement {
  const [selected, setSelected] = useState<string | null>(null);
  const [, setTick] = useState(0);

  // Re-render every 5s to keep relative timestamps fresh.
  // TODO(perf): scope this interval to a dedicated RelativeTime component
  // so only timestamp cells re-render rather than the full agent table.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 5_000);
    return () => clearInterval(id);
  }, []);

  const selectedAgent = useMemo(
    () => agents.find((a) => a.agentId === selected) ?? null,
    [agents, selected],
  );

  // Error banner is non-blocking: stale agent data (if any) remains visible below it.
  // This prevents the table from disappearing after a successful initial load
  // when a subsequent refresh fails.
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {error && (
        <div style={ERROR_BANNER}>
          <span>{error}</span>
          <button type="button" style={BTN} onClick={refresh}>Retry</button>
        </div>
      )}
      {sseError && !error && (
        <div style={WARN_BANNER}>
          <span>⚠ {sseError}</span>
        </div>
      )}

      {loading && agents.length === 0 ? (
        <div style={EMPTY}>Loading agents…</div>
      ) : agents.length === 0 ? (
        <div style={EMPTY}>No agents registered.</div>
      ) : (
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Agent table */}
          <div style={{ flex: 1, overflow: "auto" }}>
            <table style={TABLE}>
              <thead>
                <tr>
                  <th style={TH}>Agent</th>
                  <th style={TH}>Role</th>
                  <th style={TH}>Status</th>
                  <th style={TH}>Heartbeat</th>
                  <th style={TH}>Last Activity</th>
                  <th style={{ ...TH, textAlign: "center" }}>IPC</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((a) => {
                  const heartbeatAge = a.lastHeartbeat > 0 ? (Date.now() - a.lastHeartbeat) / 1000 : Infinity;
                  const heartbeatStale = heartbeatAge > 30;
                  const isSelected = selected === a.agentId;

                  return (
                    <tr
                      key={a.agentId}
                      onClick={() => setSelected(isSelected ? null : a.agentId)}
                      style={{
                        cursor: "pointer",
                        background: isSelected ? "rgba(255,255,255,0.04)" : undefined,
                      }}
                    >
                      <td style={{ ...TD, fontWeight: 600 }}>{a.agentId}</td>
                      <td style={TD}>
                        <span style={roleBadgeStyle(a.role)}>{a.role}</span>
                      </td>
                      <td style={TD}>
                        <span style={statusDot(a.status)} />
                        {a.status}
                      </td>
                      <td style={{ ...TD, color: heartbeatStale ? "#ef4444" : "var(--color-text-secondary)" }}>
                        {relativeTime(a.lastHeartbeat)}
                      </td>
                      <td style={{ ...TD, maxWidth: 220 }} title={a.lastActivity}>
                        {a.lastActivity || "\u2014"}
                      </td>
                      <td style={{ ...TD, textAlign: "center" }}>
                        <span
                          style={{
                            display: "inline-block",
                            width: 7,
                            height: 7,
                            borderRadius: "50%",
                            backgroundColor: a.acceptsMessages ? "#22c55e" : "#6b7280",
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Detail panel */}
          {selectedAgent && (
            <div
              style={{
                flex: "0 0 260px",
                borderLeft: "1px solid var(--color-border-subtle)",
                overflow: "auto",
                padding: "12px 14px",
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10 }}>
                {selectedAgent.agentId}
              </div>

              <DetailRow label="Role" value={selectedAgent.role} />
              <DetailRow label="Status" value={selectedAgent.status} />
              <DetailRow label="Session Key" value={selectedAgent.sessionKey} />
              <DetailRow label="Window ID" value={selectedAgent.windowId || "\u2014"} />
              <DetailRow label="App ID" value={selectedAgent.appId || "\u2014"} />
              <DetailRow label="IPC Ready" value={selectedAgent.acceptsMessages ? "Yes" : "No"} />
              <DetailRow label="Heartbeat" value={relativeTime(selectedAgent.lastHeartbeat)} />
              <DetailRow label="Created" value={selectedAgent.createdAt ? fmtDate(selectedAgent.createdAt) : "\u2014"} />
              <DetailRow label="Last Activity" value={selectedAgent.lastActivity || "\u2014"} />

              {selectedAgent.capabilities.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ ...PANE_HEADER, padding: "4px 0", border: "none" }}>
                    Capabilities
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                    {selectedAgent.capabilities.map((cap) => (
                      <span
                        key={cap}
                        style={{
                          ...TIER_BADGE,
                          background: "rgba(107,114,128,0.15)",
                          color: "#9ca3af",
                        }}
                      >
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
      <span style={{ color: "var(--color-text-muted)", flexShrink: 0 }}>{label}</span>
      <span
        style={{
          color: "var(--color-text-secondary)",
          textAlign: "right",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          maxWidth: 160,
          marginLeft: 8,
        }}
        title={value}
      >
        {value}
      </span>
    </div>
  );
}

// ── Dashboard view (original layout) ──────────────────────────────────────

function DashboardView({
  sessions,
  files,
  events,
}: {
  sessions: BackupSessionEntry[];
  files: BackupFileEntry[];
  events: SystemEvent[];
}): React.ReactElement {
  return (
    <>
      {/* Top row: tables */}
      <div style={TABLES_ROW}>
        {/* Session snapshots */}
        <div style={PANE_LEFT}>
          <div style={PANE_HEADER}>
            Session Snapshots
            <span style={{ float: "right", opacity: 0.8, fontWeight: 400, letterSpacing: 0 }}>
              {sessions.length}
            </span>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <SessionsTable sessions={sessions} />
          </div>
        </div>

        {/* File backups */}
        <div style={PANE}>
          <div style={PANE_HEADER}>
            File Backups
            <span style={{ float: "right", opacity: 0.8, fontWeight: 400, letterSpacing: 0 }}>
              {files.length}
            </span>
          </div>
          <div style={{ flex: 1, overflow: "auto" }}>
            <FilesTable files={files} />
          </div>
        </div>
      </div>

      {/* Bottom row: activity feed */}
      <div style={FEED_PANE}>
        <div style={PANE_HEADER}>
          System Activity Feed
          <span style={{ float: "right", opacity: 0.8, fontWeight: 400, letterSpacing: 0 }}>
            {events.length}
          </span>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          <ActivityFeed events={events} />
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────

export function SentinelApp(): React.ReactElement {
  const [tab, setTab] = useState<SentinelTab>("dashboard");

  const { data, loading, error, refresh } = useBackupInventory();
  const sessions = useSortedSessions(data?.sessions);
  const files = useSortedFiles(data?.files);
  const events = data?.events ?? [];

  const agentState = useAgentRegistry();

  return (
    <div style={ROOT}>
      {/* Header */}
      <header style={HEADER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Sentinel</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
            Stability &middot; Backups &middot; Agents
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {tab === "dashboard" && data && (
            <>
              <div style={{ textAlign: "right" }}>
                <div style={STAT_VALUE}>{fmtBytes(data.totalSizeBytes)}</div>
                <div style={STAT_LABEL}>Total backup size</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ ...STAT_VALUE, color: "var(--color-text-primary)" }}>
                  {fmtTime(data.ts)}
                </div>
                <div style={STAT_LABEL}>Last scan</div>
              </div>
            </>
          )}
          {tab === "agents" && (
            <div style={{ textAlign: "right" }}>
              <div style={STAT_VALUE}>{agentState.agents.length}</div>
              <div style={STAT_LABEL}>Active agents</div>
            </div>
          )}
          <button
            type="button"
            style={{ ...BTN, opacity: loading ? 0.5 : 1 }}
            disabled={tab === "dashboard" ? loading : agentState.loading}
            onClick={tab === "dashboard" ? refresh : agentState.refresh}
          >
            {(tab === "dashboard" ? loading : agentState.loading) ? "Loading\u2026" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <div style={TAB_BAR}>
        <button type="button" style={tabStyle(tab === "dashboard")} onClick={() => setTab("dashboard")}>
          Dashboard
        </button>
        <button type="button" style={tabStyle(tab === "agents")} onClick={() => setTab("agents")}>
          Agents
          {agentState.agents.length > 0 && (
            <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 400 }}>
              {agentState.agents.length}
            </span>
          )}
        </button>
      </div>

      {/* Error banner (dashboard tab) */}
      {tab === "dashboard" && error && (
        <div style={ERROR_BANNER}>
          <span>{error}</span>
          <button type="button" style={BTN} onClick={refresh}>Retry</button>
        </div>
      )}

      {/* Body */}
      <div style={BODY}>
        {tab === "dashboard" && (
          <DashboardView sessions={sessions} files={files} events={events} />
        )}
        {tab === "agents" && (
          <AgentsView
            agents={agentState.agents}
            loading={agentState.loading}
            error={agentState.error}
            sseError={agentState.sseError}
            refresh={agentState.refresh}
          />
        )}
      </div>
    </div>
  );
}
