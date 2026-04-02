import { useEffect, useRef } from 'react';
import { sse } from '../api/client';

export function useSse(path: string, onEvent: (data: unknown) => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const source = sse(path, (event) => {
      try {
        const data = JSON.parse(event.data);
        callbackRef.current(data);
      } catch {
        callbackRef.current(event.data);
      }
    });

    return () => source.close();
  }, [path]);
}
