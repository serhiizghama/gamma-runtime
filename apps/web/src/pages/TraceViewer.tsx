import { useState, useCallback, useEffect } from 'react';
import { useTrace, type TraceEvent } from '../hooks/useTrace';
import { TraceEvent as TraceEventRow } from '../components/TraceEvent';
import { get } from '../api/client';
import type { Team, Agent } from '../store/useStore';
import { useSse } from '../hooks/useSse';

const EVENT_KINDS = [
  'agent.started',
  'agent.thinking',
  'agent.message',
  'agent.tool_use',
  'agent.tool_result',
  'agent.completed',
  'agent.error',
  'task.created',
  'task.assigned',
  'task.stage_changed',
  'task.completed',
  'team.message',
];

export function TraceViewer() {
  const [teamId, setTeamId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [kind, setKind] = useState('');

  const [teams, setTeams] = useState<Team[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);

  useEffect(() => {
    get<Team[]>('/teams').then(setTeams).catch(() => {});
    get<Agent[]>('/agents').then(setAgents).catch(() => {});
  }, []);

  const { events, loading, prepend } = useTrace({
    teamId: teamId || undefined,
    agentId: agentId || undefined,
    kind: kind || undefined,
    limit: 200,
  });

  // Live updates via global SSE
  const handleSse = useCallback(
    (data: unknown) => {
      const ev = data as { id?: string; kind?: string; agentId?: string; teamId?: string; taskId?: string; content?: unknown; createdAt?: number };
      if (!ev.id || !ev.kind) return;

      // Apply client-side filters
      if (teamId && ev.teamId !== teamId) return;
      if (agentId && ev.agentId !== agentId) return;
      if (kind && ev.kind !== kind) return;

      const trace: TraceEvent = {
        id: ev.id,
        agent_id: ev.agentId ?? '',
        team_id: ev.teamId ?? null,
        task_id: ev.taskId ?? null,
        kind: ev.kind,
        content: ev.content ? JSON.stringify(ev.content) : null,
        created_at: ev.createdAt ?? Date.now(),
      };
      prepend(trace);
    },
    [teamId, agentId, kind, prepend],
  );

  useSse('/stream', handleSse);

  // Build agent name/emoji lookup
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  return (
    <div className="flex h-full flex-col">
      <h1 className="mb-4 text-2xl font-bold text-white">Trace Viewer</h1>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={teamId}
          onChange={(e) => setTeamId(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Teams</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>

        <select
          value={agentId}
          onChange={(e) => setAgentId(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.avatar_emoji} {a.name}</option>
          ))}
        </select>

        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">All Events</option>
          {EVENT_KINDS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      {/* Event list */}
      <div className="flex-1 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/50">
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading trace events...</div>
        ) : events.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-gray-600">
            No events match the current filters
          </div>
        ) : (
          <div className="divide-y divide-gray-800/50">
            {events.map((ev) => {
              const agent = agentMap.get(ev.agent_id);
              return (
                <TraceEventRow
                  key={ev.id}
                  event={ev}
                  agentName={agent?.name}
                  agentEmoji={agent?.avatar_emoji}
                  compact
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
