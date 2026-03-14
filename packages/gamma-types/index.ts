/**
 * @gamma/types — Shared type definitions for Gamma Agent Runtime
 * Spec reference: Phase 2 Backend Integration Specification v1.4, §3
 *
 * Single source of truth for both frontend (React) and backend (NestJS).
 */

// ── §3.1 Agent Status ────────────────────────────────────────────────────

/** v1.3: includes "aborted" — set on user abort or tool timeout */
export type AgentStatus = 'idle' | 'running' | 'error' | 'aborted';

// ── §3.3 SSE Events ──────────────────────────────────────────────────────

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
  | { type: 'assistant_update'; windowId: string; runId: string; text: string }
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
  // User input (v1.6)
  | { type: 'user_message'; windowId: string; text: string; ts: number }
  // System
  | { type: 'gateway_status'; status: 'connected' | 'disconnected'; ts: number }
  | { type: 'keep_alive' }
  // Agent Control Plane (Stage 4)
  | { type: 'session_registry_update'; records: SessionRecord[] }
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
  /** Redis Stream ID of the last SSE event — used for gap protection on reconnect */
  lastEventId: string | null;
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
  /** App context document — written to bundle as context.md */
  contextDoc?: string;
  /** App Owner agent persona — written to bundle as agent-prompt.md */
  agentPrompt?: string;
}

export interface AppRegistryEntry {
  appId: string;
  displayName: string;
  modulePath: string;
  createdAt: number;
  /** Path to the bundle directory, e.g. "./apps/gamma-ui/apps/private/weather/" */
  bundlePath: string;
  /** true if an agent-prompt.md exists in the bundle */
  hasAgent: boolean;
  /** Timestamp of last scaffold — used as React key for hot-reload */
  updatedAt: number;
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

// ── §16 Session Registry ─────────────────────────────────────────────────

/**
 * Telemetry record persisted in Redis for every active agent session.
 * Stored as a Hash at gamma:session-registry:<sessionKey>.
 */
export interface SessionRecord {
  sessionKey: string;
  windowId: string;
  appId: string;
  status: AgentStatus;
  createdAt: number;
  lastActiveAt: number;
  tokenUsage: TokenUsage;
  /** Slice of the assembled system prompt (max 2000 chars) */
  systemPromptSnippet: string;
  /** Total number of agent runs fired within this session */
  runCount: number;
}

// ── Redis Key Constants ──────────────────────────────────────────────────

export const REDIS_KEYS = {
  SESSIONS: 'gamma:sessions',
  SSE_PREFIX: 'gamma:sse:',
  SSE_BROADCAST: 'gamma:sse:broadcast',
  MEMORY_BUS: 'gamma:memory:bus',
  APP_REGISTRY: 'gamma:app:registry',
  APP_DATA_PREFIX: 'gamma:app-data:',
  STATE_PREFIX: 'gamma:state:',
  EVENT_LAG: 'gamma:metrics:event_lag',
  SESSION_REGISTRY_PREFIX: 'gamma:session-registry:',
  SESSION_CONTEXT_PREFIX: 'gamma:session-context:',
} as const;

/** Stream ID is always a string — never parse as number (precision loss) */
export type StreamID = string;

// ── §10 Window & UI Models ────────────────────────────────────────────────

export interface WindowCoordinates {
  x: number;
  y: number;
}

export interface WindowDimensions {
  width: number;
  height: number;
}

export interface WindowNode {
  id: string;
  appId: string;
  title: string;
  coordinates: WindowCoordinates;
  dimensions: WindowDimensions;
  zIndex: number;
  isMinimized: boolean;
  isMaximized: boolean;
  prevCoordinates?: WindowCoordinates;
  prevDimensions?: WindowDimensions;
  openedAt: number;
}

export interface Notification {
  id: string;
  appId: string;
  title: string;
  body: string;
  timestamp: number;
  read: boolean;
}

export interface UISettings {
  theme: 'dark' | 'light';
  accentColor?: string;
  /** px — blob filter blur (60–140) */
  bgBlur: number;
  /** s — base breath cycle duration (10–60) */
  bgSpeed: number;
}

export interface OSStore {
  windows: Record<string, WindowNode>;
  zIndexCounter: number;
  focusedWindowId: string | null;

  launchpadOpen: boolean;
  notifications: Notification[];
  toastQueue: Notification[];

  uiSettings: UISettings;

  /** System Architect panel visibility */
  architectOpen: boolean;

  /** Generated app registry (from API + component_ready/removed SSE) */
  appRegistry: Record<string, AppRegistryEntry>;
  setAppRegistry: (registry: Record<string, AppRegistryEntry>) => void;
  updateAppRegistryEntry: (appId: string, entry: Partial<AppRegistryEntry>) => void;
  removeAppRegistryEntry: (appId: string) => void;

  /** Per-window agent panel (✨) open state — keyed by window id */
  windowAgentPanelOpen: Record<string, boolean>;
  toggleWindowAgentPanel: (windowId: string) => void;

  openWindow: (appId: string, title: string) => void;
  closeWindow: (id: string) => void;
  minimizeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  maximizeWindow: (id: string) => void;
  updateWindowPosition: (id: string, coords: WindowCoordinates) => void;
  updateWindowDimensions: (id: string, dims: WindowDimensions) => void;

  toggleLaunchpad: () => void;
  closeLaunchpad: () => void;

  toggleArchitect: () => void;

  pushNotification: (n: Omit<Notification, 'id' | 'timestamp' | 'read'>) => void;
  dismissToast: (id: string) => void;

  updateUISettings: (patch: Partial<UISettings>) => void;
  resetAll: () => void;
}
