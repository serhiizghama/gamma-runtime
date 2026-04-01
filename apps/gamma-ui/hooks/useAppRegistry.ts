import { useEffect } from "react";
import { useGammaStore } from "../store/useGammaStore";
import { API_BASE } from "../constants/api";
import { fetchSseTicket } from "../lib/auth";

/**
 * Fetches app registry on mount and subscribes to component_ready/component_removed
 * via broadcast SSE. Updates Zustand store for DynamicAppRenderer hot-reload.
 *
 * Uses fetchSseTicket for authenticated SSE + exponential backoff on errors
 * to prevent the reconnect flood caused by invalid/expired tickets.
 */
export function useAppRegistry(): void {
  const setAppRegistry = useGammaStore((s) => s.setAppRegistry);
  const updateAppRegistryEntry = useGammaStore((s) => s.updateAppRegistryEntry);
  const removeAppRegistryEntry = useGammaStore((s) => s.removeAppRegistryEntry);

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoffMs = 2000;
    const MAX_BACKOFF_MS = 30_000;

    const fetchRegistry = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/scaffold/registry`);
        if (!res.ok || cancelled) return;
        const registry = (await res.json()) as Record<string, import("@gamma/types").AppRegistryEntry>;
        if (!cancelled) setAppRegistry(registry);
      } catch {
        /* Kernel may not be running */
      }
    };

    fetchRegistry();

    // Subscribe to broadcast SSE for component_ready / component_removed.
    // Fetches a fresh SSE ticket before each connect to avoid 'invalid or expired
    // ticket' rejections. Uses exponential backoff so a broken broadcast stream
    // doesn't flood the server with reconnects.
    const connect = async (): Promise<void> => {
      if (cancelled) return;

      const ticketQs = await fetchSseTicket("/api/stream/broadcast");
      if (cancelled) return;

      const url = `${API_BASE}/api/stream/broadcast${ticketQs}`;
      es = new EventSource(url);

      es.onopen = () => {
        // Reset backoff on successful connection.
        backoffMs = 2000;
      };

      es.onmessage = (ev) => {
        if (cancelled) return;
        let event: Record<string, unknown>;
        try {
          event = JSON.parse(ev.data);
        } catch {
          return;
        }
        const type = event.type as string;

        // Ticket expired mid-stream — close and reconnect with a fresh ticket.
        if (type === "error" && (event.message as string)?.includes("invalid or expired ticket")) {
          console.warn("[useAppRegistry] SSE ticket expired — reconnecting with fresh ticket");
          es?.close();
          es = null;
          scheduleReconnect();
          return;
        }

        if (type === "component_ready") {
          const appId = event.appId as string;
          const updatedAt = event.updatedAt as number | undefined;
          if (appId) {
            updateAppRegistryEntry(appId, { updatedAt: updatedAt ?? Date.now() });
            // If we don't have the entry yet, refetch full registry
            const current = useGammaStore.getState().appRegistry[appId];
            if (!current) fetchRegistry();
          }
        } else if (type === "component_removed") {
          const appId = event.appId as string;
          if (appId) removeAppRegistryEntry(appId);
        }
      };

      es.onerror = () => {
        if (cancelled) return;
        console.warn(`[useAppRegistry] SSE error — reconnecting in ${backoffMs}ms`);
        es?.close();
        es = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectTimer = setTimeout(() => {
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        void connect().catch((err) => console.error("[useAppRegistry] SSE connect failed:", err));
      }, backoffMs);
    };

    void connect().catch((err) => console.error("[useAppRegistry] SSE connect failed:", err));

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [setAppRegistry, updateAppRegistryEntry, removeAppRegistryEntry]);
}
