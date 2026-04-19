import { useCallback, useEffect, useRef, useState } from 'react';
import type { SseEvent } from './useTeamSse';
import { formatTool, type ToolDisplay } from '../utils/formatTool';

export type ActivityKind = 'starting' | 'thinking' | 'writing' | 'tool' | 'error';

export interface AgentActivity {
  agentId: string;
  kind: ActivityKind;
  icon: string;
  label: string;
  detail?: string;
  recentTools: string[];
  startedAt: number;
  updatedAt: number;
  fadingOut?: boolean;
}

const THROTTLE_MS = 300;
const FADE_OUT_MS = 600;
const ERROR_HOLD_MS = 3500;
const RECENT_TOOLS_MAX = 5;

type PendingUpdate = { activity: AgentActivity; scheduledAt: number };

function buildActivity(base: Partial<AgentActivity>, agentId: string, prev?: AgentActivity): AgentActivity {
  const now = Date.now();
  return {
    agentId,
    kind: base.kind ?? 'starting',
    icon: base.icon ?? '🤔',
    label: base.label ?? 'Working',
    detail: base.detail,
    recentTools: base.recentTools ?? prev?.recentTools ?? [],
    startedAt: prev?.startedAt ?? now,
    updatedAt: now,
    fadingOut: false,
  };
}

export function useAgentActivities() {
  const [activities, setActivities] = useState<Map<string, AgentActivity>>(new Map());
  const activitiesRef = useRef<Map<string, AgentActivity>>(new Map());
  const pendingRef = useRef<Map<string, PendingUpdate>>(new Map());
  const lastFlushRef = useRef<Map<string, number>>(new Map());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const removalTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => { activitiesRef.current = activities; }, [activities]);

  const cancelRemoval = useCallback((agentId: string) => {
    const t = removalTimersRef.current.get(agentId);
    if (t) {
      clearTimeout(t);
      removalTimersRef.current.delete(agentId);
    }
    // Also clear any in-progress fade so the pill becomes visible again
    setActivities((prev) => {
      const existing = prev.get(agentId);
      if (!existing || !existing.fadingOut) return prev;
      const m = new Map(prev);
      m.set(agentId, { ...existing, fadingOut: false });
      return m;
    });
  }, []);

  const applyNow = useCallback((agentId: string, next: AgentActivity) => {
    setActivities((prev) => {
      const m = new Map(prev);
      m.set(agentId, next);
      return m;
    });
    lastFlushRef.current.set(agentId, Date.now());
    pendingRef.current.delete(agentId);
    const t = timersRef.current.get(agentId);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(agentId);
    }
  }, []);

  const scheduleThrottled = useCallback((agentId: string, next: AgentActivity) => {
    const last = lastFlushRef.current.get(agentId) ?? 0;
    const elapsed = Date.now() - last;
    if (elapsed >= THROTTLE_MS) {
      applyNow(agentId, next);
      return;
    }
    pendingRef.current.set(agentId, { activity: next, scheduledAt: Date.now() });
    if (timersRef.current.has(agentId)) return;
    const delay = THROTTLE_MS - elapsed;
    const handle = setTimeout(() => {
      const pending = pendingRef.current.get(agentId);
      timersRef.current.delete(agentId);
      if (pending) applyNow(agentId, pending.activity);
    }, delay);
    timersRef.current.set(agentId, handle);
  }, [applyNow]);

  const scheduleRemoval = useCallback((agentId: string, delay: number) => {
    cancelRemoval(agentId);
    const fadeHandle = setTimeout(() => {
      setActivities((prev) => {
        const existing = prev.get(agentId);
        if (!existing) return prev;
        const m = new Map(prev);
        m.set(agentId, { ...existing, fadingOut: true });
        return m;
      });
      const removeHandle = setTimeout(() => {
        setActivities((prev) => {
          if (!prev.has(agentId)) return prev;
          const m = new Map(prev);
          m.delete(agentId);
          return m;
        });
        removalTimersRef.current.delete(agentId);
      }, FADE_OUT_MS);
      removalTimersRef.current.set(agentId, removeHandle);
    }, delay);
    removalTimersRef.current.set(agentId, fadeHandle);
  }, [cancelRemoval]);

  const handleEvent = useCallback((event: SseEvent) => {
    const agentId = event.agentId;
    if (event.kind === 'system.emergency_stop') {
      setActivities(new Map());
      pendingRef.current.clear();
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
      removalTimersRef.current.forEach(clearTimeout);
      removalTimersRef.current.clear();
      return;
    }
    if (!agentId) return;

    switch (event.kind) {
      case 'agent.started': {
        cancelRemoval(agentId);
        const prev = activitiesRef.current.get(agentId);
        const content = (event.content as { taskTitle?: string; message?: string } | undefined) ?? {};
        const detail = content.taskTitle ? `on ${content.taskTitle}` : undefined;
        applyNow(agentId, buildActivity({
          kind: 'starting',
          icon: '🤔',
          label: 'Starting',
          detail,
        }, agentId, prev));
        break;
      }
      case 'agent.thinking': {
        cancelRemoval(agentId);
        const prev = activitiesRef.current.get(agentId);
        scheduleThrottled(agentId, buildActivity({
          kind: 'thinking',
          icon: '💭',
          label: 'Thinking',
        }, agentId, prev));
        break;
      }
      case 'agent.message': {
        cancelRemoval(agentId);
        const prev = activitiesRef.current.get(agentId);
        scheduleThrottled(agentId, buildActivity({
          kind: 'writing',
          icon: '✍️',
          label: 'Writing response',
        }, agentId, prev));
        break;
      }
      case 'agent.tool_use': {
        cancelRemoval(agentId);
        const content = event.content as { tool?: string; input?: unknown } | undefined;
        if (!content?.tool) break;
        const display: ToolDisplay = formatTool(content.tool, content.input);
        const prev = activitiesRef.current.get(agentId);
        const recent = prev?.recentTools ?? [];
        const label = display.detail ? `${display.label} ${display.detail}` : display.label;
        const nextRecent = [label, ...recent.filter((x) => x !== label)].slice(0, RECENT_TOOLS_MAX);
        applyNow(agentId, buildActivity({
          kind: 'tool',
          icon: display.icon,
          label: display.label,
          detail: display.detail,
          recentTools: nextRecent,
        }, agentId, prev));
        break;
      }
      case 'agent.completed': {
        const prev = activitiesRef.current.get(agentId);
        if (!prev) break;
        // Flush any pending update first so the last action isn't lost visually
        const pending = pendingRef.current.get(agentId);
        if (pending) applyNow(agentId, pending.activity);
        scheduleRemoval(agentId, 400);
        break;
      }
      case 'agent.error': {
        const prev = activitiesRef.current.get(agentId);
        const content = event.content as { error?: string } | undefined;
        const msg = (content?.error ?? 'error').toString();
        applyNow(agentId, buildActivity({
          kind: 'error',
          icon: '⚠️',
          label: 'Error',
          detail: msg.length > 80 ? msg.slice(0, 79) + '…' : msg,
        }, agentId, prev));
        scheduleRemoval(agentId, ERROR_HOLD_MS);
        break;
      }
    }
  }, [applyNow, scheduleThrottled, scheduleRemoval, cancelRemoval]);

  const seedPlaceholder = useCallback((agentId: string) => {
    setActivities((prev) => {
      if (prev.has(agentId)) return prev;
      const m = new Map(prev);
      m.set(agentId, buildActivity({
        kind: 'starting',
        icon: '🤔',
        label: 'Working',
      }, agentId));
      return m;
    });
  }, []);

  const reset = useCallback(() => {
    setActivities(new Map());
    pendingRef.current.clear();
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
    removalTimersRef.current.forEach(clearTimeout);
    removalTimersRef.current.clear();
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = timersRef.current;
    const removalTimers = removalTimersRef.current;
    return () => {
      timers.forEach(clearTimeout);
      removalTimers.forEach(clearTimeout);
    };
  }, []);

  return {
    activities: Array.from(activities.values()),
    handleEvent,
    seedPlaceholder,
    reset,
  };
}
