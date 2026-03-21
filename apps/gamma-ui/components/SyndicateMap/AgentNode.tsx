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
      0%, 100% { box-shadow: 0 0 6px var(--led-color, #28c840)22; }
      50%      { box-shadow: 0 0 12px var(--led-color, #28c840)44, 0 0 24px var(--led-color, #28c840)22; }
    }
    @keyframes agentBadgePulse {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.15); }
    }
  `;
  document.head.appendChild(sheet);
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
  full:    { avatar: 80, radius: 20, emoji: 36 },
  compact: { avatar: 48, radius: 14, emoji: 22 },
  dot:     { avatar: 20, radius: 10, emoji: 0  },
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

  // Border color: identity color normally, blends with status glow
  const borderColor = color;

  const avatarStyle: CSSProperties = {
    position: "relative",
    width: sz.avatar,
    height: sz.avatar,
    borderRadius: sz.radius,
    border: `2px solid ${borderColor}`,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: sz.emoji,
    lineHeight: 1,
    background: "var(--color-surface-elevated)",
    transition: "box-shadow 200ms ease, transform 200ms ease",
    boxShadow: selected
      ? `0 0 20px ${color}88, 0 0 8px ${color}66, inset 0 0 4px ${color}22`
      : isRunning
        ? undefined // handled by breath animation
        : `0 0 8px ${color}33`,
    transform: selected ? "scale(1.05)" : undefined,
    animation: isRunning ? "agentBreath 2.4s ease-in-out infinite" : undefined,
    "--led-color": statusColor,
  } as CSSProperties;

  // ── Dot LOD ─────────────────────────────────────────────────────────────
  if (lod === "dot") {
    return (
      <>
        <Handle type="target" position={Position.Top} style={handleStyle} />
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", cursor: "grab" }}>
          <div style={{
            ...avatarStyle,
            opacity: status === "offline" ? 0.5 : 1,
          }}>
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
            <span style={{ userSelect: "none" }}>{avatarEmoji}</span>
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
          minWidth: 100,
          cursor: "grab",
        }}
      >
        {/* Avatar with LED diode border */}
        <div style={{
          ...avatarStyle,
          opacity: status === "offline" ? 0.6 : 1,
        }}>
          <span style={{ userSelect: "none" }}>{avatarEmoji}</span>

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
        {teamName && (
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
    p.teamName === n.teamName
  );
}

export const AgentNode = memo(AgentNodeInner, arePropsEqual);
