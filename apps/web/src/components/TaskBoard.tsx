import type { Task, TaskStage } from '../hooks/useTeamTasks';
import type { Agent } from '../store/useStore';
import { TaskCard } from './TaskCard';
import { Spinner } from './Spinner';

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
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Spinner className="h-4 w-4" />
          Loading tasks...
        </div>
      ) : tasks.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <svg className="h-10 w-10 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25Z" />
          </svg>
          <p className="text-sm text-gray-500">No tasks yet</p>
          <p className="text-xs text-gray-600">Tasks will appear here when the team starts working</p>
        </div>
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
