/**
 * TeamChatPanel — Inline chat sidebar for a team, embedded in SyndicateMap.
 *
 * - Resizable via drag handle on the left edge
 * - Width persisted in localStorage (key: team-chat-panel-width)
 * - Same pattern as AgentDetailPanel: absolute right-side overlay
 * - Reuses useTeamChat → useAgentStream
 */

import React, { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTeamChat } from "../../hooks/useTeamChat";
import { MessageList } from "../MessageList";
import { ChatInput } from "../ChatInput";

// ── Constants ─────────────────────────────────────────────────────────────

const STORAGE_KEY = "team-chat-panel-width";
const MIN_WIDTH = 280;
const MAX_WIDTH = 680;
const DEFAULT_WIDTH = 360;

function loadWidth(): number {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (!isNaN(n) && n >= MIN_WIDTH && n <= MAX_WIDTH) return n;
    }
  } catch { /* ignore */ }
  return DEFAULT_WIDTH;
}

function saveWidth(w: number) {
  try { localStorage.setItem(STORAGE_KEY, String(w)); } catch { /* ignore */ }
}

// ── Styles ────────────────────────────────────────────────────────────────

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.07)",
  flexShrink: 0,
  gap: 8,
};

const closeBtnStyle: CSSProperties = {
  background: "transparent",
  border: "none",
  color: "rgba(255,255,255,0.4)",
  fontSize: 16,
  cursor: "pointer",
  padding: "2px 6px",
  borderRadius: 4,
  lineHeight: 1,
  flexShrink: 0,
};

const resizeHandleStyle: CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  width: 5,
  height: "100%",
  cursor: "ew-resize",
  zIndex: 20,
  background: "transparent",
  transition: "background 150ms ease",
};

// ── Component ─────────────────────────────────────────────────────────────

interface Props {
  teamId: string;
  teamName: string;
  teamColor: string;
  onClose: () => void;
}

export function TeamChatPanel({
  teamId,
  teamName,
  teamColor,
  onClose,
}: Props): React.ReactElement {
  const [width, setWidth] = useState<number>(loadWidth);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  const { messages, members, isConnected, sendMessage, squadLeaderId, agentStatuses, status, pendingToolLines } =
    useTeamChat(teamId);

  // ── Resize drag logic ──────────────────────────────────────────────────

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = width;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
  }, [width]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const delta = startXRef.current - e.clientX; // dragging left = wider
      const newW = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWRef.current + delta));
      setWidth(newW);
    };
    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setWidth((w) => { saveWidth(w); return w; });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────

  const panelStyle: CSSProperties = {
    position: "absolute",
    top: 0,
    right: 0,
    width,
    height: "100%",
    background: "var(--color-bg-secondary, #0d1117)",
    borderLeft: "1px solid var(--color-border-subtle, rgba(255,255,255,0.08))",
    boxShadow: "-4px 0 24px rgba(0,0,0,0.5)",
    display: "flex",
    flexDirection: "column",
    zIndex: 10,
    fontFamily: "var(--font-system)",
    overflow: "hidden",
  };

  return (
    <div style={panelStyle}>
      {/* Drag-to-resize handle on left edge */}
      <div
        style={resizeHandleStyle}
        onMouseDown={onMouseDown}
        onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,0.08)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
        title="Drag to resize"
      />

      {/* Header */}
      <div style={headerStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {teamName}
          </span>
          {/* Member avatars */}
          <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
            {members.slice(0, 6).map((m) => {
              const s = agentStatuses[m.id] ?? "unknown";
              const dotColor = s === "running" ? "#22c55e" : s === "error" ? "#ef4444" : "rgba(255,255,255,0.2)";
              return (
                <span key={m.id} title={`${m.name} — ${s}`} style={{ position: "relative", fontSize: 15 }}>
                  {m.emoji}
                  <span style={{
                    position: "absolute",
                    bottom: -1,
                    right: -1,
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: dotColor,
                    border: "1px solid rgba(0,0,0,0.6)",
                  }} />
                </span>
              );
            })}
          </div>
        </div>

        {/* Connection status */}
        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, opacity: 0.55, whiteSpace: "nowrap" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: isConnected ? "#22c55e" : "#ef4444", display: "inline-block" }} />
          {isConnected ? "Live" : "Offline"}
        </span>

        {/* Close */}
        <button style={closeBtnStyle} onClick={onClose} title="Close chat">✕</button>
      </div>

      {/* Messages */}
      <MessageList
        messages={messages}
        status={status}
        pendingToolLines={pendingToolLines}
        accentColor={teamColor}
      />

      {/* Input */}
      <ChatInput
        status={status}
        placeholder={squadLeaderId ? "Send task to Squad Leader..." : "No squad leader found"}
        onSend={sendMessage}
        accentColor={teamColor}
      />
    </div>
  );
}
