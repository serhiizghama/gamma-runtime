import { useState, useCallback } from "react";
import type { AgentStatus } from "@gamma/types";

interface ChatInputProps {
  status: AgentStatus;
  accentColor?: string; // reserved for future theming; uses theme vars when absent
  placeholder?: string;
  onSend: (text: string) => void;
}

export function ChatInput({
  status,
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
        background: "var(--color-bg-primary)",
        borderTop: "1px solid var(--color-border-subtle)",
      }}
    >
      <input
        type="text"
        className="agent-chat-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={status === "running"}
        style={{
          flex: 1,
          background: "var(--color-bg-secondary)",
          border: "1px solid var(--color-border-subtle)",
          borderRadius: 6,
          padding: "8px 12px",
          color: "var(--color-text-primary)",
          fontFamily: "var(--font-system)",
          fontSize: 13,
          outline: "none",
          transition: "border-color 200ms ease-out",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--color-accent-primary)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--color-border-subtle)";
        }}
      />
      <button
        onClick={handleSend}
        disabled={disabled}
        style={{
          background: disabled ? "var(--color-bg-secondary)" : "var(--color-accent-primary)",
          color: disabled ? "var(--color-text-secondary)" : "#ffffff",
          border: "none",
          borderRadius: 6,
          padding: "8px 16px",
          fontFamily: "var(--font-system)",
          fontSize: 13,
          fontWeight: 600,
          cursor: disabled ? "not-allowed" : "pointer",
          transition: "background 200ms ease-out, color 200ms ease-out",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        Send
      </button>
    </div>
  );
}
