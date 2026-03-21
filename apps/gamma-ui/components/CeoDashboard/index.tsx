import { type CSSProperties } from 'react';
import { useTeams } from '../../hooks/useTeams';
import { useProjects } from '../../hooks/useProjects';
import { ProjectList } from './ProjectList';
import { ProjectCreator } from './ProjectCreator';
import { TeamOverview } from './TeamOverview';
import { BlueprintSpawner } from './BlueprintSpawner';

// ── Styles ───────────────────────────────────────────────────────────────

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  background: 'var(--color-bg-primary)',
  fontFamily: 'var(--font-system)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: 'var(--space-3) var(--space-4)',
  borderBottom: '1px solid var(--color-border-subtle)',
  flexShrink: 0,
};

const titleStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
};

const statsRowStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-4)',
};

const statStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
};

const statValueStyle: CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-accent-primary)',
};

const statLabelStyle: CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.3px',
};

const bodyStyle: CSSProperties = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
  minHeight: 0,
};

const leftPaneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  gap: 'var(--space-4)',
  padding: 'var(--space-3) var(--space-4)',
  overflowY: 'auto',
  minWidth: 0,
};

const rightPaneStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  width: 340,
  flexShrink: 0,
  gap: 'var(--space-4)',
  padding: 'var(--space-3) var(--space-4)',
  overflowY: 'auto',
  borderLeft: '1px solid var(--color-border-subtle)',
};

// ── Component ────────────────────────────────────────────────────────────

export function CeoDashboard() {
  const { teams, refresh: refreshTeams } = useTeams();
  const { projects, refresh: refreshProjects } = useProjects();

  const activeProjects = projects.filter((p) => p.status === 'active' || p.status === 'planning');

  return (
    <div style={containerStyle}>
      {/* Header with stats */}
      <div style={headerStyle}>
        <span style={titleStyle}>CEO Dashboard</span>
        <div style={statsRowStyle}>
          <div style={statStyle}>
            <span style={statValueStyle}>{teams.length}</span>
            <span style={statLabelStyle}>Teams</span>
          </div>
          <div style={statStyle}>
            <span style={statValueStyle}>{projects.length}</span>
            <span style={statLabelStyle}>Projects</span>
          </div>
          <div style={statStyle}>
            <span style={statValueStyle}>{activeProjects.length}</span>
            <span style={statLabelStyle}>Active</span>
          </div>
        </div>
      </div>

      {/* Body: split layout */}
      <div style={bodyStyle}>
        {/* Left pane: Projects + Teams */}
        <div style={leftPaneStyle}>
          <ProjectList projects={projects} />
          <TeamOverview teams={teams} />
        </div>

        {/* Right pane: Project Creator + Blueprint Spawner */}
        <div style={rightPaneStyle}>
          <ProjectCreator teams={teams} onCreated={refreshProjects} />
          <BlueprintSpawner onSpawned={refreshTeams} />
        </div>
      </div>
    </div>
  );
}
