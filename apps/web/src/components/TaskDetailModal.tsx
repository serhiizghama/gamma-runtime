import { Modal } from './Modal';
import type { Task } from '../hooks/useTeamTasks';
import type { Agent } from '../store/useStore';
import { StatusBadge } from './StatusBadge';

interface Props {
  task: Task | null;
  agents: Agent[];
  onClose: () => void;
}

export function TaskDetailModal({ task, agents, onClose }: Props) {
  if (!task) return null;

  const assigned = task.assignedTo ? agents.find((a) => a.id === task.assignedTo) : null;

  return (
    <Modal open={!!task} onClose={onClose} title={task.title}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={task.stage} />
          <span className="rounded-full bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400">{task.kind}</span>
          {assigned && (
            <span className="text-sm text-gray-400">
              {assigned.avatar_emoji} {assigned.name}
            </span>
          )}
        </div>

        {task.description && (
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase text-gray-500">Description</h4>
            <p className="whitespace-pre-wrap text-sm text-gray-300">{task.description}</p>
          </div>
        )}

        {task.result && (
          <div>
            <h4 className="mb-1 text-xs font-medium uppercase text-gray-500">Result</h4>
            <p className="whitespace-pre-wrap text-sm text-gray-300">{task.result.summary}</p>
            {task.result.filesChanged.length > 0 && (
              <div className="mt-2">
                <h5 className="mb-1 text-xs text-gray-500">Files changed:</h5>
                <ul className="space-y-0.5">
                  {task.result.filesChanged.map((f) => (
                    <li key={f} className="font-mono text-xs text-gray-400">{f}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="text-xs text-gray-600">
          Created: {new Date(Number(task.createdAt)).toLocaleString()}
          {task.updatedAt !== task.createdAt && (
            <> &middot; Updated: {new Date(Number(task.updatedAt)).toLocaleString()}</>
          )}
        </div>
      </div>
    </Modal>
  );
}
