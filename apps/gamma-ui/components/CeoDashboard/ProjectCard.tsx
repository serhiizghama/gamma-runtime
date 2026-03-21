import { useState, useEffect, useRef, type CSSProperties } from 'react';
import type { ProjectRecord } from '@gamma/types';
import { API_BASE } from '../../constants/api';
import { systemAuthHeaders } from '../../lib/auth';
import { useGammaStore } from '../../store/useGammaStore';

interface ProjectCardProps {
  project: ProjectRecord;
}

interface TaskCounts {
  backlog: number;
  pending: number;
  in_progress: number;
  review: number;
  done: number;
  failed: number;
}

const STATUS_COLORS: Record<string, string> = {
  backlog: '#94A3B8',
  pending: '#94A3B8',
  in_progress: '#3B82F6',
  review: '#A78BFA',
  done: '#34D399',
  failed: '#F87171',
};

const TYPE_COLORS: Record<string, string> = {
  epic: '#3B82F6',
  continuous: '#34D399',
};

const STATUS_BADGE_COLORS: Record<string, string> = {
  planning: '#F59E0B',
  active: '#3B82F6',
  paused: '#94A3B8',
  completed: '#34D399',
  cancelled: '#F87171',
};

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

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--space-2)',
};

const nameStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
};

const badgeStyle = (color: string): CSSProperties => ({
  fontSize: 10,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: '#fff',
  background: color,
  padding: '2px 6px',
  borderRadius: 4,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.3px',
  flexShrink: 0,
});

const donutContainerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
};

const donutStyle = (gradient: string): CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: '50%',
  background: gradient,
  flexShrink: 0,
  position: 'relative',
});

const donutHoleStyle: CSSProperties = {
  position: 'absolute',
  top: 6,
  left: 6,
  width: 20,
  height: 20,
  borderRadius: '50%',
  background: 'var(--color-surface-elevated)',
};

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '2px 8px',
  fontSize: 10,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
};

const progressBarContainerStyle: CSSProperties = {
  width: '100%',
  height: 4,
  background: 'var(--color-bg-primary)',
  borderRadius: 2,
  overflow: 'hidden',
};

function buildConicGradient(counts: TaskCounts): string {
  const segments = [
    { key: 'backlog', count: counts.backlog + counts.pending },
    { key: 'in_progress', count: counts.in_progress },
    { key: 'review', count: counts.review },
    { key: 'done', count: counts.done },
    { key: 'failed', count: counts.failed },
  ];

  const total = segments.reduce((s, seg) => s + seg.count, 0);
  if (total === 0) return '#333';

  const parts: string[] = [];
  let cumPct = 0;
  for (const seg of segments) {
    if (seg.count === 0) continue;
    const pct = (seg.count / total) * 100;
    const color = STATUS_COLORS[seg.key] || '#666';
    parts.push(`${color} ${cumPct}% ${cumPct + pct}%`);
    cumPct += pct;
  }

  return `conic-gradient(${parts.join(', ')})`;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const [counts, setCounts] = useState<TaskCounts | null>(null);
  const mountedRef = useRef(true);
  const setKanbanFilters = useGammaStore((s) => s.setKanbanFilters);
  const openWindow = useGammaStore((s) => s.openWindow);

  useEffect(() => {
    mountedRef.current = true;
    const controller = new AbortController();

    fetch(`${API_BASE}/api/projects/${project.id}/counts`, {
      headers: systemAuthHeaders(),
      signal: controller.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: TaskCounts) => {
        if (mountedRef.current) setCounts(data);
      })
      .catch(() => {
        // Silently ignore — counts are optional UI sugar
      });

    return () => {
      mountedRef.current = false;
      controller.abort();
    };
  }, [project.id]);

  const handleClick = () => {
    setKanbanFilters({ projectId: project.id, teamId: null, kind: null });
    openWindow('kanban', `Kanban: ${project.name}`);
  };

  const total = counts
    ? counts.backlog + counts.pending + counts.in_progress + counts.review + counts.done + counts.failed
    : 0;
  const donePct = counts && total > 0 ? ((counts.done / total) * 100) : 0;

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
      <div style={headerStyle}>
        <span style={nameStyle}>{project.name}</span>
        <span style={badgeStyle(TYPE_COLORS[project.type] || '#666')}>
          {project.type}
        </span>
        <span style={badgeStyle(STATUS_BADGE_COLORS[project.status] || '#666')}>
          {project.status}
        </span>
      </div>

      {counts && total > 0 && (
        <div style={donutContainerStyle}>
          <div style={donutStyle(buildConicGradient(counts))}>
            <div style={donutHoleStyle} />
          </div>
          <div style={legendStyle}>
            {counts.in_progress > 0 && <span>In Progress: {counts.in_progress}</span>}
            {counts.review > 0 && <span>Review: {counts.review}</span>}
            {counts.done > 0 && <span>Done: {counts.done}</span>}
            {(counts.backlog + counts.pending) > 0 && <span>Backlog: {counts.backlog + counts.pending}</span>}
            {counts.failed > 0 && <span>Failed: {counts.failed}</span>}
          </div>
        </div>
      )}

      {project.type === 'epic' && counts && total > 0 && (
        <div style={progressBarContainerStyle}>
          <div
            style={{
              width: `${donePct}%`,
              height: '100%',
              background: '#34D399',
              borderRadius: 2,
              transition: 'width 0.3s',
            }}
          />
        </div>
      )}
    </div>
  );
}
