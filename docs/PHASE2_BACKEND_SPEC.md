# Gamma OS — Phase 2: Backend Integration Specification
**Version:** 1.4  
**Status:** Ready for Implementation  
**Audience:** Senior Backend Developer (NestJS + Redis)  
**Changelog v1.4:** Management & Health — app deletion (unscaffold), system health endpoint (CPU/RAM/Redis/Gateway), tokenUsage in lifecycle_end, path jail guard for scaffold writes.  
**Changelog v1.3:** Resilience & Control — agent interruption (abort endpoint), stream throttling/batching, scaffold asset support + static serving, security linting in validateSource, tool result timeout (30s watchdog).  
**Changelog v1.2:** Production-grade resilience additions — session recovery (F5 sync), scaffold code validation, memory bus hierarchy (decision tree), SSE keep-alive + gateway_status, CORS policy.  
**Changelog v1.1:** Enhanced streaming architecture based on openclaw-studio analysis — phase-aware event bridge, thinking/tool/lifecycle stream types, frontend Zustand state model.

---

## 1. Overview

Phase 2 connects Gamma OS (React-based Web OS) to the **OpenClaw Gateway** running locally on the Mac Mini M4. The result is a live OS where:

- Each open **Window** maps to an **OpenClaw agent session**
- Agent responses stream live into the window: thinking blocks, tool calls, assistant text — all in real-time
- A **System Architect Agent** can generate `.tsx` files, commit them via Git, and hot-reload them into the UI without a full rebuild
- All agent "thought tokens" are intercepted and pushed to `gamma:memory:bus` (Redis Streams)

```
Browser (Gamma OS React)
    │  SSE /api/stream/:windowId
    ▼
NestJS Backend (kernel/)
    │         │
    │  WS     │  Redis Streams
    ▼         ▼
OpenClaw Gateway   Redis 7+
    │
    ▼
Claude / local models / sub-agents
```

---

## 2. Technology Stack

| Layer | Tech |
|---|---|
| Backend framework | NestJS 10 + Fastify adapter |
| Realtime | SSE (client←server), WS (server→OpenClaw) |
| State bus | Redis Streams (ioredis) |
| FS watcher | `chokidar` |
| Git integration | `simple-git` |
| Process runner | `execa` |
| Config | `@nestjs/config` + `.env` |

---

## 3. TypeScript Interfaces

### 3.1 Agent Status

```typescript
// v1.3: added "aborted" — set when user calls POST /abort or tool timeout fires
export type AgentStatus = "idle" | "running" | "error" | "aborted";
```

### 3.2 OpenClaw Gateway Frames

```typescript
/** WS frame types received from OpenClaw Gateway */
export type GWFrameType = "res" | "event";

export interface GWFrame<T = unknown> {
  type: GWFrameType;
  id?: string;
  ok?: boolean;
  event?: string;   // "agent" | "chat" | "presence" | "heartbeat"
  payload?: T;
  seq?: number;
}

export interface GWConnectParams {
  minProtocol: 3;
  maxProtocol: 3;
  client: { id: string; version: string; platform: string; mode: "operator" };
  role: "operator";
  scopes: ["operator.read", "operator.write"];
  auth: { token: string };
  device: { id: string; publicKey: string; signature: string; signedAt: number; nonce: string };
}

/**
 * Agent event payload — emitted per-frame during a run.
 * stream field determines rendering path.
 */
export interface GWAgentEventPayload {
  runId: string;
  sessionKey: string;
  seq?: number;
  stream:
    | "lifecycle"   // run phase transitions
    | "thinking"    // Extended Thinking / reasoning trace
    | "assistant"   // visible LM text output
    | "tool"        // tool call or result
    | string;       // custom streams (reasoning, analysis, etc.)
  data?: {
    phase?: "start" | "end" | "error" | "call" | "result";  // lifecycle OR tool phase
    text?: string;     // full accumulated text
    delta?: string;    // incremental chunk
    thinking?: string; // thinking content (assistant stream)
    name?: string;     // tool name
    toolCallId?: string;
    arguments?: unknown;
    result?: unknown;
    isError?: boolean;
  };
}

/** Chat event payload — final/history messages */
export interface GWChatEventPayload {
  runId: string;
  sessionKey: string;
  state: "delta" | "final" | "aborted" | "error";
  seq?: number;
  stopReason?: string;
  message?: unknown;
  errorMessage?: string;
}
```

### 3.3 Gamma OS SSE Events

```typescript
/**
 * Structured packets pushed to gamma:sse:<windowId> Redis Stream.
 * Frontend discriminates on `type`.
 */
export type GammaSSEEvent =
  // ── Lifecycle ──────────────────────────────────────────────────────────
  | { type: "lifecycle_start"; windowId: string; runId: string }
  | {
      type: "lifecycle_end";
      windowId: string;
      runId: string;
      stopReason?: string;
      /** v1.4: Token consumption for the completed run */
      tokenUsage?: {
        inputTokens: number;
        outputTokens: number;
        cacheReadTokens: number;
        cacheWriteTokens: number;
        /** contextUsedPct: outputTokens / modelContextWindow * 100 */
        contextUsedPct: number;
      };
    }
  | { type: "lifecycle_error"; windowId: string; runId: string; message: string }

  // ── Thinking / Extended Reasoning ─────────────────────────────────────
  | { type: "thinking"; windowId: string; runId: string; text: string }

  // ── Assistant text (delta streaming) ──────────────────────────────────
  | { type: "assistant_delta"; windowId: string; runId: string; text: string }

  // ── Tool calls ─────────────────────────────────────────────────────────
  | { type: "tool_call";   windowId: string; runId: string; name: string; toolCallId: string; arguments: unknown }
  | { type: "tool_result"; windowId: string; runId: string; name: string; toolCallId: string; result: unknown; isError: boolean }

  // ── Scaffolding ────────────────────────────────────────────────────────
  | { type: "component_ready";   appId: string; modulePath: string }
  | { type: "component_removed"; appId: string }                     // ← v1.4

  // ── Error ──────────────────────────────────────────────────────────────
  | { type: "error"; windowId: string; message: string };
```

### 3.4 Window↔Session Mapping

```typescript
export interface WindowSession {
  windowId: string;      // Zustand window UUID
  appId: string;         // e.g. "terminal", "browser"
  sessionKey: string;    // OpenClaw session key
  agentId: string;       // OpenClaw agent id
  createdAt: number;
  status: AgentStatus;
}
```

### 3.5 Frontend Window Agent State (Zustand)

```typescript
/**
 * Per-window agent state — lives inside WindowNode's local state or
 * a dedicated agentWindows slice of useOSStore.
 */
export interface WindowAgentState {
  status: AgentStatus;

  /** Active streaming text — cleared to null when lifecycle:end fires */
  streamText: string | null;

  /**
   * Extended Thinking block — full accumulated reasoning text.
   * Shown as a collapsible block above the assistant response.
   * Cleared on lifecycle:end.
   */
  thinkingTrace: string | null;

  /** Permanent session history — markdown lines appended after lifecycle:end */
  outputLines: string[];

  /** Current run id — used to drop stale frames from previous runs */
  runId: string | null;

  /** Timestamp when current run started */
  runStartedAt: number | null;

  /** Last tool call/result lines rendered in-stream */
  pendingToolLines: string[];
}

export const INITIAL_WINDOW_AGENT_STATE: WindowAgentState = {
  status: "idle",
  streamText: null,
  thinkingTrace: null,
  outputLines: [],
  runId: null,
  runStartedAt: null,
  pendingToolLines: [],
};
```

### 3.6 Memory Bus Entry

```typescript
export interface MemoryBusEntry {
  id: string;
  sessionKey: string;
  windowId: string;
  kind: "thought" | "tool_call" | "tool_result" | "text";
  content: string;
  ts: number;

  // ── v1.2 — Hierarchy support (Decision Tree reconstruction) ───────────
  /**
   * stepId — unique identifier for this reasoning/tool step within a run.
   * Generated as `${runId}:step:${seq}` by the event bridge.
   */
  stepId: string;

  /**
   * parentId — stepId of the parent entry.
   * - For tool_call: parentId = the thinking/assistant entry that triggered it
   * - For tool_result: parentId = the matching tool_call stepId
   * - For thought: parentId = previous thought stepId (for multi-hop reasoning chains)
   * - null for root-level entries (first thought in a run)
   */
  parentId?: string;
}
```

### 3.7 Session Sync Snapshot (v1.2)

```typescript
/**
 * Snapshot returned by GET /api/sessions/:windowId/sync
 * Allows frontend to resume live streams after F5.
 */
export interface WindowStateSyncSnapshot {
  windowId: string;
  sessionKey: string;
  status: AgentStatus;
  runId: string | null;
  /** Last accumulated streamText stored in Redis (null if no active run) */
  streamText: string | null;
  /** Last accumulated thinkingTrace stored in Redis (null if no active run) */
  thinkingTrace: string | null;
  /** Partial pendingToolLines accumulated during the current run */
  pendingToolLines: string[];
  /** Timestamp of last event processed */
  lastEventAt: number | null;
}
```

---

## 4. API Surface

```
POST   /api/sessions                   Create window↔session mapping
DELETE /api/sessions/:windowId         Destroy session
POST   /api/sessions/:windowId/send    Send user message to agent
GET    /api/sessions/:windowId/sync    ← v1.2: F5 recovery snapshot
POST   /api/sessions/:windowId/abort   ← v1.3: Interrupt running agent
GET    /api/stream/:windowId           SSE stream (text/event-stream)
POST   /api/scaffold                   Scaffold a new app component
DELETE /api/scaffold/:appId            ← v1.4: Remove generated app + assets
GET    /api/assets/:appId/*            ← v1.3: Serve scaffold static assets
GET    /api/memory-bus                 SSE stream of all memory bus entries
GET    /api/sessions                   List active window→session mappings
GET    /api/system/health              ← v1.4: CPU / RAM / Redis / Gateway metrics
```

### 4.1 Session Sync Endpoint (v1.2)

```typescript
// src/sessions/sessions.controller.ts
@Get(":windowId/sync")
async sync(@Param("windowId") windowId: string): Promise<WindowStateSyncSnapshot> {
  const session = await this.sessionsService.findByWindowId(windowId);
  if (!session) throw new NotFoundException(`No session for window ${windowId}`);

  // Read live state snapshot from Redis Hash gamma:state:<windowId>
  const raw = await this.redis.hgetall(`gamma:state:${windowId}`);

  return {
    windowId,
    sessionKey: session.sessionKey,
    status: (raw.status as AgentStatus) ?? "idle",
    runId: raw.runId ?? null,
    streamText: raw.streamText ?? null,
    thinkingTrace: raw.thinkingTrace ?? null,
    pendingToolLines: raw.pendingToolLines ? JSON.parse(raw.pendingToolLines) : [],
    lastEventAt: raw.lastEventAt ? Number(raw.lastEventAt) : null,
  };
}
```

The event bridge must **write to `gamma:state:<windowId>`** on every agent event:

```typescript
// Inside handleAgentEvent() — after pushing to gamma:sse:<windowId>
// Maintain a live state snapshot for F5 recovery
await this.redis.hset(`gamma:state:${windowId}`,
  "status",        "running",
  "runId",         runId,
  "lastEventAt",   String(Date.now()),
  // Overwrite streamText / thinkingTrace on each delta
  ...(stream === "assistant" && data?.text
    ? ["streamText", data.text]
    : []),
  ...(stream === "thinking" && data?.text
    ? ["thinkingTrace", data.text]
    : []),
);

// On lifecycle_end: update status, clear ephemeral fields
if (stream === "lifecycle" && data?.phase === "end") {
  await this.redis.hset(`gamma:state:${windowId}`,
    "status",        "idle",
    "runId",         "",
    "streamText",    "",
    "thinkingTrace", "",
    "pendingToolLines", "[]",
  );
}
```

Redis key `gamma:state:<windowId>` — Hash, TTL 4h.

### 4.2 Agent Abort Endpoint (v1.3)

```typescript
// src/sessions/sessions.controller.ts
@Post(":windowId/abort")
async abort(@Param("windowId") windowId: string): Promise<{ ok: boolean }> {
  const session = await this.sessionsService.findByWindowId(windowId);
  if (!session) throw new NotFoundException(`No session for window ${windowId}`);

  await this.gatewayWsService.abortRun(session.sessionKey);

  // Immediately update Redis state — don't wait for Gateway confirmation
  await this.redis.hset(`gamma:state:${windowId}`,
    "status", "aborted",
    "runId", "",
  );

  // Push aborted lifecycle event so SSE clients update immediately
  await this.redis.xadd(`gamma:sse:${windowId}`, "*",
    ...flattenEntry({
      type: "lifecycle_error",
      windowId,
      runId: session.runId ?? "",
      message: "Run aborted by user",
    })
  );

  return { ok: true };
}
```

In `GatewayWsService`:

```typescript
// src/gateway/gateway-ws.service.ts
async abortRun(sessionKey: string): Promise<void> {
  // Send cancellation frame to OpenClaw Gateway
  // OpenClaw protocol: type="req", method="sessions.abort"
  const frameId = ulid();
  this.send({
    type: "req",
    id: frameId,
    method: "sessions.abort",
    params: { sessionKey },
  });

  // Wait up to 2s for Gateway ack — fire-and-forget if no response
  try {
    await this.waitForResponse(frameId, 2000);
  } catch {
    // Gateway may not ack abort — that's acceptable; Redis state is already updated
  }
}
```

Frontend: add `"aborted"` handling in reducer:
```typescript
case "lifecycle_error":
  return {
    ...state,
    status: event.message === "Run aborted by user" ? "aborted" : "error",
    runId: null,
    streamText: null,
  };
```

---

## 5. OpenClaw Gateway WS Client

### 5.1 Connection & Handshake

```typescript
// src/gateway/gateway-ws.service.ts
@Injectable()
export class GatewayWsService implements OnModuleInit {
  private ws: WebSocket;
  private sessionToWindow = new Map<string, string>(); // sessionKey → windowId

  async onModuleInit() { await this.connect(); }

  private async connect() {
    this.ws = new WebSocket(`ws://localhost:${GW_PORT}`);
    this.ws.on("message", (raw) => this.handleFrame(JSON.parse(raw.toString())));

    const challenge = await this.waitForEvent("connect.challenge");
    const signature = await signChallenge(challenge.payload.nonce, DEVICE_PRIVATE_KEY);

    this.send({
      type: "req", id: ulid(), method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "gamma-os-bridge", version: "1.0.0", platform: "macos", mode: "operator" },
        role: "operator",
        scopes: ["operator.read", "operator.write"],
        auth: { token: process.env.OPENCLAW_GATEWAY_TOKEN },
        device: { id: DEVICE_ID, publicKey: DEVICE_PUBLIC_KEY, signature,
                  signedAt: Date.now(), nonce: challenge.payload.nonce },
      },
    });

    await this.waitForResponse(); // hello-ok
  }

  async invokeTool(tool: string, args: Record<string, unknown>, sessionKey = "main") {
    const res = await fetch(`http://localhost:${GW_PORT}/tools/invoke`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}`,
      },
      body: JSON.stringify({ tool, args, sessionKey }),
    });
    return res.json();
  }
}
```

### 5.2 Event Classification

```typescript
// Mirrors openclaw-studio's classifyGatewayEventKind
type GatewayEventKind = "summary-refresh" | "runtime-agent" | "runtime-chat" | "ignore";

function classifyGatewayEventKind(event: string): GatewayEventKind {
  if (event === "presence" || event === "heartbeat") return "summary-refresh";
  if (event === "agent")  return "runtime-agent";
  if (event === "chat")   return "runtime-chat";
  return "ignore";
}

// Custom reasoning streams (beyond "thinking") — e.g. "analysis", "reasoning", "trace"
const REASONING_STREAM_HINTS = ["reason", "think", "analysis", "trace"];
function isReasoningStream(stream: string): boolean {
  const s = stream.trim().toLowerCase();
  if (!s || s === "assistant" || s === "tool" || s === "lifecycle") return false;
  return REASONING_STREAM_HINTS.some((h) => s.includes(h));
}
```

---

## 6. Phase-Aware Event Bridge

The core of the streaming system. Each incoming `agent` WS frame is routed by `stream` field.

```typescript
// src/gateway/gateway-ws.service.ts — handleFrame()
private async handleFrame(frame: GWFrame) {
  const kind = classifyGatewayEventKind(frame.event ?? "");

  // ── Summary refresh (heartbeat/presence) — update session status only ──
  if (kind === "summary-refresh") return; // optional: update Redis status key

  // ── Runtime agent stream ────────────────────────────────────────────────
  if (kind === "runtime-agent") {
    await this.handleAgentEvent(frame.payload as GWAgentEventPayload);
    return;
  }

  // ── Runtime chat (final messages / history) ─────────────────────────────
  if (kind === "runtime-chat") {
    await this.handleChatEvent(frame.payload as GWChatEventPayload);
    return;
  }
}

private async handleAgentEvent(payload: GWAgentEventPayload) {
  const windowId = this.sessionToWindow.get(payload.sessionKey);
  if (!windowId) return;

  const { stream, data, runId } = payload;
  const streamKey = `gamma:sse:${windowId}`;
  const nowMs = Date.now();

  // ── LIFECYCLE ────────────────────────────────────────────────────────────
  if (stream === "lifecycle") {
    const phase = data?.phase;
    if (phase === "start") {
      await this.pushSSE(streamKey, {
        type: "lifecycle_start", windowId, runId,
      });
    } else if (phase === "end") {
      // v1.4: Extract tokenUsage from Gateway payload if available
      const usage = data as Record<string, unknown>;
      const tokenUsage = (usage?.inputTokens != null) ? {
        inputTokens:       Number(usage.inputTokens ?? 0),
        outputTokens:      Number(usage.outputTokens ?? 0),
        cacheReadTokens:   Number(usage.cacheReadTokens ?? 0),
        cacheWriteTokens:  Number(usage.cacheWriteTokens ?? 0),
        contextUsedPct:    Number(usage.contextUsedPct ?? 0),
      } : undefined;

      await this.pushSSE(streamKey, {
        type: "lifecycle_end", windowId, runId, stopReason: "stop",
        ...(tokenUsage ? { tokenUsage } : {}),
      });
    } else if (phase === "error") {
      await this.pushSSE(streamKey, {
        type: "lifecycle_error", windowId, runId,
        message: typeof data?.text === "string" ? data.text : "Run error",
      });
    }
    return;
  }

  // ── THINKING / REASONING STREAMS ─────────────────────────────────────────
  if (stream === "thinking" || isReasoningStream(stream)) {
    const text = data?.text ?? data?.delta ?? "";
    if (!text) return;

    await this.pushSSE(streamKey, { type: "thinking", windowId, runId, text });

    // Also write to memory bus
    await this.pushMemoryBus({
      sessionKey: payload.sessionKey, windowId,
      kind: "thought", content: text, ts: nowMs,
    });
    return;
  }

  // ── ASSISTANT TEXT ────────────────────────────────────────────────────────
  if (stream === "assistant") {
    const text = data?.text ?? data?.delta ?? "";
    // Also intercept embedded thinking (<think> tags)
    const thinkingContent = data?.thinking;

    if (thinkingContent) {
      await this.pushSSE(streamKey, { type: "thinking", windowId, runId, text: thinkingContent });
      await this.pushMemoryBus({
        sessionKey: payload.sessionKey, windowId,
        kind: "thought", content: thinkingContent, ts: nowMs,
      });
    }

    if (text) {
      await this.pushSSE(streamKey, { type: "assistant_delta", windowId, runId, text });
    }
    return;
  }

  // ── TOOL CALLS ────────────────────────────────────────────────────────────
  if (stream === "tool") {
    const phase = data?.phase;
    const name  = data?.name ?? "tool";
    const toolCallId = data?.toolCallId ?? "";

    if (phase !== "result") {
      // Tool call initiated
      await this.pushSSE(streamKey, {
        type: "tool_call", windowId, runId,
        name, toolCallId, arguments: data?.arguments ?? null,
      });
      await this.pushMemoryBus({
        sessionKey: payload.sessionKey, windowId,
        kind: "tool_call",
        content: JSON.stringify({ name, arguments: data?.arguments }),
        ts: nowMs,
      });
    } else {
      // Tool result received
      await this.pushSSE(streamKey, {
        type: "tool_result", windowId, runId,
        name, toolCallId,
        result: data?.result ?? null,
        isError: data?.isError ?? false,
      });
      await this.pushMemoryBus({
        sessionKey: payload.sessionKey, windowId,
        kind: "tool_result",
        content: JSON.stringify({ name, result: data?.result }),
        ts: nowMs,
      });
    }
    return;
  }
}

// Helper: push to Redis Stream
private async pushSSE(streamKey: string, event: GammaSSEEvent) {
  await this.redis.xadd(streamKey, "*", ...flattenEntry(event));
}

private async pushMemoryBus(entry: Omit<MemoryBusEntry, "id">) {
  await this.redis.xadd("gamma:memory:bus", "*",
    ...flattenEntry({ ...entry, id: ulid() })
  );
}
```

---

## 6.2 Tool Result Timeout Watchdog (v1.3)

If a `tool_call` fires but no matching `tool_result` arrives within **30 seconds**, the backend auto-injects a `lifecycle_error` to prevent the UI from hanging indefinitely in "running" state.

```typescript
// src/gateway/tool-watchdog.service.ts
const TOOL_TIMEOUT_MS = 30_000;

@Injectable()
export class ToolWatchdogService {
  private pendingCalls = new Map<string, ReturnType<typeof setTimeout>>();
  // key: `${windowId}:${toolCallId}`

  /**
   * Register a tool call. If no result arrives within TOOL_TIMEOUT_MS,
   * fire the timeout callback.
   */
  register(
    windowId: string,
    toolCallId: string,
    runId: string,
    onTimeout: () => void,
  ): void {
    const key = `${windowId}:${toolCallId}`;
    const timer = setTimeout(() => {
      this.pendingCalls.delete(key);
      onTimeout();
    }, TOOL_TIMEOUT_MS);
    this.pendingCalls.set(key, timer);
  }

  /** Cancel the watchdog when a tool_result arrives in time. */
  resolve(windowId: string, toolCallId: string): void {
    const key = `${windowId}:${toolCallId}`;
    const timer = this.pendingCalls.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingCalls.delete(key);
    }
  }

  /** Clean up all pending timers for a window (on lifecycle_end / abort). */
  clearWindow(windowId: string): void {
    for (const [key, timer] of this.pendingCalls) {
      if (key.startsWith(`${windowId}:`)) {
        clearTimeout(timer);
        this.pendingCalls.delete(key);
      }
    }
  }
}
```

Integrate into `handleAgentEvent()`:

```typescript
// When tool_call arrives:
if (stream === "tool" && data?.phase !== "result") {
  await this.pushSSE(streamKey, { type: "tool_call", ... });

  // Register watchdog
  this.toolWatchdog.register(windowId, data.toolCallId!, runId, async () => {
    await this.pushSSE(streamKey, {
      type: "lifecycle_error",
      windowId,
      runId,
      message: `Tool '${data.name}' timed out after ${TOOL_TIMEOUT_MS / 1000}s`,
    });
    // Update Redis state
    await this.redis.hset(`gamma:state:${windowId}`, "status", "error", "runId", "");
  });
}

// When tool_result arrives:
if (stream === "tool" && data?.phase === "result") {
  this.toolWatchdog.resolve(windowId, data.toolCallId!);
  await this.pushSSE(streamKey, { type: "tool_result", ... });
}

// On lifecycle_end or abort:
this.toolWatchdog.clearWindow(windowId);
```

**Redis impact:** None — watchdog is in-memory only. No additional keys required.  
**Frontend impact:** `lifecycle_error` with timeout message is handled by the existing reducer (`status → "error"`).  
```typescript
// Extend existing lifecycle_error case to distinguish timeout:
case "lifecycle_error": {
  const isTimeout  = event.message?.includes("timed out");
  const isAborted  = event.message === "Run aborted by user";
  return {
    ...state,
    status: isAborted ? "aborted" : isTimeout ? "error" : "error",
    runId: null,
    streamText: null,
    // Show timeout message in outputLines for UX clarity
    outputLines: isTimeout
      ? [...state.outputLines, `⚠️ ${event.message}`]
      : state.outputLines,
  };
}
```
```

---

## 7. SSE Multiplexer (NestJS → Browser)

### 7.1 Streaming Controller (v1.2 — keep-alive + gateway_status)

```typescript
// src/sse/sse.controller.ts
@Controller("api/stream")
export class SseController {
  @Sse(":windowId")
  stream(@Param("windowId") windowId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const keys = [`gamma:sse:${windowId}`, "gamma:sse:broadcast"];
      let lastIds: Record<string, string> = Object.fromEntries(keys.map(k => [k, "$"]));

      // ── v1.2: Keep-alive — send SSE comment every 15s to prevent
      // browser / Nginx / load-balancer timeout (60s default idle).
      // SSE spec: lines starting with ":" are comments, ignored by clients.
      const keepAliveInterval = setInterval(() => {
        if (!subscriber.closed) {
          // Raw SSE comment — NestJS MessageEvent wraps in "data:", so
          // we use a sentinel value and strip it on the client, OR
          // send a typed keep-alive event:
          subscriber.next({ data: JSON.stringify({ type: "keep_alive" }) } as MessageEvent);
        }
      }, 15_000);

      const poll = async () => {
        try {
          const results = await this.redis.xread(
            "BLOCK", 5000, "COUNT", 50,
            "STREAMS", ...keys, ...keys.map(k => lastIds[k])
          );
          if (results) {
            for (const [key, messages] of results) {
              for (const [id, fields] of messages) {
                lastIds[key] = id;
                const event = parseStreamEntry(fields) as GammaSSEEvent;
                subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
              }
            }
          }
          if (!subscriber.closed) poll();
        } catch (e) {
          subscriber.error(e);
        }
      };

      poll();
      return () => {
        clearInterval(keepAliveInterval);
        subscriber.complete();
      };
    });
  }
}
```

### 7.2 Gateway Status Events (v1.2)

When the `GatewayWsService` detects connection loss or reconnect, it broadcasts to `gamma:sse:broadcast`:

```typescript
// src/gateway/gateway-ws.service.ts
private onDisconnect() {
  this.redis.xadd("gamma:sse:broadcast", "*",
    ...flattenEntry({
      type: "gateway_status",
      status: "disconnected",
      ts: Date.now(),
    })
  );
  this.scheduleReconnect();
}

private onReconnected() {
  this.redis.xadd("gamma:sse:broadcast", "*",
    ...flattenEntry({
      type: "gateway_status",
      status: "connected",
      ts: Date.now(),
    })
  );
}
```

Add to `GammaSSEEvent` union:
```typescript
| { type: "gateway_status"; status: "connected" | "disconnected"; ts: number }
| { type: "keep_alive" }
```

Frontend handles:
```typescript
case "gateway_status":
  // Show/hide "Gateway offline" banner in UI
  dispatch({ type: "SET_GATEWAY_STATUS", status: event.status });
  break;
case "keep_alive":
  // Silently discard — only purpose is to prevent timeout
  return state;
```

### 7.3 Stream Throttling & Batching (v1.3)

High-frequency `thinking` and `assistant_delta` events can arrive at 50–200ms intervals. Sending each token directly to the browser causes excessive React re-renders (~20/sec). The SSE bridge **batches** rapid consecutive tokens before forwarding.

```typescript
// src/sse/stream-batcher.ts
const BATCH_WINDOW_MS = 50;

interface PendingBatch {
  windowId: string;
  runId: string;
  thinkingChunks: string[];
  deltaChunks: string[];
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export class StreamBatcher {
  private batches = new Map<string, PendingBatch>();

  constructor(private readonly flush: (event: GammaSSEEvent) => void) {}

  push(event: GammaSSEEvent): void {
    // Only batch thinking and assistant_delta; all other events pass through immediately
    if (event.type !== "thinking" && event.type !== "assistant_delta") {
      this.flush(event);
      return;
    }

    const key = `${event.windowId}:${event.runId}`;
    let batch = this.batches.get(key);

    if (!batch) {
      batch = {
        windowId: event.windowId,
        runId: event.runId,
        thinkingChunks: [],
        deltaChunks: [],
        flushTimer: null,
      };
      this.batches.set(key, batch);
    }

    if (event.type === "thinking")       batch.thinkingChunks.push(event.text);
    if (event.type === "assistant_delta") batch.deltaChunks.push(event.text);

    // Reset debounce window
    if (batch.flushTimer) clearTimeout(batch.flushTimer);
    batch.flushTimer = setTimeout(() => this.flushBatch(key), BATCH_WINDOW_MS);
  }

  private flushBatch(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;

    // Emit merged thinking (last accumulated value wins — Gateway sends full text)
    if (batch.thinkingChunks.length > 0) {
      this.flush({
        type: "thinking",
        windowId: batch.windowId,
        runId: batch.runId,
        text: batch.thinkingChunks.at(-1)!,
      });
    }

    // Emit merged delta (last value wins — Gateway sends full accumulated text)
    if (batch.deltaChunks.length > 0) {
      this.flush({
        type: "assistant_delta",
        windowId: batch.windowId,
        runId: batch.runId,
        text: batch.deltaChunks.at(-1)!,
      });
    }

    this.batches.delete(key);
  }

  destroy(windowId: string, runId: string): void {
    const key = `${windowId}:${runId}`;
    const batch = this.batches.get(key);
    if (batch?.flushTimer) clearTimeout(batch.flushTimer);
    this.batches.delete(key);
  }
}
```

Integrate into SSE controller:
```typescript
// In SseController.stream()
const batcher = new StreamBatcher((event) => {
  subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
});

// In poll loop, replace direct subscriber.next with:
batcher.push(event);

// In cleanup:
return () => {
  clearInterval(keepAliveInterval);
  batcher.destroy("*", "*"); // cleanup all pending batches for this connection
  subscriber.complete();
};
```

**Impact:** React re-renders reduced from ~20/sec to ≤2/sec during high-frequency token streaming.

---

## 8. Frontend: How to Handle SSE Events

### 8.1 Event → State Mapping (v1.2 — with F5 sync phase)

```typescript
// hooks/useAgentStream.ts — runs inside each agent-enabled WindowNode
function useAgentStream(windowId: string): WindowAgentState {
  const [state, dispatch] = useReducer(agentReducer, INITIAL_WINDOW_AGENT_STATE);

  useEffect(() => {
    let es: EventSource;

    // ── v1.2: Sync phase — restore state from Redis snapshot on mount.
    // This handles F5 / page refresh while an agent run is in progress.
    // The sync call happens BEFORE opening SSE so we don't miss events:
    //   1. GET /api/sessions/:windowId/sync  → seed local state
    //   2. Open EventSource with lastEventId if available → resume stream
    const bootstrap = async () => {
      try {
        const res  = await fetch(`/api/sessions/${windowId}/sync`);
        if (res.ok) {
          const snapshot: WindowStateSyncSnapshot = await res.json();
          // Hydrate reducer with snapshot
          dispatch({ type: "sync_snapshot", snapshot });
        }
      } catch {
        // If sync fails (new session, network), just start fresh
      }

      // Open SSE after sync — events arriving now are newer than the snapshot
      es = new EventSource(`/api/stream/${windowId}`);
      es.onmessage = (e) => {
        const event: GammaSSEEvent = JSON.parse(e.data);
        dispatch(event);
      };
    };

    bootstrap();
    return () => es?.close();
  }, [windowId]);

  return state;
}
```

Add `sync_snapshot` case to reducer:
```typescript
case "sync_snapshot": {
  const snap = (event as { snapshot: WindowStateSyncSnapshot }).snapshot;
  // Only hydrate if there's an active run — otherwise keep initial state
  if (snap.status !== "running" || !snap.runId) return state;
  return {
    ...state,
    status: snap.status,
    runId: snap.runId,
    streamText: snap.streamText,
    thinkingTrace: snap.thinkingTrace,
    pendingToolLines: snap.pendingToolLines,
  };
}
```

### 8.2 Reducer Logic

```typescript
function agentReducer(state: WindowAgentState, event: GammaSSEEvent): WindowAgentState {
  switch (event.type) {

    // ── Run started ──────────────────────────────────────────────
    case "lifecycle_start":
      return {
        ...state,
        status: "running",
        runId: event.runId,
        runStartedAt: Date.now(),
        streamText: null,
        thinkingTrace: null,
        pendingToolLines: [],
      };

    // ── Run ended: commit streamText to history ───────────────────
    case "lifecycle_end": {
      if (state.runId !== event.runId) return state;
      const newLines = [...state.outputLines];
      if (state.thinkingTrace) {
        newLines.push(`<details><summary>💭 Thinking</summary>\n\n${state.thinkingTrace}\n</details>`);
      }
      if (state.pendingToolLines.length > 0) {
        newLines.push(...state.pendingToolLines);
      }
      if (state.streamText) {
        newLines.push(state.streamText);
      }
      return {
        ...state,
        status: "idle",
        runId: null,
        runStartedAt: null,
        streamText: null,
        thinkingTrace: null,
        pendingToolLines: [],
        outputLines: newLines,
      };
    }

    case "lifecycle_error":
      return { ...state, status: "error", runId: null, streamText: null };

    // ── Thinking: replace/append to thinkingTrace ─────────────────
    case "thinking":
      if (state.runId !== event.runId) return state;
      return {
        ...state,
        thinkingTrace: event.text,  // Gateway sends full accumulated text
      };

    // ── Assistant text: delta-update streamText ───────────────────
    case "assistant_delta":
      if (state.runId !== event.runId) return state;
      return {
        ...state,
        streamText: event.text,  // Full accumulated text from Gateway
      };

    // ── Tool call: append formatted line ─────────────────────────
    case "tool_call": {
      if (state.runId !== event.runId) return state;
      const line = `🔧 \`${event.name}\`(${JSON.stringify(event.arguments ?? {})})`;
      return { ...state, pendingToolLines: [...state.pendingToolLines, line] };
    }

    // ── Tool result: append formatted line ────────────────────────
    case "tool_result": {
      if (state.runId !== event.runId) return state;
      const status = event.isError ? "❌" : "✅";
      const line = `${status} \`${event.name}\` → ${JSON.stringify(event.result ?? null)}`;
      return { ...state, pendingToolLines: [...state.pendingToolLines, line] };
    }

    default:
      return state;
  }
}
```

### 8.3 UI Rendering Order

```
outputLines     → permanent history (markdown, scrollable)
pendingToolLines → in-progress tool calls (appended live during run)
thinkingTrace   → collapsible "💭 Thinking" block (shown while running)
streamText      → live-printing assistant response (shown while running)
```

---

## 9. App Scaffolding Pipeline

### 9.1 Flow

```
1. User asks: "Build me a Weather app"
2. Architect Agent generates WeatherApp.tsx source + optional assets
3. Agent calls POST /api/scaffold { appId:"weather", sourceCode:"...", files:[...] }
4. NestJS runs security scan → syntax validation → writes files to disk  ← v1.3
5. NestJS: git add && git commit -m "feat: generated WeatherApp"
6. NestJS pushes SSE: { type:"component_ready", appId:"weather", modulePath:"..." }
7. React: const mod = await import(modulePath) → register in app registry
8. User opens Weather from Launchpad — no page reload
9. Assets served via GET /api/assets/:appId/*                             ← v1.3
```

### 9.2 Scaffold Service (v1.2 — with Code Validation)

```typescript
@Injectable()
export class ScaffoldService {
  private readonly appsDir = path.resolve(GAMMA_OS_REPO, "web/apps/generated");
  private readonly git = simpleGit(GAMMA_OS_REPO);

  async scaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
    const safeId   = req.appId.replace(/[^a-z0-9-]/gi, "");
    const fileName = `${pascal(safeId)}App.tsx`;
    const filePath = path.join(this.appsDir, fileName);

    // ── v1.2: Validate generated source before writing to disk ───────────
    const validation = await this.validateSource(req.sourceCode, fileName);
    if (!validation.ok) {
      return { ok: false, error: `Syntax validation failed:\n${validation.errors.join("\n")}` };
    }

    await fs.mkdir(this.appsDir, { recursive: true });
    await fs.writeFile(filePath, req.sourceCode, "utf8");

    let commitHash: string | undefined;
    if (req.commit) {
      await this.git.add(filePath);
      const result = await this.git.commit(
        `feat: generated ${req.displayName} app`,
        { "--author": `${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>` }
      );
      commitHash = result.commit;
    }

    const modulePath = `./web/apps/generated/${fileName.replace(".tsx", "")}`;
    await this.redis.xadd("gamma:sse:broadcast", "*",
      ...flattenEntry({ type: "component_ready", appId: safeId, modulePath })
    );

    return { ok: true, filePath, commitHash, modulePath };
  }

  /**
   * Validates TypeScript/TSX source without writing to disk.
   *
   * Strategy:
   * 1. Fast path — use @typescript-eslint/typescript-estree to parse AST
   *    (no spawning a process, ~10ms). Catches syntax errors.
   * 2. Slow path (optional, only when req.strictCheck=true) — spawn
   *    `tsc --noEmit` in a temp directory for full type-checking (~2-4s).
   *
   * NOTE: @typescript-eslint/typescript-estree is preferred over spawning tsc
   * for every scaffold request because it is synchronous (~10ms) vs
   * tsc (~2-4s per invocation). Full type-check is an optional slow path.
   */
  private async validateSource(
    source: string,
    fileName: string,
  ): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];

    // ── Fast path: AST parse (syntax only) ────────────────────────────────
    try {
      const { parse } = await import("@typescript-eslint/typescript-estree");
      parse(source, {
        jsx: true,
        errorOnUnknownASTType: false,
        comment: false,
        tokens: false,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Syntax error in ${fileName}: ${msg}`);
    }

    // ── Guard: must export a React component ─────────────────────────────
    if (!source.includes("export") || !source.includes("React")) {
      errors.push("Generated file must export a React component");
    }

    return { ok: errors.length === 0, errors };
  }
}
```

### 9.3 Security Linting in validateSource (v1.3)

Before AST parse, run a security scan to block dangerous patterns in AI-generated code:

```typescript
// Extend validateSource() in ScaffoldService

/** Patterns that must never appear in generated app code */
const SECURITY_DENY_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\beval\s*\(/,            reason: "eval() is forbidden — arbitrary code execution risk" },
  { pattern: /\.innerHTML\s*=/,        reason: "innerHTML assignment — XSS risk; use React JSX instead" },
  { pattern: /\.outerHTML\s*=/,        reason: "outerHTML assignment — XSS risk" },
  { pattern: /document\.write\s*\(/,   reason: "document.write() — XSS risk" },
  { pattern: /localStorage\s*\./,      reason: "Direct localStorage access forbidden in generated apps — use OS store" },
  { pattern: /sessionStorage\s*\./,    reason: "Direct sessionStorage access forbidden in generated apps" },
  { pattern: /require\s*\(\s*['"`]child_process/, reason: "child_process require — server-side escape attempt" },
  { pattern: /process\.env\b/,         reason: "process.env access forbidden in generated client apps" },
  { pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/, reason: "External fetch calls require explicit allowlisting" },
];

private async validateSource(
  source: string,
  fileName: string,
): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = [];

  // ── Security scan (runs BEFORE syntax parse) ──────────────────────────
  for (const { pattern, reason } of SECURITY_DENY_PATTERNS) {
    if (pattern.test(source)) {
      errors.push(`Security violation in ${fileName}: ${reason}`);
    }
  }

  // Abort early if security issues found — don't bother parsing
  if (errors.length > 0) return { ok: false, errors };

  // ── Fast path: AST parse (syntax only) ────────────────────────────────
  try {
    const { parse } = await import("@typescript-eslint/typescript-estree");
    parse(source, { jsx: true, errorOnUnknownASTType: false, comment: false, tokens: false });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    errors.push(`Syntax error in ${fileName}: ${msg}`);
  }

  // ── Guard: must export a React component ─────────────────────────────
  if (!source.includes("export") || !source.includes("React")) {
    errors.push("Generated file must export a React component");
  }

  return { ok: errors.length === 0, errors };
}
```

### 9.4 Asset Support for Scaffolding (v1.3)

Update `ScaffoldRequest` to accept optional binary/text assets:

```typescript
export interface ScaffoldAsset {
  /** Relative path inside the app's asset directory, e.g. "icons/logo.png" */
  path: string;
  /** Base64-encoded content for binary assets, or plain text for text assets */
  content: string;
  encoding: "base64" | "utf8";
}

export interface ScaffoldRequest {
  appId: string;
  displayName: string;
  sourceCode: string;
  commit?: boolean;
  strictCheck?: boolean;
  /** v1.3: Optional assets (images, icons, JSON data files) */
  files?: ScaffoldAsset[];
}
```

Write assets to `web/apps/generated/assets/:appId/`:

```typescript
// In ScaffoldService.scaffold(), after writing sourceCode:
if (req.files?.length) {
  const assetsDir = path.join(this.appsDir, "assets", safeId);
  await fs.mkdir(assetsDir, { recursive: true });

  for (const asset of req.files) {
    // Sanitize path — prevent directory traversal
    const safeAssetPath = path.join(assetsDir, path.basename(asset.path));
    const buffer = asset.encoding === "base64"
      ? Buffer.from(asset.content, "base64")
      : Buffer.from(asset.content, "utf8");
    await fs.writeFile(safeAssetPath, buffer);
  }
}
```

**Static asset serving module:**

```typescript
// src/scaffold/scaffold-assets.controller.ts
@Controller("api/assets")
export class ScaffoldAssetsController {
  private readonly assetsRoot = path.join(GAMMA_OS_REPO, "web/apps/generated/assets");

  @Get(":appId/*")
  async serveAsset(
    @Param("appId") appId: string,
    @Param("0") assetPath: string,
    @Res() res: FastifyReply,
  ): Promise<void> {
    const safeAppId   = appId.replace(/[^a-z0-9-]/gi, "");
    const safeRelPath = path.normalize(assetPath).replace(/^(\.\.(\/|\\|$))+/, "");
    const filePath    = path.join(this.assetsRoot, safeAppId, safeRelPath);

    // Ensure path stays within assetsRoot
    if (!filePath.startsWith(this.assetsRoot)) {
      res.status(403).send("Forbidden");
      return;
    }

    try {
      await res.sendFile(filePath);
    } catch {
      res.status(404).send("Asset not found");
    }
  }
}
```

**Dependencies to add:**
```bash
npm install --save-dev @typescript-eslint/typescript-estree
npm install @fastify/static
```

### 9.5 Path Jail Guard (v1.4)

All scaffold file writes are **jailed** to `web/apps/generated/`. The service must reject any path that escapes this boundary — protecting `kernel/`, `web/src/`, `node_modules/`, `.env`, and other project files.

```typescript
// src/scaffold/scaffold.service.ts — path jail utility
private readonly JAIL_ROOT = path.resolve(GAMMA_OS_REPO, "web/apps/generated");

/**
 * Resolves a relative path and verifies it stays within JAIL_ROOT.
 * Throws if path traversal is attempted.
 */
private jailPath(relativePath: string): string {
  const resolved = path.resolve(this.JAIL_ROOT, relativePath);

  if (!resolved.startsWith(this.JAIL_ROOT + path.sep) &&
      resolved !== this.JAIL_ROOT) {
    throw new ForbiddenException(
      `Path traversal attempt blocked: '${relativePath}' resolves outside jail`
    );
  }
  return resolved;
}
```

Apply to every write operation:

```typescript
// Source file
const filePath = this.jailPath(`${pascal(safeId)}App.tsx`);

// Asset files
for (const asset of req.files ?? []) {
  const assetPath = this.jailPath(`assets/${safeId}/${path.basename(asset.path)}`);
  // ...write
}
```

**Protected paths** (blocked by jail):
- `../../src/main.tsx`
- `../../../.env`
- `node_modules/malicious-package/index.js`
- Any absolute path (`/etc/passwd`, etc.)

### 9.6 App Deletion — Unscaffold (v1.4)

```typescript
// src/scaffold/scaffold.controller.ts
@Delete(":appId")
async remove(@Param("appId") appId: string): Promise<{ ok: boolean }> {
  return this.scaffoldService.remove(appId);
}
```

```typescript
// src/scaffold/scaffold.service.ts
async remove(appId: string): Promise<{ ok: boolean }> {
  const safeId   = appId.replace(/[^a-z0-9-]/gi, "");
  const fileName = `${pascal(safeId)}App.tsx`;

  // Jail-checked paths
  const filePath  = this.jailPath(fileName);
  const assetsDir = this.jailPath(`assets/${safeId}`);

  // Remove source file
  try { await fs.unlink(filePath); } catch { /* already gone */ }

  // Remove asset directory
  try { await fs.rm(assetsDir, { recursive: true, force: true }); } catch { /* ok */ }

  // Git: stage removal and commit
  await this.git.rm([filePath]).catch(() => {});
  const hasChanges = (await this.git.status()).files.length > 0;
  if (hasChanges) {
    await this.git.commit(
      `chore: remove generated ${safeId} app`,
      { "--author": `${GIT_AUTHOR_NAME} <${GIT_AUTHOR_EMAIL}>` }
    );
  }

  // Remove from app registry
  await this.redis.hdel("gamma:app:registry", safeId);

  // Broadcast removal so Launchpad removes the icon without page reload
  await this.redis.xadd("gamma:sse:broadcast", "*",
    ...flattenEntry({ type: "component_removed", appId: safeId })
  );

  return { ok: true };
}
```

**Frontend — handle `component_removed`:**
```typescript
// In the dynamic app registry:
eventSource.onmessage = (e) => {
  const event = JSON.parse(e.data);
  if (event.type === "component_removed") {
    appRegistry.delete(event.appId);        // Remove from registry
    launchpadStore.removeApp(event.appId);  // Remove Launchpad icon
    // If a window of this app is open: show "App was removed" state
  }
};
```

---

## 15. System Health Endpoint (v1.4)

```typescript
// src/system/system.controller.ts
@Controller("api/system")
export class SystemController {
  @Get("health")
  async health(): Promise<SystemHealthReport> {
    const [redisOk, redisLatencyMs] = await this.pingRedis();
    const [gwOk,    gwLatencyMs]    = await this.pingGateway();
    const { cpuPct, ramUsedMb, ramTotalMb } = await this.getSystemMetrics();

    return {
      ts: Date.now(),
      status: redisOk && gwOk ? "ok" : "degraded",
      cpu: { usagePct: cpuPct },
      ram: { usedMb: ramUsedMb, totalMb: ramTotalMb, usedPct: Math.round(ramUsedMb / ramTotalMb * 100) },
      redis: { connected: redisOk, latencyMs: redisLatencyMs },
      gateway: { connected: gwOk, latencyMs: gwLatencyMs },
    };
  }

  private async pingRedis(): Promise<[boolean, number]> {
    const t0 = Date.now();
    try {
      await this.redis.ping();
      return [true, Date.now() - t0];
    } catch { return [false, -1]; }
  }

  private async pingGateway(): Promise<[boolean, number]> {
    const t0 = Date.now();
    try {
      const res = await fetch(`http://localhost:${GW_PORT}/ping`, {
        headers: { Authorization: `Bearer ${process.env.OPENCLAW_GATEWAY_TOKEN}` },
        signal: AbortSignal.timeout(2000),
      });
      return [res.ok, Date.now() - t0];
    } catch { return [false, -1]; }
  }

  private async getSystemMetrics() {
    // macOS: use `vm_stat` + `sysctl` via execa for accurate M4 metrics
    const [vmStat, cpuLoad] = await Promise.all([
      execa("vm_stat"),
      execa("sysctl", ["-n", "vm.loadavg"]),
    ]);

    // Parse page counts → MB
    const pageSize = 16384; // macOS M4 page = 16 KB
    const freePages    = parseInt(vmStat.stdout.match(/Pages free:\s+(\d+)/)?.[1] ?? "0");
    const activePages  = parseInt(vmStat.stdout.match(/Pages active:\s+(\d+)/)?.[1] ?? "0");
    const wiredPages   = parseInt(vmStat.stdout.match(/Pages wired down:\s+(\d+)/)?.[1] ?? "0");
    const totalMb      = 16384; // Mac Mini M4 = 16 GB unified memory
    const usedMb       = Math.round((activePages + wiredPages) * pageSize / 1024 / 1024);

    // CPU: 1-min load average as proxy for usage %
    const loadAvg = parseFloat(cpuLoad.stdout.trim().replace(/[{}]/g, "").split(" ")[0] ?? "0");
    const cpuPct  = Math.min(Math.round(loadAvg * 100 / 10), 100); // normalize

    return { cpuPct, ramUsedMb: usedMb, ramTotalMb: totalMb };
  }
}
```

Response schema:
```typescript
export interface SystemHealthReport {
  ts: number;
  status: "ok" | "degraded" | "error";
  cpu:     { usagePct: number };
  ram:     { usedMb: number; totalMb: number; usedPct: number };
  redis:   { connected: boolean; latencyMs: number };
  gateway: { connected: boolean; latencyMs: number };
}
```

**Usage in frontend:**
- Poll `GET /api/system/health` every 30s
- Show a subtle status bar in Gamma OS menu bar: 🟢 OK / 🟡 Degraded / 🔴 Error
- On degraded: show which component is down (Redis? Gateway?)

---

## 10. Redis Key Schema

| Key | Type | TTL | Description |
|---|---|---|---|
| `gamma:sessions` | Hash | — | windowId → WindowSession JSON |
| `gamma:sse:<windowId>` | Stream | 1h | Per-window SSE event stream |
| `gamma:sse:broadcast` | Stream | 1h | Global: component_ready, gateway_status |
| `gamma:memory:bus` | Stream | 24h | All thoughts + tool calls (with stepId/parentId) |
| `gamma:app:registry` | Hash | — | appId → modulePath (generated) |
| `gamma:state:<windowId>` | Hash | 4h | **v1.2** Live state snapshot for F5 recovery |

---

## 11. CORS & Security Policy (v1.2)

### 11.1 Fastify CORS Configuration

```typescript
// src/main.ts
import Fastify from "fastify";
import cors from "@fastify/cors";

const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter(),
);

// Allow EventSource + fetch from Vite dev server and production origins
await app.register(cors, {
  origin: [
    "http://localhost:5173",          // Vite dev server
    "http://127.0.0.1:5173",
    "http://192.168.0.100:5173",      // LAN access
    "http://100.123.78.76:5173",      // Tailscale IP
    "https://sputniks-mac-mini.tailcde006.ts.net",  // Tailscale hostname
  ],
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cache-Control"],
  // EventSource requires credentials=omit by default; 
  // set credentials:true only if using cookie auth
  credentials: false,
});

// SSE requires no Content-Type buffering — disable Fastify compression for /api/stream
app.register(import("@fastify/compress"), {
  encodings: ["gzip"],
  // Exclude SSE routes from compression (breaks streaming)
  customTypes: /^application\//,
});

await app.listen(3001, "0.0.0.0");
```

### 11.2 Security Notes

| Concern | Mitigation |
|---|---|
| Gateway token exposure | Stored only server-side in `.env`; never sent to browser |
| Redis exposure | Bind Redis to `127.0.0.1` only (`bind 127.0.0.1` in redis.conf) |
| Scaffold path traversal | `appId.replace(/[^a-z0-9-]/gi, "")` sanitizes before file write |
| Generated code execution | `validateSource()` runs before disk write; no eval() used |
| CORS for SSE | Explicit origin allowlist; no wildcard `*` |

---

## 12. Environment Variables

```env
OPENCLAW_GATEWAY_URL=ws://localhost:18789
OPENCLAW_GATEWAY_TOKEN=your-token-here

GAMMA_DEVICE_ID=gamma-os-bridge-001
GAMMA_DEVICE_PUBLIC_KEY=base64...
GAMMA_DEVICE_PRIVATE_KEY=base64...

REDIS_URL=redis://localhost:6379

GAMMA_OS_REPO=/Users/sputnik/.openclaw/agents/serhii/projects/gamma-os
GIT_AUTHOR_NAME=serhiizghama
GIT_AUTHOR_EMAIL=zmrser@gmail.com
```

---

## 13. NestJS Module Structure

```
kernel/
├── src/
│   ├── app.module.ts
│   ├── gateway/
│   │   ├── gateway-ws.service.ts      # WS client + event bridge
│   │   ├── event-classifier.ts        # classifyGatewayEventKind
│   │   ├── tool-watchdog.service.ts   # ← v1.3: 30s tool timeout watchdog
│   │   └── gateway.module.ts
│   ├── sessions/
│   │   ├── sessions.controller.ts     # POST /abort ← v1.3
│   │   ├── sessions.service.ts
│   │   └── sessions.module.ts
│   ├── sse/
│   │   ├── sse.controller.ts          # GET /api/stream/:windowId
│   │   ├── stream-batcher.ts          # ← v1.3: 50ms token batcher
│   │   └── sse.module.ts
│   ├── scaffold/
│   │   ├── scaffold.controller.ts     # DELETE /:appId ← v1.4
│   │   ├── scaffold.service.ts        # validateSource + security scan + jail guard ← v1.3/v1.4
│   │   ├── scaffold-assets.controller.ts  # ← v1.3: GET /api/assets/:appId/*
│   │   ├── scaffold-watcher.service.ts
│   │   └── scaffold.module.ts
│   ├── system/
│   │   ├── system.controller.ts       # ← v1.4: GET /api/system/health
│   │   └── system.module.ts
│   ├── memory-bus/
│   │   ├── memory-bus.service.ts
│   │   └── memory-bus.module.ts
│   └── redis/
│       └── redis.module.ts
├── .env.example         # Template; copy to .env for local use
└── package.json
```

---

## 14. Implementation Order

| Priority | Module | Estimated effort |
|---|---|---|
| P0 | Redis setup + key schema | 0.5 day |
| P0 | GatewayWsService — connect + handshake | 1 day |
| P0 | Phase-aware event bridge (lifecycle/thinking/assistant/tool) | 1 day |
| P0 | Sessions CRUD + Redis mapping | 0.5 day |
| P0 | SSE multiplexer (per-window + broadcast) | 1 day |
| P1 | Frontend `useAgentStream` hook + reducer | 1 day |
| P1 | Memory bus interception | 0.5 day |
| P1 | Scaffold service + Git integration | 1 day |
| P1 | FS watcher (hot-reload fallback) | 0.5 day |
| P2 | Frontend dynamic import registry | 1 day |
| P2 | Memory bus visualization (Gamma OS UI panel) | 1 day |
| P2 | **v1.2** Session sync endpoint + Redis state hash | 0.5 day |
| P2 | **v1.2** SSE keep-alive + gateway_status events | 0.5 day |
| P2 | **v1.2** Scaffold code validation (AST parse) | 0.5 day |
| P2 | **v1.2** Memory bus parentId/stepId hierarchy | 0.5 day |
| P2 | **v1.2** CORS policy + Fastify config | 0.5 day |
| P2 | **v1.2** Frontend sync-on-mount in useAgentStream | 0.5 day |
| P2 | **v1.3** Agent abort endpoint + Gateway cancel frame | 0.5 day |
| P2 | **v1.3** StreamBatcher (50ms token debounce) | 0.5 day |
| P2 | **v1.3** Scaffold asset upload + static serving | 0.5 day |
| P2 | **v1.3** Security linting (8 deny patterns) | 0.25 day |
| P2 | **v1.3** Tool result watchdog (30s timeout) | 0.5 day |
| P2 | **v1.4** App deletion + component_removed broadcast | 0.5 day |
| P2 | **v1.4** System health endpoint (CPU/RAM/Redis/GW) | 0.5 day |
| P2 | **v1.4** tokenUsage in lifecycle_end event | 0.25 day |
| P2 | **v1.4** Path jail guard for all scaffold writes | 0.25 day |

**Total Phase 2 estimate: ~15.5 developer-days**  
*(+1.5 days for v1.4 management & health layer)*

---

## 16. Specification Summary

| Version | Theme | Key Additions |
|---|---|---|
| v1.0 | Foundation | WS bridge, Redis Streams, SSE, basic session CRUD |
| v1.1 | Live Streaming | Phase-aware events (thinking/tool/lifecycle), frontend reducer |
| v1.2 | Resilience | F5 sync, code validation, memory hierarchy, keep-alive, CORS |
| v1.3 | Control | Abort, stream batching, asset scaffold, security linting, tool timeout |
| v1.4 | Management | App deletion, system health, tokenUsage, path jail |

**This specification is now feature-complete. Next step: NestJS boilerplate generation.**
