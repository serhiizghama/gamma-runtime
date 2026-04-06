import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTeams } from '../hooks/useTeams';
import { StatusBadge } from '../components/StatusBadge';
import { Spinner } from '../components/Spinner';
import { CreateTeamModal } from '../components/CreateTeamModal';

export function Dashboard() {
  const { teams, loading, refetch } = useTeams();
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
            const activeTasks: number = 0;
            return (
              <div
                key={team.id}
                onClick={() => navigate(`/teams/${team.id}`)}
                className="group cursor-pointer rounded-xl border border-gray-800 bg-gray-850 p-5 transition-colors hover:border-gray-700 hover:bg-gray-800/80"
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
                <div className="space-y-1 text-sm text-gray-500">
                  <div>{team.members.length} agent{team.members.length !== 1 ? 's' : ''}</div>
                  {leader && (
                    <div className="text-gray-400">
                      {leader.avatar_emoji} {leader.name}
                    </div>
                  )}
                  <div>{activeTasks} active task{activeTasks === 1 ? '' : 's'}</div>
                </div>
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
