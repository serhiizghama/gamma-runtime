import { useState } from 'react';
import type { TraceEvent as TraceEventType } from '../hooks/useTrace';
import { ThinkingBlock } from './ThinkingBlock';
import { ToolCallBlock } from './ToolCallBlock';

const kindBadge: Record<string, string> = {
  'agent.thinking': 'bg-gray-700 text-gray-300',
  'agent.message': 'bg-blue-500/20 text-blue-400',
  'agent.tool_use': 'bg-purple-500/20 text-purple-400',
  'agent.tool_result': 'bg-green-500/20 text-green-400',
  'agent.started': 'bg-cyan-500/20 text-cyan-400',
  'agent.completed': 'bg-green-500/20 text-green-400',
  'agent.error': 'bg-red-500/20 text-red-400',
  'task.created': 'bg-yellow-500/20 text-yellow-400',
  'task.assigned': 'bg-yellow-500/20 text-yellow-400',
  'task.stage_changed': 'bg-orange-500/20 text-orange-400',
  'task.completed': 'bg-green-500/20 text-green-400',
  'team.message': 'bg-blue-500/20 text-blue-400',
};

function parseContent(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

interface Props {
  event: TraceEventType;
  agentName?: string;
  agentEmoji?: string;
  compact?: boolean;
}

export function TraceEvent({ event, agentName, agentEmoji, compact }: Props) {
  const [expanded, setExpanded] = useState(false);
  const content = parseContent(event.content);
  const badge = kindBadge[event.kind] ?? 'bg-gray-700 text-gray-400';

  const textContent = typeof content === 'string'
    ? content
    : content && typeof content === 'object' && 'text' in (content as Record<string, unknown>)
      ? String((content as Record<string, string>).text)
      : null;

  // Specialized rendering for certain kinds
  if (!compact) {
    if (event.kind === 'agent.thinking' && textContent) {
      return <ThinkingBlock content={textContent} />;
    }
    if (event.kind === 'agent.tool_use' && content && typeof content === 'object') {
      const c = content as Record<string, unknown>;
      return (
        <ToolCallBlock
          toolName={String(c.tool ?? c.name ?? 'tool')}
          input={c.input ? (typeof c.input === 'string' ? c.input : JSON.stringify(c.input, null, 2)) : undefined}
        />
      );
    }
    if (event.kind === 'agent.tool_result' && textContent) {
      return <ToolCallBlock toolName="result" output={textContent} isResult />;
    }
    if (event.kind === 'agent.message' && textContent) {
      return (
        <div className="rounded-lg bg-gray-800/60 px-3 py-2 text-sm text-gray-200">
          {textContent}
        </div>
      );
    }
  }

  // Generic row (compact mode or unknown kind)
  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left transition-colors hover:bg-gray-800/50"
      >
        <span className="w-16 shrink-0 text-[10px] text-gray-600">
          {new Date(Number(event.created_at)).toLocaleTimeString()}
        </span>
        {agentEmoji && <span className="text-sm">{agentEmoji}</span>}
        {agentName && <span className="shrink-0 text-xs text-gray-400">{agentName}</span>}
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${badge}`}>
          {event.kind.replace('agent.', '').replace('task.', '')}
        </span>
        {textContent && (
          <span className="min-w-0 truncate text-xs text-gray-500">{textContent.slice(0, 80)}</span>
        )}
      </button>
      {expanded && event.content && (
        <pre className="mx-3 mb-2 max-h-48 overflow-auto rounded bg-gray-950 p-2 font-mono text-[11px] text-gray-400">
          {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
        </pre>
      )}
    </div>
  );
}
