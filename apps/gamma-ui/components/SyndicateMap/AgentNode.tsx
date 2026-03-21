/**
 * AgentNode — Custom React Flow node for the Syndicate Map.
 *
 * Renders a compact agent avatar with:
 *  - Emoji glyph centered in a rounded card
 *  - Border / glow derived from `data.uiColor`
 *  - Status indicator dot (running=green, idle=amber, offline=red)
 *  - Task badge (pill, hidden when 0, pulsing red when > 3)
 *  - Name + roleId label below the avatar
 *
 * Wrapped in React.memo with a custom comparator that checks the data
 * fields we actually render, so node position changes from other nodes
 * don't cause spurious re-renders.
 */

import { memo, type CSSProperties } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";

// ── Data contract ─────────────────────────────────────────────────────────

export interface AgentNodeData extends Record<string, unknown> {
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  status: "running" | "idle" | "offline" | "error" | "aborted";
  inProgressTaskCount: number;
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
  minWidth: 100,
  cursor: "grab",
};

const avatarBase: CSSProperties = {
  position: "relative",
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
  maxWidth: 120,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const roleStyle: CSSProperties = {
  fontSize: 10,
  color: "var(--color-text-secondary)",
  fontFamily: "var(--font-system)",
  textAlign: "center",
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

// ── LOD-specific styles ───────────────────────────────────────────────────

const compactCard: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: 4,
  cursor: "grab",
};

const compactAvatar: CSSProperties = {
  position: "relative",
  width: 48,
  height: 48,
  borderRadius: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 22,
  lineHeight: 1,
  background: "var(--color-surface-elevated)",
  transition: "box-shadow var(--duration-fast) var(--ease-smooth)",
};

const compactDot: CSSProperties = {
  position: "absolute",
  top: 2,
  right: 2,
  width: 8,
  height: 8,
  borderRadius: "50%",
  border: "2px solid var(--color-bg-primary)",
};

const dotModeOuter: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  cursor: "grab",
};

const dotModeCircle: CSSProperties = {
  position: "relative",
  width: 20,
  height: 20,
  borderRadius: "50%",
  background: "var(--color-surface-elevated)",
  transition: "box-shadow var(--duration-fast) var(--ease-smooth)",
};

const dotModeStatusDot: CSSProperties = {
  position: "absolute",
  top: -2,
  right: -2,
  width: 6,
  height: 6,
  borderRadius: "50%",
  border: "1px solid var(--color-bg-primary)",
};

type Lod = "full" | "compact" | "dot";

// ── Component ─────────────────────────────────────────────────────────────

function AgentNodeInner({ data, selected }: NodeProps) {
  const {
    name,
    roleId,
    avatarEmoji,
    uiColor,
    status,
    inProgressTaskCount,
  } = data as unknown as AgentNodeData;

  const zoom = useStore((s) => s.transform[2]);
  const lod: Lod = zoom >= 0.6 ? "full" : zoom >= 0.3 ? "compact" : "dot";

  const color = uiColor || "var(--color-accent-primary)";
  const dotColor = STATUS_DOT[status] ?? STATUS_DOT.offline;
  const taskCount = inProgressTaskCount ?? 0;
  const isPulsing = taskCount > 3;

  // ── Dot mode: minimal colored circle ────────────────────────────────────
  if (lod === "dot") {
    return (
      <>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={dotModeOuter}>
          <div
            style={{
              ...dotModeCircle,
              border: `2px solid ${color}`,
              boxShadow: selected
                ? `0 0 12px ${color}88`
                : `0 0 6px ${color}44`,
            }}
          >
            <span
              style={{
                ...dotModeStatusDot,
                background: dotColor,
              }}
            />
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </>
    );
  }

  // ── Compact mode: avatar + emoji + status dot only ──────────────────────
  if (lod === "compact") {
    return (
      <>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={compactCard}>
          <div
            style={{
              ...compactAvatar,
              border: `2px solid ${color}`,
              boxShadow: selected
                ? `0 0 16px ${color}88, 0 0 6px ${color}66`
                : `0 0 8px ${color}44`,
              transform: selected ? "scale(1.05)" : undefined,
              transition: "box-shadow 200ms ease, transform 200ms ease",
            }}
          >
            <span style={{ userSelect: "none" }}>{avatarEmoji}</span>
            <span
              style={{
                ...compactDot,
                background: dotColor,
                boxShadow: status === "running" ? `0 0 4px ${dotColor}` : undefined,
              }}
            />
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </>
    );
  }

  // ── Full mode: current detailed rendering ───────────────────────────────
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} />

      <div style={card}>
        {/* Avatar */}
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
              boxShadow: status === "running" ? `0 0 6px ${dotColor}` : undefined,
            }}
          />

          {/* Task badge */}
          {taskCount > 0 && (
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
              {taskCount}
            </span>
          )}
        </div>

        {/* Labels */}
        <span style={nameStyle}>{name}</span>
        <span style={roleStyle}>{roleId}</span>
      </div>

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </>
  );
}

/**
 * Custom comparator: only re-render when the data fields we display change.
 * React Flow passes `selected`, `dragging`, `positionAbsoluteX/Y` etc. as
 * top-level NodeProps — we ignore those to avoid re-renders when other nodes
 * move or selection changes.
 */
function arePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  if (prev.selected !== next.selected) return false;
  const p = prev.data as unknown as AgentNodeData;
  const n = next.data as unknown as AgentNodeData;
  return (
    p.name === n.name &&
    p.roleId === n.roleId &&
    p.avatarEmoji === n.avatarEmoji &&
    p.uiColor === n.uiColor &&
    p.status === n.status &&
    p.inProgressTaskCount === n.inProgressTaskCount
  );
}

export const AgentNode = memo(AgentNodeInner, arePropsEqual);
