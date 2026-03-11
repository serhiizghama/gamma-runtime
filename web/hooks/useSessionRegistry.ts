import { useState, useEffect, useRef } from "react";
import type { SessionRecord, GammaSSEEvent } from "@gamma/types";
import { API_BASE } from "../constants/api";

// Set VITE_GAMMA_SYSTEM_TOKEN in web/.env.local to match the kernel's GAMMA_SYSTEM_TOKEN.
const SYSTEM_TOKEN =
  ((import.meta as unknown as { env?: Record<string, string | undefined> }).env?.["VITE_GAMMA_SYSTEM_TOKEN"]) ?? "";

export interface SessionRegistryState {
  records: SessionRecord[];
  loading: boolean;
  error: string | null;
}

export function systemAuthHeaders(): Record<string, string> {
  return { "X-Gamma-System-Token": SYSTEM_TOKEN };
}

/**
 * Fetches the active session registry from the kernel and keeps it live via
 * the SSE broadcast stream (session_registry_update events).
 */
export function useSessionRegistry(): SessionRegistryState {
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Initial REST fetch
  useEffect(() => {
    mountedRef.current = true;

    fetch(`${API_BASE}/api/sessions/active`, {
      headers: systemAuthHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json() as Promise<SessionRecord[]>;
      })
      .then((data) => {
        if (mountedRef.current) {
          setRecords(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load registry");
          setLoading(false);
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Live updates via SSE broadcast — agent-monitor is a stable dummy window ID
  // that receives broadcast events (session_registry_update) without any per-window traffic.
  useEffect(() => {
    const es = new EventSource(`${API_BASE}/api/stream/agent-monitor`);

    es.onmessage = (ev) => {
      let event: GammaSSEEvent;
      try {
        event = JSON.parse(ev.data as string) as GammaSSEEvent;
      } catch {
        return;
      }

      if (event.type === "session_registry_update") {
        setRecords(event.records);
        setLoading(false);
      }
    };

    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here
    };

    return () => {
      es.close();
    };
  }, []);

  return { records, loading, error };
}
