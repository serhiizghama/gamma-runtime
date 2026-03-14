import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentStatus } from "@gamma/types";
import { useThrottledValue } from "../hooks/useThrottledValue";

// ── Types ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  thinking?: string;
  toolCalls?: ToolCallEntry[];
  ts: number;
}

export interface ToolCallEntry {
  name: string;
  args?: string;
  result?: string;
  isError?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
  streamingMessage?: ChatMessage | null;
  pendingToolLines: string[];
  accentColor: string;
  status: AgentStatus;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_TOOL_LEN = 64;

function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src || typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  return s.startsWith("https://") || s.startsWith("http://") || s.startsWith("data:image/");
}

function truncate(str: string, max = MAX_TOOL_LEN): string {
  return str.length <= max ? str : str.slice(0, max) + "… (truncated)";
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// ── Assistant Avatar ─────────────────────────────────────────────────────

function GammaAvatar(): React.ReactElement {
  return (
    <div
      style={{
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: "rgba(59, 130, 246, 0.12)",
        border: "1px solid rgba(59, 130, 246, 0.25)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        marginTop: 2,
      }}
    >
      <svg viewBox="0 0 20 24" width="11" height="13">
        <path
          d="M2 3 L10 13 L10 22 M18 3 L10 13"
          stroke="rgba(96,165,250,0.85)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
    </div>
  );
}

// ── Thinking Block ───────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginBottom: 8,
        padding: "6px 10px",
        background: "rgba(255,255,255,0.03)",
        borderRadius: 6,
        border: "1px solid rgba(255,255,255,0.06)",
        fontSize: 12,
      }}
    >
      <summary style={{ cursor: "pointer", userSelect: "none", fontSize: 11, color: "rgba(150,170,220,0.6)", fontFamily: "'SF Mono', monospace" }}>
        💭 Thinking
      </summary>
      <pre style={{ marginTop: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: "'SF Mono', monospace", fontSize: 11, lineHeight: 1.5, color: "rgba(150,170,220,0.7)", userSelect: "text" }}>
        {text}
      </pre>
    </details>
  );
}

// ── Safe Image ───────────────────────────────────────────────────────────

function SafeMarkdownImage({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement | null {
  if (!isAllowedImageSrc(src)) return null;
  return <img {...props} src={src} alt={alt ?? ""} className="agent-chat-markdown-img" loading="lazy" />;
}

// ── Code Block ───────────────────────────────────────────────────────────

function CodeBlockWithCopy({ children, ...preProps }: React.ComponentPropsWithoutRef<"pre">): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopy = async () => {
    const code = containerRef.current?.querySelector("code")?.textContent?.trim() ?? "";
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = code;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isBlock = React.Children.toArray(children).some(
    (c) => typeof c === "object" && c !== null && (c as React.ReactElement).type === "code"
  );

  return (
    <div className="agent-chat-code-block" ref={containerRef}>
      {isBlock && (
        <button type="button" className="agent-chat-code-copy" onClick={handleCopy} title={copied ? "Copied!" : "Copy"}>
          {copied ? "✓" : "⎘"}
        </button>
      )}
      <pre {...preProps}>{children}</pre>
    </div>
  );
}

// ── Tool Call ────────────────────────────────────────────────────────────

function ToolCallLine({ entry }: { entry: ToolCallEntry }): React.ReactElement {
  if (entry.result !== undefined) {
    return (
      <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, color: entry.isError ? "#f87171" : "rgba(100,200,150,0.8)", padding: "2px 0" }}>
        {entry.isError ? "❌" : "✅"} {entry.name} → {truncate(entry.result)}
      </div>
    );
  }
  return (
    <div style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, color: "rgba(96,165,250,0.8)", padding: "2px 0" }}>
      🔧 {entry.name}({entry.args ? truncate(entry.args) : ""})
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────

function MessageBubble({ msg, status, isStreaming }: { msg: ChatMessage; accentColor: string; status: AgentStatus; isStreaming: boolean }): React.ReactElement {
  const isUser = msg.role === "user";
  const throttledText = useThrottledValue(msg.text, 100, status);
  const displayText = isStreaming ? throttledText : msg.text;
  const [hovered, setHovered] = useState(false);

  if (isUser) {
    return (
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, paddingLeft: "20%" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3 }}>
          <div
            className="agent-chat-bubble"
            style={{
              padding: "9px 14px",
              borderRadius: "18px 18px 4px 18px",
              background: "linear-gradient(135deg, rgba(59,130,246,0.92), rgba(37,99,235,0.96))",
              color: "#fff",
              fontSize: 13,
              lineHeight: 1.55,
              wordBreak: "break-word",
              boxShadow: "0 2px 12px rgba(59,130,246,0.3)",
              fontFamily: "var(--font-system)",
            }}
          >
            {msg.text}
          </div>
          <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", transition: "opacity 0.15s", opacity: hovered ? 1 : 0, paddingRight: 4 }}>
            {formatTime(msg.ts)}
          </span>
        </div>
      </div>
    );
  }

  // Assistant
  return (
    <div
      style={{ display: "flex", gap: 10, marginBottom: 14, paddingRight: "12%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <GammaAvatar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          className="agent-chat-bubble"
          style={{
            padding: "10px 14px",
            borderRadius: "4px 18px 18px 18px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
            borderLeft: "3px solid rgba(59,130,246,0.45)",
            color: "rgba(220,232,255,0.9)",
            fontSize: 13,
            lineHeight: 1.6,
            wordBreak: "break-word",
            fontFamily: "var(--font-system)",
          }}
        >
          {msg.thinking && <ThinkingBlock text={msg.thinking} />}
          {msg.toolCalls?.map((tc, i) => <ToolCallLine key={i} entry={tc} />)}
          <div className="agent-chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy, img: SafeMarkdownImage }}>
              {displayText}
            </ReactMarkdown>
          </div>
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", paddingLeft: 4, transition: "opacity 0.15s", opacity: hovered ? 1 : 0 }}>
          Gamma · {formatTime(msg.ts)}
        </span>
      </div>
    </div>
  );
}

// ── Typing Indicator ─────────────────────────────────────────────────────

const STATUS_LABELS = ["Thinking", "Working", "Processing"];
let _labelIdx = 0;

function TypingIndicator({ toolLines }: { toolLines?: string[] }): React.ReactElement {
  const [label] = React.useState(() => STATUS_LABELS[_labelIdx++ % STATUS_LABELS.length]);

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14, paddingRight: "12%" }}>
      <GammaAvatar />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "10px 14px",
          borderRadius: "4px 18px 18px 18px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderLeft: "3px solid rgba(59,130,246,0.45)",
          minWidth: 120,
        }}
      >
        {/* Animated status row */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {/* Label */}
          <span style={{ fontSize: 12, color: "rgba(150,180,255,0.6)", fontFamily: "var(--font-system)", letterSpacing: 0.2 }}>
            {label}
          </span>
          {/* Wave dots after the word */}
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: "rgba(96,165,250,0.75)",
                  display: "inline-block",
                  animation: `waveDot 1.1s ease-in-out ${i * 0.18}s infinite`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Live tool lines if any */}
        {toolLines && toolLines.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: 6, display: "flex", flexDirection: "column", gap: 2 }}>
            {toolLines.slice(-3).map((line, i) => (
              <div key={i} style={{ fontFamily: "'SF Mono', monospace", fontSize: 10, color: "rgba(96,165,250,0.7)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {line}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MessageList ──────────────────────────────────────────────────────────

export function MessageList({ messages, streamingMessage, pendingToolLines, accentColor, status }: MessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingMessage, pendingToolLines]);

  // Show typing indicator only while running and before any streaming content arrives
  const showTypingIndicator = status === "running" && !streamingMessage;

  return (
    <div
      className="agent-chat-message-list"
      style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 14px 8px", display: "flex", flexDirection: "column" }}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} accentColor={accentColor} status={status} isStreaming={false} />
      ))}

      {/* Live streaming message — visible in real-time as the agent types */}
      {streamingMessage && (
        <MessageBubble
          key={streamingMessage.id}
          msg={streamingMessage}
          accentColor={accentColor}
          status={status}
          isStreaming={true}
        />
      )}

      {/* Typing indicator: shown while running before streaming content arrives */}
      {showTypingIndicator && (
        <TypingIndicator
          toolLines={pendingToolLines.length > 0 ? pendingToolLines : undefined}
        />
      )}

      <div ref={bottomRef} />

      <style>{`
        @keyframes typingDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
      `}</style>
    </div>
  );
}
