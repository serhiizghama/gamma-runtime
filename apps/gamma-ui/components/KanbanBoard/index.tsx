import { useMemo, type CSSProperties } from 'react';
import type { TaskRecord } from '@gamma/types';
import { useTeams } from '../../hooks/useTeams';
import { useProjects } from '../../hooks/useProjects';
import { useKanbanTasks } from '../../hooks/useKanbanTasks';
import { useGammaStore } from '../../store/useGammaStore';
import { KanbanFilters } from './KanbanFilters';
import { KanbanColumn } from './KanbanColumn';

// ── Column definitions ───────────────────────────────────────────────────

interface ColumnDef {
  title: string;
  statuses: string[];
  color: string;
}

const COLUMNS: ColumnDef[] = [
  { title: 'Backlog',     statuses: ['backlog', 'pending'], color: '#94A3B8' },
  { title: 'In Progress', statuses: ['in_progress'],        color: '#3B82F6' },
  { title: 'Review',      statuses: ['review'],             color: '#A78BFA' },
  { title: 'Done',        statuses: ['done', 'failed'],     color: '#34D399' },
];

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

const boardStyle: CSSProperties = {
  display: 'flex',
  gap: 'var(--space-3)',
  flex: 1,
  padding: 'var(--space-3) var(--space-4)',
  overflow: 'auto',
  minHeight: 0,
};

const emptyStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  gap: 'var(--space-3)',
};

const loadMoreBtnStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-secondary)',
  background: 'var(--color-surface-elevated)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-control)',
  padding: '4px 12px',
  cursor: 'pointer',
  width: '100%',
  textAlign: 'center',
  marginTop: 'var(--space-1)',
};

// ── Component ────────────────────────────────────────────────────────────

export function KanbanBoard() {
  const { teams } = useTeams();
  const { projects } = useProjects();

  const kanbanFilters = useGammaStore((s) => s.kanbanFilters);
  const setKanbanFilters = useGammaStore((s) => s.setKanbanFilters);

  const { teamId, projectId, kind } = kanbanFilters;

  const { tasks, loading, hasMoreDone, loadMoreDone, refresh } = useKanbanTasks(
    teamId,
    projectId,
  );

  // Filter by kind if selected
  const filteredTasks = useMemo(() => {
    if (!kind) return tasks;
    return tasks.filter(t => t.kind === kind);
  }, [tasks, kind]);

  // Group tasks by column
  const grouped = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    for (const col of COLUMNS) {
      map.set(col.title, []);
    }
    for (const task of filteredTasks) {
      for (const col of COLUMNS) {
        if (col.statuses.includes(task.status)) {
          map.get(col.title)!.push(task);
          break;
        }
      }
    }
    return map;
  }, [filteredTasks]);

  // Show empty state when no team or project is selected
  const noScope = !teamId && !projectId;

  return (
    <div style={containerStyle}>
      <KanbanFilters
        teams={teams}
        projects={projects}
        selectedTeamId={teamId}
        selectedProjectId={projectId}
        selectedKind={kind}
        onTeamChange={(id) => setKanbanFilters({ teamId: id })}
        onProjectChange={(id) => setKanbanFilters({ projectId: id })}
        onKindChange={(k) => setKanbanFilters({ kind: k })}
      />

      {noScope ? (
        <div style={emptyStyle}>
          <span style={{ fontSize: 36 }}>📋</span>
          <span
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
            }}
          >
            Select a team or project
          </span>
          <span
            style={{
              fontSize: 12,
              color: 'var(--color-text-secondary)',
              textAlign: 'center',
              maxWidth: 280,
            }}
          >
            Choose a team or project from the filters above to view the Kanban board.
          </span>
        </div>
      ) : loading ? (
        <div style={emptyStyle}>
          <span
            style={{
              fontSize: 13,
              color: 'var(--color-text-secondary)',
            }}
          >
            Loading tasks...
          </span>
        </div>
      ) : (
        <div style={boardStyle}>
          {COLUMNS.map((col) => {
            const colTasks = grouped.get(col.title) || [];
            const isDoneCol = col.title === 'Done';
            return (
              <KanbanColumn
                key={col.title}
                title={col.title}
                count={colTasks.length}
                tasks={colTasks}
                statusColor={col.color}
              >
                {isDoneCol && hasMoreDone && (
                  <button
                    style={loadMoreBtnStyle}
                    onClick={loadMoreDone}
                  >
                    Load more
                  </button>
                )}
              </KanbanColumn>
            );
          })}
        </div>
      )}

      {/* Refresh button in the bottom-right corner */}
      {!noScope && (
        <button
          onClick={() => refresh()}
          style={{
            position: 'absolute',
            bottom: 'var(--space-3)',
            right: 'var(--space-3)',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: 'var(--font-system)',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-border-subtle)',
            borderRadius: 'var(--radius-control)',
            padding: '4px 10px',
            cursor: 'pointer',
            zIndex: 10,
          }}
          title="Refresh tasks"
        >
          Refresh
        </button>
      )}
    </div>
  );
}
