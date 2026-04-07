import { useState } from 'react';
import { post } from '../api/client';
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

const kindGlows: Record<string, string> = {
  backend: 'hover:shadow-[0_4px_12px_rgba(168,85,247,0.15)]',
  frontend: 'hover:shadow-[0_4px_12px_rgba(6,182,212,0.15)]',
  qa: 'hover:shadow-[0_4px_12px_rgba(234,179,8,0.12)]',
  design: 'hover:shadow-[0_4px_12px_rgba(236,72,153,0.15)]',
  devops: 'hover:shadow-[0_4px_12px_rgba(249,115,22,0.15)]',
  generic: 'hover:shadow-[0_4px_12px_rgba(255,255,255,0.05)]',
};

interface Props {
  task: Task;
  agents: Agent[];
  teamId: string;
  onClick: () => void;
}

export function TaskCard({ task, agents, teamId, onClick }: Props) {
  const assigned = task.assignedTo ? agents.find((a) => a.id === task.assignedTo) : null;
  const creator = task.createdBy ? agents.find((a) => a.id === task.createdBy) : null;
  const isFailed = task.stage === 'failed';
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRetrying(true);
    try {
      await post(`/teams/${teamId}/tasks`, {
        title: task.title,
        description: task.description,
        kind: task.kind,
      });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <button
      onClick={onClick}
      className={`w-full card-hover rounded-lg border p-3 text-left transition-colors ${
        isFailed
          ? 'border-red-800/50 bg-red-900/20 hover:border-red-700/50 hover:bg-red-900/30 hover:shadow-[0_4px_12px_rgba(239,68,68,0.12)]'
          : `border-gray-700 bg-gray-800/60 hover:border-gray-600 hover:bg-gray-800 ${kindGlows[task.kind] ?? kindGlows.generic}`
      }`}
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
      {isFailed && task.result?.summary && (
        <div className="mt-1.5 text-xs text-red-300/80 line-clamp-2">{task.result.summary}</div>
      )}
      {creator && (
        <div className="mt-1.5 text-[10px] text-gray-600 truncate">
          by {creator.avatar_emoji} {creator.name}
        </div>
      )}
      {isFailed && (
        <div
          role="button"
          tabIndex={0}
          onClick={handleRetry}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRetry(e as unknown as React.MouseEvent); }}
          className="mt-2 text-xs text-blue-400 hover:text-blue-300 cursor-pointer"
        >
          {retrying ? 'Retrying...' : 'Retry'}
        </div>
      )}
    </button>
  );
}
