import React, { useState, useCallback, type CSSProperties } from "react";
import { useTeamChat, type TeamMember, type AgentLiveStatus } from "../../../hooks/useTeamChat";
import { useTeams } from "../../../hooks/useTeams";
import { MessageList } from "../../../components/MessageList";
import { ChatInput } from "../../../components/ChatInput";

// ── Styles ─────────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  width: "100%",
  background: "rgba(6, 8, 18, 0.97)",
  fontFamily: "var(--font-system, -apple-system, BlinkMacSystemFont, sans-serif)",
  color: "rgba(255, 255, 255, 0.85)",
  fontSize: 13,
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "10px 16px",
  borderBottom: "1px solid rgba(255, 255, 255, 0.07)",
  gap: 10,
  flexShrink: 0,
};

const membersRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  flex: 1,
  overflow: "hidden",
};

// ── Team Selector ──────────────────────────────────────────────────────────

function TeamSelector({
  onSelect,
}: {
  onSelect: (teamId: string) => void;
}): React.ReactElement {
  const { teams, loading, error } = useTeams();

  // Auto-select if only one team
  React.useEffect(() => {
    if (!loading && !error && teams.length === 1) {
      onSelect(teams[0].id);
    }
  }, [teams, loading, error, onSelect]);

  if (loading) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <span style={{ opacity: 0.5 }}>Loading teams...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#ff5f5f" }}>Failed to load teams: {error}</span>
      </div>
    );
  }

  if (teams.length === 0) {
    return (
      <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
        <span style={{ opacity: 0.5 }}>No teams found</span>
      </div>
    );
  }

  return (
    <div style={{ ...containerStyle, alignItems: "center", justifyContent: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 24, marginBottom: 8 }}>💬</div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Select a Team</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {teams.map((t) => (
            <button
              key={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 10,
                padding: "12px 24px",
                color: "rgba(255, 255, 255, 0.85)",
                fontSize: 14,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.15s",
              }}
              onMouseEnter={(e) => {
                (e.target as HTMLElement).style.background =
                  "rgba(255, 255, 255, 0.1)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background =
                  "rgba(255, 255, 255, 0.05)";
              }}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Member Status Dot ──────────────────────────────────────────────────────

function MemberDot({
  member,
  status,
}: {
  member: TeamMember;
  status: AgentLiveStatus;
}): React.ReactElement {
  const isRunning = status === "running";
  const dotColor =
    isRunning
      ? "#22c55e"
      : status === "error"
      ? "#ef4444"
      : "rgba(255,255,255,0.2)";

  return (
    <span
      title={`${member.name} — ${status}`}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "default",
      }}
    >
      <span
        style={{
          fontSize: 16,
          filter: "drop-shadow(0 0 2px rgba(0,0,0,0.5))",
          opacity: status === "idle" ? 1 : status === "running" ? 1 : 0.5,
        }}
      >
        {member.emoji}
      </span>
      <span
        style={{
          position: "absolute",
          bottom: -1,
          right: -1,
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          border: "1px solid rgba(0,0,0,0.6)",
          animation: isRunning ? "teamAgentPulse 1s ease-in-out infinite" : "none",
        }}
      />
    </span>
  );
}

// ── Chat View ──────────────────────────────────────────────────────────────

function ChatView({ teamId }: { teamId: string }): React.ReactElement {
  const {
    messages,
    teamName,
    members,
    isConnected,
    sendMessage,
    squadLeaderId,
    agentStatuses,
    status,
    pendingToolLines,
  } = useTeamChat(teamId);

  return (
    <div style={containerStyle}>
      {/* Header — same pattern as WindowNode/ArchitectWindow */}
      <div style={headerStyle}>
        <div style={membersRowStyle}>
          <span
            style={{
              fontWeight: 600,
              fontSize: 13,
              marginRight: 8,
              whiteSpace: "nowrap",
            }}
          >
            {teamName}
          </span>
          {members.map((m) => (
            <MemberDot
              key={m.id}
              member={m}
              status={agentStatuses[m.id] ?? "unknown"}
            />
          ))}
        </div>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            fontSize: 11,
            opacity: 0.6,
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: isConnected ? "#22c55e" : "#ef4444",
              display: "inline-block",
            }}
          />
          {isConnected ? "Connected" : "Disconnected"}
        </span>
      </div>

      {/* Messages — reuse shared MessageList (same as ArchitectWindow) */}
      <MessageList
        messages={messages}
        status={status}
        pendingToolLines={pendingToolLines}
        accentColor="#6366f1"
      />

      {/* Input — reuse shared ChatInput */}
      <ChatInput
        status={status}
        placeholder={
          squadLeaderId
            ? "Send task to Squad Leader..."
            : "No squad leader found"
        }
        onSend={sendMessage}
        accentColor="#6366f1"
      />

      <style>{`
        @keyframes teamAgentPulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.4); }
        }
      `}</style>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────────────────────

export function TeamChatApp(): React.ReactElement {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const handleSelect = useCallback((teamId: string) => {
    setSelectedTeamId(teamId);
  }, []);

  if (!selectedTeamId) {
    return <TeamSelector onSelect={handleSelect} />;
  }

  return <ChatView teamId={selectedTeamId} />;
}
