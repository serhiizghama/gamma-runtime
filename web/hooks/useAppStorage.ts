import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE } from "../constants/api";

/**
 * useAppStorage — persist per-app key-value data via the kernel App Data API.
 *
 * On mount: fetches the stored value from `GET /api/app-data/:appId/:key`.
 * On change: debounces a `PUT` request by 500ms.
 *
 * @returns [value, setValue, { loading, error }]
 */
export function useAppStorage<T>(
  appId: string,
  key: string,
  initial: T,
): [T, (v: T | ((prev: T) => T)) => void, { loading: boolean; error: string | null }] {
  const [value, setValueInternal] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  // Fetch on mount
  useEffect(() => {
    mountedRef.current = true;

    const fetchData = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/app-data/${appId}/${key}`);
        if (!res.ok) {
          throw new Error(`GET failed: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        if (mountedRef.current) {
          if (data.value !== null && data.value !== undefined) {
            setValueInternal(data.value as T);
          }
          setError(null);
          setLoading(false);
        }
      } catch (err) {
        if (mountedRef.current) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      mountedRef.current = false;
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [appId, key]);

  // Debounced PUT
  const persist = useCallback(
    (newValue: T) => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const res = await fetch(`${API_BASE}/api/app-data/${appId}/${key}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ value: newValue }),
          });
          if (!res.ok) {
            throw new Error(`PUT failed: ${res.status} ${res.statusText}`);
          }
          if (mountedRef.current) {
            setError(null);
          }
        } catch (err) {
          if (mountedRef.current) {
            setError(err instanceof Error ? err.message : String(err));
          }
        }
      }, 500);
    },
    [appId, key],
  );

  // Public setter — updates state immediately, debounces persistence
  const setValue = useCallback(
    (v: T | ((prev: T) => T)) => {
      setValueInternal((prev) => {
        const next = typeof v === "function" ? (v as (prev: T) => T)(prev) : v;
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return [value, setValue, { loading, error }];
}
