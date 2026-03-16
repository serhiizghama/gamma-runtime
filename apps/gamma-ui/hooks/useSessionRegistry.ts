import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionRecord, GammaSSEEvent } from "@gamma/types";
import { API_BASE } from "../constants/api";
import { systemAuthHeaders } from "../lib/auth";
import { useSecureSse } from "./useSecureSse";

export interface SessionRegistryState {
  records: SessionRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the active session registry from the kernel and keeps it live via
 * the SSE broadcast stream (session_registry_update events).
 *
 * Uses a module-level singleton EventSource so that multiple components
 * (Sentinel, AgentMonitor) share ONE connection instead of opening N.
 */
export function useSessionRegistry(): SessionRegistryState {
  const [records, setRecords] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const mountedRef = useRef(true);

  // Initial REST fetch (re-runs on manual refresh)
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
  }, [refreshTick]);

  const handleMessage = useCallback(
    (ev: MessageEvent) => {
      if (!mountedRef.current) return;
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
    },
    [],
  );

  useSecureSse({
    path: "/api/stream/agent-monitor",
    onMessage: handleMessage,
    reconnectMs: 4000,
    label: "SessionRegistry",
  });

  return { records, loading, error, refresh: () => setRefreshTick((t) => t + 1) };
}
