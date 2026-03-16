# Phase 6, Stage 1: Agent Capability Architecture — Hybrid Tool Registry

> **Status:** Draft — Awaiting Architect Approval
> **Date:** 2026-03-16
> **Scope:** `gamma-core` NestJS backend
> **Depends on:** Phase 4 (Agent Registry), Phase 5 (Activity Stream)

---

## 1. Problem Statement

Today, tool definitions are hardcoded as string arrays (`APP_OWNER_TOOLS`, `SYSTEM_ARCHITECT_TOOLS`) inside `gateway-ws.service.ts`. There is no structured schema, no input/output validation, and no way for the LLM to dynamically discover tool capabilities at prompt-assembly time. External tools (handled by OpenClaw Gateway) and potential internal tools (executed within NestJS) share no common abstraction.

**This plan introduces a `ToolRegistryModule`** — a centralized, typed, hybrid registry that:
- Defines every tool as a first-class object with JSON Schema for inputs/outputs.
- Routes execution to either an **internal NestJS handler** or the **OpenClaw Gateway** `/tools/invoke` endpoint.
- Exposes a dynamic tool manifest for prompt injection.

---

## 2. Directory & File Structure

```
apps/gamma-core/src/
├── tools/                              # NEW — ToolRegistryModule
│   ├── tools.module.ts                 # NestJS module definition
│   ├── tool-registry.service.ts        # Core registry: register, lookup, invoke, manifest
│   ├── tool-executor.service.ts        # Hybrid routing: internal vs. external dispatch
│   ├── interfaces/
│   │   ├── tool-definition.interface.ts    # ITool, ToolType, ToolSchema, ToolResult
│   │   └── tool-executor.interface.ts      # IToolExecutor contract for internal tools
│   ├── dto/
│   │   ├── tool-invoke.dto.ts          # Inbound DTO: invoke a tool by name + args
│   │   └── tool-result.dto.ts          # Outbound DTO: standardized result envelope
│   ├── internal/                       # Internal tool handlers (NestJS-native)
│   │   ├── spawn-sub-agent.tool.ts     # Example: spawn_sub_agent
│   │   └── send-message.tool.ts        # Example: send_message (inter-agent)
│   └── constants.ts                    # Tool names enum, OpenClaw endpoint config
│
packages/gamma-types/
│   └── index.ts                        # + ITool, ToolType, ToolSchema, ToolResult exports
```

**Why this layout:**
- `tools/` sits as a peer to `gateway/`, `sessions/`, `messaging/` — same pattern.
- `interfaces/` holds contracts; `dto/` holds validated request/response shapes; `internal/` holds NestJS-native tool implementations.
- Shared type definitions go into `@gamma/types` so the UI (and future services) can reference tool schemas.

---

## 3. Core Interfaces

### 3.1 `ITool` — Tool Definition

```typescript
// packages/gamma-types/index.ts (additions)

export type ToolType = 'internal' | 'external';

export interface ToolParameterSchema {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  /** For type: 'object' — nested property schemas */
  properties?: Record<string, ToolParameterSchema>;
  /** For type: 'array' — item schema */
  items?: ToolParameterSchema;
  /** Enum constraint */
  enum?: (string | number)[];
  /** Default value */
  default?: unknown;
}

export interface ToolSchema {
  /** JSON-Schema-like input parameter definitions */
  parameters: Record<string, ToolParameterSchema>;
  /** Short description of what the output contains */
  outputDescription?: string;
}

export interface ITool {
  /** Unique tool name — snake_case, e.g. 'fs_read', 'spawn_sub_agent' */
  name: string;
  /** Human-readable description for LLM prompt injection */
  description: string;
  /** Routing type */
  type: ToolType;
  /** Input/output schema */
  schema: ToolSchema;
  /** Which agent roles can use this tool */
  allowedRoles: AgentRole[];
  /** Optional: category for grouping in UI/prompts */
  category?: string;
}
```

### 3.2 `ToolResult` — Standardized Execution Result

```typescript
// packages/gamma-types/index.ts (additions)

export interface ToolResult {
  ok: boolean;
  /** Tool name that was invoked */
  toolName: string;
  /** Arbitrary result payload — tool-specific */
  data?: unknown;
  /** Error message if ok === false */
  error?: string;
  /** Execution duration in ms */
  durationMs: number;
}
```

### 3.3 `IToolExecutor` — Internal Tool Contract

```typescript
// apps/gamma-core/src/tools/interfaces/tool-executor.interface.ts

export interface IToolExecutor {
  /** Must match the ITool.name this executor handles */
  readonly toolName: string;

  /**
   * Execute the tool with validated arguments.
   * @param args - Validated input arguments (already passed through DTO validation).
   * @param context - Execution context (agentId, sessionKey, windowId).
   * @returns ToolResult
   */
  execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult>;
}

export interface ToolExecutionContext {
  agentId: string;
  sessionKey: string;
  windowId: string;
  appId: string;
  role: AgentRole;
}
```

---

## 4. Hybrid Routing Logic

### 4.1 Registration

On module init, `ToolRegistryService` collects tool definitions from two sources:

1. **Internal tools** — Each internal tool handler (e.g., `SpawnSubAgentTool`) is a NestJS `@Injectable()` that implements `IToolExecutor` and declares a static `DEFINITION: ITool` with `type: 'internal'`. The `ToolsModule` registers them via a `TOOL_EXECUTORS` multi-provider token.

2. **External tools** — Declared as static `ITool` objects with `type: 'external'` in a configuration array (`EXTERNAL_TOOL_DEFINITIONS` in `constants.ts`). No executor needed — they all route to OpenClaw.

```
┌──────────────────────────────────────────────────────────────────┐
│                     ToolRegistryService                          │
│                                                                  │
│  Map<string, ITool>          toolDefinitions                     │
│  Map<string, IToolExecutor>  internalExecutors                   │
│                                                                  │
│  register(tool: ITool, executor?: IToolExecutor)                 │
│  invoke(name, args, context) → ToolResult                        │
│  getManifest(role: AgentRole) → ITool[]                          │
│  getToolSchema(name) → ToolSchema | null                         │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 Invocation Flow

```
Agent (LLM) requests tool_call(name, args)
        │
        ▼
┌─ GatewayWsService ─────────────────────────┐
│  1. Intercept tool_call event               │
│  2. Validate: is tool in session allowlist? │
│  3. Delegate to ToolRegistryService.invoke() │
└─────────────────────────────────────────────┘
        │
        ▼
┌─ ToolRegistryService.invoke() ──────────────┐
│  1. Lookup ITool by name                     │
│  2. Validate role permission (allowedRoles)  │
│  3. Validate args against tool schema (Ajv)   │
│  4. Branch on tool.type:                     │
│     ├─ 'internal' → internalExecutors.get()  │
│     │               .execute(args, ctx)      │
│     └─ 'external' → ToolExecutorService      │
│                      .invokeExternal(...)     │
└──────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
┌─ Internal Handler ─┐   ┌─ ToolExecutorService ──────────┐
│  e.g. SpawnSubAgent │   │  HTTP POST to OpenClaw Gateway  │
│  Direct NestJS call │   │  POST /tools/invoke             │
│  Returns ToolResult │   │  { tool: name, args, context }  │
└─────────────────────┘   │  Returns ToolResult             │
                          └─────────────────────────────────┘
```

### 4.3 External Tool Proxy (`ToolExecutorService`)

- Uses **native `fetch`** (consistent with existing `system-health.service.ts` — no new HTTP dependency).
- OpenClaw Gateway base URL from `ConfigService` (`OPENCLAW_GATEWAY_URL`). Auth token from `ConfigService` (`OPENCLAW_GATEWAY_TOKEN`).
- POST `/tools/invoke` with body: `{ tool: string, arguments: Record<string, unknown>, context: ToolExecutionContext }`.
- Timeout: 30s (aligned with existing `ToolWatchdogService`).
- Response mapped to `ToolResult`.

### 4.4 Dynamic Manifest for LLM Prompt

`ToolRegistryService.getManifest(role)` returns a filtered list of `ITool` objects based on the agent's role. The `ContextInjectorService` calls this at prompt-assembly time and serializes it as a JSON block in the system prompt:

```
[AVAILABLE TOOLS]
${JSON.stringify(manifest, null, 2)}
```

This replaces the current hardcoded string arrays in `gateway-ws.service.ts`.

---

## 5. DTOs (class-validator)

### 5.1 `ToolInvokeDto`

```typescript
// apps/gamma-core/src/tools/dto/tool-invoke.dto.ts

import { IsString, IsNotEmpty, IsObject, IsOptional } from 'class-validator';

export class ToolInvokeDto {
  @IsString()
  @IsNotEmpty()
  toolName: string;

  @IsObject()
  arguments: Record<string, unknown>;

  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  sessionKey: string;

  @IsString()
  @IsOptional()
  toolCallId?: string;
}
```

### 5.2 `ToolResultDto`

```typescript
// apps/gamma-core/src/tools/dto/tool-result.dto.ts

import { IsBoolean, IsString, IsNumber, IsOptional } from 'class-validator';

export class ToolResultDto {
  @IsBoolean()
  ok: boolean;

  @IsString()
  toolName: string;

  @IsOptional()
  data?: unknown;

  @IsString()
  @IsOptional()
  error?: string;

  @IsNumber()
  durationMs: number;
}
```

---

## 6. Integration Points with Existing Code

| Existing Service | Change Required | Details |
|---|---|---|
| `GatewayWsService` | **Refactor** tool dispatch | Replace inline tool scoping arrays with `ToolRegistryService.getManifest()` for allowlist resolution. Delegate `tool_call` handling to `ToolRegistryService.invoke()`. |
| `ContextInjectorService` | **Extend** prompt assembly | Call `ToolRegistryService.getManifest(role)` to inject structured tool definitions into system prompt instead of flat name lists. |
| `ToolWatchdogService` | **No change** | Continues to operate at the WebSocket frame level. Registry adds validation *before* watchdog timeout starts. |
| `ToolJailGuardService` | **No change** | Path-based jail enforcement stays as-is. Registry handles role permissions; JailGuard handles filesystem boundaries. |
| `ActivityStreamService` | **Extend** | Emit `tool_call_start` / `tool_call_end` events from `ToolRegistryService.invoke()` with structured metadata (tool name, type, duration). |
| `@gamma/types` | **Extend** | Add `ITool`, `ToolType`, `ToolSchema`, `ToolParameterSchema`, `ToolResult` exports. |
| `AppModule` | **Import** | Add `ToolsModule` to root module imports. |

---

## 7. Implementation Phasing (PR-sized Steps)

### PR 1: Shared Types & Interfaces
**Scope:** `packages/gamma-types` + `apps/gamma-core/src/tools/interfaces/`
**Files:**
- `packages/gamma-types/index.ts` — Add `ITool`, `ToolType`, `ToolSchema`, `ToolParameterSchema`, `ToolResult`
- `apps/gamma-core/src/tools/interfaces/tool-definition.interface.ts` — Re-export from `@gamma/types`
- `apps/gamma-core/src/tools/interfaces/tool-executor.interface.ts` — `IToolExecutor`, `ToolExecutionContext`

**Tests:** Type-level only (compile check). Ensure `@gamma/types` build passes.
**Merge criteria:** `pnpm build:types && pnpm typecheck` green.

---

### PR 2: ToolRegistryService + DTOs + Module Shell
**Scope:** Core registry logic with in-memory registration, lookup, and manifest generation.
**Files:**
- `apps/gamma-core/src/tools/tools.module.ts`
- `apps/gamma-core/src/tools/tool-registry.service.ts`
- `apps/gamma-core/src/tools/dto/tool-invoke.dto.ts`
- `apps/gamma-core/src/tools/dto/tool-result.dto.ts`
- `apps/gamma-core/src/tools/constants.ts` — `EXTERNAL_TOOL_DEFINITIONS` array, `TOOL_EXECUTORS` injection token
- `apps/gamma-core/src/app.module.ts` — Import `ToolsModule`

**Key behaviors:**
- `register(tool, executor?)` — stores definition + optional executor
- `invoke(name, args, context)` — lookup, role check, **dynamic JSON Schema validation via Ajv** against `ITool.schema.parameters` before dispatch, **internal-only** dispatch (external stubbed as TODO)
- `getManifest(role)` — returns filtered `ITool[]` for a given `AgentRole`
- `getToolSchema(name)` — returns schema or null

**New dependency:** `ajv` — for runtime JSON Schema validation of tool arguments against each tool's parameter schema.

**Tests:** Unit tests for registry (register, lookup, manifest filtering, role enforcement, argument schema validation).
**Merge criteria:** All unit tests pass. Module initializes cleanly with `pnpm dev:core`.

---

### PR 3: External Tool Proxy (ToolExecutorService)
**Scope:** HTTP dispatch to OpenClaw Gateway.
**Files:**
- `apps/gamma-core/src/tools/tool-executor.service.ts`
- Update `tools.module.ts` — register `ToolExecutorService`
- Update `tool-registry.service.ts` — wire `type: 'external'` branch to `ToolExecutorService`

**Key behaviors:**
- `invokeExternal(tool: ITool, args, context)` → `fetch(POST ${OPENCLAW_URL}/tools/invoke, { tool, arguments, context })`
- **Authentication:** Must include `Authorization: Bearer ${OPENCLAW_GATEWAY_TOKEN}` header (from `ConfigService`). OpenClaw strictly requires this.
- Timeout handling (30s AbortController)
- Map response to `ToolResult`
- Retry: **none** (tool calls are not idempotent — fail fast)

**Tests:** Unit tests with mocked `fetch`. Integration test with a local mock server if feasible.
**Merge criteria:** External dispatch works end-to-end in dev with OpenClaw Gateway running.

---

### PR 4: Internal Tool Handlers (First Two)
**Scope:** Implement `spawn_sub_agent` and `send_message` as internal tools.
**Files:**
- `apps/gamma-core/src/tools/internal/spawn-sub-agent.tool.ts`
- `apps/gamma-core/src/tools/internal/send-message.tool.ts`
- Update `tools.module.ts` — register via `TOOL_EXECUTORS` multi-provider
- Update `constants.ts` — add tool definitions to `EXTERNAL_TOOL_DEFINITIONS` for existing OpenClaw tools (fs_read, fs_write, fs_list, shell_exec, etc.)

**Pattern for internal tools:**
```typescript
@Injectable()
export class SpawnSubAgentTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'spawn_sub_agent',
    description: 'Spawn a new sub-agent under the current agent\'s supervision.',
    type: 'internal',
    schema: { parameters: { ... } },
    allowedRoles: ['architect'],
  };

  readonly toolName = SpawnSubAgentTool.DEFINITION.name;

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  async execute(args, context): Promise<ToolResult> { ... }
}
```

**Tests:** Unit tests for each internal tool handler.
**Merge criteria:** Both tools invocable through registry. Existing tool scoping unchanged for external tools.

---

### PR 5: Integration — Wire into GatewayWsService + ContextInjector
**Scope:** Replace legacy tool scoping with registry-driven dispatch.
**Files:**
- `apps/gamma-core/src/gateway/gateway-ws.service.ts` — Replace `APP_OWNER_TOOLS` / `SYSTEM_ARCHITECT_TOOLS` / `resolveAllowedTools()` with `ToolRegistryService.getManifest(role)`
- `apps/gamma-core/src/scaffold/context-injector.service.ts` — Inject tool manifest into system prompt
- `apps/gamma-core/src/tools/tool-registry.service.ts` — Add `ActivityStreamService` integration (emit tool_call_start/end)

**Migration strategy:**
1. Keep `resolveAllowedTools()` as fallback during transition (feature flag via `ConfigService`: `TOOL_REGISTRY_ENABLED`).
2. When enabled, tool_call events route through `ToolRegistryService.invoke()`.
3. When disabled, existing WebSocket passthrough behavior is preserved.
4. Remove fallback in a follow-up PR once stable in staging.

**Tests:** E2E smoke test: send a message to an agent session, verify tool_call flows through registry and returns result.
**Merge criteria:** Full agent loop works with registry enabled. No regression with registry disabled.

---

## 8. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Breaking existing tool dispatch during migration | Agent sessions fail mid-conversation | Feature flag (`TOOL_REGISTRY_ENABLED`). Fallback to legacy path. |
| OpenClaw Gateway `/tools/invoke` contract mismatch | External tools return unexpected shapes | Define strict ToolResult contract. Validate response shape. Log + surface mismatches as `lifecycle_error`. |
| Schema drift between registry and OpenClaw | LLM sends args that OpenClaw rejects | Single source of truth: `EXTERNAL_TOOL_DEFINITIONS` in `constants.ts`. OpenClaw must conform. |
| Performance overhead of registry lookup on every tool call | Latency increase per tool call | In-memory `Map` lookup — O(1). Negligible compared to LLM + Gateway latency. |

---

## 9. Out of Scope (Future Phases)

- **Dynamic tool registration via API** (hot-loading tools at runtime) — Phase 6, Stage 2.
- **Tool versioning** — not needed until multi-gateway support.
- **Tool-level rate limiting** — Phase 7 (Security Hardening).
- **MCP (Model Context Protocol) integration** — separate workstream, can layer on top of this registry.
- **UI tool explorer** — gamma-ui feature, depends on manifest endpoint.

---

## 10. Acceptance Criteria

- [ ] All tool definitions are typed as `ITool` with full schema.
- [ ] Internal tools execute within NestJS process; external tools proxy to OpenClaw.
- [ ] Role-based filtering works: app-owner sees only its tools, architect sees all.
- [ ] `getManifest(role)` returns serializable JSON suitable for prompt injection.
- [ ] Feature flag allows rollback to legacy tool scoping.
- [ ] ActivityStream emits `tool_call_start` / `tool_call_end` for all invocations.
- [ ] Zero regressions on existing agent sessions.
