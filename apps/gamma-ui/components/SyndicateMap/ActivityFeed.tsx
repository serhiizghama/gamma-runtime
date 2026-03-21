/**
 * ActivityFeed — Compact, scrollable activity event list for the Syndicate Map.
 *
 * Can be used standalone or embedded inside AgentDetailPanel as a tab.
 * When `agentId` is provided, filters to events involving that agent.
 */

import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { ActivityEvent, ActivityEventKind } from "@gamma/types";

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  events: ActivityEvent[];
  /** When set, only shows events where sourceAgentId or targetAgentId matches */
  agentId?: string;
}

// ── Event kind → badge color mapping ──────────────────────────────────────

const KIND_COLORS: Partial<Record<ActivityEventKind, { bg: string; fg: string }>> = {
  agent_registered:    { bg: "rgba(40, 200, 64, 0.15)",  fg: "#28c840" },
  agent_deregistered:  { bg: "rgba(255, 95, 87, 0.15)",  fg: "#ff5f57" },
  agent_status_change: { bg: "rgba(254, 188, 46, 0.15)", fg: "#febc2e" },
  ipc_message_sent:    { bg: "rgba(59, 130, 246, 0.15)", fg: "#60a5fa" },
  ipc_task_completed:  { bg: "rgba(40, 200, 64, 0.15)",  fg: "#28c840" },
  ipc_task_failed:     { bg: "rgba(255, 95, 87, 0.15)",  fg: "#ff5f57" },
  message_sent:        { bg: "rgba(59, 130, 246, 0.15)", fg: "#60a5fa" },
  message_completed:   { bg: "rgba(40, 200, 64, 0.15)",  fg: "#28c840" },
  lifecycle_start:     { bg: "rgba(147, 130, 220, 0.15)", fg: "#a78bfa" },
  lifecycle_end:       { bg: "rgba(147, 130, 220, 0.15)", fg: "#a78bfa" },
  lifecycle_error:     { bg: "rgba(255, 95, 87, 0.15)",  fg: "#ff5f57" },
  emergency_stop:      { bg: "rgba(255, 60, 60, 0.25)",  fg: "#ff3c3c" },
  hierarchy_change:    { bg: "rgba(254, 188, 46, 0.15)", fg: "#febc2e" },
  tool_call_start:     { bg: "rgba(255, 215, 135, 0.15)", fg: "#ffd787" },
  tool_call_end:       { bg: "rgba(255, 215, 135, 0.15)", fg: "#ffd787" },
  context_injected:    { bg: "rgba(135, 215, 255, 0.15)", fg: "#87d7ff" },
  system_event:        { bg: "rgba(160, 160, 160, 0.15)", fg: "#a0a0a0" },
};

const DEFAULT_KIND_COLOR = { bg: "rgba(160, 160, 160, 0.12)", fg: "#888" };

// ── Human-readable descriptions per event kind ────────────────────────────

function describeEvent(ev: ActivityEvent): string {
  switch (ev.kind) {
    case "agent_registered":    return "Agent registered";
    case "agent_deregistered":  return "Agent deregistered";
    case "agent_status_change": return ev.payload ? `Status: ${ev.payload}` : "Status changed";
    case "ipc_message_sent":    return ev.targetAgentId ? `Msg to ${truncate(ev.targetAgentId, 16)}` : "IPC message sent";
    case "ipc_task_completed":  return "IPC task completed";
    case "ipc_task_failed":     return ev.payload ? `Task failed: ${truncate(ev.payload, 40)}` : "IPC task failed";
    case "message_sent":        return ev.targetAgentId ? `To ${truncate(ev.targetAgentId, 16)}` : "Message sent";
    case "message_completed":   return "Message completed";
    case "lifecycle_start":     return "Lifecycle started";
    case "lifecycle_end":       return "Lifecycle ended";
    case "lifecycle_error":     return ev.payload ? `Error: ${truncate(ev.payload, 40)}` : "Lifecycle error";
    case "emergency_stop":      return "EMERGENCY STOP";
    case "hierarchy_change":    return ev.payload ?? "Hierarchy changed";
    case "tool_call_start":     return ev.toolName ? `Tool: ${ev.toolName}` : "Tool call started";
    case "tool_call_end":       return ev.toolName ? `Tool done: ${ev.toolName}` : "Tool call ended";
    case "context_injected":    return "Context injected";
    case "system_event":        return ev.payload ?? "System event";
    default:                    return ev.payload ?? ev.kind;
  }
}

// ── Relative time formatting ──────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "now";
  const secs = Math.floor(diffMs / 1000);
  if (secs < 5) return "now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + "\u2026" : s;
}

// ── Pretty kind label ─────────────────────────────────────────────────────

function kindLabel(kind: ActivityEventKind): string {
  return kind.replace(/_/g, " ");
}

// ── Styles ────────────────────────────────────────────────────────────────

const container: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  height: "100%",
  fontFamily: "var(--font-system)",
};

const scrollArea: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  overflowX: "hidden",
};

const row: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 6,
  padding: "5px 8px",
  borderBottom: "1px solid var(--color-border-subtle)",
  fontSize: 11,
  lineHeight: 1.4,
};

const tsStyle: CSSProperties = {
  flexShrink: 0,
  width: 48,
  color: "var(--color-text-secondary)",
  fontSize: 10,
  whiteSpace: "nowrap",
};

const badge: CSSProperties = {
  flexShrink: 0,
  padding: "1px 6px",
  borderRadius: 6,
  fontSize: 9,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.03em",
  whiteSpace: "nowrap",
  lineHeight: 1.5,
};

const sourceStyle: CSSProperties = {
  flexShrink: 0,
  maxWidth: 72,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontSize: 10,
};

const descStyle: CSSProperties = {
  flex: 1,
  color: "var(--color-text-secondary)",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const emptyMsg: CSSProperties = {
  color: "var(--color-text-secondary)",
  fontSize: 12,
  textAlign: "center",
  padding: 24,
};

// ── Component ─────────────────────────────────────────────────────────────

export function ActivityFeed({ events, agentId }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Filter events when agentId is provided
  const filtered = useMemo(() => {
    if (!agentId) return events;
    return events.filter(
      (ev) => ev.agentId === agentId || ev.targetAgentId === agentId,
    );
  }, [events, agentId]);

  // Auto-scroll to bottom on new events (only if already near bottom)
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [filtered.length]);

  if (filtered.length === 0) {
    return (
      <div style={container}>
        <div style={emptyMsg}>No activity events yet.</div>
      </div>
    );
  }

  return (
    <div style={container}>
      <div ref={scrollRef} style={scrollArea}>
        {filtered.map((ev) => {
          const kc = KIND_COLORS[ev.kind] ?? DEFAULT_KIND_COLOR;
          return (
            <div key={ev.id} style={row}>
              <span style={tsStyle}>{relativeTime(ev.ts)}</span>
              <span style={{ ...badge, background: kc.bg, color: kc.fg }}>
                {kindLabel(ev.kind)}
              </span>
              <span style={sourceStyle} title={ev.agentId}>
                {truncate(ev.agentId, 12)}
              </span>
              <span style={descStyle} title={describeEvent(ev)}>
                {describeEvent(ev)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
