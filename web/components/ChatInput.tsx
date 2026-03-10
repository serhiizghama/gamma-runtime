import { useState, useCallback } from "react";
import type { AgentStatus } from "@gamma/types";

interface ChatInputProps {
  status: AgentStatus;
  accentColor: string;
  placeholder?: string;
  onSend: (text: string) => void;
}

export function ChatInput({
  status,
  accentColor,
  placeholder = "Type a message…",
  onSend,
}: ChatInputProps): React.ReactElement {
  const [text, setText] = useState("");
  const disabled = status === "running" || text.trim().length === 0;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length === 0 || status === "running") return;
    onSend(trimmed);
    setText("");
  }, [text, status, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 14px",
        borderTop: `1px solid ${accentColor}22`,
      }}
    >
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={status === "running"}
        style={{
          flex: 1,
          background: "#111",
          border: `1px solid ${accentColor}33`,
          borderRadius: 6,
          padding: "8px 12px",
          color: "#e0e0e0",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 13,
          outline: "none",
          transition: "border-color 0.2s",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = `${accentColor}88`;
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = `${accentColor}33`;
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        style={{
          background: disabled ? "#333" : accentColor,
          color: disabled ? "#666" : "#0a0a0a",
          border: "none",
          borderRadius: 6,
          padding: "8px 16px",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 0.2s, color 0.2s",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Send
      </button>
    </div>
  );
}
