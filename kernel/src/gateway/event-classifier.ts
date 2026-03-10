/**
 * Event classification — pure functions.
 * Mirrors openclaw-studio's classifyGatewayEventKind (spec §5.2).
 *
 * Types re-exported from @gamma/types for convenience.
 */

export type { AgentStatus, GatewayEventKind } from '@gamma/types';

import type { GatewayEventKind } from '@gamma/types';

export function classifyGatewayEventKind(event: string): GatewayEventKind {
  if (event === 'presence' || event === 'heartbeat') return 'summary-refresh';
  if (event === 'agent') return 'runtime-agent';
  if (event === 'chat') return 'runtime-chat';
  return 'ignore';
}

/**
 * Detect reasoning/thinking streams beyond the canonical "thinking".
 */
const REASONING_STREAM_HINTS = ['reason', 'think', 'analysis', 'trace'];

export function isReasoningStream(stream: string): boolean {
  const s = stream.trim().toLowerCase();
  if (!s || s === 'assistant' || s === 'tool' || s === 'lifecycle') return false;
  return REASONING_STREAM_HINTS.some((h) => s.includes(h));
}
