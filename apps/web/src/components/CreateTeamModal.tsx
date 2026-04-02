import { useState } from 'react';
import { Modal } from './Modal';
import { RolePicker } from './RolePicker';
import { post } from '../api/client';
import { useStore, type Team } from '../store/useStore';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (team: Team) => void;
}

export function CreateTeamModal({ open, onClose, onCreated }: Props) {
  const addNotification = useStore((s) => s.addNotification);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [leaderName, setLeaderName] = useState('');
  const [leaderRoleId, setLeaderRoleId] = useState('');
  const [leaderSpec, setLeaderSpec] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setDescription('');
    setLeaderName('');
    setLeaderRoleId('');
    setLeaderSpec('');
    setErrors({});
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Team name is required';
    if (!leaderRoleId) e.leaderRoleId = 'Select a leader role';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const team = await post<Team>('/teams', {
        name: name.trim(),
        description: description.trim() || undefined,
        leaderRoleId,
        leaderName: leaderName.trim() || undefined,
        leaderSpec: leaderSpec.trim() || undefined,
      });
      addNotification({ type: 'success', message: `Team "${team.name}" created` });
      reset();
      onCreated(team);
      onClose();
    } catch (err) {
      addNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to create team',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Create Team">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Team Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Alpha Squad"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What will this team work on?"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <hr className="border-gray-800" />

        <h3 className="text-sm font-medium text-gray-300">Team Leader</h3>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Leader Name</label>
          <input
            value={leaderName}
            onChange={(e) => setLeaderName(e.target.value)}
            placeholder="Defaults to role name"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div>
          {errors.leaderRoleId && <p className="mb-1 text-xs text-red-400">{errors.leaderRoleId}</p>}
          <RolePicker
            defaultCategory="leadership"
            value={leaderRoleId}
            onChange={(id, roleName) => {
              setLeaderRoleId(id);
              if (!leaderName.trim()) setLeaderName(roleName);
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Specialization</label>
          <input
            value={leaderSpec}
            onChange={(e) => setLeaderSpec(e.target.value)}
            placeholder="e.g. Full-stack architect"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
        </div>

        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-gray-400 transition-colors hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
          >
            {submitting ? 'Creating...' : 'Create Team'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
