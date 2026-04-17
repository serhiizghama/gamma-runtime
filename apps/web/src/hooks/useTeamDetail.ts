import { useEffect, useState, useCallback } from 'react';
import { get, ApiError } from '../api/client';
import { useStore, type Team } from '../store/useStore';

export function useTeamDetail(teamId: string | undefined) {
  const addNotification = useStore((s) => s.addNotification);
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchTeam = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const data = await get<Team>(`/teams/${teamId}`);
      setTeam(data);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch team';
      addNotification({ type: 'error', message });
      setTeam(null);
    } finally {
      setLoading(false);
    }
  }, [teamId, addNotification]);

  useEffect(() => {
    fetchTeam();
  }, [fetchTeam]);

  const updateMember = useCallback(
    (agentId: string, updates: Partial<Team['members'][number]>) => {
      setTeam((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          members: prev.members.map((m) => (m.id === agentId ? { ...m, ...updates } : m)),
        };
      });
    },
    [],
  );

  const updateTeam = useCallback((updates: Partial<Team>) => {
    setTeam((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  return { team, loading, refetch: fetchTeam, updateMember, updateTeam };
}
