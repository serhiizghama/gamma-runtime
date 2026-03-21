/**
 * TaskList — Standalone component for displaying an agent's task list.
 *
 * Fetches tasks from GET /api/agents/:id/tasks and renders them as
 * status-colored cards.
 */

import { useEffect, useState, type CSSProperties } from "react";
import { systemAuthHeaders } from "../../lib/auth";
import { API_BASE } from "../../constants/api";

// ── Types ─────────────────────────────────────────────────────────────────

interface TaskRecord {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  status: string;
  payload: string;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Check if agentId matches backend's strict ULID format: agent.<26-char ULID> */
const AGENT_ULID_RE = /^agent\.[A-Z0-9]{26}$/;
function isValidUlidAgentId(id: string): boolean {
  return AGENT_ULID_RE.test(id);
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ── Styles ────────────────────────────────────────────────────────────────

const taskPill: CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
};

const TASK_STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  pending: { bg: "rgba(254, 188, 46, 0.15)", fg: "#febc2e" },
  in_progress: { bg: "rgba(59, 130, 246, 0.15)", fg: "#60a5fa" },
  completed: { bg: "rgba(40, 200, 64, 0.15)", fg: "#28c840" },
  failed: { bg: "rgba(255, 95, 87, 0.15)", fg: "#ff5f57" },
};

const emptyMsg: CSSProperties = {
  color: "var(--color-text-secondary)",
  fontSize: 12,
  textAlign: "center",
  padding: 24,
};

const errorMsg: CSSProperties = {
  ...emptyMsg,
  color: "var(--color-accent-error)",
};

const loadingMsg: CSSProperties = {
  ...emptyMsg,
  opacity: 0.6,
};

// ── Component ─────────────────────────────────────────────────────────────

export function TaskList({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Skip fetch for registry-only agents (non-ULID IDs fail backend validation)
    if (!isValidUlidAgentId(agentId)) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(
      `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/tasks?limit=50`,
      { headers: systemAuthHeaders(), signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ ok: boolean; tasks: TaskRecord[] }>;
      })
      .then((data) => setTasks(data.tasks))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [agentId]);

  if (loading) return <div style={loadingMsg}>Loading tasks...</div>;
  if (error) return <div style={errorMsg}>Could not load tasks: {error}</div>;
  if (tasks.length === 0) return <div style={emptyMsg}>No tasks assigned.</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {tasks.map((t) => {
        const sc = TASK_STATUS_COLORS[t.status] ?? TASK_STATUS_COLORS.pending;
        return (
          <div
            key={t.id}
            style={{
              background: "var(--color-surface-elevated)",
              border: "1px solid var(--color-border-subtle)",
              borderRadius: 8,
              padding: "10px 12px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 4,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: "var(--color-text-primary)",
                  fontWeight: 600,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  maxWidth: 220,
                }}
              >
                {t.id.slice(0, 16)}...
              </span>
              <span style={{ ...taskPill, background: sc.bg, color: sc.fg }}>
                {t.status.replace("_", " ")}
              </span>
            </div>
            <div
              style={{
                fontSize: 11,
                color: "var(--color-text-secondary)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 60,
                overflow: "hidden",
              }}
            >
              {truncate(t.payload, 120)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
