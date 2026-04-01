import { useState, useEffect, useRef, useCallback } from "react";
import type { SessionRecord, GammaSSEEvent } from "@gamma/types";
import { API_BASE } from "../constants/api";
import { systemAuthHeaders } from "../lib/auth";
import { useUnifiedSse } from "./useUnifiedSse";

export interface SessionRegistryState {
  records: SessionRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the active session registry from the kernel and keeps it live via
 * the unified SSE agent-monitor channel (session_registry_update events).
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

  const handleEvent = useCallback(
    (data: Record<string, unknown>) => {
      if (!mountedRef.current) return;
      const event = data as unknown as GammaSSEEvent;
      if (event.type === "session_registry_update") {
        setRecords(event.records);
        setLoading(false);
      }
    },
    [],
  );

  useUnifiedSse("window:agent-monitor", handleEvent);

  return { records, loading, error, refresh: () => setRefreshTick((t) => t + 1) };
}
