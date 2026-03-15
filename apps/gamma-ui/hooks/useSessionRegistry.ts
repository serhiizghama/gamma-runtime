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
  refresh: () => void;
}

export function systemAuthHeaders(): Record<string, string> {
  return { "X-Gamma-System-Token": SYSTEM_TOKEN };
}

// ── Singleton EventSource ────────────────────────────────────────────────────
// Sentinel and AgentMonitor both use this hook — we share ONE SSE connection
// instead of opening a new one per component, saving a precious HTTP/1.1 slot.
type SseListener = (event: GammaSSEEvent) => void;
let sharedEs: EventSource | null = null;
let esRefCount = 0;
const esListeners = new Set<SseListener>();

function addSseListener(fn: SseListener): () => void {
  if (esListeners.size === 0 || !sharedEs || sharedEs.readyState === EventSource.CLOSED) {
    sharedEs?.close();
    sharedEs = new EventSource(`${API_BASE}/api/stream/agent-monitor`);
    sharedEs.onmessage = (ev) => {
      let event: GammaSSEEvent;
      try {
        event = JSON.parse(ev.data as string) as GammaSSEEvent;
      } catch {
        return;
      }
      esListeners.forEach((l) => l(event));
    };
  }
  esRefCount++;
  esListeners.add(fn);

  return () => {
    esListeners.delete(fn);
    esRefCount--;
    if (esRefCount <= 0 && sharedEs) {
      sharedEs.close();
      sharedEs = null;
      esRefCount = 0;
    }
  };
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

  // Live updates via shared singleton SSE connection
  useEffect(() => {
    const unsubscribe = addSseListener((event) => {
      if (!mountedRef.current) return;
      if (event.type === "session_registry_update") {
        setRecords(event.records);
        setLoading(false);
      }
    });
    return unsubscribe;
  }, []);

  return { records, loading, error, refresh: () => setRefreshTick((t) => t + 1) };
}
