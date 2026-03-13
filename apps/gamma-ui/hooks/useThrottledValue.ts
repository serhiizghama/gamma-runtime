import { useEffect, useRef, useState } from "react";

/**
 * Throttle a rapidly changing value so that consumers (e.g. ReactMarkdown)
 * see updates at most once per `delayMs`.
 *
 * - During an active stream, updates are emitted at a fixed cadence.
 * - When `flushSignal` changes (e.g. lifecycle_end / status change),
 *   the latest value is flushed immediately and any pending timers cleared.
 * - All timers are cleaned up on unmount to avoid leaks.
 */
export function useThrottledValue<T>(
  value: T,
  delayMs: number,
  flushSignal?: unknown,
): T {
  const [throttled, setThrottled] = useState<T>(value);

  const lastValueRef = useRef<T>(value);
  const timeoutIdRef = useRef<number | null>(null);

  // Always keep the latest value in a ref so we can flush instantly.
  useEffect(() => {
    lastValueRef.current = value;
  }, [value]);

  // Schedule throttled updates while the value is changing.
  useEffect(() => {
    // Clear any existing timer before scheduling a new one.
    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }

    timeoutIdRef.current = window.setTimeout(() => {
      setThrottled(lastValueRef.current);
      timeoutIdRef.current = null;
    }, delayMs);

    return () => {
      if (timeoutIdRef.current !== null) {
        window.clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    };
  }, [value, delayMs]);

  // Force-flush on lifecycle end / status change.
  useEffect(() => {
    if (flushSignal === undefined) return;

    if (timeoutIdRef.current !== null) {
      window.clearTimeout(timeoutIdRef.current);
      timeoutIdRef.current = null;
    }
    setThrottled(lastValueRef.current);
  }, [flushSignal]);

  // Cleanup on unmount to avoid any dangling timers.
  useEffect(
    () => () => {
      if (timeoutIdRef.current !== null) {
        window.clearTimeout(timeoutIdRef.current);
        timeoutIdRef.current = null;
      }
    },
    [],
  );

  return throttled;
}

