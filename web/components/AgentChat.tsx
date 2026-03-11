import { useState, useCallback } from "react";
import type { AgentStatus } from "@gamma/types";
import { ChatHeader } from "./ChatHeader";
import { ChatInput } from "./ChatInput";
import { MessageList } from "./MessageList";
import type { ChatMessage } from "./MessageList";

// ── Props ────────────────────────────────────────────────────────────────

interface AgentChatBaseProps {
  title: string;
  variant: "fullWindow" | "embedded";
  accentColor?: string;
  placeholder?: string;
  onClose?: () => void;
}

/** Live mode — driven by external stream hook */
interface AgentChatLiveProps extends AgentChatBaseProps {
  mode: "live";
  messages: ChatMessage[];
  status: AgentStatus;
  pendingToolLines: string[];
  onSend: (text: string) => void;
}

/** Mock mode — self-contained with demo data */
interface AgentChatMockProps extends AgentChatBaseProps {
  mode?: "mock";
  windowId: string;
  onComponentReady?: (appId: string) => void;
}

type AgentChatProps = AgentChatLiveProps | AgentChatMockProps;

// ── Mock Data ────────────────────────────────────────────────────────────

const MOCK_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    role: "user",
    text: "Create a weather dashboard for Hanoi and Kyiv",
    ts: Date.now() - 60000,
  },
  {
    id: "m2",
    role: "assistant",
    text: "I'll build a **weather dashboard** with real-time data for both cities.\n\nLet me scaffold the component now.",
    thinking:
      "User wants a weather app for two cities. I need to use the scaffold API to generate a React component with city cards showing temperature, humidity, and conditions.",
    toolCalls: [
      {
        name: "scaffold",
        args: '{"appId":"weather","displayName":"Weather Dashboard"}',
      },
      {
        name: "scaffold",
        result: '{"ok":true,"modulePath":"./web/apps/generated/weather/We',
      },
    ],
    ts: Date.now() - 45000,
  },
  {
    id: "m3",
    role: "assistant",
    text: "The Weather Dashboard is ready! It shows current conditions for **Hanoi** (32°C, Partly Cloudy) and **Kyiv** (8°C, Overcast).",
    ts: Date.now() - 30000,
  },
];

// ── Component ────────────────────────────────────────────────────────────

export function AgentChat(props: AgentChatProps): React.ReactElement {
  const { title, variant, accentColor = "#0066ff", placeholder, onClose } = props;

  // Determine if live or mock
  const isLive = "mode" in props && props.mode === "live";

  // Mock state (only used in mock mode)
  const [mockMessages, setMockMessages] = useState<ChatMessage[]>(MOCK_MESSAGES);
  const [mockStatus, setMockStatus] = useState<AgentStatus>("idle");

  const messages = isLive ? (props as AgentChatLiveProps).messages : mockMessages;
  const status = isLive ? (props as AgentChatLiveProps).status : mockStatus;
  const pendingToolLines = isLive ? (props as AgentChatLiveProps).pendingToolLines : [];

  const handleSend = useCallback(
    (text: string) => {
      if (isLive) {
        (props as AgentChatLiveProps).onSend(text);
      } else {
        const msg: ChatMessage = {
          id: `u-${Date.now()}`,
          role: "user",
          text,
          ts: Date.now(),
        };
        setMockMessages((prev) => [...prev, msg]);
        setMockStatus("running");
        setTimeout(() => {
          setMockMessages((prev) => [
            ...prev,
            {
              id: `a-${Date.now()}`,
              role: "assistant",
              text: `Got it — working on: "${text}"`,
              ts: Date.now(),
            },
          ]);
          setMockStatus("idle");
        }, 2000);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLive],
  );

  const isEmbedded = variant === "embedded";

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: isEmbedded ? "40%" : "100%",
        width: "100%",
        background: "var(--color-bg-secondary)",
        borderRadius: isEmbedded ? "10px 10px 0 0" : 0,
        border: isEmbedded ? `1px solid var(--color-border-subtle)` : "none",
        position: isEmbedded ? "absolute" : "relative",
        bottom: isEmbedded ? 0 : undefined,
        left: isEmbedded ? 0 : undefined,
        overflow: "hidden",
      }}
    >
      <ChatHeader title={title} status={status} accentColor={accentColor} onClose={onClose} />
      <MessageList
        messages={messages}
        pendingToolLines={pendingToolLines}
        accentColor={accentColor}
      />
      <ChatInput
        status={status}
        accentColor={accentColor}
        placeholder={placeholder}
        onSend={handleSend}
      />

      {/* Twilight Blue markdown styles + scrollbar + watermark */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .agent-chat-message-list::-webkit-scrollbar {
          width: 6px;
        }
        .agent-chat-message-list::-webkit-scrollbar-track {
          background: transparent;
        }
        .agent-chat-message-list::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }
        .agent-chat-message-list::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.2);
        }
        .agent-chat-message-list,
        .agent-chat-bubble,
        .agent-chat-markdown {
          user-select: text;
          -webkit-user-select: text;
        }
        .agent-chat-code-block {
          position: relative;
          margin: var(--space-2) 0;
        }
        .agent-chat-code-block pre {
          margin: 0;
        }
        .agent-chat-code-copy {
          position: absolute;
          top: var(--space-2);
          right: var(--space-2);
          padding: 4px 8px;
          font-size: 11px;
          font-family: var(--font-system);
          color: var(--color-text-secondary);
          user-select: none;
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid var(--color-border-subtle);
          border-radius: 4px;
          cursor: pointer;
          transition: background 0.15s, color 0.15s;
          z-index: 1;
        }
        .agent-chat-code-copy:hover {
          background: rgba(255, 255, 255, 0.15);
          color: var(--color-text-primary);
        }
        .agent-chat-code-copy:focus {
          outline: 2px solid var(--color-accent-primary);
          outline-offset: 2px;
        }
        .agent-chat-bubble .agent-chat-markdown {
          color: inherit;
        }
        .agent-chat-markdown p { margin: var(--space-1) 0; color: inherit; }
        .agent-chat-markdown ul, .agent-chat-markdown ol {
          margin: var(--space-2) 0;
          padding-left: var(--space-6);
          color: inherit;
        }
        .agent-chat-markdown strong { font-weight: var(--font-weight-semibold); color: inherit; }
        .agent-chat-markdown code {
          background: var(--color-bg-primary);
          color: inherit;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 12px;
          border: 1px solid var(--color-border-subtle);
        }
        .agent-chat-markdown pre {
          background: var(--color-bg-primary);
          padding: var(--space-3);
          border-radius: 6px;
          overflow-x: auto;
          font-size: 12px;
          border: 1px solid var(--color-border-subtle);
          margin: var(--space-2) 0;
        }
        .agent-chat-markdown pre code {
          background: none;
          border: none;
          padding: 0;
          color: inherit;
        }
        .agent-chat-markdown-img {
          max-width: 100%;
          height: auto;
          border-radius: 8px;
          display: block;
          margin: var(--space-2) 0;
          object-fit: contain;
        }
        .agent-chat-markdown a {
          color: var(--color-accent-primary);
          text-decoration: underline;
          word-break: break-word;
        }
        .agent-chat-markdown table {
          border-collapse: collapse;
          width: 100%;
          font-size: 12px;
        }
        .agent-chat-markdown th,
        .agent-chat-markdown td {
          border: 1px solid var(--color-border-subtle);
          padding: 4px 8px;
          text-align: left;
        }
        .agent-chat-markdown th {
          background: var(--color-bg-primary);
          color: inherit;
        }
        .agent-chat-markdown td {
          color: inherit;
        }
        .agent-chat-input::placeholder {
          color: var(--color-text-secondary);
        }
      `}</style>
    </div>
  );
}
