import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeams } from '../hooks/useTeams';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { CreateTeamModal } from '../components/CreateTeamModal';
import { get } from '../api/client';
import type { Task } from '../hooks/useTeamTasks';
import type { Team } from '../store/useStore';

interface ListTasksResponse {
  success: boolean;
  tasks: Task[];
}

function timeAgo(ts: number | null): string {
  if (!ts) return '';
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function useTeamTasks(teams: Team[]) {
  const [tasksByTeam, setTasksByTeam] = useState<Record<string, Task[]>>({});

  useEffect(() => {
    if (teams.length === 0) return;

    const fetchAll = async () => {
      const results: Record<string, Task[]> = {};
      await Promise.all(
        teams.map(async (team) => {
          try {
            const data = await get<ListTasksResponse>(`/internal/list-tasks?teamId=${team.id}`);
            results[team.id] = data.tasks;
          } catch {
            results[team.id] = [];
          }
        }),
      );
      setTasksByTeam(results);
    };

    fetchAll();
  }, [teams]);

  return tasksByTeam;
}

function TeamCardStats({ team, tasks }: { team: Team; tasks: Task[] | undefined }) {
  const runningAgents = team.members.filter((m) => m.status === 'running');
  const hasRunning = runningAgents.length > 0;

  const inProgress = tasks?.filter((t) => t.stage === 'in_progress').length ?? 0;
  const done = tasks?.filter((t) => t.stage === 'done').length ?? 0;
  const total = tasks?.length ?? 0;

  // Last activity: most recent last_active_at across all members
  const lastActivity = team.members.reduce<number | null>((latest, m) => {
    if (!m.last_active_at) return latest;
    return latest === null ? m.last_active_at : Math.max(latest, m.last_active_at);
  }, null);

  const lastActivityStr = timeAgo(lastActivity);

  return (
    <div className="space-y-2 text-sm">
      {/* Running agents row */}
      {hasRunning ? (
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1">
            {runningAgents.map((a) => (
              <span
                key={a.id}
                title={a.name}
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/20 text-xs ring-2 ring-gray-900"
              >
                {a.avatar_emoji}
              </span>
            ))}
          </div>
          <span className="text-blue-400">
            {runningAgents.length} agent{runningAgents.length !== 1 ? 's' : ''} working
          </span>
        </div>
      ) : (
        <div className="text-gray-600">Quiet</div>
      )}

      {/* Task progress */}
      {total > 0 && (
        <div>
          {inProgress > 0 ? (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all"
                  style={{ width: `${Math.round((done / total) * 100)}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-blue-400">
                {inProgress} in progress
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full bg-green-500/60 transition-all"
                  style={{ width: `${Math.round((done / total) * 100)}%` }}
                />
              </div>
              <span className="whitespace-nowrap text-gray-500">
                {done}/{total} done
              </span>
            </div>
          )}
        </div>
      )}

      {/* Last activity */}
      {lastActivityStr && (
        <div className="text-xs text-gray-600">
          Active {lastActivityStr.toLowerCase()}
        </div>
      )}
    </div>
  );
}

export function Dashboard() {
  const { teams, loading, refetch } = useTeams();
  const tasksByTeam = useTeamTasks(teams);
  const [showCreate, setShowCreate] = useState(false);
  const navigate = useNavigate();

  return (
    <div>
      <h1 className="mb-6 text-2xl font-bold text-white">Teams</h1>

      {loading ? (
        <div className="flex items-center gap-2 text-gray-400">
          <Spinner />
          Loading teams...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {teams.map((team) => {
            const leader = team.members.find((m) => m.is_leader);
            const hasRunning = team.members.some((m) => m.status === 'running');
            return (
              <div
                key={team.id}
                onClick={() => navigate(`/teams/${team.id}`)}
                className={`group card-hover cursor-pointer rounded-xl border p-5 transition-all ${
                  hasRunning
                    ? 'team-active border-blue-500/30 bg-gray-850 hover:shadow-[0_4px_12px_rgba(59,130,246,0.15)]'
                    : 'border-gray-800 bg-gray-850 hover:border-gray-700 hover:bg-gray-800/80 hover:shadow-[0_4px_12px_rgba(255,255,255,0.05)]'
                }`}
              >
                <div className="mb-3 flex items-start justify-between">
                  <h2 className="text-lg font-semibold text-white group-hover:text-blue-400">
                    {team.name}
                  </h2>
                  <StatusBadge status={team.status} />
                </div>
                {team.description && (
                  <p className="mb-3 text-sm text-gray-400 line-clamp-2">{team.description}</p>
                )}
                <div className="mb-3 text-sm text-gray-500">
                  {leader && (
                    <span className="text-gray-400">
                      {leader.avatar_emoji} {leader.name}
                    </span>
                  )}
                  <span className="mx-1.5 text-gray-700">·</span>
                  {team.members.length} agent{team.members.length !== 1 ? 's' : ''}
                </div>
                <TeamCardStats team={team} tasks={tasksByTeam[team.id]} />
              </div>
            );
          })}

          <button
            onClick={() => setShowCreate(true)}
            className="flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-700 p-5 text-gray-500 transition-colors hover:border-gray-600 hover:text-gray-400"
          >
            <svg className="h-10 w-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            <span className="text-sm font-medium">Create Team</span>
          </button>
        </div>
      )}

      <CreateTeamModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={() => refetch()}
      />
    </div>
  );
}
