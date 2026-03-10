/**
 * @gamma/types — Shared type definitions for Gamma OS
 * Spec reference: Phase 2 Backend Integration Specification v1.4, §3
 *
 * Single source of truth for both frontend (React) and backend (NestJS).
 */

// ── §3.1 Agent Status ────────────────────────────────────────────────────

/** v1.3: includes "aborted" — set on user abort or tool timeout */
export type AgentStatus = 'idle' | 'running' | 'error' | 'aborted';

// ── §3.3 Gamma OS SSE Events ─────────────────────────────────────────────

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  /** outputTokens / modelContextWindow * 100 */
  contextUsedPct: number;
}

export type GammaSSEEvent =
  // Lifecycle
  | { type: 'lifecycle_start'; windowId: string; runId: string }
  | {
      type: 'lifecycle_end';
      windowId: string;
      runId: string;
      stopReason?: string;
      tokenUsage?: TokenUsage;
    }
  | { type: 'lifecycle_error'; windowId: string; runId: string; message: string }
  // Thinking
  | { type: 'thinking'; windowId: string; runId: string; text: string }
  // Assistant
  | { type: 'assistant_delta'; windowId: string; runId: string; text: string }
  // Tools
  | {
      type: 'tool_call';
      windowId: string;
      runId: string;
      name: string;
      toolCallId: string;
      arguments: unknown;
    }
  | {
      type: 'tool_result';
      windowId: string;
      runId: string;
      name: string;
      toolCallId: string;
      result: unknown;
      isError: boolean;
    }
  // Scaffolding
  | { type: 'component_ready'; appId: string; modulePath: string }
  | { type: 'component_removed'; appId: string }
  // System
  | { type: 'gateway_status'; status: 'connected' | 'disconnected'; ts: number }
  | { type: 'keep_alive' }
  // Error
  | { type: 'error'; windowId: string; message: string };

// ── §3.4 Window↔Session Mapping ──────────────────────────────────────────

export interface WindowSession {
  windowId: string;
  appId: string;
  sessionKey: string;
  agentId: string;
  createdAt: number;
  status: AgentStatus;
}

export interface CreateSessionDto {
  windowId: string;
  appId: string;
  sessionKey: string;
  agentId: string;
}

// ── §3.5 Frontend Window Agent State ─────────────────────────────────────

export interface WindowAgentState {
  status: AgentStatus;
  streamText: string | null;
  thinkingTrace: string | null;
  outputLines: string[];
  runId: string | null;
  runStartedAt: number | null;
  pendingToolLines: string[];
}

export const INITIAL_WINDOW_AGENT_STATE: WindowAgentState = {
  status: 'idle',
  streamText: null,
  thinkingTrace: null,
  outputLines: [],
  runId: null,
  runStartedAt: null,
  pendingToolLines: [],
};

// ── §3.6 Memory Bus Entry ────────────────────────────────────────────────

export interface MemoryBusEntry {
  id: string;
  sessionKey: string;
  windowId: string;
  kind: 'thought' | 'tool_call' | 'tool_result' | 'text';
  content: string;
  ts: number;
  stepId: string;
  parentId?: string;
}

// ── §3.7 Session Sync Snapshot ───────────────────────────────────────────

export interface WindowStateSyncSnapshot {
  windowId: string;
  sessionKey: string;
  status: AgentStatus;
  runId: string | null;
  streamText: string | null;
  thinkingTrace: string | null;
  pendingToolLines: string[];
  lastEventAt: number | null;
}

// ── §9 Scaffold Types ────────────────────────────────────────────────────

export interface ScaffoldAsset {
  path: string;
  content: string;
  encoding: 'base64' | 'utf8';
}

export interface ScaffoldRequest {
  appId: string;
  displayName: string;
  sourceCode: string;
  commit?: boolean;
  strictCheck?: boolean;
  files?: ScaffoldAsset[];
}

export interface ScaffoldResult {
  ok: boolean;
  error?: string;
  filePath?: string;
  commitHash?: string;
  modulePath?: string;
}

// ── §15 System Health ────────────────────────────────────────────────────

export interface SystemHealthReport {
  ts: number;
  status: 'ok' | 'degraded' | 'error';
  cpu: { usagePct: number };
  ram: { usedMb: number; totalMb: number; usedPct: number };
  redis: { connected: boolean; latencyMs: number };
  gateway: { connected: boolean; latencyMs: number };
  eventLag: { avgMs: number; maxMs: number; samples: number } | null;
}

// ── Gateway WS Frame Types (§3.2) ───────────────────────────────────────

export type GWFrameType = 'res' | 'event';

export interface GWAgentEventPayload {
  runId: string;
  sessionKey: string;
  seq?: number;
  stream: string;
  data?: {
    phase?: string;
    text?: string;
    delta?: string;
    thinking?: string;
    name?: string;
    toolCallId?: string;
    arguments?: unknown;
    result?: unknown;
    isError?: boolean;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    contextUsedPct?: number;
  };
  ts?: number;
}

// ── Event Classification (§5.2) ──────────────────────────────────────────

export type GatewayEventKind =
  | 'summary-refresh'
  | 'runtime-agent'
  | 'runtime-chat'
  | 'ignore';

// ── Redis Key Constants ──────────────────────────────────────────────────

export const REDIS_KEYS = {
  SESSIONS: 'gamma:sessions',
  SSE_PREFIX: 'gamma:sse:',
  SSE_BROADCAST: 'gamma:sse:broadcast',
  MEMORY_BUS: 'gamma:memory:bus',
  APP_REGISTRY: 'gamma:app:registry',
  STATE_PREFIX: 'gamma:state:',
  EVENT_LAG: 'gamma:metrics:event_lag',
} as const;

/** Stream ID is always a string — never parse as number (precision loss) */
export type StreamID = string;
