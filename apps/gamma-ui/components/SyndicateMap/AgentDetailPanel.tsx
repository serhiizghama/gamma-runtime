/**
 * AgentDetailPanel — Sidebar panel for inspecting a selected agent.
 *
 * Tabs:
 *  - Soul:  SOUL.md summary (GET /api/agents/:id/soul)
 *  - Tasks: Active/completed tasks (GET /api/agents/:id/tasks)
 *  - Trace: Console-style log view (GET /api/agents/:id/trace + SSE stream)
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { systemAuthHeaders } from "../../lib/auth";
import { API_BASE } from "../../constants/api";
import { useAgentTrace } from "../../hooks/useAgentTrace";
import { TraceTerminal } from "./TraceTerminal";
import { ActivityFeed } from "./ActivityFeed";
import { useActivityStream } from "../../hooks/useActivityStream";
import { TaskList } from "./TaskList";

// ── Types ─────────────────────────────────────────────────────────────────

interface SoulData {
  ok: boolean;
  soul: string;
}


type Tab = "tasks" | "trace" | "activity";

/** Check if agentId matches backend's strict ULID format: agent.<26-char ULID> */
const AGENT_ULID_RE = /^agent\.[A-Z0-9]{26}$/;
function isValidUlidAgentId(id: string): boolean {
  return AGENT_ULID_RE.test(id);
}

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
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
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

// ── Soul Tab (hidden — pending backend data migration) ────────────────────

// @ts-ignore — SoulTab temporarily unused while Soul tab is hidden
function _SoulTab({ agentId }: { agentId: string }) {
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

// ── Trace Tab ─────────────────────────────────────────────────────────────

function TraceTab({ agentId }: { agentId: string }) {
  const { entries, loading, connected } = useAgentTrace({
    agentId: isValidUlidAgentId(agentId) ? agentId : null,
    enabled: true,
  });
  return <TraceTerminal entries={entries} loading={loading} connected={connected} />;
}

// ── Activity Tab ──────────────────────────────────────────────────────────

function ActivityTab({ agentId }: { agentId: string }) {
  const { events } = useActivityStream();
  return <ActivityFeed events={events} agentId={agentId} />;
}

// ── Main Panel ────────────────────────────────────────────────────────────

export function AgentDetailPanel({
  agentId,
  agentName,
  agentEmoji,
  agentColor,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>("tasks");

  // Reset tab to "tasks" when switching agents
  const prevIdRef = useRef(agentId);
  if (prevIdRef.current !== agentId) {
    prevIdRef.current = agentId;
    setTab("tasks");
  }

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
          <div style={{ fontSize: 11, color: agentColor }}>
            {agentId.length > 24 ? `${agentId.slice(0, 20)}…` : agentId}
          </div>
        </div>
        <button style={closeBtn} onClick={onClose} title="Close">
          &#x2715;
        </button>
      </div>

      {/* Tabs — Soul tab hidden pending backend data migration */}
      <div style={tabBar}>
        {(["tasks", "trace", "activity"] as const).map((t) => (
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

      {/* Tab content — key on agentId forces remount on agent switch,
          ensuring each tab's internal state (fetch, SSE) is cleanly reset */}
      <div style={tabContent} key={agentId}>
        {/* {tab === "soul" && <SoulTab agentId={agentId} />} */}
        {tab === "tasks" && <TaskList agentId={agentId} />}
        {tab === "trace" && <TraceTab agentId={agentId} />}
        {tab === "activity" && <ActivityTab agentId={agentId} />}
      </div>
    </div>
  );
}
