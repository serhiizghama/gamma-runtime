import { useEffect, useState, useCallback } from 'react';
import { get, ApiError } from '../api/client';
import { useStore } from '../store/useStore';

export type TaskStage = 'backlog' | 'planning' | 'in_progress' | 'review' | 'done' | 'failed';
export type TaskKind = 'generic' | 'backend' | 'frontend' | 'qa' | 'design' | 'devops';

export interface TaskResult {
  summary: string;
  filesChanged: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  stage: TaskStage;
  kind: TaskKind;
  assignedTo: string | null;
  createdBy: string | null;
  priority: number;
  result: TaskResult | null;
  createdAt: number;
  updatedAt: number;
}

interface ListTasksResponse {
  success: boolean;
  tasks: Task[];
}

export function useTeamTasks(teamId: string | undefined) {
  const addNotification = useStore((s) => s.addNotification);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    if (!teamId) return;
    try {
      setLoading(true);
      const data = await get<ListTasksResponse>(`/internal/list-tasks?teamId=${teamId}`);
      setTasks(data.tasks);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Failed to fetch tasks';
      addNotification({ type: 'error', message });
    } finally {
      setLoading(false);
    }
  }, [teamId, addNotification]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => {
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...updates } : t)));
  }, []);

  const addTask = useCallback((task: Task) => {
    setTasks((prev) => {
      if (prev.find((t) => t.id === task.id)) return prev;
      return [task, ...prev];
    });
  }, []);

  return { tasks, loading, refetch: fetchTasks, updateTask, addTask };
}
