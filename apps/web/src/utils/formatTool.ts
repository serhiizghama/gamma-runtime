export interface ToolDisplay {
  icon: string;
  label: string;
  detail?: string;
}

function basename(p: unknown): string | undefined {
  if (typeof p !== 'string' || !p) return undefined;
  const parts = p.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function truncate(s: unknown, max: number): string | undefined {
  if (typeof s !== 'string' || !s) return undefined;
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function hostname(u: unknown): string | undefined {
  if (typeof u !== 'string') return undefined;
  try {
    return new URL(u).hostname;
  } catch {
    return truncate(u, 40);
  }
}

export function formatTool(tool: string, input: unknown): ToolDisplay {
  const inp = (input ?? {}) as Record<string, unknown>;

  switch (tool) {
    case 'Read':
      return { icon: '📖', label: 'Reading', detail: basename(inp.file_path) };
    case 'Write':
      return { icon: '📝', label: 'Writing', detail: basename(inp.file_path) };
    case 'Edit':
    case 'MultiEdit':
      return { icon: '✏️', label: 'Editing', detail: basename(inp.file_path) };
    case 'Bash': {
      const cmd = typeof inp.command === 'string' ? inp.command : '';
      if (/\/api\/internal\/assign-task/.test(cmd)) {
        return { icon: '📋', label: 'Delegating task' };
      }
      if (/\/api\/internal\/send-message/.test(cmd)) {
        return { icon: '💬', label: 'Messaging agent' };
      }
      if (/\/api\/internal\/update-task/.test(cmd)) {
        return { icon: '🔄', label: 'Updating task' };
      }
      if (/\/api\/internal\/read-messages/.test(cmd)) {
        return { icon: '📥', label: 'Reading inbox' };
      }
      if (/\/api\/internal\/broadcast/.test(cmd)) {
        return { icon: '📢', label: 'Broadcasting' };
      }
      return { icon: '⚡', label: 'Running', detail: truncate(cmd, 60) };
    }
    case 'Grep':
      return { icon: '🔍', label: 'Searching', detail: truncate(inp.pattern, 40) };
    case 'Glob':
      return { icon: '🗂️', label: 'Finding files', detail: truncate(inp.pattern, 40) };
    case 'WebFetch':
      return { icon: '🌐', label: 'Fetching', detail: hostname(inp.url) };
    case 'WebSearch':
      return { icon: '🌐', label: 'Searching web', detail: truncate(inp.query, 40) };
    case 'TodoWrite':
      return { icon: '🗒️', label: 'Updating task list' };
    case 'Task':
      return { icon: '👥', label: 'Spawning sub-agent' };
    case 'NotebookEdit':
      return { icon: '📓', label: 'Editing notebook', detail: basename(inp.notebook_path) };
    default:
      return { icon: '🔧', label: tool };
  }
}
