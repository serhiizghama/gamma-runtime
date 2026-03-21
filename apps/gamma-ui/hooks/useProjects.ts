import { useState, useEffect, useCallback, useRef } from 'react';
import type { ProjectRecord } from '@gamma/types';
import { API_BASE } from '../constants/api';
import { systemAuthHeaders } from '../lib/auth';

interface ProjectsState {
  projects: ProjectRecord[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useProjects(): ProjectsState {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchProjects = useCallback(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/projects`, { headers: systemAuthHeaders() })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: ProjectRecord[]) => {
        if (mountedRef.current) {
          setProjects(data);
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
    fetchProjects();
    return () => { mountedRef.current = false; };
  }, [fetchProjects]);

  return { projects, loading, error, refresh: fetchProjects };
}
