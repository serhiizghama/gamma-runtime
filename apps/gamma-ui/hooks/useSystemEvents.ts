import { useEffect } from "react";

/**
 * useSystemEvents — mock SSE hook.
 * In production this will open an EventSource to /api/events (Redis Streams via SSE).
 * For now it fires a fake notification every 15 seconds.
 */
export function useSystemEvents(): void {
  useEffect(() => {
    // Mock SSE disabled — will be replaced with real EventSource in Phase 2.
    // Uncomment the block below to re-enable fake notifications for testing.
    /*
    Example wiring for real SSE:
    const es = new EventSource("/api/events");
    es.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      useGammaStore.getState().pushNotification(payload);
    };
    return () => es.close();
    */
  }, []);
}
