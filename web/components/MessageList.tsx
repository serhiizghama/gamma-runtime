import { useEffect, useRef, useState } from "react";
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
        background: "#1a1a2e",
        borderRadius: 6,
        border: "1px solid #333",
        fontSize: 12,
        color: "#aaa",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          userSelect: "none",
          fontFamily: "'SF Mono', 'Fira Code', monospace",
          fontSize: 11,
          color: "#888",
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
          color: "#999",
        }}
      >
        {text}
      </pre>
    </details>
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
          color: entry.isError ? "#ff4444" : "#888",
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
        color: "#00ff41",
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
  accentColor,
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
        marginBottom: 10,
      }}
    >
      <div
        style={{
          maxWidth: "80%",
          padding: "8px 12px",
          borderRadius: 10,
          background: isUser ? `${accentColor}18` : "#141414",
          border: `1px solid ${isUser ? `${accentColor}33` : "#222"}`,
          color: "#e0e0e0",
          fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
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
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.text}
            </ReactMarkdown>
          </div>
        )}

        <div
          style={{
            textAlign: "right",
            fontSize: 10,
            color: "#555",
            marginTop: 4,
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
      style={{
        flex: 1,
        overflowY: "auto",
        padding: "12px 14px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} accentColor={accentColor} />
      ))}

      {pendingToolLines.length > 0 && (
        <div
          style={{
            padding: "6px 10px",
            background: "#111",
            borderRadius: 6,
            border: "1px solid #222",
            marginBottom: 8,
          }}
        >
          {pendingToolLines.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: "'SF Mono', 'Fira Code', monospace",
                fontSize: 11,
                color: "#00ff41",
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
