/**
 * AgentClusterNode — Custom React Flow node for collapsed subtrees.
 *
 * Renders a "stacked card" visual indicating multiple agents are grouped:
 *  - Root agent emoji with layered shadow effect
 *  - "+N agents" badge showing hidden count
 *  - Aggregate status dot (worst across all members)
 *  - Aggregate task badge (sum across all members)
 *  - Expand indicator (▶) suggesting the cluster can be expanded
 *
 * Same style approach as AgentNode: inline CSSProperties, CSS vars.
 */

import { memo, type CSSProperties } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

// ── Data contract ─────────────────────────────────────────────────────────

export interface AgentClusterNodeData extends Record<string, unknown> {
  /** Cluster root agent name. */
  name: string;
  /** Cluster root emoji. */
  avatarEmoji: string;
  /** Cluster root UI color. */
  uiColor: string;
  /** Total hidden agents (not counting root). */
  hiddenCount: number;
  /** Aggregate task count. */
  totalTasks: number;
  /** Worst status across members. */
  worstStatus: string;
  /** Cluster root agent ID (for expand action). */
  clusterId: string;
}

// ── Status indicator mapping ──────────────────────────────────────────────

const STATUS_DOT: Record<string, string> = {
  running: "#28c840",
  idle:    "#febc2e",
  error:   "#ff5f57",
  aborted: "#ff5f57",
  offline: "#666",
};

// ── Styles (inline, using CSS vars for theme coherence) ───────────────────

const card: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: 12,
  minWidth: 120,
  cursor: "grab",
};

const avatarWrapper: CSSProperties = {
  position: "relative",
  width: 88,
  height: 88,
};

/** Background "stacked" layer giving depth. */
const stackShadow: CSSProperties = {
  position: "absolute",
  top: 4,
  left: 4,
  width: 80,
  height: 80,
  borderRadius: 20,
  background: "var(--color-surface-elevated)",
  opacity: 0.45,
};

const avatarBase: CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  width: 80,
  height: 80,
  borderRadius: 20,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 36,
  lineHeight: 1,
  background: "var(--color-surface-elevated)",
  transition: "box-shadow var(--duration-fast) var(--ease-smooth)",
};

const nameStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-system)",
  textAlign: "center",
  maxWidth: 140,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const countStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 500,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-system)",
  textAlign: "center",
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginTop: -4,
};

const dotBase: CSSProperties = {
  position: "absolute",
  top: 4,
  right: 4,
  width: 10,
  height: 10,
  borderRadius: "50%",
  border: "2px solid var(--color-bg-primary)",
};

const badgeBase: CSSProperties = {
  position: "absolute",
  bottom: -4,
  right: -4,
  minWidth: 20,
  height: 18,
  borderRadius: 9,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 10,
  fontWeight: 700,
  fontFamily: "var(--font-system)",
  color: "#fff",
  padding: "0 5px",
  border: "2px solid var(--color-bg-primary)",
};

const handleStyle: CSSProperties = {
  width: 8,
  height: 8,
  background: "var(--color-border-subtle)",
  border: "2px solid var(--color-bg-primary)",
};

const expandIndicator: CSSProperties = {
  fontSize: 9,
  color: "var(--color-text-tertiary)",
  fontFamily: "var(--font-system)",
  opacity: 0.7,
};

// ── Component ─────────────────────────────────────────────────────────────

function AgentClusterNodeInner({ data, selected }: NodeProps) {
  const {
    name,
    avatarEmoji,
    uiColor,
    hiddenCount,
    totalTasks,
    worstStatus,
  } = data as unknown as AgentClusterNodeData;

  const color = uiColor || "var(--color-accent-primary)";
  const dotColor = STATUS_DOT[worstStatus] ?? STATUS_DOT.offline;
  const isPulsing = totalTasks > 3;

  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} />

      <div style={card}>
        {/* Avatar with stacked shadow */}
        <div style={avatarWrapper}>
          {/* Stacked layer behind */}
          <div
            style={{
              ...stackShadow,
              border: `2px solid ${color}`,
              boxShadow: `0 0 8px ${color}22`,
            }}
          />

          {/* Primary avatar */}
          <div
            style={{
              ...avatarBase,
              border: `2px solid ${color}`,
              boxShadow: selected
                ? `0 0 20px ${color}88, 0 0 8px ${color}66, inset 0 0 4px ${color}22`
                : `0 0 12px ${color}44, 0 0 4px ${color}22`,
              transform: selected ? "scale(1.05)" : undefined,
              transition: "box-shadow 200ms ease, transform 200ms ease",
            }}
          >
            <span style={{ userSelect: "none" }}>{avatarEmoji}</span>

            {/* Status dot */}
            <span
              style={{
                ...dotBase,
                background: dotColor,
                boxShadow:
                  worstStatus === "running"
                    ? `0 0 6px ${dotColor}`
                    : undefined,
              }}
            />

            {/* Task badge */}
            {totalTasks > 0 && (
              <span
                style={{
                  ...badgeBase,
                  background: isPulsing
                    ? "var(--color-accent-error)"
                    : color,
                  animation: isPulsing
                    ? "agentBadgePulse 1.2s ease-in-out infinite"
                    : undefined,
                }}
              >
                {totalTasks}
              </span>
            )}
          </div>
        </div>

        {/* Labels */}
        <span style={nameStyle}>{name}</span>
        <span style={countStyle}>
          +{hiddenCount} agent{hiddenCount !== 1 ? "s" : ""}
          <span style={expandIndicator}>&#x25B6;</span>
        </span>
      </div>

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </>
  );
}

// ── Memo comparator ───────────────────────────────────────────────────────

function arePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data as unknown as AgentClusterNodeData;
  const n = next.data as unknown as AgentClusterNodeData;
  return (
    p.name === n.name &&
    p.avatarEmoji === n.avatarEmoji &&
    p.uiColor === n.uiColor &&
    p.hiddenCount === n.hiddenCount &&
    p.totalTasks === n.totalTasks &&
    p.worstStatus === n.worstStatus &&
    p.clusterId === n.clusterId
  );
}

export const AgentClusterNode = memo(AgentClusterNodeInner, arePropsEqual);
