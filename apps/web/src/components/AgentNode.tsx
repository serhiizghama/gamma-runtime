import { useState, useEffect } from 'react';
import type { Agent } from '../store/useStore';

function useElapsed(since: number | null, active: boolean): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active || !since) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active, since]);

  if (!since) return '';
  const diff = Math.max(0, Math.floor((now - since) / 1000));
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  return `${h}h ${m}m`;
}

function timeAgo(ts: number | null): string {
  if (!ts) return 'Never active';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function formatRoleName(roleId: string): string {
  const slug = roleId.split('/').pop() ?? roleId;
  return slug
    .replace(/^(engineering|design|product|testing|support|specialized|project-management|sales|marketing|academic|game-development|job-hunting|paid-media|spatial-computing)-/, '')
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

interface Props {
  agent: Agent;
  onClick?: () => void;
}

export function AgentNode({ agent, onClick }: Props) {
  const isRunning = agent.status === 'running';
  const elapsed = useElapsed(agent.last_active_at, isRunning);

  const statusClass =
    agent.status === 'running'
      ? 'agent-running border-blue-500/30'
      : agent.status === 'error'
        ? 'agent-error border-red-500/30'
        : 'border-gray-700';

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg bg-gray-800/80 px-3 py-2.5 text-left transition-colors hover:bg-gray-800 border ${statusClass}`}
    >
      <span className="shrink-0 text-xl">{agent.avatar_emoji}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-white">{agent.name}</span>
          <span
            className={`shrink-0 h-1.5 w-1.5 rounded-full ${
              agent.status === 'running'
                ? 'bg-blue-400'
                : agent.status === 'error'
                  ? 'bg-red-400'
                  : agent.status === 'idle'
                    ? 'bg-green-400'
                    : 'bg-gray-500'
            }`}
          />
        </div>
        <div className="truncate text-xs text-gray-500">{formatRoleName(agent.role_id)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px]">
          {isRunning ? (
            <>
              <span className="text-blue-400">Running</span>
              <span className="text-gray-500">{elapsed}</span>
              {agent.total_turns > 0 && (
                <span className="text-gray-600">· {agent.total_turns} turns</span>
              )}
            </>
          ) : agent.status === 'error' ? (
            <>
              <span className="text-red-400">Error</span>
              <span className="text-gray-500">{timeAgo(agent.last_active_at)}</span>
            </>
          ) : (
            <>
              <span className="text-gray-500">{timeAgo(agent.last_active_at)}</span>
              {agent.total_turns > 0 && (
                <span className="text-gray-600">· {agent.total_turns} turns</span>
              )}
            </>
          )}
        </div>
      </div>
    </button>
  );
}
