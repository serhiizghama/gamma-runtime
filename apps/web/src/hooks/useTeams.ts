import { useEffect, useState } from 'react';
import { get, ApiError } from '../api/client';
import { useStore, Team } from '../store/useStore';

export function useTeams() {
  const { teams, setTeams, addNotification } = useStore();
  const [loading, setLoading] = useState(true);

  const fetchTeams = async () => {
    try {
      setLoading(true);
      const data = await get<Team[]>('/teams');
      setTeams(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch teams';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTeams();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { teams, loading, refetch: fetchTeams };
}
