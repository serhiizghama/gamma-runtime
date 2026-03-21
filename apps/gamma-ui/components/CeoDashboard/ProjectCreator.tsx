import type { CSSProperties } from 'react';
import type { TeamRecord } from '@gamma/types';
import { GoalInput } from './GoalInput';

interface ProjectCreatorProps {
  teams: TeamRecord[];
  onCreated: () => void;
}

const wrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
};

const headingStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

export function ProjectCreator({ teams, onCreated }: ProjectCreatorProps) {
  return (
    <div style={wrapperStyle}>
      <span style={headingStyle}>Create Project</span>
      <GoalInput teams={teams} onCreated={onCreated} />
    </div>
  );
}
