/**
 * AgentNode — Custom React Flow node for the Syndicate Map.
 *
 * Design: Single avatar card with LED-diode border animation.
 *  - Emoji glyph centered in a rounded card
 *  - Border color = agent's `uiColor` (identity)
 *  - When running: animated LED dots chase around the border perimeter
 *  - Idle/error/offline: static border with status-tinted glow
 *  - Task badge (pill, hidden when 0, pulsing red when > 3)
 *  - Name + roleId label below the avatar
 */

import { memo, useEffect, type CSSProperties } from "react";
import { Handle, Position, useStore, type NodeProps } from "@xyflow/react";

// ── Data contract ─────────────────────────────────────────────────────────

export interface AgentNodeData extends Record<string, unknown> {
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  status: "running" | "idle" | "offline" | "error" | "aborted";
  inProgressTaskCount: number;
  teamName: string | null;
  /** True when this agent is rendered inside a team group container. */
  isInTeamGroup?: boolean;
  /** True when this agent is the squad leader of their team. */
  isLeader?: boolean;
}

// ── Status color mapping ──────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  running: "#28c840",
  idle:    "#febc2e",
  error:   "#ff5f57",
  aborted: "#ff5f57",
  offline: "#555",
};

// ── Inject keyframe animations once ───────────────────────────────────────

let stylesInjected = false;
function injectStyles() {
  if (stylesInjected) return;
  stylesInjected = true;
  const sheet = document.createElement("style");
  sheet.id = "agent-node-animations";
  sheet.textContent = `
    @keyframes agentBreath {
      0%, 100% { box-shadow: 0 0 8px var(--led-color, #28c840)44, 0 2px 16px rgba(0,0,0,0.5); }
      50%      { box-shadow: 0 0 18px var(--led-color, #28c840)66, 0 0 32px var(--led-color, #28c840)22, 0 2px 16px rgba(0,0,0,0.5); }
    }
    @keyframes agentBadgePulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.15); }
    }
    @keyframes agentNodeAppear {
      from { opacity: 0; transform: scale(0.85); }
      to   { opacity: 1; transform: scale(1); }
    }
    @keyframes agentRunningPulse {
      0%   { box-shadow: 0 0 0 0 var(--led-color, #28c840), 0 2px 16px rgba(0,0,0,0.5); }
      40%  { box-shadow: 0 0 0 8px transparent, 0 2px 16px rgba(0,0,0,0.5); }
      100% { box-shadow: 0 0 0 0 transparent, 0 2px 16px rgba(0,0,0,0.5); }
    }
    @keyframes agentLeaderCrown {
      0%, 100% { opacity: 0.8; transform: translateY(0); }
      50%       { opacity: 1;   transform: translateY(-2px); }
    }
  `;
  document.head.appendChild(sheet);
}

/**
 * Convert a roleId like "engineering/engineering-software-architect" into
 * a readable label like "Software Architect". Strips the category prefix
 * and the repeated category slug from the role name portion.
 */
function humanizeRoleId(roleId: string): string {
  // Take the last segment after "/"
  const slug = roleId.includes("/") ? roleId.split("/").pop()! : roleId;
  // Strip category prefix (e.g. "engineering-" from "engineering-software-architect")
  const category = roleId.split("/")[0] ?? "";
  const stripped = slug.startsWith(category + "-") ? slug.slice(category.length + 1) : slug;
  // Convert kebab-case to Title Case
  return stripped
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Derive a stable gradient from a hex color — like iOS app icon background */
function colorToGradient(hex: string): string {
  // Parse hex, lighten for top-left, darken for bottom-right
  const r = parseInt(hex.slice(1, 3), 16) || 80;
  const g = parseInt(hex.slice(3, 5), 16) || 100;
  const b = parseInt(hex.slice(5, 7), 16) || 180;
  const lighten = (v: number, amt: number) => Math.min(255, v + amt);
  const darken  = (v: number, amt: number) => Math.max(0,   v - amt);
  const tl = `rgb(${lighten(r,40)},${lighten(g,30)},${lighten(b,20)})`;
  const br = `rgb(${darken(r,30)},${darken(g,20)},${darken(b,15)})`;
  return `linear-gradient(135deg, ${tl} 0%, ${hex} 50%, ${br} 100%)`;
}


// ── Shared styles ─────────────────────────────────────────────────────────

const handleStyle: CSSProperties = {
  width: 8,
  height: 8,
  background: "var(--color-border-subtle)",
  border: "2px solid var(--color-bg-primary)",
};

const nameStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--color-text-primary)",
  fontFamily: "var(--font-system)",
  textAlign: "center",
  maxWidth: 112,
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
  maxWidth: 112,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const badgeBase: CSSProperties = {
  position: "absolute",
  bottom: -6,
  right: -6,
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
  zIndex: 4,
};

type Lod = "full" | "compact" | "dot";

// ── Sizing per LOD ────────────────────────────────────────────────────────

const SIZES = {
  full:    { avatar: 84, radius: 22, emoji: 38 },
  compact: { avatar: 52, radius: 15, emoji: 24 },
  dot:     { avatar: 22, radius: 11, emoji: 0  },
} as const;

// ── Component ─────────────────────────────────────────────────────────────

function AgentNodeInner({ data, selected }: NodeProps) {
  const {
    name,
    roleId,
    avatarEmoji,
    uiColor,
    status,
    inProgressTaskCount,
    teamName,
    isInTeamGroup,
    isLeader,
  } = data as unknown as AgentNodeData;

  useEffect(() => { injectStyles(); }, []);

  const zoom = useStore((s) => s.transform[2]);
  const lod: Lod = zoom >= 0.6 ? "full" : zoom >= 0.3 ? "compact" : "dot";

  const color = uiColor || "var(--color-accent-primary)";
  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.offline;
  const taskCount = inProgressTaskCount ?? 0;
  const isPulsing = taskCount > 3;
  const isRunning = status === "running";

  const sz = SIZES[lod];

  const avatarStyle: CSSProperties = {
    position: "relative",
    flexShrink: 0,
    width: sz.avatar,
    height: sz.avatar,
    borderRadius: sz.radius,
    overflow: "visible",
    // Thicker, brighter border for leader; pulsing border for running
    border: isRunning
      ? `2.5px solid ${statusColor}`
      : isLeader
        ? `2.5px solid ${color}dd`
        : `2px solid ${color}88`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: sz.emoji,
    lineHeight: 1,
    background: colorToGradient(color.startsWith("#") ? color : "#5060b8"),
    transition: "box-shadow 200ms ease, transform 200ms ease, border-color 200ms ease",
    boxShadow: selected
      ? `0 0 22px ${color}bb, 0 0 10px ${color}77, 0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.15)`
      : isRunning
        ? `0 2px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)`
        : isLeader
          ? `0 0 14px ${color}44, 0 2px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)`
          : `0 2px 12px rgba(0,0,0,0.45), 0 0 6px ${color}22, inset 0 1px 0 rgba(255,255,255,0.10)`,
    transform: selected ? "scale(1.07)" : isLeader && !isRunning ? "scale(1.04)" : undefined,
    // Ripple pulse when running — visible "working" indicator
    animation: isRunning
      ? `agentRunningPulse 1.4s ease-out infinite`
      : undefined,
    "--led-color": statusColor,
  } as CSSProperties;

  // Shared inner highlight (glass shine on top edge)
  const shineOverlay: CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "45%",
    borderRadius: `${sz.radius}px ${sz.radius}px 0 0`,
    background: "linear-gradient(180deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 100%)",
    pointerEvents: "none",
    zIndex: 2,
  };

  // ── Dot LOD ─────────────────────────────────────────────────────────────
  if (lod === "dot") {
    return (
      <>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab" }}>
          <div style={{
            ...avatarStyle,
            opacity: status === "offline" ? 0.5 : 1,
            animation: `agentNodeAppear 220ms ease-out, ${avatarStyle.animation ?? ""}`.trim().replace(/,$/, ""),
          }}>
            <div style={shineOverlay} />
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </>
    );
  }

  // ── Compact LOD ─────────────────────────────────────────────────────────
  if (lod === "compact") {
    return (
      <>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 4, cursor: "grab" }}>
          <div style={{
            ...avatarStyle,
            opacity: status === "offline" ? 0.6 : 1,
          }}>
            <div style={shineOverlay} />
            <span style={{ userSelect: "none", zIndex: 1, position: "relative", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}>{avatarEmoji}</span>
          </div>
        </div>
        <Handle type="source" position={Position.Bottom} style={handleStyle} />
      </>
    );
  }

  // ── Full LOD ────────────────────────────────────────────────────────────
  return (
    <>
      <Handle type="target" position={Position.Top} style={handleStyle} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          padding: 12,
          minWidth: 104,
          cursor: "grab",
        }}
      >
        {/* Avatar wrapper — fixed px so SVG overlay always aligns perfectly */}
        <div style={{ position: "relative", width: sz.avatar, height: sz.avatar, flexShrink: 0 }}>
          {/* Outer ripple ring — behind everything */}
          {isRunning && (
            <span style={{
              position: "absolute",
              top: -6, left: -6, right: -6, bottom: -6,
              borderRadius: sz.radius + 4,
              border: `2px solid ${statusColor}44`,
              animation: "agentRunningPulse 1.4s ease-out infinite 0.35s",
              pointerEvents: "none",
              zIndex: 0,
            }} />
          )}

          {/* Avatar card — exact px size matching wrapper */}
          <div style={{
            ...avatarStyle,
            position: "absolute",
            top: 0, left: 0,
            width: sz.avatar,
            height: sz.avatar,
            opacity: status === "offline" ? 0.6 : 1,
          }}>
            <div style={shineOverlay} />
            <span style={{ userSelect: "none", zIndex: 1, position: "relative", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}>{avatarEmoji}</span>

            {/* Task badge */}
            {taskCount > 0 && (
              <span style={{
                ...badgeBase,
                background: isPulsing ? "var(--color-accent-error)" : color,
                animation: isPulsing ? "agentBadgePulse 1.2s ease-in-out infinite" : undefined,
              }}>
                {taskCount}
              </span>
            )}
          </div>

        </div>

        {/* Labels */}
        <div style={{ display: "flex", alignItems: "center", gap: 4, justifyContent: "center" }}>
          {isLeader && (
            <span style={{ fontSize: 11, animation: "agentLeaderCrown 2s ease-in-out infinite", lineHeight: 1 }} title="Squad Leader">👑</span>
          )}
          <span style={nameStyle}>{name}</span>
        </div>
        <span style={roleStyle} title={roleId}>
          {humanizeRoleId(roleId)}
        </span>
        {teamName && !isInTeamGroup && (
          <span
            style={{
              fontSize: 9,
              fontWeight: 600,
              fontFamily: "var(--font-system)",
              color: "var(--color-accent-primary)",
              background: "rgba(59, 130, 246, 0.12)",
              padding: "1px 6px",
              borderRadius: 8,
              textAlign: "center",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: -4,
            }}
          >
            {teamName}
          </span>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} style={handleStyle} />
    </>
  );
}

/**
 * Custom comparator: only re-render when the data fields we display change.
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
    p.inProgressTaskCount === n.inProgressTaskCount &&
    p.teamName === n.teamName &&
    p.isInTeamGroup === n.isInTeamGroup &&
    p.isLeader === n.isLeader
  );
}

export const AgentNode = memo(AgentNodeInner, arePropsEqual);
