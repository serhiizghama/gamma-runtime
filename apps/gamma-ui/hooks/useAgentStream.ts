import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentStatus, GammaSSEEvent } from "@gamma/types";
import type { ChatMessage, ToolCallEntry } from "../components/MessageList";
import { API_BASE } from "../constants/api";

// ── Types ────────────────────────────────────────────────────────────────

interface AgentStreamState {
  messages: ChatMessage[];
  streamingMessage: ChatMessage | null;
  status: AgentStatus;
  pendingToolLines: string[];
  sendMessage: (text: string) => void;
}

const STREAM_THROTTLE_MS = 100;

// ── Hook ─────────────────────────────────────────────────────────────────

export function useAgentStream(windowId: string): AgentStreamState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<ChatMessage | null>(null);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [pendingToolLines, setPendingToolLines] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const currentAssistantRef = useRef<{
    id: string;
    text: string;
    thinking: string;
    toolCalls: ToolCallEntry[];
  } | null>(null);
  const streamFlushTimerRef = useRef<number | null>(null);

  // SSE connection
  useEffect(() => {
    mountedRef.current = true;
    const url = `${API_BASE}/api/stream/${windowId}`;
    const es = new EventSource(url);

    // ── Throttled streaming flush ──────────────────────────────────────
    // Snapshot the ref into a ChatMessage state at most every STREAM_THROTTLE_MS
    // to drive React re-renders without a render storm.
    const flushStreamToState = () => {
      const cur = currentAssistantRef.current;
      if (cur && mountedRef.current) {
        setStreamingMessage({
          id: cur.id,
          role: "assistant",
          text: cur.text,
          thinking: cur.thinking || undefined,
          toolCalls: cur.toolCalls.length > 0 ? [...cur.toolCalls] : undefined,
          ts: Date.now(),
        });
      }
    };

    const scheduleStreamFlush = () => {
      if (streamFlushTimerRef.current !== null) return; // already scheduled
      streamFlushTimerRef.current = window.setTimeout(() => {
        streamFlushTimerRef.current = null;
        flushStreamToState();
      }, STREAM_THROTTLE_MS);
    };

    const flushStreamNow = () => {
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
      flushStreamToState();
    };

    // ── Event handler ──────────────────────────────────────────────────
    es.onmessage = (ev) => {
      if (!mountedRef.current) return;

      let event: GammaSSEEvent;
      try {
        event = JSON.parse(ev.data) as GammaSSEEvent;
      } catch {
        return;
      }

      switch (event.type) {
        case "keep_alive":
          break;

        case "lifecycle_start": {
          setStatus("running");
          setPendingToolLines([]);
          // Start accumulating a new assistant message
          currentAssistantRef.current = {
            id: `a-${Date.now()}`,
            text: "",
            thinking: "",
            toolCalls: [],
          };
          break;
        }

        case "lifecycle_end": {
          setStatus("idle");
          // Flush accumulated assistant message to the permanent history
          const cur = currentAssistantRef.current;
          if (cur && (cur.text.trim() || cur.toolCalls.length > 0)) {
            const msg: ChatMessage = {
              id: cur.id,
              role: "assistant",
              text: cur.text,
              thinking: cur.thinking || undefined,
              toolCalls: cur.toolCalls.length > 0 ? cur.toolCalls : undefined,
              ts: Date.now(),
            };
            setMessages((prev) => [...prev, msg]);
          }
          currentAssistantRef.current = null;
          // Clear streaming state — the message now lives in `messages`
          if (streamFlushTimerRef.current !== null) {
            window.clearTimeout(streamFlushTimerRef.current);
            streamFlushTimerRef.current = null;
          }
          setStreamingMessage(null);
          setPendingToolLines([]);
          break;
        }

        case "lifecycle_error": {
          setStatus("error");
          setMessages((prev) => [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: "assistant",
              text: `⚠️ Error: ${event.message}`,
              ts: Date.now(),
            },
          ]);
          currentAssistantRef.current = null;
          if (streamFlushTimerRef.current !== null) {
            window.clearTimeout(streamFlushTimerRef.current);
            streamFlushTimerRef.current = null;
          }
          setStreamingMessage(null);
          setPendingToolLines([]);
          break;
        }

        case "thinking": {
          const cur = currentAssistantRef.current;
          if (cur) {
            cur.thinking += event.text;
            scheduleStreamFlush();
          }
          break;
        }

        case "assistant_delta":
        case "assistant_update": {
          const cur = currentAssistantRef.current;
          if (cur) {
            // Cumulative overwrite — immune to dropped packets, double-mounts, out-of-order chunks
            cur.text = event.text;
            scheduleStreamFlush();
          }
          break;
        }

        case "tool_call": {
          const { name, arguments: args } = event;
          const argsStr = args ? JSON.stringify(args).slice(0, 64) : "";
          const cur = currentAssistantRef.current;
          if (cur) {
            cur.toolCalls.push({ name, args: argsStr });
            flushStreamNow(); // Immediate feedback for tool invocations
          }
          setPendingToolLines((prev) => [...prev, `🔧 ${name}(${argsStr})`]);
          break;
        }

        case "tool_result": {
          const { name, result, isError } = event;
          const resultStr = result ? JSON.stringify(result).slice(0, 64) : "";
          const cur = currentAssistantRef.current;
          if (cur) {
            cur.toolCalls.push({ name, result: resultStr, isError });
            flushStreamNow(); // Immediate feedback for tool results
          }
          setPendingToolLines((prev) =>
            prev.filter((l) => !l.includes(name)),
          );
          break;
        }

        case "user_message": {
          setMessages((prev) => [
            ...prev,
            {
              id: `u-${event.ts}`,
              role: "user",
              text: event.text,
              ts: event.ts,
            },
          ]);
          break;
        }

        default:
          // component_ready, component_removed, gateway_status, error
          // handled by useSystemEvents or ignored
          break;
      }
    };

    es.onerror = () => {
      if (mountedRef.current) {
        // EventSource auto-reconnects; just mark as potentially degraded
      }
    };

    return () => {
      mountedRef.current = false;
      es.close();
      if (streamFlushTimerRef.current !== null) {
        window.clearTimeout(streamFlushTimerRef.current);
        streamFlushTimerRef.current = null;
      }
    };
  }, [windowId]);

  // Send message — no optimistic add, backend echoes user_message via SSE
  const sendMessage = useCallback(
    async (text: string) => {
      try {
        const res = await fetch(`${API_BASE}/api/sessions/${windowId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!res.ok) throw new Error(`${res.status}`);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: "assistant",
            text: "⚠️ Failed to send message. Check your connection.",
            ts: Date.now(),
          },
        ]);
      }
    },
    [windowId],
  );

  return { messages, streamingMessage, status, pendingToolLines, sendMessage };
}
