import type { CSSProperties } from 'react';
import type { TaskRecord, TaskKind } from '@gamma/types';

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

const PRIORITY_COLORS = ['#34D399', '#FBBF24', '#F87171'];

function formatElapsed(createdAt: number): string {
  const diffMs = Date.now() - createdAt;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function getTitle(task: TaskRecord): string {
  if (task.title) return task.title;
  try {
    const parsed = JSON.parse(task.payload);
    if (parsed.description) return parsed.description.slice(0, 100);
  } catch {
    // payload is plain text
  }
  return task.payload?.slice(0, 100) || 'Untitled task';
}

const cardStyle: CSSProperties = {
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-control)',
  padding: 'var(--space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-2)',
  cursor: 'default',
  transition: 'border-color 150ms ease',
};

const titleStyle: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--color-text-primary)',
  fontFamily: 'var(--font-system)',
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  display: '-webkit-box',
  WebkitLineClamp: 3,
  WebkitBoxOrient: 'vertical',
};

const metaRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--space-2)',
  flexWrap: 'wrap',
};

interface KanbanCardProps {
  task: TaskRecord;
}

export function KanbanCard({ task }: KanbanCardProps) {
  const kindColor = KIND_COLORS[task.kind] || KIND_COLORS.generic;
  const priorityColor = PRIORITY_COLORS[Math.min(task.priority, 2)] || PRIORITY_COLORS[0];
  const elapsed = formatElapsed(task.created_at);

  return (
    <div style={cardStyle}>
      <span style={titleStyle}>{getTitle(task)}</span>
      <div style={metaRowStyle}>
        {/* Kind badge */}
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: 'var(--font-system)',
            color: kindColor,
            background: `${kindColor}1A`,
            padding: '1px 6px',
            borderRadius: 10,
            whiteSpace: 'nowrap',
          }}
        >
          {task.kind}
        </span>

        {/* Priority dot */}
        <span
          style={{
            width: 7,
            height: 7,
            borderRadius: '50%',
            background: priorityColor,
            flexShrink: 0,
          }}
        />

        {/* Elapsed time */}
        <span
          style={{
            fontSize: 10,
            color: 'var(--color-text-secondary)',
            fontFamily: 'var(--font-system)',
            marginLeft: 'auto',
          }}
        >
          {elapsed}
        </span>

        {/* Assignee */}
        {task.target_agent_id && (
          <span
            style={{
              fontSize: 11,
              color: 'var(--color-text-secondary)',
              fontFamily: 'var(--font-system)',
            }}
            title={task.target_agent_id}
          >
            🤖
          </span>
        )}
      </div>
    </div>
  );
}
