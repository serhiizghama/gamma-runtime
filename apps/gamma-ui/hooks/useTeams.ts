import { useState, useEffect, useCallback, useRef } from 'react';
import type { TeamRecord } from '@gamma/types';
import { API_BASE } from '../constants/api';
import { systemAuthHeaders } from '../lib/auth';

interface TeamsState {
  teams: TeamRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useTeams(): TeamsState {
  const [teams, setTeams] = useState<TeamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchTeams = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/teams`, { headers: systemAuthHeaders() })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: TeamRecord[]) => {
        if (mountedRef.current) {
          setTeams(data);
          setError(null);
        }
      })
      .catch(err => {
        if (mountedRef.current) setError(err.message);
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchTeams();
    return () => { mountedRef.current = false; };
  }, [fetchTeams]);

  return { teams, loading, error, refresh: fetchTeams };
}
