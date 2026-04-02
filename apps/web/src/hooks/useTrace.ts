import { useEffect, useState, useCallback } from 'react';
import { get, ApiError } from '../api/client';
import { useStore } from '../store/useStore';

export interface TraceEvent {
  id: string;
  agent_id: string;
  team_id: string | null;
  task_id: string | null;
  kind: string;
  content: string | null;
  created_at: number;
}

interface Filters {
  teamId?: string;
  agentId?: string;
  kind?: string;
  limit?: number;
}

export function useTrace(filters: Filters) {
  const addNotification = useStore((s) => s.addNotification);
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (filters.teamId) params.set('teamId', filters.teamId);
      if (filters.agentId) params.set('agentId', filters.agentId);
      if (filters.kind) params.set('kind', filters.kind);
      if (filters.limit) params.set('limit', String(filters.limit));
      const qs = params.toString();
      const data = await get<TraceEvent[]>(`/trace${qs ? `?${qs}` : ''}`);
      setEvents(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch trace';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [filters.teamId, filters.agentId, filters.kind, filters.limit, addNotification]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const prepend = useCallback((event: TraceEvent) => {
    setEvents((prev) => {
      if (prev.find((e) => e.id === event.id)) return prev;
      return [event, ...prev];
    });
  }, []);

  return { events, loading, refetch: fetchEvents, prepend };
}
