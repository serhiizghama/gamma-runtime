import type { CSSProperties } from 'react';
import type { TeamRecord } from '@gamma/types';
import { TeamCard } from './TeamCard';

interface TeamOverviewProps {
  teams: TeamRecord[];
}

const containerStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

const titleStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.5px',
};

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 'var(--space-2)',
};

const emptyStyle: CSSProperties = {
  fontSize: 12,
  color: 'var(--color-text-secondary)',
  fontFamily: 'var(--font-system)',
  textAlign: 'center',
  padding: 'var(--space-3)',
};

export function TeamOverview({ teams }: TeamOverviewProps) {
  return (
    <div style={containerStyle}>
      <span style={titleStyle}>Teams</span>
      {teams.length === 0 ? (
        <span style={emptyStyle}>No teams created yet</span>
      ) : (
        <div style={gridStyle}>
          {teams.map((t) => (
            <TeamCard key={t.id} team={t} />
          ))}
        </div>
      )}
    </div>
  );
}
