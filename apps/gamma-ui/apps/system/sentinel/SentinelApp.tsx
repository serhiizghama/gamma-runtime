import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import type { BackupInventory, BackupSessionEntry, BackupFileEntry, SystemEvent } from "@gamma/types";
import { systemAuthHeaders } from "../../../hooks/useSessionRegistry";
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

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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

// ── Throttled fetch hook ──────────────────────────────────────────────────

const THROTTLE_MS = 100;

function useBackupInventory() {
  const [data, setData] = useState<BackupInventory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const lastFetchRef = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    const now = Date.now();
    const elapsed = now - lastFetchRef.current;
    const delay = elapsed < THROTTLE_MS ? THROTTLE_MS - elapsed : 0;

    const timer = setTimeout(() => {
      lastFetchRef.current = Date.now();
      setLoading(true);

      fetch(`${API_BASE}/api/system/backups`, {
        headers: systemAuthHeaders(),
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
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : "Failed to fetch backups");
            setLoading(false);
          }
        });
    }, delay);

    return () => {
      mountedRef.current = false;
      clearTimeout(timer);
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

// ── Main component ────────────────────────────────────────────────────────

export function SentinelApp(): React.ReactElement {
  const { data, loading, error, refresh } = useBackupInventory();
  const sessions = useSortedSessions(data?.sessions);
  const files = useSortedFiles(data?.files);
  const events = data?.events ?? [];

  return (
    <div style={ROOT}>
      {/* Header */}
      <header style={HEADER}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Sentinel</div>
          <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
            Pre-flight Snapshots &middot; File Backups &middot; Activity Feed
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {data && (
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
          <button
            type="button"
            style={{ ...BTN, opacity: loading ? 0.5 : 1 }}
            disabled={loading}
            onClick={refresh}
          >
            {loading ? "Scanning\u2026" : "Refresh"}
          </button>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div style={ERROR_BANNER}>
          <span>{error}</span>
          <button type="button" style={BTN} onClick={refresh}>Retry</button>
        </div>
      )}

      {/* Body */}
      <div style={BODY}>
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
      </div>
    </div>
  );
}
