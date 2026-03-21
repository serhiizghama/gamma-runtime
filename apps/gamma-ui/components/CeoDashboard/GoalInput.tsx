import { useState, useRef, type CSSProperties } from 'react';
import type { TeamRecord } from '@gamma/types';
import { API_BASE } from '../../constants/api';
import { systemAuthHeaders } from '../../lib/auth';

interface GoalInputProps {
  teams: TeamRecord[];
  onCreated: () => void;
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
  padding: 'var(--space-4)',
  background: 'var(--color-surface-elevated)',
  borderRadius: 8,
  border: '1px solid var(--color-border-subtle)',
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const textareaStyle: CSSProperties = {
  width: '100%',
  minHeight: 80,
  padding: 'var(--space-2)',
  fontSize: 13,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 6,
  resize: 'vertical',
  outline: 'none',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: 'var(--space-2)',
  fontSize: 13,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 6,
  outline: 'none',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-3)',
  alignItems: 'center',
};

const radioLabelStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 12,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  cursor: 'pointer',
};

const selectStyle: CSSProperties = {
  flex: 1,
  padding: 'var(--space-2)',
  fontSize: 12,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 6,
  outline: 'none',
};

const btnStyle: CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: '#fff',
  background: 'var(--color-accent-primary)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  alignSelf: 'flex-end',
};

const btnDisabledStyle: CSSProperties = {
  ...btnStyle,
  opacity: 0.5,
  cursor: 'not-allowed',
};

export function GoalInput({ teams, onCreated }: GoalInputProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<'epic' | 'continuous'>('epic');
  const [teamId, setTeamId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const canSubmit = name.trim().length > 0 && description.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/api/projects`, {
        method: 'POST',
        headers: {
          ...systemAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          type,
          team_id: teamId || undefined,
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      if (mountedRef.current) {
        setName('');
        setDescription('');
        setType('epic');
        setTeamId('');
        onCreated();
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to create project');
      }
    } finally {
      if (mountedRef.current) setSubmitting(false);
    }
  };

  return (
    <div style={containerStyle}>
      <span style={{ fontSize: 14, fontWeight: 600, fontFamily: 'var(--font-system)', color: 'var(--color-text-primary)' }}>
        New Project
      </span>

      <div>
        <span style={labelStyle}>Project Name</span>
        <input
          style={inputStyle}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. User Authentication Revamp"
        />
      </div>

      <div>
        <span style={labelStyle}>Description / Goal</span>
        <textarea
          style={textareaStyle}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Describe the project goal in natural language..."
        />
      </div>

      <div style={rowStyle}>
        <span style={labelStyle}>Type:</span>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="project-type"
            checked={type === 'epic'}
            onChange={() => setType('epic')}
          />
          Epic
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="project-type"
            checked={type === 'continuous'}
            onChange={() => setType('continuous')}
          />
          Continuous
        </label>
      </div>

      <div>
        <span style={labelStyle}>Team (optional)</span>
        <select style={selectStyle} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
          <option value="">No team assigned</option>
          {teams.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <span style={{ fontSize: 12, color: '#F87171', fontFamily: 'var(--font-system)' }}>
          {error}
        </span>
      )}

      <button
        style={canSubmit ? btnStyle : btnDisabledStyle}
        onClick={handleSubmit}
        disabled={!canSubmit}
      >
        {submitting ? 'Creating...' : 'Create Project'}
      </button>
    </div>
  );
}
