import { useEffect, useRef, useState } from "react";
import { fetchSseTicket } from "../lib/auth";
import { API_BASE } from "../constants/api";

export interface UseSecureSseOptions {
  /** Stream path, e.g. "/api/system/activity/stream" */
  path: string;
  /** Called for each incoming SSE message */
  onMessage: (data: MessageEvent) => void;
  /** Base reconnection delay in ms (default: 3000). Doubles on each failure up to 30s. */
  reconnectMs?: number;
  /** Label for console logs (default: "SSE") */
  label?: string;
  /**
   * When false, the hook does not connect. Changing from false → true triggers a
   * fresh connection attempt. Defaults to true to preserve existing auto-connect
   * behaviour for current consumers.
   */
  enabled?: boolean;
}

/**
 * Shared hook for authenticated SSE connections with automatic reconnection.
 *
 * Handles the fetchSseTicket → EventSource → reconnect lifecycle that was
 * previously duplicated across DirectorApp, SentinelApp, etc.
 *
 * Key behaviours:
 * - Always fetches a fresh ticket on every connect attempt (never reuses stale ticket URL)
 * - Intercepts server-sent { type: 'error' } (invalid/expired ticket) and reconnects
 *   with a fresh ticket instead of letting EventSource auto-retry with the same URL
 * - Exponential backoff: reconnectMs → 2x → 4x … up to MAX_BACKOFF_MS
 */
export function useSecureSse({
  path,
  onMessage,
  reconnectMs = 3000,
  label = "SSE",
  enabled = true,
}: UseSecureSseOptions): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;
    let backoffMs = reconnectMs;
    const MAX_BACKOFF_MS = 30_000;

    const cleanup = () => {
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      setConnected(false);
    };

    if (!enabled) {
      cleanup();
      return () => {
        destroyed = true;
        cleanup();
      };
    }

    const scheduleReconnect = () => {
      if (destroyed || !enabled) return;
      const jitter = Math.random() * 2000;
      reconnectTimerRef.current = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        void connect().catch((err) => console.error(`[${label}] SSE reconnect failed:`, err));
      }, backoffMs + jitter);
    };

    const connect = async (): Promise<void> => {
      if (destroyed || !enabled) return;

      // Always fetch a fresh ticket — never reuse the previous URL.
      // EventSource built-in auto-retry uses the same URL (stale ticket) causing loops.
      const ticketQs = await fetchSseTicket(path);
      if (destroyed || !enabled) return;

      const url = `${API_BASE}${path}${ticketQs}`;
      console.log(`[${label}] SSE connecting:`, url.replace(/ticket=[^&]+/, "ticket=***"));

      const es = new EventSource(url);
      esRef.current = es;
      const connectedAt = { ts: 0 };

      es.onopen = () => {
        if (destroyed || !enabled) return;
        connectedAt.ts = Date.now();
        console.log(`[${label}] SSE connected`);
        setConnected(true);
        // Reset backoff only after the connection has been stable for 5s.
        // ERR_NETWORK_CHANGED can fire immediately after onopen — resetting
        // backoff in that case causes a rapid reconnect flood.
        setTimeout(() => {
          if (!destroyed && enabled && connectedAt.ts > 0) {
            backoffMs = reconnectMs;
          }
        }, 5000);
      };

      es.onmessage = (ev) => {
        if (destroyed || !enabled) return;

        // Intercept server-sent error before forwarding to caller.
        // When the server sends { type: 'error', message: 'invalid or expired ticket' }
        // it then calls subscriber.complete() — EventSource sees a clean HTTP close and
        // auto-retries with the SAME stale URL. We must close and reconnect ourselves.
        try {
          const parsed = JSON.parse(ev.data as string) as Record<string, unknown>;
          if (
            parsed.type === "error" &&
            typeof parsed.message === "string" &&
            parsed.message.includes("invalid or expired ticket")
          ) {
            console.warn(`[${label}] SSE ticket expired — reconnecting with fresh ticket`);
            setConnected(false);
            es.close();
            esRef.current = null;
            scheduleReconnect();
            return;
          }
        } catch {
          // Not JSON or not an error event — pass through normally
        }

        onMessageRef.current(ev);
      };

      es.onerror = () => {
        if (destroyed || !enabled) return;
        console.warn(`[${label}] SSE error — reconnecting in ${backoffMs}ms`);
        setConnected(false);
        es.close();
        esRef.current = null;
        scheduleReconnect();
      };
    };

    void connect().catch((err) => console.error(`[${label}] SSE connect failed:`, err));

    return () => {
      destroyed = true;
      cleanup();
    };
  }, [path, reconnectMs, label, enabled]);

  return { connected };
}
