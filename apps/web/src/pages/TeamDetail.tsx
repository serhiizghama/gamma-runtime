import { useState, useCallback, useRef, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTeamDetail } from '../hooks/useTeamDetail';
import { useTeamTasks, type Task } from '../hooks/useTeamTasks';
import { useTeamChat } from '../hooks/useTeamChat';
import { useTeamSse, type SseEvent } from '../hooks/useTeamSse';
import { useAgentActivities } from '../hooks/useAgentActivities';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { del, patch, post } from '../api/client';
import { useStore } from '../store/useStore';
import { TeamMap } from '../components/TeamMap';
import { ChatPanel } from '../components/ChatPanel';
import { TaskBoard } from '../components/TaskBoard';
import { TaskDetailModal } from '../components/TaskDetailModal';
import { AppViewer } from '../components/AppViewer';
import { AddAgentModal } from '../components/AddAgentModal';
import { AgentDetailPanel } from '../components/AgentDetailPanel';
import { ResizeHandle } from '../components/ResizeHandle';
import type { Agent } from '../store/useStore';

type Tab = 'tasks' | 'app';

export function TeamDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addNotification = useStore((s) => s.addNotification);
  const { team, loading, refetch, updateMember, updateTeam } = useTeamDetail(id);
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTeamTasks(id);
  const { messages, loading: chatLoading, sending, hasMore, loadingMore, sendMessage, appendMessage, loadMore, refetch: refetchChat } = useTeamChat(id);
  const { activities, handleEvent: handleActivityEvent, seedPlaceholder, reset: resetActivities } = useAgentActivities();

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(400);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [renaming, setRenaming] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingName && nameInputRef.current) {
      nameInputRef.current.focus();
      nameInputRef.current.select();
    }
  }, [editingName]);

  // Reset activities when switching teams
  useEffect(() => {
    resetActivities();
  }, [id, resetActivities]);

  // Seed placeholder activities for agents that were already running when the page mounted
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || !team) return;
    seededRef.current = true;
    for (const m of team.members) {
      if (m.status === 'running') seedPlaceholder(m.id);
    }
  }, [team, seedPlaceholder]);
  useEffect(() => {
    seededRef.current = false;
  }, [id]);

  // Handle SSE events
  const handleSseEvent = useCallback(
    (event: SseEvent) => {
      // Forward activity-relevant events to the live indicator
      handleActivityEvent(event);

      switch (event.kind) {
        case 'agent.started':
        case 'agent.error':
          if (event.agentId) {
            const statusMap: Record<string, string> = {
              'agent.started': 'running',
              'agent.error': 'error',
            };
            updateMember(event.agentId, { status: statusMap[event.kind] as 'running' | 'error' });
          }
          break;

        case 'agent.completed':
          if (event.agentId) {
            updateMember(event.agentId, { status: 'idle' as const });
          }
          // Note: we intentionally do NOT refetchChat() here — assistant
          // messages already arrive via team.message SSE during the run,
          // and a full refetch replaces the array (losing scroll position
          // and paginated history).
          refetchTasks();
          break;

        case 'task.created':
        case 'task.assigned':
        case 'task.stage_changed':
        case 'task.completed':
          refetchTasks();
          break;

        case 'team.message': {
          const msg = event.content as { id: string; team_id: string; role: 'user' | 'assistant' | 'system'; agent_id: string | null; content: string; created_at: number } | undefined;
          if (msg) appendMessage(msg);
          break;
        }

        case 'system.emergency_stop':
          // All agents were killed — refresh everything
          refetch();
          refetchTasks();
          refetchChat();
          break;
      }
    },
    [updateMember, appendMessage, refetch, refetchChat, refetchTasks, handleActivityEvent],
  );

  useTeamSse(id, handleSseEvent);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <Spinner />
        Loading...
      </div>
    );
  }

  if (!team) {
    return (
      <div className="text-gray-400">
        Team not found.{' '}
        <Link to="/" className="text-blue-400 hover:underline">Back to Dashboard</Link>
      </div>
    );
  }

  const leader = team.members.find((m) => m.is_leader);
  const members = team.members.filter((m) => !m.is_leader);

  const commitRename = async () => {
    if (!team) return;
    const next = nameDraft.trim();
    if (!next || next === team.name) {
      setEditingName(false);
      return;
    }
    setRenaming(true);
    try {
      const updated = await patch<typeof team>(`/teams/${team.id}`, { name: next });
      updateTeam({ name: updated.name, updated_at: updated.updated_at });
      addNotification({ type: 'success', message: 'Team renamed' });
      setEditingName(false);
    } catch (err) {
      addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Rename failed' });
    } finally {
      setRenaming(false);
    }
  };

  const handleResetSession = async (agent: Agent) => {
    try {
      await post(`/agents/${agent.id}/reset-session`, {});
      addNotification({ type: 'success', message: `Session reset for ${agent.name}` });
      refetch();
    } catch (err) {
      addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Reset failed' });
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-gray-500 transition-colors hover:text-gray-300">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          {editingName ? (
            <input
              ref={nameInputRef}
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                else if (e.key === 'Escape') {
                  setNameDraft(team.name);
                  setEditingName(false);
                }
              }}
              disabled={renaming}
              maxLength={120}
              className="rounded-md border border-gray-700 bg-gray-800 px-2 py-0.5 text-xl font-bold text-white outline-none focus:border-blue-500 disabled:opacity-60"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setNameDraft(team.name);
                setEditingName(true);
              }}
              title="Click to rename"
              className="group flex items-center gap-1.5 rounded-md px-1 text-xl font-bold text-white hover:bg-gray-800/60"
            >
              <span>{team.name}</span>
              <svg className="h-3.5 w-3.5 text-gray-500 opacity-0 transition-opacity group-hover:opacity-100" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 11l6.586-6.586a2 2 0 112.828 2.828L11.828 13.828a2 2 0 01-.879.515l-3.535.884.884-3.535a2 2 0 01.515-.879z" />
              </svg>
            </button>
          )}
          <StatusBadge status={team.status} />
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAddAgent(true)}
            className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Add Agent
          </button>
          <button
            onClick={async () => {
              try {
                await post('/emergency-stop', {});
                addNotification({ type: 'success', message: 'All agents stopped' });
              } catch (err) {
                addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Emergency stop failed' });
              }
            }}
            className="rounded-lg bg-red-600/20 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-600/30"
          >
            Emergency Stop
          </button>
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-red-900/30 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-900/50"
          >
            Delete Team
          </button>
        </div>
      </div>

      {/* Three-panel layout */}
      <div ref={containerRef} className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: Team Map */}
        <div
          className="shrink-0 overflow-y-auto rounded-xl border border-gray-800 border-t-white/[0.03] bg-gray-900/50 p-4"
          style={{ width: leftWidth, boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.03)' }}
        >
          <TeamMap leader={leader} members={members} onAgentClick={(agent) => setSelectedAgent((prev) => prev?.id === agent.id ? null : agent)} onResetSession={handleResetSession} />
        </div>

        <ResizeHandle
          onResize={(delta) =>
            setLeftWidth((w) => Math.max(200, Math.min(500, w + delta)))
          }
        />

        {/* Center: Chat */}
        <div className="flex min-w-[250px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 border-t-white/[0.03] bg-gray-900/50 p-4" style={{ boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.03)' }}>
          <ChatPanel
            messages={messages}
            loading={chatLoading}
            sending={sending}
            members={team.members}
            hasMore={hasMore}
            loadingMore={loadingMore}
            activities={activities}
            onSend={sendMessage}
            onLoadMore={loadMore}
          />
        </div>

        <ResizeHandle
          onResize={(delta) =>
            setRightWidth((w) => Math.max(250, Math.min(700, w - delta)))
          }
        />

        {/* Right: Tasks / App tabs */}
        <div
          className="shrink-0 flex flex-col overflow-hidden rounded-xl border border-gray-800 border-t-white/[0.03] bg-gray-900/50 p-4"
          style={{ width: rightWidth, boxShadow: 'inset 0 1px 0 0 rgba(255,255,255,0.03)' }}
        >
          <div className="mb-3 flex gap-1">
            <button
              onClick={() => setActiveTab('tasks')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'tasks'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              Tasks
            </button>
            <button
              onClick={() => setActiveTab('app')}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                activeTab === 'app'
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              View App
            </button>
          </div>

          <div className="flex-1 overflow-hidden">
            {activeTab === 'tasks' ? (
              <TaskBoard
                tasks={tasks}
                agents={team.members}
                loading={tasksLoading}
                teamId={team.id}
                onTaskClick={setSelectedTask}
              />
            ) : (
              <AppViewer teamId={team.id} />
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      <TaskDetailModal
        task={selectedTask}
        agents={team.members}
        onClose={() => setSelectedTask(null)}
      />
      <AddAgentModal
        open={showAddAgent}
        teamId={team.id}
        onClose={() => setShowAddAgent(false)}
        onCreated={() => refetch()}
      />
      {selectedAgent && (
        <AgentDetailPanel
          agent={selectedAgent}
          onClose={() => setSelectedAgent(null)}
          onAgentUpdate={refetch}
        />
      )}

      {/* Delete Team Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">Delete {team.name}?</h3>
            <ul className="mt-3 space-y-1 text-sm text-gray-400">
              <li>Kill all running agents</li>
              <li>Archive all agents in the team</li>
              <li>Fail all pending tasks</li>
              <li>Archive the team</li>
            </ul>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg bg-gray-800 px-4 py-2 text-sm text-gray-300 hover:bg-gray-700"
              >
                Cancel
              </button>
              <button
                disabled={deleting}
                onClick={async () => {
                  setDeleting(true);
                  try {
                    await del(`/teams/${team.id}`);
                    addNotification({ type: 'success', message: `${team.name} deleted` });
                    navigate('/');
                  } catch (err) {
                    addNotification({ type: 'error', message: err instanceof Error ? err.message : 'Delete failed' });
                  } finally {
                    setDeleting(false);
                    setShowDeleteConfirm(false);
                  }
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50"
              >
                {deleting ? 'Deleting...' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
