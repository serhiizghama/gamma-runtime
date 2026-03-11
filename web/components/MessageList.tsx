import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  pendingToolLines: string[];
  accentColor: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_TOOL_LEN = 64;

/** Allow only safe image URLs: https, http, or data:image/* to prevent XSS. */
function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src || typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  if (s.startsWith("https://") || s.startsWith("http://")) return true;
  if (s.startsWith("data:image/")) return true;
  return false;
}

function truncate(str: string, max = MAX_TOOL_LEN): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + "… (truncated)";
}

// ── Thinking Block ───────────────────────────────────────────────────────

function ThinkingBlock({ text }: { text: string }): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      style={{
        marginBottom: 6,
        padding: "6px 10px",
        background: "var(--color-bg-primary)",
        borderRadius: 6,
        border: "1px solid var(--color-border-subtle)",
        fontSize: 12,
        color: "var(--color-text-secondary)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          color: "var(--color-text-secondary)",
        }}
      >
        💭 Thinking
      </summary>
      <pre
        style={{
          marginTop: 6,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          lineHeight: 1.5,
          color: "var(--color-text-secondary)",
          userSelect: "text",
        }}
      >
        {text}
      </pre>
    </details>
  );
}

// ── Secure Markdown Image ──────────────────────────────────────────

function SafeMarkdownImage({
  src,
  alt,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>): React.ReactElement | null {
  if (!isAllowedImageSrc(src)) return null;
  return (
    <img
      {...props}
      src={src}
      alt={alt ?? ""}
      className="agent-chat-markdown-img"
      loading="lazy"
    />
  );
}

// ── Code Block with Copy ──────────────────────────────────────────

function CodeBlockWithCopy({
  children,
  ...preProps
}: React.ComponentPropsWithoutRef<"pre">): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleCopy = async (): Promise<void> => {
    const codeEl = containerRef.current?.querySelector("code");
    const text = codeEl?.textContent?.trim() ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for older browsers or non-HTTPS
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch {
        /* ignore */
      }
    }
  };

  const isBlockCode = React.Children.toArray(children).some(
    (child) => typeof child === "object" && child !== null && (child as React.ReactElement).type === "code",
  );

  return (
    <div className="agent-chat-code-block" ref={containerRef}>
      {isBlockCode && (
        <button
          type="button"
          className="agent-chat-code-copy"
          onClick={handleCopy}
          aria-label={copied ? "Copied" : "Copy to clipboard"}
          title={copied ? "Copied!" : "Copy"}
        >
          {copied ? (
            <span className="agent-chat-code-copy-icon" aria-hidden>✓</span>
          ) : (
            <span className="agent-chat-code-copy-icon" aria-hidden>⎘</span>
          )}
        </button>
      )}
      <pre {...preProps}>{children}</pre>
    </div>
  );
}

// ── Tool Call Render ─────────────────────────────────────────────────────

function ToolCallLine({
  entry,
}: {
  entry: ToolCallEntry;
}): React.ReactElement {
  if (entry.result !== undefined) {
    const icon = entry.isError ? "❌" : "✅";
    return (
      <div
        style={{
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          color: entry.isError ? "#ff4d4f" : "var(--color-text-secondary)",
          padding: "2px 0",
        }}
      >
        {icon} {entry.name} → {truncate(entry.result)}
      </div>
    );
  }
  return (
    <div
      style={{
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        fontSize: 11,
        color: "var(--color-accent-primary)",
        padding: "2px 0",
      }}
    >
      🔧 {entry.name}({entry.args ? truncate(entry.args) : ""})
    </div>
  );
}

// ── Message Bubble ───────────────────────────────────────────────────────

function MessageBubble({
  msg,
}: {
  msg: ChatMessage;
  accentColor: string;
}): React.ReactElement {
  const isUser = msg.role === "user";

  return (
    <div
      style={{
        display: "flex",
        justifyContent: isUser ? "flex-end" : "flex-start",
        marginBottom: "var(--space-3)",
      }}
    >
      <div
        className="agent-chat-bubble"
        style={{
          maxWidth: "85%",
          padding: "var(--space-2) var(--space-3)",
          borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
          background: isUser ? "var(--color-accent-primary)" : "#273548",
          color: isUser ? "#FFFFFF" : "var(--color-text-primary)",
          boxShadow: isUser ? "0 2px 4px rgba(0, 0, 0, 0.1)" : "0 2px 8px rgba(0, 0, 0, 0.15)",
          border: isUser ? "none" : "1px solid rgba(255, 255, 255, 0.05)",
          fontFamily: "var(--font-system)",
          fontSize: 13,
          lineHeight: 1.6,
          wordBreak: "break-word",
        }}
      >
        {msg.thinking && <ThinkingBlock text={msg.thinking} />}

        {msg.toolCalls?.map((tc, i) => (
          <ToolCallLine key={`${msg.id}-tool-${i}`} entry={tc} />
        ))}

        {isUser ? (
          <span>{msg.text}</span>
        ) : (
          <div className="agent-chat-markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                pre: CodeBlockWithCopy,
                img: SafeMarkdownImage,
              }}
            >
              {msg.text}
            </ReactMarkdown>
          </div>
        )}

        <div
          style={{
            textAlign: "right",
            fontSize: 10,
            marginTop: 4,
            color: isUser ? "rgba(255, 255, 255, 0.7)" : "var(--color-text-secondary)",
          }}
        >
          {new Date(msg.ts).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}

// ── MessageList ──────────────────────────────────────────────────────────

export function MessageList({
  messages,
  pendingToolLines,
  accentColor,
}: MessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, pendingToolLines]);

  return (
    <div
      className="agent-chat-message-list"
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "var(--space-3) var(--space-4)",
        display: "flex",
        flexDirection: "column",
        color: "var(--color-text-primary)",
        backgroundImage: `url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><text x="50%" y="50%" font-family="Inter, sans-serif" font-weight="800" font-size="16" fill="rgba(255, 255, 255, 0.03)" transform="rotate(-45 80 80)" text-anchor="middle" letter-spacing="2">GAMMA OS</text></svg>')`,
        backgroundRepeat: "repeat",
      }}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} accentColor={accentColor} />
      ))}

      {pendingToolLines.length > 0 && (
        <div
          style={{
            padding: "var(--space-2) var(--space-3)",
            background: "var(--color-bg-primary)",
            borderRadius: 6,
            border: "1px solid var(--color-border-subtle)",
            marginBottom: "var(--space-2)",
          }}
        >
          {pendingToolLines.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: 11,
                color: "var(--color-accent-primary)",
                padding: "1px 0",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}

      <div ref={bottomRef} />
    </div>
  );
}
