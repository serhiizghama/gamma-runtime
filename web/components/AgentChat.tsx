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
  const { title, variant, accentColor = "#00ff41", placeholder } = props;

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
        background: "#0a0a0a",
        borderRadius: isEmbedded ? "10px 10px 0 0" : 0,
        border: isEmbedded ? `1px solid ${accentColor}22` : "none",
        position: isEmbedded ? "absolute" : "relative",
        bottom: isEmbedded ? 0 : undefined,
        left: isEmbedded ? 0 : undefined,
        overflow: "hidden",
      }}
    >
      <ChatHeader title={title} status={status} accentColor={accentColor} />
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

      {/* Pulse animation keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        .agent-chat-markdown p { margin: 4px 0; }
        .agent-chat-markdown code {
          background: #1a1a2e;
          padding: 1px 5px;
          border-radius: 3px;
          font-size: 12px;
        }
        .agent-chat-markdown pre {
          background: #111;
          padding: 10px;
          border-radius: 6px;
          overflow-x: auto;
          font-size: 12px;
          border: 1px solid #222;
        }
        .agent-chat-markdown pre code {
          background: none;
          padding: 0;
        }
        .agent-chat-markdown a {
          color: #00ff41;
          text-decoration: underline;
        }
        .agent-chat-markdown table {
          border-collapse: collapse;
          width: 100%;
          font-size: 12px;
        }
        .agent-chat-markdown th,
        .agent-chat-markdown td {
          border: 1px solid #333;
          padding: 4px 8px;
          text-align: left;
        }
        .agent-chat-markdown th {
          background: #1a1a2e;
        }
      `}</style>
    </div>
  );
}
