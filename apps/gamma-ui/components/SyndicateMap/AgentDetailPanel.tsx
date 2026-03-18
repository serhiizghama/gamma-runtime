/**
 * AgentDetailPanel — Sidebar panel for inspecting a selected agent.
 *
 * Tabs:
 *  - Soul:  SOUL.md summary (GET /api/agents/:id/soul)
 *  - Tasks: Active/completed tasks (GET /api/agents/:id/tasks)
 *  - Trace: Console-style log view (GET /api/agents/:id/trace + SSE stream)
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { systemAuthHeaders } from "../../lib/auth";
import { API_BASE } from "../../constants/api";
import { useSecureSse } from "../../hooks/useSecureSse";

// ── Types ─────────────────────────────────────────────────────────────────

interface SoulData {
  ok: boolean;
  soul: string;
}

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

interface TraceEntry {
  id: string;
  sessionKey: string;
  windowId: string;
  kind: string;
  content: string;
  ts: number;
  stepId: string;
  parentId?: string;
}

type Tab = "soul" | "tasks" | "trace";

interface Props {
  agentId: string;
  agentName: string;
  agentEmoji: string;
  agentColor: string;
  onClose: () => void;
}

// ── Styles ────────────────────────────────────────────────────────────────

const panel: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  width: 380,
  height: "100%",
  background: "var(--color-bg-secondary)",
  borderLeft: "1px solid var(--color-border-subtle)",
  boxShadow: "var(--shadow-panel-side)",
  display: "flex",
  flexDirection: "column",
  zIndex: 10,
  fontFamily: "var(--font-system)",
  overflow: "hidden",
};

const header: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "12px 16px",
  borderBottom: "1px solid var(--color-border-subtle)",
  flexShrink: 0,
};

const closeBtn: CSSProperties = {
  marginLeft: "auto",
  background: "none",
  border: "none",
  color: "var(--color-text-secondary)",
  fontSize: 18,
  cursor: "pointer",
  padding: "2px 6px",
  borderRadius: 4,
  lineHeight: 1,
};

const tabBar: CSSProperties = {
  display: "flex",
  borderBottom: "1px solid var(--color-border-subtle)",
  flexShrink: 0,
};

const tabBtnBase: CSSProperties = {
  flex: 1,
  padding: "8px 0",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  background: "none",
  border: "none",
  borderBottom: "2px solid transparent",
  color: "var(--color-text-secondary)",
  cursor: "pointer",
  transition: "color var(--duration-fast), border-color var(--duration-fast)",
};

const tabBtnActive: CSSProperties = {
  color: "var(--color-text-primary)",
  borderBottomColor: "var(--color-accent-primary)",
};

const tabContent: CSSProperties = {
  flex: 1,
  overflow: "auto",
  padding: 16,
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

// ── Soul Tab ──────────────────────────────────────────────────────────────

function SoulTab({ agentId }: { agentId: string }) {
  const [soul, setSoul] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/soul`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<SoulData>;
      })
      .then((data) => setSoul(data.soul))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [agentId]);

  if (loading) return <div style={loadingMsg}>Loading persona...</div>;
  if (error) return <div style={errorMsg}>Could not load SOUL.md: {error}</div>;
  if (!soul) return <div style={emptyMsg}>No persona summary available.</div>;

  return (
    <pre
      style={{
        fontSize: 12,
        lineHeight: 1.6,
        color: "var(--color-text-primary)",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        margin: 0,
      }}
    >
      {soul}
    </pre>
  );
}

// ── Tasks Tab ─────────────────────────────────────────────────────────────

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

function TasksTab({ agentId }: { agentId: string }) {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}

// ── Trace Tab ─────────────────────────────────────────────────────────────

const TRACE_KIND_COLORS: Record<string, string> = {
  thought: "#d7afff",
  tool_call: "#ffd787",
  tool_result: "#5fd7ff",
  text: "#87d7ff",
};

function TraceTab({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<TraceEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch historical trace
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setEntries([]);

    fetch(
      `${API_BASE}/api/agents/${encodeURIComponent(agentId)}/trace?count=200`,
      { headers: systemAuthHeaders(), signal: controller.signal },
    )
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<{ ok: boolean; trace: TraceEntry[] }>;
      })
      .then((data) => setEntries(data.trace))
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Failed to load");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [agentId]);

  // SSE live stream for real-time trace
  const handleStreamMessage = useCallback((ev: MessageEvent) => {
    try {
      const data = JSON.parse(ev.data as string) as Record<string, unknown>;
      if (data.type === "keep_alive" || data.type === "trace_end") return;

      // SSE events from the agent's window stream have 'type' field;
      // map them into our trace shape for display
      const entry: TraceEntry = {
        id: `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        sessionKey: "",
        windowId: (data.windowId as string) ?? "",
        kind: mapSseTypeToKind(data.type as string),
        content: extractContent(data),
        ts: Date.now(),
        stepId: (data.runId as string) ?? "",
      };
      if (entry.kind === "unknown") return;

      setEntries((prev) => [...prev, entry]);
    } catch {
      // Ignore parse errors
    }
  }, []);

  useSecureSse({
    path: `/api/agents/${encodeURIComponent(agentId)}/trace/stream`,
    onMessage: handleStreamMessage,
    reconnectMs: 5000,
    label: "Trace",
  });

  // Auto-scroll on new entries
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries.length]);

  if (loading) return <div style={loadingMsg}>Loading trace...</div>;
  if (error) return <div style={errorMsg}>Could not load trace: {error}</div>;
  if (entries.length === 0)
    return <div style={emptyMsg}>No trace events recorded yet.</div>;

  return (
    <div
      ref={scrollRef}
      style={{
        fontFamily: "ui-monospace, 'SF Mono', monospace",
        fontSize: 11,
        lineHeight: 1.5,
        color: "var(--color-text-primary)",
        overflow: "auto",
        flex: 1,
        padding: 0,
      }}
    >
      {entries.map((e) => (
        <div
          key={e.id}
          style={{
            display: "flex",
            gap: 8,
            padding: "2px 0",
            borderBottom: "1px solid var(--color-border-subtle-strong)",
          }}
        >
          <span style={{ color: "var(--color-text-secondary)", flexShrink: 0, width: 56 }}>
            {formatTs(e.ts)}
          </span>
          <span
            style={{
              color: TRACE_KIND_COLORS[e.kind] ?? "var(--color-text-secondary)",
              flexShrink: 0,
              width: 72,
              fontWeight: 600,
            }}
          >
            {e.kind}
          </span>
          <span
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              opacity: 0.9,
            }}
          >
            {truncate(e.content, 300)}
          </span>
        </div>
      ))}
    </div>
  );
}

function mapSseTypeToKind(type: string): string {
  if (type === "thinking") return "thought";
  if (type === "tool_call") return "tool_call";
  if (type === "tool_result") return "tool_result";
  if (type === "assistant_delta" || type === "assistant_update") return "text";
  return "unknown";
}

function extractContent(data: Record<string, unknown>): string {
  if (typeof data.text === "string") return data.text.slice(-200);
  if (typeof data.tool === "string") return data.tool;
  if (typeof data.content === "string") return data.content;
  return JSON.stringify(data).slice(0, 200);
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

// ── Main Panel ────────────────────────────────────────────────────────────

export function AgentDetailPanel({
  agentId,
  agentName,
  agentEmoji,
  agentColor,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("soul");

  return (
    <div style={panel}>
      {/* Header */}
      <div style={header}>
        <span style={{ fontSize: 24 }}>{agentEmoji}</span>
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--color-text-primary)",
            }}
          >
            {agentName}
          </div>
          <div style={{ fontSize: 11, color: agentColor }}>{agentId.slice(0, 20)}...</div>
        </div>
        <button style={closeBtn} onClick={onClose} title="Close">
          &#x2715;
        </button>
      </div>

      {/* Tabs */}
      <div style={tabBar}>
        {(["soul", "tasks", "trace"] as const).map((t) => (
          <button
            key={t}
            style={{
              ...tabBtnBase,
              ...(tab === t ? tabBtnActive : {}),
            }}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={tabContent}>
        {tab === "soul" && <SoulTab agentId={agentId} />}
        {tab === "tasks" && <TasksTab agentId={agentId} />}
        {tab === "trace" && <TraceTab agentId={agentId} />}
      </div>
    </div>
  );
}
