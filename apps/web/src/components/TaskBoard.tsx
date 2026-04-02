import type { Task, TaskStage } from '../hooks/useTeamTasks';
import type { Agent } from '../store/useStore';
import { TaskCard } from './TaskCard';

const columns: { key: TaskStage; label: string }[] = [
  { key: 'backlog', label: 'Backlog' },
  { key: 'in_progress', label: 'In Progress' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

interface Props {
  tasks: Task[];
  agents: Agent[];
  loading: boolean;
  onTaskClick: (task: Task) => void;
}

export function TaskBoard({ tasks, agents, loading, onTaskClick }: Props) {
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Tasks</h3>

      {loading ? (
        <div className="text-sm text-gray-500">Loading tasks...</div>
      ) : (
        <div className="grid flex-1 grid-cols-4 gap-3 overflow-hidden">
          {columns.map((col) => {
            const colTasks = tasks.filter((t) => {
              if (col.key === 'backlog') return t.stage === 'backlog' || t.stage === 'planning';
              return t.stage === col.key;
            });
            return (
              <div key={col.key} className="flex flex-col overflow-hidden rounded-lg bg-gray-900/50">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-medium text-gray-400">{col.label}</span>
                  <span className="rounded-full bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-500">
                    {colTasks.length}
                  </span>
                </div>
                <div className="flex-1 space-y-2 overflow-y-auto px-2 pb-2">
                  {colTasks.map((task) => (
                    <TaskCard
                      key={task.id}
                      task={task}
                      agents={agents}
                      onClick={() => onTaskClick(task)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
