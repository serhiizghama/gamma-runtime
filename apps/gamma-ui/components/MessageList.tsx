import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentStatus } from "@gamma/types";
import { fmtTimeShort } from "../lib/format";

// ── Types ────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  /**
   * thinking  — agent's internal reasoning phase
   * tool      — tool calls + results
   * answer    — final response text (default / undefined = answer)
   */
  kind?: "thinking" | "tool" | "answer";
  text: string;
  toolCalls?: ToolCallEntry[];
  ts: number;
  /** True while this specific message is still receiving data from the stream */
  isStreaming?: boolean;
}

export interface ToolCallEntry {
  toolCallId?: string;
  name: string;
  args?: string;
  result?: string;
  isError?: boolean;
}

interface MessageListProps {
  messages: ChatMessage[];
  pendingToolLines: string[];
  accentColor: string;
  status: AgentStatus;
  hasMoreHistory?: boolean;
  loadMoreHistory?: () => void;
  loadingMore?: boolean;
  /** True once the initial history fetch has completed. Used to trigger initial scroll-to-bottom. */
  historyLoaded?: boolean;
}

// ── Helpers ──────────────────────────────────────────────────────────────

const MAX_TOOL_LEN = 80;

function isAllowedImageSrc(src: string | undefined): boolean {
  if (!src || typeof src !== "string") return false;
  const s = src.trim().toLowerCase();
  return s.startsWith("https://") || s.startsWith("http://") || s.startsWith("data:image/");
}

function truncate(str: string, max = MAX_TOOL_LEN): string {
  return str.length <= max ? str : str.slice(0, max) + "…";
}

// ── Avatars ──────────────────────────────────────────────────────────────

function AnswerAvatar(): React.ReactElement {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "rgba(59, 130, 246, 0.12)",
      border: "1px solid rgba(59, 130, 246, 0.25)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, marginTop: 2,
    }}>
      <svg viewBox="0 0 20 24" width="11" height="13">
        <path d="M2 3 L10 13 L10 22 M18 3 L10 13"
          stroke="rgba(96,165,250,0.85)" strokeWidth="2.5"
          strokeLinecap="round" strokeLinejoin="round" fill="none" />
      </svg>
    </div>
  );
}

function ThinkingAvatar(): React.ReactElement {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "rgba(139, 92, 246, 0.1)",
      border: "1px solid rgba(139, 92, 246, 0.22)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, marginTop: 2,
      fontSize: 13,
    }}>
      💭
    </div>
  );
}

function ToolAvatar(): React.ReactElement {
  return (
    <div style={{
      width: 28, height: 28, borderRadius: "50%",
      background: "rgba(34, 197, 94, 0.08)",
      border: "1px solid rgba(34, 197, 94, 0.2)",
      display: "flex", alignItems: "center", justifyContent: "center",
      flexShrink: 0, marginTop: 2,
      fontSize: 13,
    }}>
      ⚙️
    </div>
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
    try { await navigator.clipboard.writeText(code); }
    catch {
      const ta = document.createElement("textarea");
      ta.value = code; ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta);
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

// ── User Bubble ──────────────────────────────────────────────────────────

function UserBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
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
            color: "#fff", fontSize: 13, lineHeight: 1.55, wordBreak: "break-word",
            boxShadow: "0 2px 12px rgba(59,130,246,0.3)",
            fontFamily: "var(--font-system)",
          }}
        >
          {msg.text}
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.22)", transition: "opacity 0.15s", opacity: hovered ? 1 : 0, paddingRight: 4 }}>
          {fmtTimeShort(msg.ts)}
        </span>
      </div>
    </div>
  );
}

// ── Thinking Bubble ──────────────────────────────────────────────────────

function ThinkingBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const streamingClass = msg.isStreaming ? "agent-chat-bubble--streaming-thinking" : "";

  return (
    <div
      style={{ display: "flex", gap: 10, marginBottom: 10, paddingRight: "18%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ThinkingAvatar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          className={`agent-chat-bubble ${streamingClass}`}
          style={{
            padding: "8px 12px",
            borderRadius: "4px 14px 14px 14px",
            background: "rgba(99, 67, 168, 0.07)",
            border: "1px solid rgba(139, 92, 246, 0.12)",
            borderLeft: "3px solid rgba(139, 92, 246, 0.38)",
            color: "rgba(180, 155, 255, 0.72)",
            fontSize: 11.5,
            lineHeight: 1.55,
            fontFamily: "'SF Mono', 'Fira Code', monospace",
            wordBreak: "break-word",
            whiteSpace: "pre-wrap",
            maxHeight: msg.isStreaming ? "none" : 120,
            overflow: "hidden",
          }}
        >
          {msg.text || "…"}
        </div>
        <span style={{ fontSize: 10, color: "rgba(139,92,246,0.3)", paddingLeft: 4, transition: "opacity 0.15s", opacity: hovered ? 1 : 0 }}>
          thinking · {fmtTimeShort(msg.ts)}
        </span>
      </div>
    </div>
  );
}

// ── Tool Bubble ──────────────────────────────────────────────────────────

function ToolBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const streamingClass = msg.isStreaming ? "agent-chat-bubble--streaming-tool" : "";

  return (
    <div
      style={{ display: "flex", gap: 10, marginBottom: 10, paddingRight: "12%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <ToolAvatar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          className={`agent-chat-bubble ${streamingClass}`}
          style={{
            padding: "8px 12px",
            borderRadius: "4px 14px 14px 14px",
            background: "rgba(0, 0, 0, 0.32)",
            border: "1px solid rgba(34, 197, 94, 0.1)",
            borderLeft: "3px solid rgba(34, 197, 94, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: 3,
          }}
        >
          {(msg.toolCalls ?? []).map((tc, i) => (
            <div key={i} style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, padding: "1px 0" }}>
              {tc.result !== undefined ? (
                <span style={{ color: tc.isError ? "#f87171" : "rgba(100,200,130,0.85)" }}>
                  {tc.isError ? "❌" : "✅"} {tc.name} → {truncate(tc.result)}
                </span>
              ) : (
                <span style={{ color: "rgba(96,165,250,0.8)" }}>
                  🔧 {tc.name}({tc.args ? truncate(tc.args) : ""})
                </span>
              )}
            </div>
          ))}
          {msg.isStreaming && (msg.toolCalls ?? []).length === 0 && (
            <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 11, color: "rgba(34,197,94,0.5)" }}>…</span>
          )}
        </div>
        <span style={{ fontSize: 10, color: "rgba(34,197,94,0.3)", paddingLeft: 4, transition: "opacity 0.15s", opacity: hovered ? 1 : 0 }}>
          tools · {fmtTimeShort(msg.ts)}
        </span>
      </div>
    </div>
  );
}

// ── Answer Bubble ────────────────────────────────────────────────────────

function AnswerBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const streamingClass = msg.isStreaming ? "agent-chat-bubble--streaming-answer" : "";

  return (
    <div
      style={{ display: "flex", gap: 10, marginBottom: 14, paddingRight: "12%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <AnswerAvatar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <div
          className={`agent-chat-bubble ${streamingClass}`}
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
          <div className="agent-chat-markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlockWithCopy, img: SafeMarkdownImage }}>
              {msg.text || ""}
            </ReactMarkdown>
          </div>
        </div>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.2)", paddingLeft: 4, transition: "opacity 0.15s", opacity: hovered ? 1 : 0 }}>
          Gamma · {fmtTimeShort(msg.ts)}
        </span>
      </div>
    </div>
  );
}

// ── Message Router ───────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }): React.ReactElement {
  if (msg.role === "user") return <UserBubble msg={msg} />;
  if (msg.kind === "thinking") return <ThinkingBubble msg={msg} />;
  if (msg.kind === "tool") return <ToolBubble msg={msg} />;
  return <AnswerBubble msg={msg} />;
}

// ── Typing Indicator ─────────────────────────────────────────────────────

const STATUS_LABELS = ["Thinking", "Working", "Processing"];
let _labelIdx = 0;

function TypingIndicator({ toolLines }: { toolLines?: string[] }): React.ReactElement {
  const [label] = React.useState(() => STATUS_LABELS[_labelIdx++ % STATUS_LABELS.length]);

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 14, paddingRight: "12%" }}>
      <AnswerAvatar />
      <div style={{
        display: "flex", flexDirection: "column", gap: 6,
        padding: "10px 14px", borderRadius: "4px 18px 18px 18px",
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.07)",
        borderLeft: "3px solid rgba(59,130,246,0.45)",
        minWidth: 120,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, color: "rgba(150,180,255,0.6)", fontFamily: "var(--font-system)", letterSpacing: 0.2 }}>
            {label}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
            {[0, 1, 2].map((i) => (
              <span key={i} style={{
                width: 5, height: 5, borderRadius: "50%",
                background: "rgba(96,165,250,0.75)", display: "inline-block",
                animation: `waveDot 1.1s ease-in-out ${i * 0.18}s infinite`,
              }} />
            ))}
          </div>
        </div>
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

export function MessageList({ messages, pendingToolLines, status, hasMoreHistory, loadMoreHistory, loadingMore, historyLoaded }: MessageListProps): React.ReactElement {
  const bottomRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // True when the user has manually scrolled up away from the bottom.
  const userScrolledUp = useRef(false);
  // Track previous message count to detect new messages (vs streaming updates).
  const prevMessageCount = useRef(messages.length);
  // Whether we have already performed the initial scroll-to-bottom after history load.
  const initialScrollDoneRef = useRef(false);

  // ── Initial scroll-to-bottom after history loads ─────────────────────
  // useLayoutEffect fires synchronously after DOM mutations, before paint.
  // This guarantees we scroll AFTER messages are in the DOM but before the
  // browser renders — no flash of wrong scroll position.
  useLayoutEffect(() => {
    if (!historyLoaded || initialScrollDoneRef.current) return;
    const el = listRef.current;
    if (!el || messages.length === 0) return;
    // Instant jump — no smooth animation, so Markdown layout cannot interrupt it
    el.scrollTop = el.scrollHeight;
    initialScrollDoneRef.current = true;
    // Sync prevMessageCount so the useEffect scroll logic starts from correct baseline
    prevMessageCount.current = messages.length;
  }, [historyLoaded, messages.length]);

  // Detect manual scroll: if user scrolls up, stop auto-scroll.
  // If user scrolls back near the bottom (within 80px), re-enable it.
  // Also trigger loadMoreHistory when scrolled near the top.
  const handleScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 80;

    // Load older messages when scrolled near the top (within 60px)
    if (el.scrollTop < 60 && hasMoreHistory && loadMoreHistory && !loadingMore) {
      loadMoreHistory();
    }
  };

  useEffect(() => {
    const newCount = messages.length;
    const lastMsg = messages[messages.length - 1];

    // Always scroll on user message (they just sent something → go to bottom)
    const isNewUserMessage =
      newCount > prevMessageCount.current && lastMsg?.role === "user";

    // Scroll on new assistant message only if user hasn't scrolled up
    const isNewAssistantMessage =
      newCount > prevMessageCount.current && lastMsg?.role !== "user";

    // Streaming update of existing message — only scroll if already at bottom
    const isStreamingUpdate = newCount === prevMessageCount.current;

    prevMessageCount.current = newCount;

    if (isNewUserMessage) {
      userScrolledUp.current = false;
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (isNewAssistantMessage && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    } else if (isStreamingUpdate && !userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, pendingToolLines]);

  // Typing indicator: visible only while running and no streaming message exists yet
  const isAnyStreaming = messages.some((m) => m.isStreaming);
  const showTypingIndicator = status === "running" && !isAnyStreaming;

  return (
    <div
      ref={listRef}
      onScroll={handleScroll}
      className="agent-chat-message-list"
      style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", padding: "16px 14px 8px", display: "flex", flexDirection: "column" }}
    >
      {/* Loading indicator for older messages */}
      {loadingMore && (
        <div style={{ textAlign: "center", padding: "8px 0", fontSize: 11, color: "rgba(255,255,255,0.3)" }}>
          Loading older messages…
        </div>
      )}
      {hasMoreHistory && !loadingMore && (
        <div style={{ textAlign: "center", padding: "6px 0", fontSize: 10, color: "rgba(255,255,255,0.15)" }}>
          ↑ scroll up for more
        </div>
      )}
      {messages.map((msg) => (
        <MessageBubble key={msg.id} msg={msg} />
      ))}

      {showTypingIndicator && (
        <TypingIndicator toolLines={pendingToolLines.length > 0 ? pendingToolLines : undefined} />
      )}

      <div ref={bottomRef} />

      <style>{`
        @keyframes waveDot {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30%            { transform: translateY(-5px); opacity: 1; }
        }

        /* ── Flashlight sweep — spotlight slides L ↔ R behind the bubble surface ── */
        @keyframes flashlightSweep {
          0%   { transform: translateX(-130%); opacity: 0; }
          9%   { opacity: 1;                               }
          50%  { transform: translateX(240%);  opacity: 1; }
          91%  { opacity: 1;                               }
          100% { transform: translateX(-130%); opacity: 0; }
        }

        /* Structural base — needed for ::before clipping */
        .agent-chat-bubble--streaming-answer,
        .agent-chat-bubble--streaming-thinking,
        .agent-chat-bubble--streaming-tool {
          position: relative;
          overflow: hidden;
        }

        /* The flashlight element itself */
        .agent-chat-bubble--streaming-answer::before,
        .agent-chat-bubble--streaming-thinking::before,
        .agent-chat-bubble--streaming-tool::before {
          content: '';
          position: absolute;
          top: -40%;
          left: -20%;
          width: 38%;
          height: 180%;
          border-radius: 50%;
          pointer-events: none;
          mix-blend-mode: screen;
          animation: flashlightSweep ease-in-out infinite;
        }

        /* Answer — blue flashlight */
        .agent-chat-bubble--streaming-answer::before {
          background: radial-gradient(ellipse at center,
            rgba(59,130,246,0.62) 0%,
            rgba(59,130,246,0.20) 44%,
            transparent 70%
          );
          animation-duration: 4.2s;
        }

        /* Thinking — violet flashlight, offset phase */
        .agent-chat-bubble--streaming-thinking::before {
          background: radial-gradient(ellipse at center,
            rgba(139,92,246,0.65) 0%,
            rgba(139,92,246,0.20) 44%,
            transparent 70%
          );
          animation-duration: 3.7s;
          animation-delay: -0.8s;
        }

        /* Tool — green flashlight, shifted phase */
        .agent-chat-bubble--streaming-tool::before {
          background: radial-gradient(ellipse at center,
            rgba(34,197,94,0.58) 0%,
            rgba(34,197,94,0.18) 44%,
            transparent 70%
          );
          animation-duration: 3.2s;
          animation-delay: -1.5s;
        }

        .agent-chat-message-list::-webkit-scrollbar { width: 4px; }
        .agent-chat-message-list::-webkit-scrollbar-track { background: transparent; }
        .agent-chat-message-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .agent-chat-message-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

        .agent-chat-message-list, .agent-chat-bubble, .agent-chat-markdown { user-select: text; -webkit-user-select: text; }

        .agent-chat-code-block { position: relative; margin: 6px 0; }
        .agent-chat-code-block pre { margin: 0; }
        .agent-chat-code-copy {
          position: absolute; top: 8px; right: 8px;
          padding: 3px 8px; font-size: 11px;
          color: rgba(180,200,255,0.5); background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1); border-radius: 4px;
          cursor: pointer; transition: background 0.15s, color 0.15s; z-index: 1;
        }
        .agent-chat-code-copy:hover { background: rgba(255,255,255,0.12); color: rgba(220,235,255,0.9); }

        .agent-chat-markdown p { margin: 4px 0; color: inherit; }
        .agent-chat-markdown ul, .agent-chat-markdown ol { margin: 6px 0; padding-left: 20px; color: inherit; }
        .agent-chat-markdown strong { font-weight: 600; color: inherit; }
        .agent-chat-markdown em { font-style: italic; }
        .agent-chat-markdown code {
          background: rgba(255,255,255,0.07); color: rgba(150,210,255,0.9);
          padding: 1px 5px; border-radius: 4px; font-size: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        .agent-chat-markdown pre {
          background: rgba(0,0,0,0.35); padding: 12px 14px; border-radius: 8px;
          overflow-x: auto; font-size: 12px; border: 1px solid rgba(255,255,255,0.07); margin: 6px 0;
        }
        .agent-chat-markdown pre code { background: none; border: none; padding: 0; color: rgba(180,220,255,0.85); }
        .agent-chat-markdown-img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 8px 0; }
        .agent-chat-markdown a { color: rgba(96,165,250,0.9); text-decoration: underline; word-break: break-word; }
        .agent-chat-markdown table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .agent-chat-markdown th, .agent-chat-markdown td { border: 1px solid rgba(255,255,255,0.08); padding: 4px 10px; text-align: left; }
        .agent-chat-markdown th { background: rgba(255,255,255,0.04); }
        .agent-chat-input::placeholder { color: rgba(255,255,255,0.25); }
        .agent-chat-markdown h1, .agent-chat-markdown h2, .agent-chat-markdown h3 { color: rgba(220,235,255,0.95); font-weight: 600; margin: 10px 0 4px; }
        .agent-chat-markdown h1 { font-size: 16px; }
        .agent-chat-markdown h2 { font-size: 14px; }
        .agent-chat-markdown h3 { font-size: 13px; }
        .agent-chat-markdown blockquote {
          border-left: 3px solid rgba(59,130,246,0.4); margin: 6px 0; padding: 4px 12px;
          color: rgba(180,200,255,0.6); font-style: italic;
        }
      `}</style>
    </div>
  );
}
