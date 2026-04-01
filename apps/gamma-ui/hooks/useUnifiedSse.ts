import { useEffect, useRef, useSyncExternalStore } from "react";
import { UnifiedSseManager, type UnifiedSseCallback } from "../lib/unified-sse";

/**
 * React hook for subscribing to a unified SSE channel.
 *
 * Replaces individual useSecureSse / EventSource connections with a single
 * multiplexed connection via UnifiedSseManager.
 *
 * @param channel - Channel name: 'broadcast', 'activity', 'window:<windowId>'
 * @param onMessage - Callback for incoming events (stable ref not required)
 * @param options.enabled - When false, does not subscribe (default: true)
 */
export function useUnifiedSse(
  channel: string,
  onMessage: UnifiedSseCallback,
  options?: { enabled?: boolean },
): { connected: boolean } {
  const enabled = options?.enabled ?? true;
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!enabled || !channel) return;

    const unsub = UnifiedSseManager.instance.subscribe(channel, (event) => {
      onMessageRef.current(event);
    });

    return unsub;
  }, [channel, enabled]);

  // Subscribe to connected state via useSyncExternalStore for tear-free reads
  const connected = useSyncExternalStore(
    (cb) => UnifiedSseManager.instance.onConnectedChange(cb),
    () => UnifiedSseManager.instance.connected,
  );

  return { connected };
}
