/**
 * TeamChatPanel — Inline chat sidebar for a team, embedded in SyndicateMap.
 *
 * Same pattern as AgentDetailPanel: absolute right-side overlay.
 * Reuses useTeamChat → useAgentStream (same stack as the standalone TeamChatApp).
 */

import React, { type CSSProperties } from "react";
import { useTeamChat } from "../../hooks/useTeamChat";
import { MessageList } from "../MessageList";
import { ChatInput } from "../ChatInput";

// ── Styles ────────────────────────────────────────────────────────────────

const panel: CSSProperties = {
  position: "absolute",
  top: 0,
  right: 0,
  width: 360,
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

const header: CSSProperties = {
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
  const { messages, members, isConnected, sendMessage, squadLeaderId, agentStatuses, status, pendingToolLines } =
    useTeamChat(teamId);

  return (
    <div style={panel}>
      {/* Header */}
      <div style={header}>
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

      {/* Messages — reuse shared MessageList */}
      <MessageList
        messages={messages}
        status={status}
        pendingToolLines={pendingToolLines}
        accentColor={teamColor}
      />

      {/* Input — reuse shared ChatInput */}
      <ChatInput
        status={status}
        placeholder={squadLeaderId ? "Send task to Squad Leader..." : "No squad leader found"}
        onSend={sendMessage}
        accentColor={teamColor}
      />
    </div>
  );
}
