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
      className={`w-full card-hover rounded-lg border px-3 py-2 text-left transition-colors ${
        isFailed
          ? 'border-red-800/50 bg-red-900/20 hover:border-red-700/50 hover:bg-red-900/30 hover:shadow-[0_4px_12px_rgba(239,68,68,0.12)]'
          : `border-gray-700/50 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/80 ${kindGlows[task.kind] ?? kindGlows.generic}`
      }`}
    >
      <div className="text-[13px] font-medium leading-snug text-gray-200 line-clamp-2">{task.title}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none ${kindColors[task.kind] ?? kindColors.generic}`}>
          {task.kind}
        </span>
        {assigned && (
          <span className="text-xs text-gray-500" title={assigned.name}>
            {assigned.avatar_emoji} <span className="text-[10px] text-gray-600">{assigned.name}</span>
          </span>
        )}
        {isFailed && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleRetry}
            onKeyDown={(e) => { if (e.key === 'Enter') handleRetry(e as unknown as React.MouseEvent); }}
            className="ml-auto text-[10px] font-medium text-blue-400 hover:text-blue-300"
          >
            {retrying ? 'Retrying...' : 'Retry'}
          </span>
        )}
      </div>
      {isFailed && task.result?.summary && (
        <div className="mt-1 text-[11px] leading-tight text-red-300/70 line-clamp-1">{task.result.summary}</div>
      )}
    </button>
  );
}
