import { useState } from 'react';
import { Modal } from './Modal';
import { RolePicker } from './RolePicker';
import { post } from '../api/client';
import { useStore, type Agent } from '../store/useStore';

interface Props {
  open: boolean;
  teamId: string;
  onClose: () => void;
  onCreated: (agent: Agent) => void;
}

export function AddAgentModal({ open, teamId, onClose, onCreated }: Props) {
  const addNotification = useStore((s) => s.addNotification);

  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setName('');
    setRoleId('');
    setSpecialization('');
    setErrors({});
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = 'Agent name is required';
    if (!roleId) e.roleId = 'Select a role';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const agent = await post<Agent>('/agents', {
        name: name.trim(),
        roleId,
        teamId,
        specialization: specialization.trim() || undefined,
      });
      addNotification({ type: 'success', message: `Agent "${agent.name}" added` });
      reset();
      onCreated(agent);
      onClose();
    } catch (err) {
      addNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to add agent',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Add Agent">
      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Agent Name *</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Backend Dev"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />
          {errors.name && <p className="mt-1 text-xs text-red-400">{errors.name}</p>}
        </div>

        <div>
          {errors.roleId && <p className="mb-1 text-xs text-red-400">{errors.roleId}</p>}
          <RolePicker
            defaultCategory="engineering"
            value={roleId}
            onChange={(id, roleName) => {
              setRoleId(id);
              if (!name.trim()) setName(roleName);
            }}
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-300">Specialization</label>
          <input
            value={specialization}
            onChange={(e) => setSpecialization(e.target.value)}
            placeholder="e.g. Node.js microservices"
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
            {submitting ? 'Adding...' : 'Add Agent'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
