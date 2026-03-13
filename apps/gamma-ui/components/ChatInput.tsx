import { useState, useCallback, useRef } from "react";
import type { AgentStatus } from "@gamma/types";

interface ChatInputProps {
  status: AgentStatus;
  accentColor?: string;
  placeholder?: string;
  onSend: (text: string) => void;
}

export function ChatInput({ status, placeholder = "Message Gamma…", onSend }: ChatInputProps): React.ReactElement {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const running = status === "running";
  const canSend = text.trim().length > 0 && !running;

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || running) return;
    onSend(trimmed);
    setText("");
    inputRef.current?.focus();
  }, [text, running, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <div
      style={{
        padding: "10px 12px 12px",
        background: "rgba(6, 8, 16, 0.8)",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {/* Input row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          background: "rgba(255,255,255,0.05)",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 12,
          padding: "6px 6px 6px 14px",
          transition: "border-color 0.2s, box-shadow 0.2s",
        }}
        onFocusCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(59,130,246,0.5)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "0 0 0 3px rgba(59,130,246,0.08)";
        }}
        onBlurCapture={(e) => {
          (e.currentTarget as HTMLDivElement).style.borderColor = "rgba(255,255,255,0.09)";
          (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
        }}
      >
        <input
          ref={inputRef}
          type="text"
          className="agent-chat-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={running}
          autoComplete="off"
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "rgba(220,232,255,0.9)",
            fontFamily: "var(--font-system)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        />

        {/* Send button — icon only */}
        <button
          onClick={handleSend}
          disabled={!canSend}
          title="Send (Enter)"
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            border: "none",
            cursor: canSend ? "pointer" : "not-allowed",
            background: canSend
              ? "linear-gradient(135deg, rgba(59,130,246,0.9), rgba(37,99,235,0.95))"
              : "rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            transition: "background 0.2s, transform 0.1s",
            boxShadow: canSend ? "0 2px 8px rgba(59,130,246,0.35)" : "none",
          }}
          onMouseDown={(e) => { if (canSend) (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.92)"; }}
          onMouseUp={(e) => { (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)"; }}
        >
          {running ? (
            /* Spinner */
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <circle cx="7" cy="7" r="5" stroke="rgba(96,165,250,0.4)" strokeWidth="2" />
              <path d="M7 2 A5 5 0 0 1 12 7" stroke="rgba(96,165,250,0.9)" strokeWidth="2" strokeLinecap="round">
                <animateTransform attributeName="transform" type="rotate" from="0 7 7" to="360 7 7" dur="0.7s" repeatCount="indefinite" />
              </path>
            </svg>
          ) : (
            /* Arrow up */
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M7 11.5 L7 2.5 M3 6 L7 2.5 L11 6"
                stroke={canSend ? "#fff" : "rgba(255,255,255,0.25)"}
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>
      </div>

      {/* Hint */}
      <div style={{ textAlign: "center", marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.15)", letterSpacing: 0.2 }}>
        Enter to send · Gamma Agent Runtime
      </div>
    </div>
  );
}
