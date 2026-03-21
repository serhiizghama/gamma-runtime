import { useCallback, useEffect, useRef, useState } from "react";
import { useSecureSse } from "./useSecureSse";
import { systemAuthHeaders } from "../lib/auth";
import { API_BASE } from "../constants/api";
import type { ActivityEvent } from "@gamma/types";

const MAX_EVENTS = 200;
const BACKFILL_LIMIT = 200;

interface UseActivityStreamResult {
  events: ActivityEvent[];
  connected: boolean;
}

/**
 * Connects to the system activity stream via SSE and backfills historical
 * events via REST. Maintains a ring buffer of the last {@link MAX_EVENTS}
 * events (newest last), deduplicating SSE events that overlap with the
 * REST backfill.
 */
export function useActivityStream(): UseActivityStreamResult {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // ── REST backfill on mount ──────────────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    fetch(`${API_BASE}/api/system/activity?limit=${BACKFILL_LIMIT}`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.json() as Promise<ActivityEvent[]>;
      })
      .then((historical) => {
        const ids = new Set<string>();
        for (const ev of historical) {
          ids.add(ev.id);
        }
        seenIdsRef.current = ids;
        setEvents(historical.slice(-MAX_EVENTS));
      })
      .catch((err) => {
        if (err instanceof Error && err.name === "AbortError") return;
        console.warn("[ActivityStream] backfill failed:", err);
      });

    return () => controller.abort();
  }, []);

  // ── SSE live events ─────────────────────────────────────────────────────
  const handleMessage = useCallback((ev: MessageEvent) => {
    try {
      const event = JSON.parse(ev.data as string) as ActivityEvent;
      if (!event.id || !event.kind) return;

      // Deduplicate against backfill
      if (seenIdsRef.current.has(event.id)) return;
      seenIdsRef.current.add(event.id);

      setEvents((prev) => {
        const next = [...prev, event];
        if (next.length > MAX_EVENTS) {
          // Trim oldest events and clean up seenIds for evicted entries
          const evicted = next.slice(0, next.length - MAX_EVENTS);
          for (const e of evicted) {
            seenIdsRef.current.delete(e.id);
          }
          return next.slice(-MAX_EVENTS);
        }
        return next;
      });
    } catch {
      // Ignore malformed messages
    }
  }, []);

  const { connected } = useSecureSse({
    path: "/api/system/activity/stream",
    onMessage: handleMessage,
    reconnectMs: 3000,
    label: "ActivityStream",
  });

  return { events, connected };
}
