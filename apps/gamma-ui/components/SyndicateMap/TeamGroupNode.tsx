/**
 * TeamGroupNode — Custom React Flow node for team group containers.
 *
 * Renders a semi-transparent container/capsule that visually groups
 * agents belonging to the same team. Child agent nodes render inside
 * via React Flow's parentId mechanism.
 *
 * Same style approach as AgentClusterNode: inline CSSProperties, memo.
 */

import { memo, useCallback, type CSSProperties } from "react";
import type { NodeProps } from "@xyflow/react";

// ── Data contract ─────────────────────────────────────────────────────────

export interface TeamGroupNodeData extends Record<string, unknown> {
  teamName: string;
  teamId: string;
  memberCount: number;
  uiColor: string;
  /** Called when the user clicks the 💬 chat button */
  onOpenChat?: (teamId: string, teamName: string, uiColor: string) => void;
  /** Called when the user clicks the ➕ add agent button */
  onAddAgent?: (teamId: string, teamName: string) => void;
}

// ── Styles ────────────────────────────────────────────────────────────────

const labelPill: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  fontSize: 10,
  fontWeight: 600,
  fontFamily: "var(--font-system)",
  padding: "2px 8px",
  borderRadius: 8,
  whiteSpace: "nowrap",
  userSelect: "none",
  position: "absolute",
  top: 10,
  left: 12,
  zIndex: 1,
};

const countBadge: CSSProperties = {
  fontSize: 9,
  fontWeight: 500,
  opacity: 0.7,
};

// ── Component ─────────────────────────────────────────────────────────────

const chatBtnStyle: CSSProperties = {
  position: "absolute",
  top: 7,
  right: 12,
  zIndex: 1,
  background: "rgba(255, 255, 255, 0.06)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 6,
  padding: "2px 6px",
  cursor: "pointer",
  fontSize: 12,
  lineHeight: 1,
  userSelect: "none",
};

function TeamGroupNodeInner({ data }: NodeProps) {
  const { teamName, teamId, memberCount, uiColor, onOpenChat, onAddAgent } = data as unknown as TeamGroupNodeData;
  const color = uiColor || "#6366f1";

  const openChat = useCallback(() => {
    if (onOpenChat) {
      onOpenChat(teamId, teamName, color);
    }
  }, [onOpenChat, teamId, teamName, color]);

  const addAgent = useCallback(() => {
    if (onAddAgent) {
      onAddAgent(teamId, teamName);
    }
  }, [onAddAgent, teamId, teamName]);

  const containerStyle: CSSProperties = {
    width: "100%",
    height: "100%",
    position: "relative",
    background: `rgba(${hexToRgb(color)}, 0.06)`,
    border: `1.5px dashed rgba(${hexToRgb(color)}, 0.3)`,
    borderRadius: 16,
    pointerEvents: "all",
  };

  const pillStyle: CSSProperties = {
    ...labelPill,
    color,
    background: `rgba(${hexToRgb(color)}, 0.12)`,
  };

  return (
    <div style={containerStyle}>
      <span style={pillStyle}>
        {teamName}
        <span style={countBadge}>{memberCount}</span>
      </span>
      {onAddAgent && (
        <button
          style={{ ...chatBtnStyle, right: 42 }}
          onClick={addAgent}
          title={`Add agent to ${teamName}`}
        >
          ➕
        </button>
      )}
      <button
        style={chatBtnStyle}
        onClick={openChat}
        title={`Open chat for ${teamName}`}
      >
        💬
      </button>
    </div>
  );
}

// ── Hex to RGB helper ─────────────────────────────────────────────────────

function hexToRgb(hex: string): string {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "99, 102, 241"; // fallback indigo
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return "99, 102, 241";
  return `${r}, ${g}, ${b}`;
}

// ── Memo comparator ───────────────────────────────────────────────────────

function arePropsEqual(prev: NodeProps, next: NodeProps): boolean {
  const p = prev.data as unknown as TeamGroupNodeData;
  const n = next.data as unknown as TeamGroupNodeData;
  return (
    p.teamName === n.teamName &&
    p.teamId === n.teamId &&
    p.memberCount === n.memberCount &&
    p.uiColor === n.uiColor &&
    p.onOpenChat === n.onOpenChat &&
    p.onAddAgent === n.onAddAgent
  );
}

export const TeamGroupNode = memo(TeamGroupNodeInner, arePropsEqual);
