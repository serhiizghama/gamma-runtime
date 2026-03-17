## Phase 7 — Stage 2: Inter-Agent Communication (IPC & Workflows)

**Status:** Proposed  
**Author:** System Architect  
**Date:** 2026-03-17  
**Scope:** Backend (NestJS `gamma-core`, Redis Streams, OpenClaw plugin layer), ActivityStream wiring for UI

---

## 1. IPC Architecture Overview

Stage 2 builds on Stage 1’s persistent agents and existing IPC substrate to enable **structured task delegation** and **hierarchical workflows** between agents.

- **Core primitives re-used**
  - `MessageBusService` — Redis Streams inbox per agent (`gamma:agent:<id>:inbox`) + broadcast. **Only `gamma-core` talks to Redis.** OpenClaw plugins never touch Redis directly.
  - `AgentRegistryService` — authoritative directory with `role`, `supervisorId`, `status`, `acceptsMessages`.
  - `AgentStateRepository` (`gamma-state.db`) — persistent record of agents and their hierarchical relationships; used for **authorization of IPC flows**.
  - `GatewayWsService` — manages OpenClaw sessions and role-based tool manifests.
  - `ActivityStreamService` — global structured event log consumed by Director / future React Flow UI.

- **New Stage 2 capabilities**
  - A dedicated **OpenClaw tool** `delegate_task` for high-level, structured inter-agent delegation.
  - A **Gamma-core IPC service** to validate, authorize, route, and persist delegated tasks into agent inboxes.
  - **Task identifiers and threading**: every delegation receives a stable `taskId` from `gamma-core` and is returned synchronously to the delegating agent.
  - **Automatic, concurrency-safe wake-up** of idle target agents, injecting the delegated task as a **high-priority user prompt** only when the agent is not already running.
  - Standardized **workflow events** (`ipc_message_sent`, `ipc_task_started`, `ipc_task_completed`) emitted into `ActivityStream`.
  - A **callback/reporting path** so sub-agents can reply to their supervisors and close the loop.

### 1.1 Event Flow (Text Diagram)

End-to-end flow for a delegated task:

1. **Supervisor agent (OpenClaw)** calls `delegate_task`:
   - Inputs: `targetAgentId` or `targetRole/department`, `taskDescription`, `expectedOutputFormat`, optional `contextReferences`.
   - Tool runs inside OpenClaw plugin (Node), with `ctx.agentId` as `sourceAgentId`.

2. **OpenClaw plugin → Gamma-core (Gateway HTTP / internal REST)**:
   - Plugin issues `POST /internal/ipc/delegate` (exact path configurable, but **must be an internal HTTP call** through `gamma-core`, not direct Redis).
   - Body:
     - `sourceAgentId`, `targetAgentId | targetRole/department`, `taskDescription`, `expectedOutputFormat`, `contextReferences`, `priority`, `correlationId`.

3. **Gamma-core IPC pipeline (IpcRoutingService)**:
   - `IpcController` (Nest) receives the request and forwards it to `IpcRoutingService`.
   - `IpcRoutingService`:
     1. Validates `sourceAgentId` + `targetAgentId/role` via `AgentRegistryService`.
     2. **Authorizes the delegation via `AgentStateRepository` (SQLite)**: enforces that `delegate_task` is used only for downward or peer delegation within the same corporate tree.
     3. Resolves concrete `targetAgentId` (from direct ID or role/department selector).
     4. Allocates a new **`taskId`** (stable workflow identifier) and constructs a `DelegatedTaskEnvelope`.
     5. Persists the delegation (envelope) in a small `delegations` table in `gamma-state.db` keyed by `taskId` for durable tracking.
     6. Writes a message into the target’s inbox via `MessageBusService`:
        - `MessageBusService.send(sourceAgentId, targetAgentId, 'task_request', subject, envelope, replyTo?)`.
     7. Emits `ActivityStreamService.emit({ kind: 'ipc_message_sent', ... })`.
     8. Runs **concurrency-safe wake-up logic**:
        - If the target agent is **IDLE** or **OFFLINE** and `acceptsMessages === true`, trigger `GatewayWsService.createSession(sessionKey=targetAgentId, agentId=targetAgentId, systemPrompt=...)` (if needed).
        - Immediately enqueue a high-priority user message to the agent session (via existing `SessionsService.sendMessage` / Gateway `chat.send`) that summarizes the delegated task and embeds the structured envelope.
        - If the target agent is **RUNNING / THINKING**, **do not inject** a prompt; the message simply remains queued in Redis.
        - Emits `ipc_task_started` when a run is actually started for this `taskId`.

4. **Subordinate agent execution**:
   - Target agent’s OpenClaw session receives the delegated task prompt.
   - Agent uses its own tools (e.g. `vector_store`, filesystem, HTTP, etc.) to fulfill the task.

5. **Callback / response**:
   - On completion, the subordinate calls either:
     - `report_status` (new OpenClaw tool) pointing back to `sourceAgentId` and original `taskId`, **or**
     - `send_message` with `type='task_response'` and `replyTo=<delegationMessageId>`, embedding the `taskId`.
   - Gamma-core:
     - Writes the response into the supervisor’s inbox via `MessageBusService.send`.
     - Updates the delegation record in `gamma-state.db` and emits `ipc_task_completed` (and optionally `message_completed`) into `ActivityStream`.

6. **Post-run inbox draining (busy → idle transition)**:
   - When **any agent finishes a run** and transitions to `IDLE`, `SessionsService` (or a small `AgentRunLifecycleService`) must:
     - Check the agent’s inbox (`MessageBusService.readInbox`) for pending IPC messages.
     - If messages exist, trigger a new OpenClaw run for that agent and inject the queued messages (in order) as high-priority prompts.
     - Emit `ipc_task_started` for each dequeued `taskId`.

**Key traceability guarantee:** every delegation and response carries `delegationId` + `correlationId`, and ActivityStream events always include `sourceAgentId`, `targetAgentId`, `status`, enabling Stage 3’s React Flow UI to render animated edges and task progress between nodes.

---

## 2. Data Models & Tool Schema

### 2.1 OpenClaw Tool: `delegate_task`

**Location (new):**
- OpenClaw plugin package, e.g. `skills/openclaw-ipc/src/index.ts` (or an extension of `openclaw-knowledge` if we keep a single plugin bundle).

**Tool contract (conceptual TypeScript, plugin-side):**

```typescript
export interface DelegateTaskContextReference {
  /** Vector DB namespace or logical knowledge bucket, e.g. "repo:gamma-runtime", "customers:acme". */
  namespace: string;
  /** Optional semantic tag, used by receiver to decide how to query. */
  tag?: string;
  /** Optional human-readable hint about what this reference contains. */
  description?: string;
}

export interface DelegateTaskParams {
  /** Concrete target agent id; mutually exclusive with role/department selectors. */
  targetAgentId?: string;

  /** High-level role label, e.g. "qa", "devops", "researcher". */
  targetRole?: string;

  /** Optional higher-level grouping, e.g. "billing", "infra", "docs". */
  targetDepartment?: string;

  /** Natural language description of the delegated task. */
  taskDescription: string;

  /**
   * Instructions for how the caller wants the result formatted.
   * Example: "Markdown report with sections: Summary, Risks, Next Steps" or
   * "JSON array of { filePath, issue, suggestedFix }".
   */
  expectedOutputFormat: string;

  /** Optional vector-store or knowledge-hub references the callee should use. */
  contextReferences?: DelegateTaskContextReference[];

  /** Optional explicit priority hint; higher priority wakes idle agents sooner. */
  priority?: 'low' | 'normal' | 'high';

  /** Optional correlation id for the delegating agent's own workflow/thread. */
  correlationId?: string;
}

export interface DelegateTaskResult {
  /** Stable workflow id generated by gamma-core, used across ActivityStream, inbox, and status reports. */
  taskId: string;
  /** Backwards-compatible alias; equal to taskId. */
  delegationId: string;
  /** Concrete resolved target agent id. */
  targetAgentId: string;
  /** Status after initial routing. */
  status: 'queued' | 'started' | 'failed';
  /** Optional machine-readable error when status === 'failed'. */
  error?: string;
}
```

**OpenClaw registration (simplified):**

```typescript
export default function register(api: any): void {
  api.registerTool((ctx: { agentId?: string; sessionKey?: string }) => ({
    name: 'delegate_task',
    description:
      'Delegate a structured task to another Gamma agent, ' +
      'optionally specifying role/department and shared context references.',
    // Allowed roles are enforced in gamma-core and in Stage 2 also filtered here:
    // 'architect', 'team-lead', 'supervisor' (see below).
    parameters: {
      type: 'object',
      properties: {
        targetAgentId: { type: 'string' },
        targetRole: { type: 'string' },
        targetDepartment: { type: 'string' },
        taskDescription: { type: 'string' },
        expectedOutputFormat: { type: 'string' },
        contextReferences: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              namespace: { type: 'string' },
              tag: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
        priority: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          default: 'normal',
        },
      },
      required: ['taskDescription', 'expectedOutputFormat'],
    },
    async execute(_toolCallId: string, params: DelegateTaskParams) {
      const sourceAgentId = ctx.agentId ?? ctx.sessionKey ?? 'unknown';

      // POST into gamma-core IPC endpoint (internal REST only; no direct Redis access)
      const res = await fetch(process.env.GAMMA_CORE_URL + '/internal/ipc/delegate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.GAMMA_CORE_TOKEN ?? ''}`,
        },
        body: JSON.stringify({
          sourceAgentId,
          ...params,
        }),
      });

      const body = (await res.json()) as DelegateTaskResult;

      // Synchronously return taskId/delegationId so the delegating LLM
      // can track this work item in its own context/thread.
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(body),
          },
        ],
      };
    },
  }));
}
```

### 2.2 Tool Availability / Role Scoping

**Goal:** Only agents that are architecturally allowed to orchestrate others should see `delegate_task`.

- **Allowed roles at the Gamma tool registry level (`@gamma/types` / tool manifest):**
  - `['architect', 'team-lead', 'supervisor']`.
- **OpenClaw side:**
  - `GatewayWsService.createSession` already computes `allowedTools` per role via `ToolRegistryService`.
  - Stage 2: ensure `delegate_task` is included in the manifest **only** for the above roles.
- **AgentRegistryEntry.link:**
  - For generative agents, `AgentFactoryService` / registry wiring must assign appropriate `role` values so that only supervising agents get `delegate_task`.

### 2.3 Delegation Envelope & IPC Models (Gamma-core)

**Location:** `packages/gamma-types/index.ts`

```typescript
export interface IpcContextReference {
  namespace: string;
  tag?: string;
  description?: string;
}

export type IpcTaskStatus = 'queued' | 'started' | 'in_progress' | 'completed' | 'failed';

export interface DelegatedTaskEnvelope {
  /** Stable id of the delegation across IPC + ActivityStream (also called taskId). */
  taskId: string;

  /** Backwards-compatible alias for taskId (for earlier docs/UI). */
  delegationId: string;

  /** AgentId of delegator (supervisor). */
  sourceAgentId: string;

  /** AgentId of concrete target (resolved from role/department if needed). */
  targetAgentId: string;

  /** Optional string used by supervisor to correlate multiple tasks into 1 workflow. */
  correlationId?: string;

  /** Free-form description of what to do. */
  taskDescription: string;

  /** Instructions on result shape. */
  expectedOutputFormat: string;

  /** Optional vector / knowledge namespaces the callee should leverage. */
  contextReferences?: IpcContextReference[];

  /** Priority hint; used for wake-up heuristics. */
  priority: 'low' | 'normal' | 'high';

  /** Current status in the workflow lifecycle. */
  status: IpcTaskStatus;

  /** Optional id of the original message in the bus. */
  messageId?: string;

  /** Timestamp (ms) when this delegation was created. */
  createdAt: number;

  /** Timestamp (ms) of last status change. */
  updatedAt: number;
}
```

### 2.4 Activity Stream Extensions

Extend `ActivityEventKind` to support IPC-specific events:

```typescript
export type ActivityEventKind =
  | 'agent_registered'
  | 'agent_deregistered'
  | 'agent_status_change'
  | 'message_sent'
  | 'message_completed'
  | 'context_injected'
  | 'tool_call_start'
  | 'tool_call_end'
  | 'lifecycle_start'
  | 'lifecycle_end'
  | 'lifecycle_error'
  | 'hierarchy_change'
  | 'system_event'
  | 'emergency_stop'
  // Stage 2 — IPC
  | 'ipc_message_sent'
  | 'ipc_task_started'
  | 'ipc_task_completed';

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
  /** Serialized JSON payload; for IPC events this will embed DelegatedTaskEnvelope or a summary. */
  payload?: string;
  /** Existing severity field remains as in Director docs. */
  severity?: 'info' | 'warn' | 'error';
}
```

**IPC event semantics:**

- **`ipc_message_sent`**
  - Emitted when a delegation is successfully validated and written to the target’s inbox.
  - `agentId = sourceAgentId`, `targetAgentId = targetAgentId`, `payload = JSON.stringify({ taskId, status: 'queued' })`.
- **`ipc_task_started`**
  - Emitted when a run is actually started for the delegated task (either immediately or after the agent becomes IDLE and consumes its inbox).
  - `agentId = targetAgentId`, `targetAgentId = sourceAgentId`, `payload = JSON.stringify({ taskId })`.
- **`ipc_task_completed`**
  - Emitted when a subordinate reports completion via `report_status` or `send_message` with `type='task_response'`.
  - `agentId = targetAgentId` (the worker), `targetAgentId = sourceAgentId`, `payload = JSON.stringify({ taskId, outcome: 'ok' | 'failed' })`.

---

## 3. NestJS APIs & Services (Gamma-core)

### 3.1 IPC Module & Controller

**New module:** `apps/gamma-core/src/ipc/ipc.module.ts`

- Imports:
  - `MessagingModule` (for `MessageBusService`).
  - `SessionsModule` (for `SessionsService` / wake-up and prompt injection).
  - `SystemModule` or a shared module that exports `ActivityStreamService`.
  - Provides `IpcService`.

**Controller:** `apps/gamma-core/src/ipc/ipc.controller.ts`

```typescript
@Controller('/internal/ipc')
@UseGuards(SystemAppGuard) // or equivalent internal auth guard
export class IpcController {
  constructor(private readonly ipc: IpcRoutingService) {}

  @Post('delegate')
  async delegateTask(@Body() dto: DelegateTaskDto): Promise<DelegateTaskResultDto> {
    return this.ipc.delegateTask(dto);
  }
}
```

**DTO (Gamma-core side):**

```typescript
export class DelegateTaskDto {
  sourceAgentId!: string;
  targetAgentId?: string;
  targetRole?: string;
  targetDepartment?: string;
  taskDescription!: string;
  expectedOutputFormat!: string;
  contextReferences?: IpcContextReference[];
  priority?: 'low' | 'normal' | 'high';
  correlationId?: string;
}

export class DelegateTaskResultDto {
  taskId!: string;
  delegationId!: string;
  targetAgentId!: string;
  status!: IpcTaskStatus;
}
```

### 3.2 IpcRoutingService — Validation, Authorization, Routing, Wake-up

**File:** `apps/gamma-core/src/ipc/ipc-routing.service.ts`

Responsibilities:

- Validate delegation requests.
- Enforce hierarchy and role-based permissions.
- Write structured envelopes into the message bus.
- Emit ActivityStream events.
- Trigger wake-up and high-priority prompt injection.

Skeleton:

```typescript
@Injectable()
export class IpcRoutingService {
  private readonly logger = new Logger(IpcRoutingService.name);

  constructor(
    private readonly agentRegistry: AgentRegistryService,
    private readonly agentStateRepo: AgentStateRepository,
    private readonly messageBus: MessageBusService,
    private readonly activity: ActivityStreamService,
    private readonly sessions: SessionsService,
    private readonly delegations: DelegationStateRepository, // wraps gamma-state.db delegations table
  ) {}

  async delegateTask(dto: DelegateTaskDto): Promise<DelegateTaskResultDto> {
    const { sourceAgentId } = dto;

    // 1. Resolve and validate agents
    const source = await this.agentRegistry.getOne(sourceAgentId);
    if (!source) {
      throw new BadRequestException(`Source agent '${sourceAgentId}' not found`);
    }

    if (!this.isRoleAllowedToDelegate(source)) {
      throw new ForbiddenException(`Agent '${sourceAgentId}' is not allowed to delegate tasks`);
    }

    const target = await this.resolveTargetAgent(dto, source);
    if (!target) {
      throw new BadRequestException('No suitable target agent found');
    }

    // 2. Enforce hierarchy authorization using gamma-state.db
    if (!await this.isDelegationAuthorized(source.agentId, target.agentId)) {
      throw new ForbiddenException(
        `Delegation from '${source.agentId}' to '${target.agentId}' is not allowed by hierarchy policy`,
      );
    }

    const taskId = ulid();
    const now = Date.now();

    const envelope: DelegatedTaskEnvelope = {
      taskId,
      delegationId: taskId,
      sourceAgentId,
      targetAgentId: target.agentId,
      correlationId: dto.correlationId,
      taskDescription: dto.taskDescription,
      expectedOutputFormat: dto.expectedOutputFormat,
      contextReferences: dto.contextReferences,
      priority: dto.priority ?? 'normal',
      status: 'queued',
      createdAt: now,
      updatedAt: now,
    };

    // 3. Persist delegation state durably in gamma-state.db
    await this.delegations.create(envelope);

    // 4. Persist into target inbox (Redis)
    const subject = `Delegated task from ${source.agentId}`;
    const { messageId } = await this.messageBus.send(
      source.agentId,
      target.agentId,
      'task_request',
      subject,
      envelope,
    );
    envelope.messageId = messageId;

    // 5. Activity: ipc_message_sent
    this.activity.emit({
      kind: 'ipc_message_sent',
      agentId: source.agentId,
      targetAgentId: target.agentId,
      payload: JSON.stringify({ taskId, status: envelope.status }),
      severity: 'info',
    });

    // 6. Wake-up logic (concurrency-aware)
    await this.wakeUpTargetAgent(target, envelope);

    return {
      taskId,
      delegationId: taskId,
      targetAgentId: target.agentId,
      status: envelope.status,
    };
  }

  private isRoleAllowedToDelegate(source: AgentRegistryEntry): boolean {
    return ['architect', 'team-lead', 'supervisor'].includes(source.role);
  }

  /**
   * Hierarchy authorization: ensure source can delegate to target.
   * Rules:
   * - Downward: supervisor → direct or transitive subordinate allowed.
   * - Peer: agents within the same supervisor subtree may delegate laterally.
   * - Upward: not allowed for delegate_task (use report_status instead).
   */
  private async isDelegationAuthorized(
    sourceAgentId: string,
    targetAgentId: string,
  ): Promise<boolean> {
    if (sourceAgentId === targetAgentId) return true;

    const sourceState = this.agentStateRepo.findById(sourceAgentId);
    const targetState = this.agentStateRepo.findById(targetAgentId);
    if (!sourceState || !targetState) return false;

    // Build supervisor chain for both using gamma-state.db (stable, persistent)
    const sourceChain = await this.getSupervisorChain(sourceAgentId);
    const targetChain = await this.getSupervisorChain(targetAgentId);

    // Downward: source is in target's supervisor chain
    if (targetChain.includes(sourceAgentId)) return true;

    // Peer: share a common non-null supervisor
    const common = sourceChain.find((id) => id !== null && targetChain.includes(id));
    if (common) return true;

    // Upward delegation is not allowed here
    return false;
  }

  private async getSupervisorChain(agentId: string): Promise<string[]> {
    const chain: string[] = [];
    let current: string | null = agentId;
    const visited = new Set<string>();

    while (current && !visited.has(current)) {
      visited.add(current);
      chain.push(current);
      const state = this.agentStateRepo.findById(current);
      const supervisorId = state?.supervisorId ?? null;
      current = supervisorId;
    }

    return chain;
  }

  private async resolveTargetAgent(
    dto: DelegateTaskDto,
    source: AgentRegistryEntry,
  ): Promise<AgentRegistryEntry | null> {
    if (dto.targetAgentId) {
      return this.agentRegistry.getOne(dto.targetAgentId);
    }

    // Role/department-based resolution: naive v1
    const all = await this.agentRegistry.getAll();
    const candidates = all.filter((agent) => {
      if (!agent.acceptsMessages) return false;
      if (dto.targetRole && agent.role !== dto.targetRole) return false;
      if (dto.targetDepartment && !agent.capabilities.includes(`dept:${dto.targetDepartment}`)) {
        return false;
      }
      return true;
    });

    // Optionally filter to same supervisor tree
    // (Stage 2 can keep this simple or enforce that source.supervisorId === agent.supervisorId, etc.)

    // For now: pick first idle/online candidate, fallback to any.
    return (
      candidates.find((c) => c.status === 'idle') ??
      candidates.find((c) => c.status !== 'offline') ??
      null
    );
  }

  private async wakeUpTargetAgent(
    target: AgentRegistryEntry,
    envelope: DelegatedTaskEnvelope,
  ): Promise<void> {
    // Read latest registry status to decide concurrency behavior
    const freshTarget = await this.agentRegistry.getOne(target.agentId);
    if (!freshTarget) return;

    if (freshTarget.status === 'running' || freshTarget.status === 'thinking') {
      // Busy: leave message in inbox; it will be consumed on next idle transition.
      this.logger.debug(
        `Target agent '${target.agentId}' is busy (status=${freshTarget.status}), ` +
        `delegation ${envelope.taskId} will be picked up from inbox later.`,
      );
      return;
    }

    // Delegate to SessionsService to encapsulate session + prompt wiring.
    const result = await this.sessions.ensureAgentAwakeWithPrompt(target.agentId, {
      kind: 'delegated_task',
      delegationId: envelope.taskId,
      taskDescription: envelope.taskDescription,
      expectedOutputFormat: envelope.expectedOutputFormat,
      contextReferences: envelope.contextReferences ?? [],
      priority: envelope.priority,
    });

    if (!result.ok) {
      this.logger.warn(
        `Failed to wake agent '${target.agentId}' for delegation ${envelope.taskId}: ${result.error}`,
      );
      return;
    }

    this.activity.emit({
      kind: 'ipc_task_started',
      agentId: target.agentId,
      targetAgentId: envelope.sourceAgentId,
      payload: JSON.stringify({ taskId: envelope.taskId }),
      severity: 'info',
    });
  }
}
```

### 3.3 SessionsService Extension: `ensureAgentAwakeWithPrompt` & Inbox Draining Hooks

**File:** `apps/gamma-core/src/sessions/sessions.service.ts`

Add a helper for IPC wake-ups that encapsulates OpenClaw session creation + high-priority user prompt injection.

```typescript
export interface DelegatedTaskPromptPayload {
  kind: 'delegated_task';
  delegationId: string;
  taskDescription: string;
  expectedOutputFormat: string;
  contextReferences: IpcContextReference[];
  priority: 'low' | 'normal' | 'high';
}

export interface EnsureAgentAwakeResult {
  ok: boolean;
  windowId?: string;
  sessionKey?: string;
  error?: string;
}

async ensureAgentAwakeWithPrompt(
  agentId: string,
  delegated: DelegatedTaskPromptPayload,
): Promise<EnsureAgentAwakeResult> {
  // 1. Look up existing WindowSession for this agent (if any).
  const existing = await this.findByAgentId(agentId);

  let sessionKey: string;
  let windowId: string;

  if (!existing) {
    // 2. Create a headless session or a system-attached window for the agent.
    const created = await this.spawnOrAttachAgentSession(agentId);
    if (!created.ok || !created.windowId || !created.sessionKey) {
      return { ok: false, error: created.error ?? 'Failed to create agent session' };
    }
    sessionKey = created.sessionKey;
    windowId = created.windowId;
  } else {
    sessionKey = existing.sessionKey;
    windowId = existing.windowId;
  }

  // 3. Construct a high-priority user message summarizing the delegation.
  const prompt = this.buildDelegatedTaskPrompt(delegated);

  const res = await this.sendMessage(windowId, prompt);
  if (!res) {
    return { ok: false, error: 'Failed to send delegated task prompt' };
  }

  return { ok: true, sessionKey, windowId };
}
```

The helper can reuse existing mechanisms (`gatewayWs.createSession`, `sendMessage`, etc.), but wraps them with a strong contract tailored to IPC tasks.

**Prompt helper (conceptual):**

```typescript
private buildDelegatedTaskPrompt(payload: DelegatedTaskPromptPayload): string {
  return [
    '[DELEGATED TASK]',
    `delegationId: ${payload.delegationId}`,
    '',
    'You have received a task delegated by another Gamma agent.',
    '',
    'Task description:',
    payload.taskDescription,
    '',
    'Expected output format:',
    payload.expectedOutputFormat,
    '',
    payload.contextReferences.length
      ? 'You have the following context references available:'
      : 'No explicit context references were provided.',
    ...payload.contextReferences.map(
      (ref, idx) =>
        `  ${idx + 1}. namespace=${ref.namespace}` +
        (ref.tag ? ` tag=${ref.tag}` : '') +
        (ref.description ? ` — ${ref.description}` : ''),
    ),
    '',
    'When you complete this task, you must either:',
    '- Call the `report_status` tool with delegationId and a concise summary, or',
    '- Reply via `send_message` to the original supervisor with type="task_response".',
  ].join('\n');
}
```

In addition, Stage 2 must add a **lifecycle hook** that executes whenever an agent finishes a run:

```typescript
// Called when a run for a given agent/session completes and the agent transitions to IDLE.
async onAgentRunCompleted(agentId: string): Promise<void> {
  // 1. Mark status = 'idle' in AgentRegistryService
  await this.agentRegistry.update(agentId, { status: 'idle' });

  // 2. Check inbox for pending messages
  const pending = await this.messageBus.readInbox(agentId);
  if (!pending.length) return;

  // 3. Trigger a new run to process queued messages one by one (or batched)
  for (const msg of pending) {
    if (msg.type === 'task_request') {
      const envelope = JSON.parse(msg.payload) as DelegatedTaskEnvelope;
      // ensure session exists and inject a prompt with this envelope
      await this.ensureAgentAwakeWithPrompt(agentId, {
        kind: 'delegated_task',
        delegationId: envelope.taskId,
        taskDescription: envelope.taskDescription,
        expectedOutputFormat: envelope.expectedOutputFormat,
        contextReferences: envelope.contextReferences ?? [],
        priority: envelope.priority,
      });

      this.activity.emit({
        kind: 'ipc_task_started',
        agentId,
        targetAgentId: envelope.sourceAgentId,
        payload: JSON.stringify({ taskId: envelope.taskId }),
        severity: 'info',
      });
    }
  }
}
```

This hook can be wired into existing run lifecycle handlers (wherever `lifecycle_end` is emitted) so IPC messages are consumed deterministically when agents become idle.

---

## 4. Response & Callback Mechanism

Stage 2 defines a **dual-path** callback mechanism, leveraging existing tools where possible and introducing a thin new abstraction for clarity.

### 4.1 New OpenClaw Tool: `report_status`

**Purpose:** Provide a first-class, structured way for subordinate agents to report task progress or completion back to their supervisor.

**Plugin-side schema:**

```typescript
export interface ReportStatusParams {
  /** Task id (delegation id) received in the delegated task prompt or envelope. */
  taskId: string;
  /** Optional finer-grained stage label, e.g. "analysis", "implementation", "verification". */
  stage?: string;
  /** New status of the delegated task. */
  status: IpcTaskStatus;
  /** Human-readable summary of what was done or why it failed. */
  summary: string;
  /** Optional machine-readable result; recommended when status='completed'. */
  resultJson?: unknown;
}
```

Tool behavior (plugin):

- POST `ReportStatusParams` + `sourceAgentId` into `POST /internal/ipc/report-status` (internal REST; no direct Redis writes).
- Gamma-core resolves the original delegation by `delegationId`, finds `sourceAgentId` (supervisor), and:
  - Writes a reply into supervisor’s inbox via `MessageBusService.send` with `type='task_response'` and `replyTo=<originalMessageId>`.
  - Emits `ipc_task_completed` (or intermediate statuses) into `ActivityStream`.

### 4.2 Gamma-core Endpoint: `/api/ipc/report-status`

**Controller method:**

```typescript
@Post('report-status')
async reportStatus(@Body() dto: ReportStatusDto): Promise<void> {
  await this.ipc.reportStatus(dto);
}
```

**Service skeleton:**

```typescript
export class ReportStatusDto {
  sourceAgentId!: string; // worker reporting
  taskId!: string;
  stage?: string;
  status!: IpcTaskStatus;
  summary!: string;
  resultJson?: unknown;
}

@Injectable()
export class IpcRoutingService {
  // ...

  async reportStatus(dto: ReportStatusDto): Promise<void> {
    const delegation = await this.delegations.findByTaskId(dto.taskId);
    if (!delegation) {
      this.logger.warn(`reportStatus: delegation '${dto.taskId}' not found`);
      return;
    }

    const supervisorId = delegation.sourceAgentId;
    const workerId = dto.sourceAgentId;

    // 1. Send response message back to supervisor’s inbox
    await this.messageBus.send(
      workerId,
      supervisorId,
      'task_response',
      `Delegation ${dto.taskId} ${dto.status}`,
      {
        taskId: dto.taskId,
        stage: dto.stage,
        status: dto.status,
        summary: dto.summary,
        result: dto.resultJson,
      },
      delegation.messageId, // replyTo original message
    );

    // 2. Activity: ipc_task_completed (or in_progress)
    this.activity.emit({
      kind: dto.status === 'completed' ? 'ipc_task_completed' : 'ipc_task_started',
      agentId: workerId,
      targetAgentId: supervisorId,
      payload: JSON.stringify({
        taskId: dto.taskId,
        status: dto.status,
      }),
      severity: dto.status === 'failed' ? 'error' : 'info',
    });

    // 3. Update delegation status in gamma-state.db (SQLite) for historical UI and correctness
    await this.delegations.updateStatus(dto.taskId, dto.status, {
      stage: dto.stage,
      summary: dto.summary,
    });
  }
}
```

**Note:** For Stage 2 we can keep delegation “state” in Redis or a lightweight SQLite table, similar to Stage 1’s `agents` table, if we want durable workflow history beyond ActivityStream.

### 4.3 Using Existing `send_message` as a Low-Level Escape Hatch

The existing internal tool `send_message` remains available for:

- Ad-hoc conversations between agents.
- Backward-compatible IPC where higher-level delegation semantics are not required.

Stage 2 simply standardizes **structured** delegation (`delegate_task` + `report_status`) on top of the same message bus and ActivityStream primitives.

---

## 5. Step-by-Step Implementation Tasks

This section translates Stage 2 into concrete backend tasks.

### 5.1 OpenClaw Plugin: `delegate_task` & `report_status`

- **5.1.1 Create IPC plugin (or extend existing one)**
  - [ ] Add a new package `skills/openclaw-ipc` (or extend `openclaw-knowledge` cautiously) with:
    - `DelegateTaskParams`, `DelegateTaskResult`, `ReportStatusParams`.
    - Environment-based configuration for `GAMMA_CORE_URL` and `GAMMA_CORE_TOKEN`.
  - [ ] Register `delegate_task` tool as described in §2.1, calling `POST /internal/ipc/delegate`.
  - [ ] Register `report_status` tool pointing to `POST /internal/ipc/report-status`.

- **5.1.2 Wire tool availability per role**
  - [ ] Ensure the Gateway passes `agentId` / `sessionKey` into the IPC plugin context as in `vector_store`.
  - [ ] Update tool manifest / role resolution so only `architect`, `team-lead`, and `supervisor` roles see `delegate_task`.
  - [ ] Optionally allow all roles to see `report_status` (so any sub-agent can report completion).

### 5.2 Types & Activity Stream Extensions

- **5.2.1 Extend `@gamma/types`**
  - [ ] Add `IpcContextReference`, `IpcTaskStatus`, `DelegatedTaskEnvelope` to `packages/gamma-types/index.ts`.
  - [ ] Extend `ActivityEventKind` and `ActivityEvent` as in §2.4.

- **5.2.2 Update Director UI typing**
  - [ ] Sync `ActivityEvent` type in `apps/gamma-ui/apps/system/director/DirectorApp.tsx` to include new IPC event kinds.
  - [ ] Optionally render IPC events with distinct colors/edges in the activity timeline (preparing for Stage 3 React Flow view).

### 5.3 IPC Module in Gamma-core

- **5.3.1 Create `IpcModule`**
  - [ ] Add `apps/gamma-core/src/ipc/ipc.module.ts`:
    - Imports: `MessagingModule`, `SessionsModule`, and module exposing `ActivityStreamService`.
    - Declares and exports `IpcRoutingService` and `DelegationStateRepository`.
    - Registers `IpcController`.
  - [ ] Import `IpcModule` into root `AppModule`.

- **5.3.2 Implement `IpcController` & DTO validation**
  - [ ] Add `DelegateTaskDto` and `ReportStatusDto` classes with class-validator decorators where appropriate.
  - [ ] Implement `/internal/ipc/delegate` and `/internal/ipc/report-status` routes (internal-only).
  - [ ] Protect routes with system-level auth guard (e.g. `SystemAppGuard`).

### 5.4 IpcService Implementation

- **5.4.1 Delegation path**
  - [ ] Implement `IpcRoutingService.delegateTask(dto: DelegateTaskDto)`:
    - Validate source/target agents via `AgentRegistryService`.
    - Enforce role-based permission (`architect`, `team-lead`, `supervisor`).
    - Resolve `targetAgentId` from role/department when necessary.
    - **Authorize hierarchy** via `AgentStateRepository` and `isDelegationAuthorized` (downward/peer-only).
    - Create `DelegatedTaskEnvelope` with a new `taskId` (ulid).
    - Persist envelope via `DelegationStateRepository.create`.
    - Call `MessageBusService.send(...)` with `type='task_request'`.
    - Emit `ipc_message_sent` into `ActivityStream`.
    - Call `wakeUpTargetAgent` / `ensureAgentAwakeWithPrompt` only when target is `idle`/`offline`.
    - Return `DelegateTaskResultDto` with `taskId`/`delegationId` to the plugin.

- **5.4.2 Wake-up logic**
  - [ ] Add `ensureAgentAwakeWithPrompt` to `SessionsService` as in §3.3.
  - [ ] Ensure it:
    - Creates an OpenClaw session for the agent if none exists.
    - Uses `gatewayWs.createSession(sessionKey=agentId, agentId=agentId, systemPrompt=...)`.
    - Sends a high-priority delegated-task message to the session using existing `sendMessage` flow.
  - [ ] Emit `ipc_task_started` once the prompt is successfully published.
  - [ ] Implement `onAgentRunCompleted` hook that:
    - Updates agent status to `idle`.
    - Uses `MessageBusService.readInbox` to check for pending messages.
    - For each queued IPC `task_request`, injects prompts and emits `ipc_task_started`.

- **5.4.3 Report status path**
  - [ ] Implement `IpcRoutingService.reportStatus(dto: ReportStatusDto)`:
    - Look up delegation state by `taskId` via `DelegationStateRepository`.
    - Use `MessageBusService.send` to write a `task_response` to the supervisor’s inbox with `replyTo` pointing to the original message.
    - Emit `ipc_task_completed` (or intermediate status event) into `ActivityStream`.
    - Persist updated status back into the delegation store (`gamma-state.db`).

### 5.5 Message Bus & Registry Integration

- **5.5.1 Ensure `MessageBusService` remains generic**
  - [ ] No structural changes required; Stage 2 only constrains payloads for IPC messages to `DelegatedTaskEnvelope`.
  - [ ] Optionally add small helper methods:
    - `sendDelegatedTask(envelope: DelegatedTaskEnvelope): Promise<{ messageId: string; delivered: boolean }>`
    - `sendTaskResponse(...)` — wrappers that set `type` and `subject` appropriately.

- **5.5.2 Leverage `AgentRegistryService` hierarchy**
  - [ ] Optionally extend `AgentRegistryEntry.capabilities` with department tags (`dept:<name>`) to support `targetDepartment` routing.
  - [ ] In `resolveTargetAgent`, prefer agents within the same supervisor tree as the delegator where applicable (hierarchy auth still enforced via SQLite).

### 5.6 ActivityStream & UI Preparation

- **5.6.1 Emit IPC events**
  - [ ] Use `ActivityStreamService.emit` for:
    - `ipc_message_sent` from `delegateTask`.
    - `ipc_task_started` from `wakeUpTargetAgent` / `ensureAgentAwakeWithPrompt`.
    - `ipc_task_completed` from `reportStatus`.

- **5.6.2 Prepare for React Flow visualization (Stage 3)**
  - [ ] Verify IPC events include:
    - `agentId` and `targetAgentId`.
    - `payload.taskId` and `status`.
  - [ ] Optionally add a small `/api/ipc/delegations/:taskId` endpoint returning full `DelegatedTaskEnvelope` for UI drill-down.

### 5.7 Testing & Validation

- **5.7.1 Unit tests**
  - [ ] Add tests for `IpcService.delegateTask`:
    - Rejects invalid source/target.
    - Enforces allowed roles.
    - Correctly resolves target by `targetRole` / `targetDepartment`.
    - Emits ActivityStream events.
  - [ ] Add tests for `reportStatus`:
    - Writes `task_response` messages to supervisor inbox.
    - Emits `ipc_task_completed`.

- **5.7.2 Integration tests (happy paths)**
  - [ ] End-to-end test using a real Redis instance:
    - Spawn two agents (`architect` supervisor, `app-owner` subordinate).
    - Call `delegate_task` from supervisor’s OpenClaw session.
    - Validate:
      - Message appears in subordinate’s inbox.
      - `ipc_message_sent` and `ipc_task_started` appear in ActivityStream.
    - Simulate subordinate calling `report_status`.
    - Validate:
      - Response appears in supervisor’s inbox.
      - `ipc_task_completed` appears in ActivityStream.

- **5.7.3 Observability**
  - [ ] Ensure logs in `IpcService`, `SessionsService.ensureAgentAwakeWithPrompt`, and plugin-side tools are sufficiently descriptive to debug misrouted or stuck delegations.

---

## 6. Out of Scope for Stage 2

- Advanced load-balancing of tasks across multiple agents with the same role/department (beyond simple first-match heuristics).
- Complex workflow orchestration (fan-out/fan-in, DAGs) — to be addressed in later Syndicate stages.
- Full React Flow visualization of IPC graphs — covered in Stage 3.
- Cross-cluster or cross-tenant delegation; Stage 2 assumes a single Gamma deployment.

