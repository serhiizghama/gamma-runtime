import type { Agent } from '../store/useStore';

function contextColor(tokens: number, window: number): string {
  if (window === 0) return 'bg-gray-600';
  const pct = (tokens / window) * 100;
  if (pct > 95) return 'bg-red-500';
  if (pct > 80) return 'bg-orange-500';
  if (pct > 50) return 'bg-yellow-500';
  return 'bg-green-500';
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
  const pct = agent.context_window > 0
    ? Math.round((agent.context_tokens / agent.context_window) * 100)
    : 0;

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
        <div className="mt-1 flex items-center gap-2">
          <div className="h-1 flex-1 rounded-full bg-gray-700">
            <div
              className={`h-1 rounded-full ${contextColor(agent.context_tokens, agent.context_window)}`}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] text-gray-500">{pct}%</span>
        </div>
      </div>
    </button>
  );
}
