import { useEffect, useState, useMemo, useRef } from 'react';
import type { AgentActivity } from '../hooks/useAgentActivities';
import type { Agent } from '../store/useStore';
import { getAgentColor } from './ChatMessage';

interface Props {
  activities: AgentActivity[];
  members: Agent[];
}

function useTick(intervalMs: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

function formatElapsed(startedAt: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s ? `${m}m ${s}s` : `${m}m`;
}

interface PillProps {
  activity: AgentActivity;
  agent?: Agent;
  compact?: boolean;
}

function ActivityPill({ activity, agent, compact }: PillProps) {
  const color = getAgentColor(activity.agentId);
  const name = agent ? `${agent.avatar_emoji} ${agent.name}` : activity.agentId.slice(-6);
  const elapsed = formatElapsed(activity.startedAt);
  const isError = activity.kind === 'error';
  const tooltipLines = activity.recentTools.slice(1); // first is current

  // Key the volatile bits (icon + label/detail) so React remounts them on
  // change and the CSS keyframe re-fires — gives a soft fade instead of a
  // hard text swap when "Thinking" → "Writing" → tool name rolls through.
  const labelKey = `${activity.kind}:${activity.label}:${activity.detail ?? ''}`;

  return (
    <div
      className={`group relative flex items-center gap-2 rounded-md bg-gray-800/50 px-2.5 py-1.5 text-xs transition-all duration-500 ${
        activity.fadingOut ? 'scale-95 opacity-0' : 'activity-pill-enter opacity-100'
      } ${compact ? 'flex-1' : ''}`}
      style={{ borderLeft: `2px solid ${isError ? '#f87171' : color}` }}
    >
      <span className="relative flex h-2 w-2 flex-shrink-0">
        {!isError && !activity.fadingOut && (
          <span
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
            style={{ backgroundColor: color }}
          />
        )}
        <span
          className="relative inline-flex h-2 w-2 rounded-full transition-colors duration-300"
          style={{ backgroundColor: isError ? '#f87171' : color }}
        />
      </span>
      <span
        key={`icon-${labelKey}`}
        className="activity-label-swap text-sm leading-none"
        aria-hidden
      >
        {activity.icon}
      </span>
      <span className="truncate text-gray-300">
        <span className="font-medium text-gray-400">{name}</span>
        <span className="mx-1.5 text-gray-600">·</span>
        <span key={`label-${labelKey}`} className="activity-label-swap inline-block">
          <span className={isError ? 'text-red-300' : 'text-gray-300'}>{activity.label}</span>
          {activity.detail && (
            <>
              <span className="mx-1 text-gray-600">·</span>
              <span className="text-gray-500">{activity.detail}</span>
            </>
          )}
        </span>
      </span>
      <span className="ml-auto flex-shrink-0 text-[10px] tabular-nums text-gray-600">{elapsed}</span>

      {tooltipLines.length > 0 && (
        <div className="pointer-events-none absolute bottom-full left-0 right-0 z-10 mb-1 rounded-md border border-gray-700 bg-gray-900 p-2 text-[11px] text-gray-400 opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-gray-600">Recent</div>
          {tooltipLines.map((line, i) => (
            <div key={i} className="truncate">· {line}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ActivityIndicator({ activities, members }: Props) {
  const [expanded, setExpanded] = useState(false);
  useTick(1000); // rerender every second for elapsed timer

  const memberMap = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the popover on outside click
  useEffect(() => {
    if (!expanded) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setExpanded(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [expanded]);

  if (activities.length === 0) return null;

  // Sort: non-fading first, then by startedAt
  const sorted = [...activities].sort((a, b) => {
    if (!!a.fadingOut !== !!b.fadingOut) return a.fadingOut ? 1 : -1;
    return a.startedAt - b.startedAt;
  });

  if (sorted.length <= 3) {
    return (
      <div className="mb-2 flex flex-col gap-1">
        {sorted.map((a) => (
          <ActivityPill key={a.agentId} activity={a} agent={memberMap.get(a.agentId)} />
        ))}
      </div>
    );
  }

  // 4+ → collapsed counter with expand-on-click popover
  const first = sorted[0];
  const firstAgent = memberMap.get(first.agentId);
  return (
    <div ref={wrapperRef} className="relative mb-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md bg-gray-800/50 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-gray-800"
      >
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
        </span>
        <span className="font-medium text-gray-300">{sorted.length} agents active</span>
        <span className="mx-1 text-gray-600">·</span>
        <span className="truncate text-gray-500">
          {firstAgent?.name ?? first.agentId.slice(-6)}: {first.label}
          {first.detail ? ` ${first.detail}` : ''}
        </span>
        <svg
          className={`ml-auto h-3 w-3 flex-shrink-0 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="absolute bottom-full left-0 right-0 z-20 mb-1 flex max-h-64 flex-col gap-1 overflow-y-auto rounded-md border border-gray-700 bg-gray-900 p-2 shadow-xl">
          {sorted.map((a) => (
            <ActivityPill key={a.agentId} activity={a} agent={memberMap.get(a.agentId)} />
          ))}
        </div>
      )}
    </div>
  );
}
