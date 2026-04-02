import { useState, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTeamDetail } from '../hooks/useTeamDetail';
import { useTeamTasks, type Task } from '../hooks/useTeamTasks';
import { useTeamChat } from '../hooks/useTeamChat';
import { useTeamSse, type SseEvent } from '../hooks/useTeamSse';
import { StatusBadge } from '../components/StatusBadge';
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
  const { team, loading, refetch, updateMember } = useTeamDetail(id);
  const { tasks, loading: tasksLoading, refetch: refetchTasks } = useTeamTasks(id);
  const { messages, loading: chatLoading, sending, sendMessage, appendMessage, refetch: refetchChat } = useTeamChat(id);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [showAddAgent, setShowAddAgent] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('tasks');
  const [leftWidth, setLeftWidth] = useState(300);
  const [rightWidth, setRightWidth] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle SSE events
  const handleSseEvent = useCallback(
    (event: SseEvent) => {
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
          refetchChat();
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
      }
    },
    [updateMember, appendMessage, refetchChat, refetchTasks],
  );

  useTeamSse(id, handleSseEvent);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-gray-400">
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
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
          <h1 className="text-xl font-bold text-white">{team.name}</h1>
          <StatusBadge status={team.status} />
        </div>
        <button
          onClick={() => setShowAddAgent(true)}
          className="flex items-center gap-1.5 rounded-lg bg-gray-800 px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-700 hover:text-white"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          Add Agent
        </button>
      </div>

      {/* Three-panel layout */}
      <div ref={containerRef} className="flex flex-1 gap-0 overflow-hidden">
        {/* Left: Team Map */}
        <div
          className="shrink-0 overflow-y-auto rounded-xl border border-gray-800 bg-gray-900/50 p-4"
          style={{ width: leftWidth }}
        >
          <TeamMap leader={leader} members={members} onAgentClick={(agent) => setSelectedAgent((prev) => prev?.id === agent.id ? null : agent)} />
        </div>

        <ResizeHandle
          onResize={(delta) =>
            setLeftWidth((w) => Math.max(200, Math.min(500, w + delta)))
          }
        />

        {/* Center: Chat */}
        <div className="flex min-w-[250px] flex-1 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50 p-4">
          <ChatPanel
            messages={messages}
            loading={chatLoading}
            sending={sending}
            members={team.members}
            onSend={sendMessage}
          />
        </div>

        <ResizeHandle
          onResize={(delta) =>
            setRightWidth((w) => Math.max(250, Math.min(700, w - delta)))
          }
        />

        {/* Right: Tasks / App tabs */}
        <div
          className="shrink-0 flex flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900/50 p-4"
          style={{ width: rightWidth }}
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
    </div>
  );
}
