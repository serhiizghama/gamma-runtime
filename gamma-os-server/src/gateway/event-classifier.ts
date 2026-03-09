/**
 * Event classification — pure functions.
 * Mirrors openclaw-studio's classifyGatewayEventKind (spec §5.2).
 */

export type GatewayEventKind =
  | 'summary-refresh'
  | 'runtime-agent'
  | 'runtime-chat'
  | 'ignore';

export function classifyGatewayEventKind(event: string): GatewayEventKind {
  if (event === 'presence' || event === 'heartbeat') return 'summary-refresh';
  if (event === 'agent') return 'runtime-agent';
  if (event === 'chat') return 'runtime-chat';
  return 'ignore';
}

/**
 * Detect reasoning/thinking streams beyond the canonical "thinking".
 * Custom streams with hints like "analysis", "reasoning", "trace" are
 * treated as thinking content for UI rendering purposes.
 */
const REASONING_STREAM_HINTS = ['reason', 'think', 'analysis', 'trace'];

export function isReasoningStream(stream: string): boolean {
  const s = stream.trim().toLowerCase();
  if (!s || s === 'assistant' || s === 'tool' || s === 'lifecycle') return false;
  return REASONING_STREAM_HINTS.some((h) => s.includes(h));
}
