import { useEffect, useRef, useState } from "react";
import { fetchSseTicket } from "../lib/auth";
import { API_BASE } from "../constants/api";

export interface UseSecureSseOptions {
  /** Stream path, e.g. "/api/system/activity/stream" */
  path: string;
  /** Called for each incoming SSE message */
  onMessage: (data: MessageEvent) => void;
  /** Reconnection delay in ms (default: 3000) */
  reconnectMs?: number;
  /** Label for console logs (default: "SSE") */
  label?: string;
}

/**
 * Shared hook for authenticated SSE connections with automatic reconnection.
 *
 * Handles the fetchSseTicket → EventSource → reconnect lifecycle that was
 * previously duplicated across DirectorApp, SentinelApp, etc.
 */
export function useSecureSse({
  path,
  onMessage,
  reconnectMs = 3000,
  label = "SSE",
}: UseSecureSseOptions): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const esRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let destroyed = false;

    const connect = async (): Promise<void> => {
      if (destroyed) return;

      const ticketQs = await fetchSseTicket(path);
      if (destroyed) return;

      const url = `${API_BASE}${path}${ticketQs}`;
      console.log(`[${label}] SSE connecting:`, url.replace(/ticket=[^&]+/, "ticket=***"));

      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        console.log(`[${label}] SSE connected`);
        setConnected(true);
      };

      es.onmessage = (ev) => {
        onMessageRef.current(ev);
      };

      es.onerror = () => {
        console.warn(`[${label}] SSE error — will reconnect`);
        setConnected(false);
        es.close();
        esRef.current = null;

        if (!destroyed) {
          reconnectTimerRef.current = setTimeout(
            () => void connect().catch((err) => console.error(`[${label}] SSE reconnect failed:`, err)),
            reconnectMs,
          );
        }
      };
    };

    void connect().catch((err) => console.error(`[${label}] SSE connect failed:`, err));

    return () => {
      destroyed = true;
      esRef.current?.close();
      esRef.current = null;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [path, reconnectMs, label]);

  return { connected };
}
