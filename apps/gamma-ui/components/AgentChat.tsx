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
  hasMoreHistory?: boolean;
  loadMoreHistory?: () => void;
  loadingMore?: boolean;
  historyLoaded?: boolean;
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
    id: "m2-think",
    role: "assistant",
    kind: "thinking",
    text: "User wants a weather app for two cities. I need to use the scaffold API to generate a React component with city cards showing temperature, humidity, and conditions.",
    ts: Date.now() - 50000,
  },
  {
    id: "m2-tool",
    role: "assistant",
    kind: "tool",
    text: "",
    toolCalls: [
      { name: "scaffold", args: '{"appId":"weather","displayName":"Weather Dashboard"}' },
      { name: "scaffold", result: '{"ok":true,"modulePath":"./apps/gamma-ui/apps/private/weather/We' },
    ],
    ts: Date.now() - 47000,
  },
  {
    id: "m2",
    role: "assistant",
    kind: "answer",
    text: "I'll build a **weather dashboard** with real-time data for both cities.\n\nLet me scaffold the component now.",
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
  const hasMoreHistory = isLive ? (props as AgentChatLiveProps).hasMoreHistory : false;
  const loadMoreHistory = isLive ? (props as AgentChatLiveProps).loadMoreHistory : undefined;
  const loadingMore = isLive ? (props as AgentChatLiveProps).loadingMore : false;
  const historyLoaded = isLive ? ((props as AgentChatLiveProps).historyLoaded ?? true) : true;

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

  // Decorative SVG pattern — code glyphs, brackets, dots, puzzle pieces
  const patternSvg = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cdefs%3E%3Cstyle%3Etext%7Bfont-family:monospace;fill:rgba(255,255,255,0.025);font-size:13px%7D%3C/style%3E%3C/defs%3E%3Ctext x='10' y='20'%3E%7B%7D%3C/text%3E%3Ctext x='140' y='25'%3Eλ%3C/text%3E%3Ctext x='55' y='55'%3E()=%3E%3C/text%3E%3Ctext x='170' y='60'%3E⚡%3C/text%3E%3Ctext x='20' y='90'%3E//✦%3C/text%3E%3Ctext x='115' y='95'%3E%3C/%3E%3C/text%3E%3Ctext x='80' y='130'%3E⬡%3C/text%3E%3Ctext x='10' y='140'%3E%5B…%5D%3C/text%3E%3Ctext x='160' y='135'%3E✧%3C/text%3E%3Ctext x='40' y='175'%3E0x%3C/text%3E%3Ctext x='125' y='170'%3E⟨Γ⟩%3C/text%3E%3Ctext x='185' y='190'%3E§%3C/text%3E%3Ctext x='75' y='210'%3E※%3C/text%3E%3Ccircle cx='195' cy='18' r='2' fill='rgba(59,130,246,0.04)'/%3E%3Ccircle cx='100' cy='75' r='1.5' fill='rgba(139,92,246,0.04)'/%3E%3Ccircle cx='35' cy='115' r='2' fill='rgba(34,197,94,0.03)'/%3E%3Ccircle cx='180' cy='155' r='1.5' fill='rgba(59,130,246,0.04)'/%3E%3Crect x='150' y='95' width='8' height='8' rx='2' fill='none' stroke='rgba(255,255,255,0.02)' stroke-width='0.8'/%3E%3Crect x='5' y='55' width='6' height='6' rx='1' fill='none' stroke='rgba(255,255,255,0.018)' stroke-width='0.7'/%3E%3Cpath d='M200 40 L206 46 L200 52' fill='none' stroke='rgba(255,255,255,0.02)' stroke-width='0.8'/%3E%3Cpath d='M60 155 L54 161 L60 167' fill='none' stroke='rgba(255,255,255,0.02)' stroke-width='0.8'/%3E%3C/svg%3E")`;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        background: "rgba(6, 8, 18, 0.97)",
        borderRadius: isEmbedded ? "10px 10px 0 0" : 0,
        border: isEmbedded ? `1px solid rgba(255,255,255,0.07)` : "none",
        overflow: "hidden",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* Decorative background pattern */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: patternSvg,
          backgroundRepeat: "repeat",
          backgroundSize: "220px 220px",
          pointerEvents: "none",
          zIndex: 0,
          opacity: 1,
        }}
      />
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", height: "100%" }}>
      <ChatHeader title={title} status={status} accentColor={accentColor} onClose={onClose} />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <MessageList
          messages={messages}
          pendingToolLines={pendingToolLines}
          status={status}
          accentColor={accentColor}
          hasMoreHistory={hasMoreHistory}
          loadMoreHistory={loadMoreHistory}
          loadingMore={loadingMore}
          historyLoaded={historyLoaded}
        />
      </div>
      <ChatInput
        status={status}
        accentColor={accentColor}
        placeholder={placeholder}
        onSend={handleSend}
      />

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
        @keyframes waveDot {
          0%, 60%, 100% { transform: translateY(0);    opacity: 0.35; }
          30%            { transform: translateY(-5px); opacity: 1;    }
        }
        .agent-chat-message-list::-webkit-scrollbar { width: 4px; }
        .agent-chat-message-list::-webkit-scrollbar-track { background: transparent; }
        .agent-chat-message-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 4px; }
        .agent-chat-message-list::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.15); }

        .agent-chat-message-list, .agent-chat-bubble, .agent-chat-markdown {
          user-select: text;
          -webkit-user-select: text;
        }

        .agent-chat-code-block { position: relative; margin: 6px 0; }
        .agent-chat-code-block pre { margin: 0; }
        .agent-chat-code-copy {
          position: absolute; top: 8px; right: 8px;
          padding: 3px 8px; font-size: 11px;
          color: rgba(180,200,255,0.5);
          background: rgba(255,255,255,0.07);
          border: 1px solid rgba(255,255,255,0.1);
          border-radius: 4px; cursor: pointer;
          transition: background 0.15s, color 0.15s; z-index: 1;
        }
        .agent-chat-code-copy:hover { background: rgba(255,255,255,0.12); color: rgba(220,235,255,0.9); }

        .agent-chat-markdown p { margin: 4px 0; color: inherit; }
        .agent-chat-markdown ul, .agent-chat-markdown ol { margin: 6px 0; padding-left: 20px; color: inherit; }
        .agent-chat-markdown strong { font-weight: 600; color: inherit; }
        .agent-chat-markdown em { font-style: italic; }
        .agent-chat-markdown code {
          background: rgba(255,255,255,0.07);
          color: rgba(150,210,255,0.9);
          padding: 1px 5px; border-radius: 4px; font-size: 12px;
          border: 1px solid rgba(255,255,255,0.08);
          font-family: 'SF Mono', 'Fira Code', monospace;
        }
        .agent-chat-markdown pre {
          background: rgba(0,0,0,0.35);
          padding: 12px 14px; border-radius: 8px;
          overflow-x: auto; font-size: 12px;
          border: 1px solid rgba(255,255,255,0.07);
          margin: 6px 0;
        }
        .agent-chat-markdown pre code { background: none; border: none; padding: 0; color: rgba(180,220,255,0.85); }
        .agent-chat-markdown-img { max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 8px 0; }
        .agent-chat-markdown a { color: rgba(96,165,250,0.9); text-decoration: underline; word-break: break-word; }
        .agent-chat-markdown table { border-collapse: collapse; width: 100%; font-size: 12px; }
        .agent-chat-markdown th, .agent-chat-markdown td {
          border: 1px solid rgba(255,255,255,0.08); padding: 4px 10px; text-align: left;
        }
        .agent-chat-markdown th { background: rgba(255,255,255,0.04); }
        .agent-chat-input::placeholder { color: rgba(255,255,255,0.25); }
        .agent-chat-markdown h1, .agent-chat-markdown h2, .agent-chat-markdown h3 {
          color: rgba(220,235,255,0.95); font-weight: 600; margin: 10px 0 4px;
        }
        .agent-chat-markdown h1 { font-size: 16px; }
        .agent-chat-markdown h2 { font-size: 14px; }
        .agent-chat-markdown h3 { font-size: 13px; }
        .agent-chat-markdown blockquote {
          border-left: 3px solid rgba(59,130,246,0.4);
          margin: 6px 0; padding: 4px 12px;
          color: rgba(180,200,255,0.6);
          font-style: italic;
        }
      `}</style>
      </div>
    </div>
  );
}
