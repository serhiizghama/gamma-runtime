# Gamma OS — Phase 2: Backend Integration Specification
**Version:** 1.1  
**Status:** Draft  
**Audience:** Senior Backend Developer (NestJS + Redis)  
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
NestJS Backend (gamma-os-server)
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
export type AgentStatus = "idle" | "running" | "error";
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
  | { type: "lifecycle_end";   windowId: string; runId: string; stopReason?: string }
  | { type: "lifecycle_error"; windowId: string; runId: string; message: string }

  // ── Thinking / Extended Reasoning ─────────────────────────────────────
  | { type: "thinking"; windowId: string; runId: string; text: string }

  // ── Assistant text (delta streaming) ──────────────────────────────────
  | { type: "assistant_delta"; windowId: string; runId: string; text: string }

  // ── Tool calls ─────────────────────────────────────────────────────────
  | { type: "tool_call";   windowId: string; runId: string; name: string; toolCallId: string; arguments: unknown }
  | { type: "tool_result"; windowId: string; runId: string; name: string; toolCallId: string; result: unknown; isError: boolean }

  // ── Scaffolding ────────────────────────────────────────────────────────
  | { type: "component_ready"; appId: string; modulePath: string }

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
}
```

---

## 4. API Surface

```
POST   /api/sessions                   Create window↔session mapping
DELETE /api/sessions/:windowId         Destroy session
POST   /api/sessions/:windowId/send    Send user message to agent
GET    /api/stream/:windowId           SSE stream (text/event-stream)
POST   /api/scaffold                   Scaffold a new app component
GET    /api/memory-bus                 SSE stream of all memory bus entries
GET    /api/sessions                   List active window→session mappings
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
      await this.pushSSE(streamKey, {
        type: "lifecycle_end", windowId, runId, stopReason: "stop",
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

## 7. SSE Multiplexer (NestJS → Browser)

```typescript
// src/sse/sse.controller.ts
@Controller("api/stream")
export class SseController {
  @Sse(":windowId")
  stream(@Param("windowId") windowId: string): Observable<MessageEvent> {
    return new Observable((subscriber) => {
      const keys = [`gamma:sse:${windowId}`, "gamma:sse:broadcast"];
      let lastIds: Record<string, string> = Object.fromEntries(keys.map(k => [k, "$"]));

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
      return () => subscriber.complete();
    });
  }
}
```

---

## 8. Frontend: How to Handle SSE Events

### 8.1 Event → State Mapping

```typescript
// hooks/useAgentStream.ts — runs inside each agent-enabled WindowNode
function useAgentStream(windowId: string): WindowAgentState {
  const [state, dispatch] = useReducer(agentReducer, INITIAL_WINDOW_AGENT_STATE);

  useEffect(() => {
    const es = new EventSource(`/api/stream/${windowId}`);

    es.onmessage = (e) => {
      const event: GammaSSEEvent = JSON.parse(e.data);
      dispatch(event);
    };

    return () => es.close();
  }, [windowId]);

  return state;
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
2. Architect Agent generates WeatherApp.tsx source
3. Agent calls POST /api/scaffold { appId:"weather", sourceCode:"..." }
4. NestJS writes file to apps/generated/WeatherApp.tsx
5. NestJS: git add && git commit -m "feat: generated WeatherApp"
6. NestJS pushes SSE: { type:"component_ready", appId:"weather", modulePath:"..." }
7. React: const mod = await import(modulePath) → register in app registry
8. User opens Weather from Launchpad — no page reload
```

### 9.2 Scaffold Service

```typescript
@Injectable()
export class ScaffoldService {
  private readonly appsDir = path.resolve(GAMMA_OS_REPO, "apps/generated");
  private readonly git = simpleGit(GAMMA_OS_REPO);

  async scaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
    const safeId   = req.appId.replace(/[^a-z0-9-]/gi, "");
    const fileName = `${pascal(safeId)}App.tsx`;
    const filePath = path.join(this.appsDir, fileName);

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

    const modulePath = `./apps/generated/${fileName.replace(".tsx", "")}`;
    await this.redis.xadd("gamma:sse:broadcast", "*",
      ...flattenEntry({ type: "component_ready", appId: safeId, modulePath })
    );

    return { ok: true, filePath, commitHash, modulePath };
  }
}
```

---

## 10. Redis Key Schema

| Key | Type | TTL | Description |
|---|---|---|---|
| `gamma:sessions` | Hash | — | windowId → WindowSession JSON |
| `gamma:sse:<windowId>` | Stream | 1h | Per-window SSE event stream |
| `gamma:sse:broadcast` | Stream | 1h | Global: component_ready, etc. |
| `gamma:memory:bus` | Stream | 24h | All thoughts + tool calls |
| `gamma:app:registry` | Hash | — | appId → modulePath (generated) |

---

## 11. Environment Variables

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

## 12. NestJS Module Structure

```
gamma-os-server/
├── src/
│   ├── app.module.ts
│   ├── gateway/
│   │   ├── gateway-ws.service.ts      # WS client + event bridge
│   │   ├── event-classifier.ts        # classifyGatewayEventKind
│   │   └── gateway.module.ts
│   ├── sessions/
│   │   ├── sessions.controller.ts
│   │   ├── sessions.service.ts
│   │   └── sessions.module.ts
│   ├── sse/
│   │   ├── sse.controller.ts          # GET /api/stream/:windowId
│   │   └── sse.module.ts
│   ├── scaffold/
│   │   ├── scaffold.controller.ts
│   │   ├── scaffold.service.ts
│   │   ├── scaffold-watcher.service.ts
│   │   └── scaffold.module.ts
│   ├── memory-bus/
│   │   ├── memory-bus.service.ts
│   │   └── memory-bus.module.ts
│   └── redis/
│       └── redis.module.ts
├── .env
└── package.json
```

---

## 13. Implementation Order

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

**Total Phase 2 estimate: ~9 developer-days**
