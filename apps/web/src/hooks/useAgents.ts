import { useEffect, useState } from 'react';
import { get, ApiError } from '../api/client';
import { useStore, Agent } from '../store/useStore';

export function useAgents() {
  const { agents, setAgents, addNotification } = useStore();
  const [loading, setLoading] = useState(true);

  const fetchAgents = async () => {
    try {
      setLoading(true);
      const data = await get<Agent[]>('/agents');
      setAgents(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch agents';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgents();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { agents, loading, refetch: fetchAgents };
}
