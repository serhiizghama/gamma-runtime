import React, { useState, useRef, useEffect, useCallback, type CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTeamChat, type TeamMessage } from "../../../hooks/useTeamChat";
import { useTeams } from "../../../hooks/useTeams";

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

const messageAreaStyle: CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minHeight: 0,
};

const inputBarStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "10px 16px",
  borderTop: "1px solid rgba(255, 255, 255, 0.07)",
  flexShrink: 0,
};

const inputStyle: CSSProperties = {
  flex: 1,
  background: "rgba(255, 255, 255, 0.05)",
  border: "1px solid rgba(255, 255, 255, 0.1)",
  borderRadius: 8,
  padding: "8px 12px",
  color: "rgba(255, 255, 255, 0.9)",
  fontSize: 13,
  fontFamily: "inherit",
  outline: "none",
};

const sendBtnStyle: CSSProperties = {
  background: "rgba(96, 165, 250, 0.2)",
  border: "1px solid rgba(96, 165, 250, 0.3)",
  borderRadius: 8,
  padding: "8px 16px",
  color: "rgba(96, 165, 250, 0.9)",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
};

// ── Team Selector ──────────────────────────────────────────────────────────

function TeamSelector({ onSelect }: { onSelect: (teamId: string) => void }): React.ReactElement {
  const { teams, loading, error } = useTeams();

  // Auto-select if only one team (must be in useEffect, not during render)
  useEffect(() => {
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
                (e.target as HTMLElement).style.background = "rgba(255, 255, 255, 0.1)";
              }}
              onMouseLeave={(e) => {
                (e.target as HTMLElement).style.background = "rgba(255, 255, 255, 0.05)";
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

// ── Message Bubble ─────────────────────────────────────────────────────────

const TYPE_PREFIX: Record<TeamMessage["type"], string> = {
  delegation: "",
  completion: "✅ ",
  failure: "❌ ",
  status: "",
  user: "",
};

function MessageBubble({ msg }: { msg: TeamMessage }): React.ReactElement {
  const time = new Date(msg.timestamp);
  const timeStr = `${time.getHours().toString().padStart(2, "0")}:${time.getMinutes().toString().padStart(2, "0")}`;

  const isUser = msg.type === "user";

  if (isUser) {
    return (
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10, paddingLeft: "20%" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <div style={{
            padding: "9px 14px",
            borderRadius: "18px 18px 4px 18px",
            background: "linear-gradient(135deg, rgba(59,130,246,0.92), rgba(37,99,235,0.96))",
            color: "#fff",
            fontSize: 13,
            lineHeight: 1.55,
            wordBreak: "break-word",
            boxShadow: "0 2px 12px rgba(59,130,246,0.3)",
            fontFamily: "var(--font-system)",
          }}>
            {msg.text}
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", paddingRight: 4 }}>{timeStr}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 12, paddingRight: "8%" }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        background: `${msg.agentColor}18`,
        border: `1px solid ${msg.agentColor}40`,
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0, marginTop: 2, fontSize: 14,
      }}>
        {msg.agentEmoji}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
          <span style={{ fontWeight: 600, color: msg.agentColor, fontSize: 11 }}>{msg.agentName}</span>
          <span style={{ fontSize: 10, opacity: 0.35, fontVariantNumeric: "tabular-nums", marginLeft: "auto" }}>{timeStr}</span>
        </div>
        <div style={{
          padding: "10px 14px",
          borderRadius: "4px 18px 18px 18px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderLeft: `3px solid ${msg.agentColor}70`,
          color: "rgba(220,232,255,0.9)",
          fontSize: 13,
          lineHeight: 1.6,
          wordBreak: "break-word",
          fontFamily: "var(--font-system)",
        }}>
          <div className="team-chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {TYPE_PREFIX[msg.type] + msg.text}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Chat View ──────────────────────────────────────────────────────────────

function ChatView({ teamId }: { teamId: string }): React.ReactElement {
  const { messages, teamName, members, isConnected, sendMessage, squadLeaderId } =
    useTeamChat(teamId);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const handleSend = () => {
    if (!input.trim()) return;
    sendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div style={membersRowStyle}>
          <span style={{ fontWeight: 600, fontSize: 13, marginRight: 8, whiteSpace: "nowrap" }}>
            {teamName}
          </span>
          {members.map((m) => (
            <span
              key={m.id}
              title={m.name}
              style={{
                fontSize: 16,
                cursor: "default",
                filter: "drop-shadow(0 0 2px rgba(0,0,0,0.5))",
              }}
            >
              {m.emoji}
            </span>
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

      {/* Messages */}
      <div style={messageAreaStyle} className="team-chat-messages">
        {messages.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.3,
              fontSize: 13,
            }}
          >
            No messages yet. Send a task to the squad leader to get started.
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div style={inputBarStyle}>
        <input
          style={inputStyle}
          placeholder={
            squadLeaderId
              ? "Send task to Squad Leader..."
              : "No squad leader found"
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!squadLeaderId}
          className="team-chat-input"
        />
        <button
          style={{
            ...sendBtnStyle,
            opacity: !input.trim() || !squadLeaderId ? 0.4 : 1,
            cursor: !input.trim() || !squadLeaderId ? "default" : "pointer",
          }}
          onClick={handleSend}
          disabled={!input.trim() || !squadLeaderId}
        >
          Send
        </button>
      </div>

      <style>{`
        .team-chat-messages::-webkit-scrollbar { width: 4px; }
        .team-chat-messages::-webkit-scrollbar-track { background: transparent; }
        .team-chat-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .team-chat-messages::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }
        .team-chat-input::placeholder { color: rgba(255,255,255,0.25); }
        .team-chat-input:focus { border-color: rgba(96,165,250,0.4); }

        .team-chat-markdown p { margin: 4px 0; color: inherit; }
        .team-chat-markdown ul, .team-chat-markdown ol { margin: 6px 0; padding-left: 20px; color: inherit; }
        .team-chat-markdown strong { font-weight: 600; color: inherit; }
        .team-chat-markdown em { font-style: italic; }
        .team-chat-markdown code {
          background: rgba(255,255,255,0.07); color: rgba(150,210,255,0.9);
          padding: 1px 5px; border-radius: 4px; font-size: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        .team-chat-markdown pre {
          background: rgba(0,0,0,0.35); padding: 12px 14px; border-radius: 8px;
          overflow-x: auto; font-size: 12px; border: 1px solid rgba(255,255,255,0.07);
          margin: 6px 0;
        }
        .team-chat-markdown pre code { background: none; border: none; padding: 0; color: rgba(180,220,255,0.85); }
        .team-chat-markdown a { color: rgba(96,165,250,0.9); text-decoration: underline; word-break: break-word; }
        .team-chat-markdown table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .team-chat-markdown th, .team-chat-markdown td { border: 1px solid rgba(255,255,255,0.08); padding: 4px 10px; text-align: left; }
        .team-chat-markdown th { background: rgba(255,255,255,0.04); }
        .team-chat-markdown h1, .team-chat-markdown h2, .team-chat-markdown h3 { color: rgba(220,235,255,0.95); font-weight: 600; margin: 10px 0 4px; }
        .team-chat-markdown h1 { font-size: 16px; }
        .team-chat-markdown h2 { font-size: 14px; }
        .team-chat-markdown h3 { font-size: 13px; }
        .team-chat-markdown blockquote {
          border-left: 3px solid rgba(59,130,246,0.4); margin: 6px 0; padding: 4px 12px;
          color: rgba(180,200,255,0.6); font-style: italic;
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
