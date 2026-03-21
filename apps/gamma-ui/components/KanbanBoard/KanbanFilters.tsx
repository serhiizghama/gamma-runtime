import type { CSSProperties } from 'react';
import type { TeamRecord, ProjectRecord, TaskKind } from '@gamma/types';

const ALL_KINDS: TaskKind[] = ['generic', 'design', 'backend', 'frontend', 'qa', 'devops', 'content', 'research'];

const KIND_COLORS: Record<TaskKind, string> = {
  design: '#A78BFA',
  backend: '#34D399',
  frontend: '#60A5FA',
  qa: '#FBBF24',
  devops: '#F87171',
  content: '#FB923C',
  research: '#2DD4BF',
  generic: '#94A3B8',
};

interface KanbanFiltersProps {
  teams: TeamRecord[];
  projects: ProjectRecord[];
  selectedTeamId: string | null;
  selectedProjectId: string | null;
  selectedKind: string | null;
  onTeamChange: (teamId: string | null) => void;
  onProjectChange: (projectId: string | null) => void;
  onKindChange: (kind: string | null) => void;
}

const barStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-3)',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--color-border-subtle)',
  flexWrap: 'wrap',
  flexShrink: 0,
};

const selectStyle: CSSProperties = {
  fontSize: 12,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  background: 'var(--color-bg-primary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-control)',
  padding: '4px 8px',
  outline: 'none',
  cursor: 'pointer',
  minWidth: 120,
};

const labelStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const chipContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-1)',
  flexWrap: 'wrap',
};

export function KanbanFilters({
  teams,
  projects,
  selectedTeamId,
  selectedProjectId,
  selectedKind,
  onTeamChange,
  onProjectChange,
  onKindChange,
}: KanbanFiltersProps) {
  // Filter projects by selected team if applicable
  const filteredProjects = selectedTeamId
    ? projects.filter(p => p.team_id === selectedTeamId)
    : projects;

  return (
    <div style={barStyle}>
      {/* Team selector */}
      <span style={labelStyle}>Team</span>
      <select
        style={selectStyle}
        value={selectedTeamId ?? ''}
        onChange={e => {
          const val = e.target.value || null;
          onTeamChange(val);
          // Reset project when team changes
          if (val !== selectedTeamId) onProjectChange(null);
        }}
      >
        <option value="">All Teams</option>
        {teams.map(t => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      {/* Project selector */}
      <span style={labelStyle}>Project</span>
      <select
        style={selectStyle}
        value={selectedProjectId ?? ''}
        onChange={e => onProjectChange(e.target.value || null)}
      >
        <option value="">All Projects</option>
        {filteredProjects.map(p => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>

      {/* Kind filter chips */}
      <span style={{ ...labelStyle, marginLeft: 'var(--space-2)' }}>Kind</span>
      <div style={chipContainerStyle}>
        {ALL_KINDS.map(kind => {
          const isActive = selectedKind === kind;
          const color = KIND_COLORS[kind];
          return (
            <button
              key={kind}
              onClick={() => onKindChange(isActive ? null : kind)}
              style={{
                fontSize: 10,
                fontWeight: 600,
                fontFamily: 'var(--font-system)',
                color: isActive ? '#fff' : color,
                background: isActive ? color : `${color}1A`,
                border: 'none',
                borderRadius: 10,
                padding: '2px 8px',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {kind}
            </button>
          );
        })}
      </div>
    </div>
  );
}
