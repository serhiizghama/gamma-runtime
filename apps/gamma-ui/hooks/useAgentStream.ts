import { useState, useEffect, useRef, useCallback } from "react";
import type { AgentStatus, GammaSSEEvent } from "@gamma/types";
import type { ChatMessage, ToolCallEntry } from "../components/MessageList";
import { API_BASE } from "../constants/api";

// ── Types ────────────────────────────────────────────────────────────────

interface AgentStreamState {
  messages: ChatMessage[];
  status: AgentStatus;
  pendingToolLines: string[];
  sendMessage: (text: string) => void;
}

interface AgentStreamOptions {
  /** Called when the backend returns 404 (session not found in Redis). */
  onSessionMissing?: () => void;
}

// ── Hook ─────────────────────────────────────────────────────────────────

/**
 * Phase-based streaming architecture.
 *
 * Each agent turn emits up to three distinct message bubbles:
 *   1. thinking  — internal reasoning (💭, violet glow)
 *   2. tool      — tool calls + results (⚙️, green glow)
 *   3. answer    — the final response text (Γ, blue glow)
 *
 * Every bubble lives in the single `messages[]` array with an `isStreaming`
 * flag. On lifecycle_end all flags are cleared atomically in one setState call,
 * preventing the unmount/remount flicker that plagued the old streamingMessage approach.
 */
export function useAgentStream(windowId: string, opts?: AgentStreamOptions): AgentStreamState {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<AgentStatus>("idle");
  const [pendingToolLines, setPendingToolLines] = useState<string[]>([]);

  const mountedRef = useRef(true);

  // IDs of the phase messages for the current run
  const thinkingIdRef = useRef<string | null>(null);
  const toolIdRef     = useRef<string | null>(null);
  const answerIdRef   = useRef<string | null>(null);

  // ── Helpers ──────────────────────────────────────────────────────────

  /** Patch a specific message in the array by id */
  const patchMsg = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  /** Mark a message as no longer streaming */
  const finalizeMsg = useCallback((id: string | null) => {
    if (id) patchMsg(id, { isStreaming: false });
  }, [patchMsg]);

  /** Atomically finalize all current-run phase messages */
  const finalizeAllPhases = useCallback(() => {
    const ids = new Set(
      [thinkingIdRef.current, toolIdRef.current, answerIdRef.current].filter(Boolean) as string[]
    );
    if (ids.size > 0) {
      setMessages((prev) => prev.map((m) => (ids.has(m.id) ? { ...m, isStreaming: false } : m)));
    }
    thinkingIdRef.current = null;
    toolIdRef.current     = null;
    answerIdRef.current   = null;
  }, []);

  // ── SSE Connection ───────────────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true;
    const url = `${API_BASE}/api/stream/${windowId}`;
    const es = new EventSource(url);

    es.onmessage = (ev) => {
      if (!mountedRef.current) return;

      let event: GammaSSEEvent;
      try { event = JSON.parse(ev.data) as GammaSSEEvent; }
      catch { return; }

      switch (event.type) {

        // ── Lifecycle ────────────────────────────────────────────────

        case "keep_alive": break;

        case "lifecycle_start": {
          thinkingIdRef.current = null;
          toolIdRef.current     = null;
          answerIdRef.current   = null;
          setStatus("running");
          setPendingToolLines([]);
          break;
        }

        case "lifecycle_end": {
          finalizeAllPhases();
          setStatus("idle");
          setPendingToolLines([]);
          break;
        }

        case "lifecycle_error": {
          finalizeAllPhases();
          setMessages((prev) => [...prev, {
            id: `err-${Date.now()}`,
            role: "assistant",
            kind: "answer",
            text: `⚠️ Error: ${event.message}`,
            ts: Date.now(),
          }]);
          setStatus("error");
          setPendingToolLines([]);
          break;
        }

        // ── Thinking ─────────────────────────────────────────────────

        case "thinking": {
          if (!thinkingIdRef.current) {
            const id = `think-${Date.now()}`;
            thinkingIdRef.current = id;
            setMessages((prev) => [...prev, {
              id,
              role: "assistant",
              kind: "thinking",
              text: event.text,
              isStreaming: true,
              ts: Date.now(),
            }]);
          } else {
            // Backend sends cumulative thinking text — overwrite, don't append
            patchMsg(thinkingIdRef.current, { text: event.text });
          }
          break;
        }

        // ── Assistant text ───────────────────────────────────────────

        case "assistant_delta":
        case "assistant_update": {
          // Thinking and tool phases are done once the answer starts
          finalizeMsg(thinkingIdRef.current);
          finalizeMsg(toolIdRef.current);

          if (!answerIdRef.current) {
            const id = `ans-${Date.now()}`;
            answerIdRef.current = id;
            setMessages((prev) => [...prev, {
              id,
              role: "assistant",
              kind: "answer",
              text: event.text,
              isStreaming: true,
              ts: Date.now(),
            }]);
          } else {
            // Cumulative overwrite — backend sends full text each time
            patchMsg(answerIdRef.current, { text: event.text });
          }
          break;
        }

        // ── Tool calls ───────────────────────────────────────────────

        case "tool_call": {
          const { name, toolCallId, arguments: args } = event;
          const argsStr = args ? JSON.stringify(args).slice(0, 80) : "";

          // Thinking phase ends when tools start
          finalizeMsg(thinkingIdRef.current);

          if (!toolIdRef.current) {
            const id = `tool-${Date.now()}`;
            toolIdRef.current = id;
            const entry: ToolCallEntry = { toolCallId, name, args: argsStr };
            setMessages((prev) => [...prev, {
              id,
              role: "assistant",
              kind: "tool",
              text: "",
              toolCalls: [entry],
              isStreaming: true,
              ts: Date.now(),
            }]);
          } else {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== toolIdRef.current) return m;
              return { ...m, toolCalls: [...(m.toolCalls ?? []), { toolCallId, name, args: argsStr }] };
            }));
          }

          setPendingToolLines((prev) => [...prev, `🔧 ${name}(${argsStr})`]);
          break;
        }

        case "tool_result": {
          const { name, toolCallId, result, isError } = event;
          const resultStr = result ? JSON.stringify(result).slice(0, 80) : "";

          if (toolIdRef.current) {
            setMessages((prev) => prev.map((m) => {
              if (m.id !== toolIdRef.current) return m;
              const calls = [...(m.toolCalls ?? [])];
              // Match by toolCallId; fallback to last pending call with same name
              const idx = toolCallId
                ? calls.findIndex((tc) => tc.toolCallId === toolCallId && tc.result === undefined)
                : calls.reduce((best, tc, i) => (tc.name === name && tc.result === undefined ? i : best), -1);
              if (idx >= 0) {
                calls[idx] = { ...calls[idx], result: resultStr, isError };
              } else {
                calls.push({ toolCallId, name, result: resultStr, isError });
              }
              return { ...m, toolCalls: calls };
            }));
          }

          setPendingToolLines((prev) => prev.filter((l) => !l.includes(name)));
          break;
        }

        // ── User message echo ────────────────────────────────────────

        case "user_message": {
          setMessages((prev) => [...prev, {
            id: `u-${event.ts}`,
            role: "user",
            text: event.text,
            ts: event.ts,
          }]);
          break;
        }

        default:
          break;
      }
    };

    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => {
      mountedRef.current = false;
      es.close();
    };
  }, [windowId, patchMsg, finalizeMsg, finalizeAllPhases]);

  // ── Send ─────────────────────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${windowId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) {
        // Session not found — trigger re-init so the caller can recreate it
        if (res.status === 404 && opts?.onSessionMissing) {
          opts.onSessionMissing();
        }
        throw new Error(`${res.status}`);
      }
    } catch {
      setMessages((prev) => [...prev, {
        id: `err-${Date.now()}`,
        role: "assistant",
        kind: "answer",
        text: "⚠️ Failed to send message. Check your connection.",
        ts: Date.now(),
      }]);
    }
  }, [windowId, opts]);

  return { messages, status, pendingToolLines, sendMessage };
}
