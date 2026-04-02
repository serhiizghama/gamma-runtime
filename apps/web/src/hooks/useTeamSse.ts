import { useEffect, useRef } from 'react';

export interface SseEvent {
  id: string;
  kind: string;
  teamId?: string;
  agentId?: string;
  taskId?: string;
  content?: unknown;
  createdAt: number;
}

export function useTeamSse(teamId: string | undefined, onEvent: (event: SseEvent) => void) {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    if (!teamId) return;

    const source = new EventSource(`/api/teams/${teamId}/stream`);

    source.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as SseEvent;
        callbackRef.current(data);
      } catch {
        // ignore non-JSON messages (heartbeats etc.)
      }
    };

    source.onerror = () => {
      // EventSource auto-reconnects
    };

    return () => source.close();
  }, [teamId]);
}
