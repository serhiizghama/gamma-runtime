import { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { TeamRecord } from '@gamma/types';
import { API_BASE } from '../../constants/api';
import { systemAuthHeaders } from '../../lib/auth';
import { useGammaStore } from '../../store/useGammaStore';

interface TeamCardProps {
  team: TeamRecord;
}

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  padding: 'var(--space-3)',
  background: 'var(--color-surface-elevated)',
  borderRadius: 8,
  border: '1px solid var(--color-border-subtle)',
  cursor: 'pointer',
  transition: 'border-color 0.15s',
};

const nameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
};

const membersStyle: CSSProperties = {
  display: 'flex',
  gap: 2,
  fontSize: 14,
};

const metaStyle: CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
};

interface TeamDetails {
  team: TeamRecord;
  members: { agentId: string; role: string }[];
}

const ROLE_EMOJI: Record<string, string> = {
  architect: '\u{1F3D7}',
  'app-owner': '\u{1F4BB}',
  daemon: '\u{1F916}',
};

export function TeamCard({ team }: TeamCardProps) {
  const [details, setDetails] = useState<TeamDetails | null>(null);
  const [backlogCount, setBacklogCount] = useState(0);
  const mountedRef = useRef(true);
  const setKanbanFilters = useGammaStore((s) => s.setKanbanFilters);
  const openWindow = useGammaStore((s) => s.openWindow);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    // Fetch team details + members
    fetch(`${API_BASE}/api/teams/${team.id}`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (mountedRef.current && data) setDetails(data);
      })
      .catch(() => {});

    // Fetch backlog count
    fetch(`${API_BASE}/api/teams/${team.id}/backlog?status=backlog&limit=1`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: unknown[]) => {
        // The API returns the tasks array; we just need a rough count
        if (mountedRef.current) setBacklogCount(Array.isArray(data) ? data.length : 0);
      })
      .catch(() => {});

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [team.id]);

  const handleClick = () => {
    setKanbanFilters({ teamId: team.id, projectId: null, kind: null });
    openWindow('kanban', `Kanban: ${team.name}`);
  };

  const members = details?.members ?? [];

  return (
    <div
      style={cardStyle}
      onClick={handleClick}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-accent-primary)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--color-border-subtle)';
      }}
    >
      <span style={nameStyle}>{team.name}</span>

      <div style={rowStyle}>
        <div style={membersStyle}>
          {members.length > 0
            ? members.map((m, i) => (
                <span key={i} title={m.agentId}>
                  {ROLE_EMOJI[m.role] || '\u{1F464}'}
                </span>
              ))
            : <span style={metaStyle}>No members</span>
          }
        </div>
        <span style={metaStyle}>
          {backlogCount > 0 ? `${backlogCount}+ backlog` : 'Empty backlog'}
        </span>
      </div>
    </div>
  );
}
