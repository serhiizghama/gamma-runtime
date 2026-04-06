import type { Agent } from '../store/useStore';
import { AgentNode } from './AgentNode';

interface Props {
  leader: Agent | undefined;
  members: Agent[];
  onAgentClick?: (agent: Agent) => void;
  onResetSession?: (agent: Agent) => void;
}

export function TeamMap({ leader, members, onAgentClick, onResetSession }: Props) {
  return (
    <div className="flex h-full flex-col">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-gray-500">Team Map</h3>

      {leader && (
        <div className="mb-2">
          <AgentNode agent={leader} onClick={() => onAgentClick?.(leader)} onResetSession={onResetSession} />
        </div>
      )}

      {members.length > 0 && leader && (
        <div className="ml-4 border-l border-gray-700 pl-3 space-y-2">
          {members.map((agent) => (
            <AgentNode key={agent.id} agent={agent} onClick={() => onAgentClick?.(agent)} onResetSession={onResetSession} />
          ))}
        </div>
      )}

      {!leader && members.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-gray-600">
          No agents yet
        </div>
      )}
    </div>
  );
}
