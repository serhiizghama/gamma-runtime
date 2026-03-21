import { useState, useEffect, useCallback, useRef } from 'react';
import type { TaskRecord } from '@gamma/types';
import { API_BASE } from '../constants/api';
import { systemAuthHeaders } from '../lib/auth';

const DONE_PAGE_SIZE = 20;
const ACTIVE_STATUSES = ['backlog', 'pending', 'in_progress', 'review'];
const DONE_STATUSES = ['done', 'failed'];

interface KanbanTasksState {
  tasks: TaskRecord[];
  loading: boolean;
  hasMoreDone: boolean;
  loadMoreDone: () => void;
  refresh: () => void;
}

export function useKanbanTasks(
  teamId: string | null,
  projectId: string | null,
): KanbanTasksState {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [doneOffset, setDoneOffset] = useState(0);
  const [hasMoreDone, setHasMoreDone] = useState(false);
  const mountedRef = useRef(true);

  /** Build the fetch URL for a given status filter. */
  const buildUrl = useCallback(
    (status: string, limit?: number, offset?: number): string | null => {
      if (teamId) {
        const params = new URLSearchParams({ status });
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));
        return `${API_BASE}/api/teams/${teamId}/backlog?${params}`;
      }
      if (projectId) {
        const params = new URLSearchParams({ status });
        if (limit !== undefined) params.set('limit', String(limit));
        if (offset !== undefined) params.set('offset', String(offset));
        return `${API_BASE}/api/projects/${projectId}/tasks?${params}`;
      }
      return null;
    },
    [teamId, projectId],
  );

  const fetchAll = useCallback(() => {
    if (!teamId && !projectId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setDoneOffset(0);

    const headers = systemAuthHeaders();
    const controller = new AbortController();

    // Fetch active statuses (all at once, no pagination)
    const activePromises = ACTIVE_STATUSES.map(status => {
      const url = buildUrl(status);
      if (!url) return Promise.resolve([]);
      return fetch(url, { headers, signal: controller.signal })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<TaskRecord[]>;
        });
    });

    // Fetch done/failed with pagination
    const donePromises = DONE_STATUSES.map(status => {
      const url = buildUrl(status, DONE_PAGE_SIZE, 0);
      if (!url) return Promise.resolve([]);
      return fetch(url, { headers, signal: controller.signal })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<TaskRecord[]>;
        });
    });

    Promise.all([...activePromises, ...donePromises])
      .then(results => {
        if (!mountedRef.current) return;
        const allTasks = results.flat();
        setTasks(allTasks);

        // Check if there might be more done tasks
        const doneResults = results.slice(ACTIVE_STATUSES.length);
        const totalDone = doneResults.reduce((sum, r) => sum + r.length, 0);
        setHasMoreDone(totalDone >= DONE_PAGE_SIZE);
        setDoneOffset(DONE_PAGE_SIZE);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        if (mountedRef.current) {
          console.warn('[useKanbanTasks] fetch failed:', err);
        }
      })
      .finally(() => {
        if (mountedRef.current) setLoading(false);
      });

    return () => controller.abort();
  }, [teamId, projectId, buildUrl]);

  const loadMoreDone = useCallback(() => {
    if (!teamId && !projectId) return;

    const headers = systemAuthHeaders();

    const promises = DONE_STATUSES.map(status => {
      const url = buildUrl(status, DONE_PAGE_SIZE, doneOffset);
      if (!url) return Promise.resolve([]);
      return fetch(url, { headers })
        .then(res => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.json() as Promise<TaskRecord[]>;
        });
    });

    Promise.all(promises)
      .then(results => {
        if (!mountedRef.current) return;
        const newTasks = results.flat();
        setTasks(prev => [...prev, ...newTasks]);

        const totalNew = newTasks.length;
        setHasMoreDone(totalNew >= DONE_PAGE_SIZE);
        setDoneOffset(prev => prev + DONE_PAGE_SIZE);
      })
      .catch(err => {
        if (mountedRef.current) {
          console.warn('[useKanbanTasks] loadMoreDone failed:', err);
        }
      });
  }, [teamId, projectId, doneOffset, buildUrl]);

  useEffect(() => {
    mountedRef.current = true;
    const cleanup = fetchAll();
    return () => {
      mountedRef.current = false;
      cleanup?.();
    };
  }, [fetchAll]);

  return { tasks, loading, hasMoreDone, loadMoreDone, refresh: fetchAll };
}
