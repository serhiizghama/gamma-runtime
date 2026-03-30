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
    @keyframes agentLedChase {
      0%   { stroke-dashoffset: 0; }
      100% { stroke-dashoffset: -200; }
    }
    @keyframes agentLedGlow {
      0%, 100% { filter: drop-shadow(0 0 2px var(--led-color, #28c840)); }
      50%      { filter: drop-shadow(0 0 6px var(--led-color, #28c840)) drop-shadow(0 0 12px var(--led-color, #28c840)); }
    }
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
  `;
  document.head.appendChild(sheet);
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

// ── LED border overlay (SVG rounded rect with dashed stroke) ──────────────

function LedBorder({
  size,
  radius,
  color,
  active,
}: {
  size: number;
  radius: number;
  color: string;
  active: boolean;
}) {
  // Inset the rect by half the stroke width so it aligns with the CSS border
  const sw = active ? 2.5 : 0;
  if (!active) return null;

  const inset = sw / 2 + 1; // +1 to sit just outside the CSS border
  const rw = size - inset * 2;
  const rh = size - inset * 2;
  const r = Math.max(0, radius - inset / 2);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 3,
        animation: "agentLedGlow 2.4s ease-in-out infinite",
        "--led-color": color,
      } as CSSProperties}
    >
      <rect
        x={inset}
        y={inset}
        width={rw}
        height={rh}
        rx={r}
        ry={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray="6 14"
        style={{
          animation: "agentLedChase 3s linear infinite",
        }}
      />
    </svg>
  );
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
    width: sz.avatar,
    height: sz.avatar,
    borderRadius: sz.radius,
    border: `2px solid ${color}99`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: sz.emoji,
    lineHeight: 1,
    // iOS-style gradient background derived from agent identity color
    background: colorToGradient(color.startsWith("#") ? color : "#5060b8"),
    transition: "box-shadow 200ms ease, transform 200ms ease, border-color 200ms ease",
    boxShadow: selected
      ? `0 0 22px ${color}aa, 0 0 10px ${color}66, 0 4px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.15)`
      : isRunning
        ? `0 2px 16px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.12)`
        : `0 2px 12px rgba(0,0,0,0.45), 0 0 6px ${color}22, inset 0 1px 0 rgba(255,255,255,0.10)`,
    transform: selected ? "scale(1.07)" : undefined,
    animation: isRunning ? "agentBreath 2.4s ease-in-out infinite" : undefined,
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
            <LedBorder size={sz.avatar} radius={sz.radius} color={statusColor} active={isRunning} />
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
            <LedBorder size={sz.avatar} radius={sz.radius} color={statusColor} active={isRunning} />
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
        {/* Avatar — iOS-style app icon */}
        <div style={{
          ...avatarStyle,
          opacity: status === "offline" ? 0.6 : 1,
        }}>
          {/* Glass shine */}
          <div style={shineOverlay} />

          <span style={{ userSelect: "none", zIndex: 1, position: "relative", filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}>{avatarEmoji}</span>

          {/* LED chase overlay */}
          <LedBorder size={sz.avatar} radius={sz.radius} color={statusColor} active={isRunning} />

          {/* Task badge */}
          {taskCount > 0 && (
            <span
              style={{
                ...badgeBase,
                background: isPulsing ? "var(--color-accent-error)" : color,
                animation: isPulsing ? "agentBadgePulse 1.2s ease-in-out infinite" : undefined,
              }}
            >
              {taskCount}
            </span>
          )}
        </div>

        {/* Labels */}
        <span style={nameStyle}>{name}</span>
        <span style={roleStyle}>{roleId}</span>
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
    p.isInTeamGroup === n.isInTeamGroup
  );
}

export const AgentNode = memo(AgentNodeInner, arePropsEqual);
