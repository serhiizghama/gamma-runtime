import { useState, type CSSProperties } from 'react';
import type { ProjectRecord } from '@gamma/types';
import { ProjectCard } from './ProjectCard';

interface ProjectListProps {
  projects: ProjectRecord[];
}

type StatusFilter = 'all' | 'active' | 'planning' | 'completed';

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'planning', label: 'Planning' },
  { key: 'completed', label: 'Completed' },
];

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  flex: 1,
  minHeight: 0,
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const tabRowStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
};

const tabStyle = (active: boolean): CSSProperties => ({
  fontSize: 11,
  fontWeight: active ? 600 : 400,
  fontFamily: 'var(--font-system)',
  color: active ? 'var(--color-accent-primary)' : 'var(--color-text-secondary)',
  background: active ? 'rgba(59,130,246,0.1)' : 'transparent',
  border: 'none',
  borderRadius: 4,
  padding: '3px 8px',
  cursor: 'pointer',
});

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
};

const emptyStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-system)',
  textAlign: 'center',
  padding: 'var(--space-4)',
};

export function ProjectList({ projects }: ProjectListProps) {
  const [filter, setFilter] = useState<StatusFilter>('all');

  const filtered = projects.filter((p) => {
    if (filter === 'all') return true;
    if (filter === 'completed') return p.status === 'completed' || p.status === 'cancelled';
    return p.status === filter;
  });

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <span style={titleStyle}>Projects</span>
        <div style={tabRowStyle}>
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              style={tabStyle(filter === tab.key)}
              onClick={() => setFilter(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div style={listStyle}>
        {filtered.length === 0 ? (
          <span style={emptyStyle}>No projects found</span>
        ) : (
          filtered.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
