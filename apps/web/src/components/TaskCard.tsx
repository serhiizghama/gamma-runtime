import type { Task } from '../hooks/useTeamTasks';
import type { Agent } from '../store/useStore';

const kindColors: Record<string, string> = {
  backend: 'bg-purple-500/20 text-purple-400',
  frontend: 'bg-cyan-500/20 text-cyan-400',
  qa: 'bg-yellow-500/20 text-yellow-400',
  design: 'bg-pink-500/20 text-pink-400',
  devops: 'bg-orange-500/20 text-orange-400',
  generic: 'bg-gray-500/20 text-gray-400',
};

interface Props {
  task: Task;
  agents: Agent[];
  onClick: () => void;
}

export function TaskCard({ task, agents, onClick }: Props) {
  const assigned = task.assignedTo ? agents.find((a) => a.id === task.assignedTo) : null;
  const creator = task.createdBy ? agents.find((a) => a.id === task.createdBy) : null;

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-gray-700 bg-gray-800/60 p-3 text-left transition-colors hover:border-gray-600 hover:bg-gray-800"
    >
      <div className="mb-1.5 text-sm font-medium text-gray-200 line-clamp-2">{task.title}</div>
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${kindColors[task.kind] ?? kindColors.generic}`}>
          {task.kind}
        </span>
        {assigned && (
          <span className="text-xs text-gray-500" title={`Assigned: ${assigned.name}`}>
            {assigned.avatar_emoji}
          </span>
        )}
      </div>
      {creator && (
        <div className="mt-1.5 text-[10px] text-gray-600 truncate">
          by {creator.avatar_emoji} {creator.name}
        </div>
      )}
    </button>
  );
}
