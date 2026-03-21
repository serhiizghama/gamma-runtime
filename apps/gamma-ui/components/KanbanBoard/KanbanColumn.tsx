import type { CSSProperties, ReactNode } from 'react';
import type { TaskRecord } from '@gamma/types';
import { KanbanCard } from './KanbanCard';

interface KanbanColumnProps {
  title: string;
  count: number;
  tasks: TaskRecord[];
  statusColor: string;
  children?: ReactNode;
}

const columnStyle: CSSProperties = {
  flex: 1,
  minWidth: 220,
  maxWidth: 340,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--color-bg-primary)',
  borderRadius: 'var(--radius-control)',
  border: '1px solid var(--color-border-subtle)',
  overflow: 'hidden',
};

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  padding: 'var(--space-3) var(--space-3)',
  borderBottom: '1px solid var(--color-border-subtle)',
  flexShrink: 0,
};

const titleTextStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  fontFamily: 'var(--font-system)',
  color: 'var(--color-text-primary)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const listStyle: CSSProperties = {
  flex: 1,
  overflowY: 'auto',
  padding: 'var(--space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
};

export function KanbanColumn({ title, count, tasks, statusColor, children }: KanbanColumnProps) {
  return (
    <div style={columnStyle}>
      <div style={headerStyle}>
        {/* Status dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: statusColor,
            flexShrink: 0,
          }}
        />
        <span style={titleTextStyle}>{title}</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--font-system)',
            color: 'var(--color-text-secondary)',
            background: 'var(--color-surface-elevated)',
            padding: '1px 6px',
            borderRadius: 8,
            minWidth: 18,
            textAlign: 'center',
          }}
        >
          {count}
        </span>
      </div>

      <div style={listStyle}>
        {tasks.map(task => (
          <KanbanCard key={task.id} task={task} />
        ))}

        {tasks.length === 0 && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-system)',
              textAlign: 'center',
              padding: 'var(--space-6) var(--space-3)',
              opacity: 0.5,
            }}
          >
            No tasks
          </div>
        )}

        {/* Optional "Load more" button for Done column */}
        {children}
      </div>
    </div>
  );
}
