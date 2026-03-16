/**
 * @gamma/types — Shared type definitions for Gamma Agent Runtime
 * Spec reference: Phase 2 Backend Integration Specification v1.4, §3
 *
 * Single source of truth for both frontend (React) and backend (NestJS).
 */
/** v1.3: includes "aborted" — set on user abort or tool timeout */
export type AgentStatus = 'idle' | 'running' | 'error' | 'aborted';
export interface TokenUsage {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    /** outputTokens / modelContextWindow * 100 */
    contextUsedPct: number;
}
export type GammaSSEEvent = {
    type: 'lifecycle_start';
    windowId: string;
    runId: string;
} | {
    type: 'lifecycle_end';
    windowId: string;
    runId: string;
    stopReason?: string;
    tokenUsage?: TokenUsage;
} | {
    type: 'lifecycle_error';
    windowId: string;
    runId: string;
    message: string;
} | {
    type: 'thinking';
    windowId: string;
    runId: string;
    text: string;
} | {
    type: 'assistant_delta';
    windowId: string;
    runId: string;
    text: string;
} | {
    type: 'assistant_update';
    windowId: string;
    runId: string;
    text: string;
} | {
    type: 'tool_call';
    windowId: string;
    runId: string;
    name: string;
    toolCallId: string;
    arguments: unknown;
} | {
    type: 'tool_result';
    windowId: string;
    runId: string;
    name: string;
    toolCallId: string;
    result: unknown;
    isError: boolean;
} | {
    type: 'component_ready';
    appId: string;
    modulePath: string;
} | {
    type: 'component_removed';
    appId: string;
} | {
    type: 'user_message';
    windowId: string;
    text: string;
    ts: number;
} | {
    type: 'gateway_status';
    status: 'connected' | 'disconnected';
    ts: number;
} | {
    type: 'keep_alive';
} | {
    type: 'session_registry_update';
    records: SessionRecord[];
} | {
    type: 'agent_registry_update';
    agents: AgentRegistryEntry[];
} | {
    type: 'emergency_stop';
    ts: number;
    killedCount: number;
} | {
    type: 'error';
    windowId: string;
    message: string;
};
export interface WindowSession {
    windowId: string;
    appId: string;
    sessionKey: string;
    agentId: string;
    createdAt: number;
    status: AgentStatus;
    /** Role-based tool allowlist (undefined = all tools). */
    allowedTools?: string[];
}
export interface CreateSessionDto {
    windowId: string;
    appId: string;
    sessionKey: string;
    agentId: string;
}
export interface WindowAgentState {
    status: AgentStatus;
    streamText: string | null;
    thinkingTrace: string | null;
    outputLines: string[];
    runId: string | null;
    runStartedAt: number | null;
    pendingToolLines: string[];
}
export declare const INITIAL_WINDOW_AGENT_STATE: WindowAgentState;
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
export interface SystemHealthReport {
    ts: number;
    status: 'ok' | 'degraded' | 'error';
    /** Human-readable warning when a subsystem is degraded (e.g. 'WARNING: Watchdog Offline') */
    statusNote?: string;
    cpu: {
        usagePct: number;
    };
    ram: {
        usedMb: number;
        totalMb: number;
        usedPct: number;
    };
    redis: {
        connected: boolean;
        latencyMs: number;
    };
    gateway: {
        connected: boolean;
        latencyMs: number;
    };
    eventLag: {
        avgMs: number;
        maxMs: number;
        samples: number;
    } | null;
    /** Watchdog daemon liveness — based on heartbeat key freshness */
    watchdog?: {
        online: boolean;
    };
}
export interface BackupSessionEntry {
    appId: string;
    tier: 'system' | 'private';
    bakSessionPath: string;
    sizeBytes: number;
    fileCount: number;
    createdAt: number;
}
export interface BackupFileEntry {
    appId: string;
    tier: 'system' | 'private';
    originalFile: string;
    bakFile: string;
    sizeBytes: number;
    modifiedAt: number;
}
export type SystemEventType = 'info' | 'warn' | 'error' | 'critical';
export interface SystemEvent {
    ts: number;
    type: SystemEventType;
    message: string;
    /** Structured metadata from watchdog post-mortems (reason, appId, etc.) */
    meta?: Record<string, unknown>;
}
export interface BackupInventory {
    ts: number;
    sessions: BackupSessionEntry[];
    files: BackupFileEntry[];
    totalSizeBytes: number;
    events: SystemEvent[];
}
export type GWFrameType = 'res' | 'event';
export interface GWFrame {
    type: string;
    id?: string;
    ok?: boolean;
    event?: string;
    method?: string;
    payload?: Record<string, unknown>;
    error?: Record<string, unknown> | string;
    seq?: number;
}
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
export type GatewayEventKind = 'summary-refresh' | 'runtime-agent' | 'runtime-chat' | 'ignore';
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
export type AgentRole = 'architect' | 'app-owner' | 'daemon';
export interface AgentRegistryEntry {
    agentId: string;
    role: AgentRole;
    sessionKey: string;
    windowId: string;
    appId: string;
    status: AgentStatus | 'offline';
    capabilities: string[];
    lastHeartbeat: number;
    lastActivity: string;
    acceptsMessages: boolean;
    createdAt: number;
    /** Phase 5.3: supervisor agent ID (null = root node) */
    supervisorId: string | null;
}
/** Phase 5.3: DTO for spawning a new agent from the Director */
export interface SpawnAgentDto {
    appId: string;
    displayName?: string;
    role?: AgentRole;
    supervisorId?: string;
    initialPrompt?: string;
}
export interface AgentMessage {
    id: string;
    from: string;
    to: string;
    type: 'task_request' | 'task_response' | 'notification' | 'query';
    subject: string;
    payload: string;
    ts: number;
    replyTo?: string;
    ttl?: number;
}
export type ActivityEventKind = 'agent_registered' | 'agent_deregistered' | 'agent_status_change' | 'message_sent' | 'message_completed' | 'context_injected' | 'tool_call_start' | 'tool_call_end' | 'lifecycle_start' | 'lifecycle_end' | 'lifecycle_error' | 'hierarchy_change' | 'system_event' | 'emergency_stop';
export interface ActivityEvent {
    id: string;
    ts: number;
    kind: ActivityEventKind;
    agentId: string;
    targetAgentId?: string;
    windowId?: string;
    appId?: string;
    toolName?: string;
    toolCallId?: string;
    runId?: string;
    payload?: string;
    severity: 'info' | 'warn' | 'error';
}
export declare const REDIS_KEYS: {
    readonly SESSIONS: "gamma:sessions";
    readonly SSE_PREFIX: "gamma:sse:";
    readonly SSE_BROADCAST: "gamma:sse:broadcast";
    readonly MEMORY_BUS: "gamma:memory:bus";
    readonly APP_REGISTRY: "gamma:app:registry";
    readonly APP_DATA_PREFIX: "gamma:app-data:";
    readonly STATE_PREFIX: "gamma:state:";
    readonly EVENT_LAG: "gamma:metrics:event_lag";
    readonly SESSION_REGISTRY_PREFIX: "gamma:session-registry:";
    readonly SESSION_CONTEXT_PREFIX: "gamma:session-context:";
    readonly AGENT_REGISTRY_PREFIX: "gamma:agent-registry:";
    readonly AGENT_REGISTRY_INDEX: "gamma:agent-registry:index";
    readonly AGENT_BROADCAST: "gamma:agent:broadcast";
    readonly AGENT_INBOX: (agentId: string) => `gamma:agent:${string}:inbox`;
    readonly SYSTEM_ACTIVITY: "gamma:system:activity";
    readonly SSE_TICKET_PREFIX: "gamma:sse-ticket:";
};
/** Stream ID is always a string — never parse as number (precision loss) */
export type StreamID = string;
/** Routing type: where the tool executes. */
export type ToolType = 'internal' | 'external';
/** JSON-Schema-like descriptor for a single tool parameter. */
export interface ToolParameterSchema {
    type: 'string' | 'number' | 'boolean' | 'object' | 'array';
    description: string;
    required?: boolean;
    /** Nested properties — only when type is 'object'. */
    properties?: Record<string, ToolParameterSchema>;
    /** Item schema — only when type is 'array'. */
    items?: ToolParameterSchema;
    /** Allowed values constraint. */
    enum?: (string | number)[];
    /** Default value when parameter is omitted. */
    default?: unknown;
}
/** Input/output schema for a tool. */
export interface ToolSchema {
    /** Parameter definitions keyed by parameter name. */
    parameters: Record<string, ToolParameterSchema>;
    /** Human-readable description of the output shape. */
    outputDescription?: string;
}
/**
 * First-class tool definition.
 * Every tool in the system (internal or external) MUST have an ITool entry.
 */
export interface ITool {
    /** Unique tool name — snake_case (e.g. 'fs_read', 'spawn_sub_agent'). */
    name: string;
    /** Human-readable description injected into the LLM prompt. */
    description: string;
    /** Where this tool executes. */
    type: ToolType;
    /** Input/output schema for argument validation and prompt generation. */
    schema: ToolSchema;
    /** Which agent roles may invoke this tool. */
    allowedRoles: AgentRole[];
    /** Optional grouping category (e.g. 'filesystem', 'agent', 'system'). */
    category?: string;
}
/** Standardized result envelope returned by every tool invocation. */
export interface ToolResult {
    ok: boolean;
    /** Name of the tool that was invoked. */
    toolName: string;
    /** Arbitrary result payload — shape is tool-specific. */
    data?: unknown;
    /** Error message when ok === false. */
    error?: string;
    /** Wall-clock execution duration in milliseconds. */
    durationMs: number;
}
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
//# sourceMappingURL=index.d.ts.map