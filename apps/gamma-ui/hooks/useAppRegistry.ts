import { useEffect } from "react";
import { useGammaStore } from "../store/useGammaStore";
import { API_BASE } from "../constants/api";

/**
 * Fetches app registry on mount and subscribes to component_ready/component_removed
 * via broadcast SSE. Updates Zustand store for DynamicAppRenderer hot-reload.
 */
export function useAppRegistry(): void {
  const setAppRegistry = useGammaStore((s) => s.setAppRegistry);
  const updateAppRegistryEntry = useGammaStore((s) => s.updateAppRegistryEntry);
  const removeAppRegistryEntry = useGammaStore((s) => s.removeAppRegistryEntry);

  useEffect(() => {
    let cancelled = false;

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

    // Subscribe to broadcast SSE for component_ready / component_removed
    const es = new EventSource(`${API_BASE}/api/stream/broadcast`);

    es.onmessage = (ev) => {
      if (cancelled) return;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(ev.data);
      } catch {
        return;
      }
      const type = event.type as string;
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

    return () => {
      cancelled = true;
      es.close();
    };
  }, [setAppRegistry, updateAppRegistryEntry, removeAppRegistryEntry]);
}
