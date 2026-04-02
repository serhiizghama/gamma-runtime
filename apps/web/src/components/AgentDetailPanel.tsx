import { useEffect, useRef, useState, useCallback } from 'react';
import type { Agent } from '../store/useStore';
import { formatRoleName } from './AgentNode';
import { StatusBadge } from './StatusBadge';
import { TraceEvent as TraceEventRow } from './TraceEvent';
import { useTrace, type TraceEvent } from '../hooks/useTrace';
import { get, post, del } from '../api/client';
import { useStore } from '../store/useStore';
import { useTeamSse, type SseEvent } from '../hooks/useTeamSse';

function contextColor(pct: number): string {
  if (pct > 95) return 'bg-red-500';
  if (pct > 80) return 'bg-orange-500';
  if (pct > 50) return 'bg-yellow-500';
  return 'bg-green-500';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

interface Props {
  agent: Agent;
  onClose: () => void;
  onAgentUpdate?: () => void;
}

export function AgentDetailPanel({ agent: initialAgent, onClose, onAgentUpdate }: Props) {
  const addNotification = useStore((s) => s.addNotification);
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const { events, prepend } = useTrace({ agentId: agent.id, limit: 50 });
  const bottomRef = useRef<HTMLDivElement>(null);
  const [resetting, setResetting] = useState(false);

  // Refresh agent data from API
  const refreshAgent = useCallback(async () => {
    try {
      const fresh = await get<Agent>(`/agents/${agent.id}`);
      setAgent(fresh);
    } catch {
      // ignore — agent may have been deleted
    }
  }, [agent.id]);

  // Fetch fresh data on open
  useEffect(() => {
    refreshAgent();
  }, [refreshAgent]);

  // Update when a new initialAgent is passed (user clicked different agent)
  useEffect(() => {
    setAgent(initialAgent);
  }, [initialAgent.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = agent.context_window > 0
    ? Math.round((Number(agent.context_tokens) / Number(agent.context_window)) * 100)
    : 0;

  // SSE for live trace updates + refresh agent stats
  const handleSseEvent = useCallback(
    (sseEvent: SseEvent) => {
      if (sseEvent.agentId !== agent.id) return;
      const traceEvent: TraceEvent = {
        id: sseEvent.id,
        agent_id: sseEvent.agentId ?? agent.id,
        team_id: sseEvent.teamId ?? null,
        task_id: sseEvent.taskId ?? null,
        kind: sseEvent.kind,
        content: sseEvent.content ? JSON.stringify(sseEvent.content) : null,
        created_at: sseEvent.createdAt,
      };
      prepend(traceEvent);

      // Refresh agent data on status-changing events
      if (['agent.started', 'agent.completed', 'agent.error'].includes(sseEvent.kind)) {
        refreshAgent();
      }
    },
    [agent.id, prepend, refreshAgent],
  );

  useTeamSse(agent.team_id ?? undefined, handleSseEvent);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  const handleReset = async () => {
    setResetting(true);
    try {
      await post(`/agents/${agent.id}/reset-session`, {});
      addNotification({ type: 'success', message: `Session reset for ${agent.name}` });
      onAgentUpdate?.();
    } catch (err) {
      addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Reset failed' });
    } finally {
      setResetting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await del(`/agents/${agent.id}`);
      addNotification({ type: 'success', message: `${agent.name} archived` });
      onAgentUpdate?.();
      onClose();
    } catch (err) {
      addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Delete failed' });
    }
  };

  // Events are returned newest-first from API; reverse for chronological display
  const chronological = [...events].reverse();

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-96 flex-col border-l border-gray-800 bg-gray-900 shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-800 p-4">
        <div className="flex items-center gap-3">
          <span className="text-3xl">{agent.avatar_emoji}</span>
          <div>
            <div className="font-semibold text-white">{agent.name}</div>
            <div className="text-xs text-gray-400">{formatRoleName(agent.role_id)}</div>
            {agent.specialization && (
              <div className="text-xs text-gray-500">{agent.specialization}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={agent.status} />
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Context Usage */}
      <div className="border-b border-gray-800 px-4 py-3">
        <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
          <span>Context</span>
          <span>{formatTokens(agent.context_tokens)} / {formatTokens(agent.context_window)} ({pct}%)</span>
        </div>
        <div className="h-2 rounded-full bg-gray-800">
          <div
            className={`h-2 rounded-full ${contextColor(pct)}`}
            style={{ width: `${Math.min(pct, 100)}%` }}
          />
        </div>
      </div>

      {/* Session Info */}
      <div className="border-b border-gray-800 px-4 py-3 text-xs text-gray-500">
        <div className="flex justify-between">
          <span>Turns</span>
          <span className="text-gray-300">{agent.total_turns}</span>
        </div>
        <div className="mt-1 flex justify-between">
          <span>Last active</span>
          <span className="text-gray-300">
            {agent.last_active_at ? new Date(Number(agent.last_active_at)).toLocaleTimeString() : 'Never'}
          </span>
        </div>
        {agent.session_id && (
          <div className="mt-1 flex items-center justify-between">
            <span>Session</span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-gray-400">{agent.session_id.slice(0, 12)}...</span>
              <button
                title="Copy: cd TEAM_WORKSPACE && claude --resume SESSION_ID"
                onClick={async () => {
                  // Agents run with cwd = team workspace (not agent workspace)
                  // workspace_path is agent-level, so derive team path from it
                  const teamPath = agent.workspace_path
                    ? agent.workspace_path.replace(/\/agents\/agent_[^/]+$/, '')
                    : '';
                  const cmd = teamPath
                    ? `cd ${teamPath} && claude --resume ${agent.session_id}`
                    : `claude --resume ${agent.session_id}`;
                  await navigator.clipboard.writeText(cmd);
                  addNotification({ type: 'success', message: 'Copied to clipboard' });
                }}
                className="rounded p-0.5 text-gray-500 transition-colors hover:bg-gray-700 hover:text-gray-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-2 border-b border-gray-800 px-4 py-3">
        <button
          onClick={handleReset}
          disabled={resetting}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-700 disabled:opacity-50"
        >
          {resetting ? 'Resetting...' : 'Reset Session'}
        </button>
        <button
          onClick={handleDelete}
          className="rounded-lg bg-red-900/30 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:bg-red-900/50"
        >
          Delete Agent
        </button>
      </div>

      {/* Trace Stream */}
      <div className="flex-1 overflow-y-auto p-3">
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">Activity</h4>
        {chronological.length === 0 ? (
          <div className="py-8 text-center text-xs text-gray-600">No activity yet</div>
        ) : (
          <div className="space-y-1.5">
            {chronological.map((ev) => (
              <TraceEventRow key={ev.id} event={ev} />
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
