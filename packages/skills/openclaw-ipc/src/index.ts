/**
 * OpenClaw IPC Plugin — `delegate_task` and `report_status` tools
 *
 * This plugin provides IPC tools for OpenClaw agents.
 * All communication goes through gamma-core's Internal IPC API.
 *
 * IMPORTANT: This plugin does NOT access Redis directly.
 *
 * Security: All requests include a Bearer token (GAMMA_CORE_TOKEN) for
 * authentication against the internal IPC endpoints.
 */

// ── Constants ─────────────────────────────────────────────────────────────

/** Maximum length for task descriptions and report messages. */
const MAX_TEXT_LENGTH = 8_000;

/** Maximum serialized size for data payloads. */
const MAX_DATA_SIZE = 64_000;

// ── delegate_task ──────────────────────────────────────────────────────

export interface DelegateTaskInput {
  targetAgentId: string;
  taskDescription: string;
  priority?: number;
}

export interface DelegateTaskOutput {
  ok: boolean;
  taskId?: string;
  error?: string;
}

/** JSON Schema exposed to the LLM for argument validation. */
export const DELEGATE_TASK_SCHEMA = {
  name: 'delegate_task',
  description:
    'Delegate a task to another agent in the Gamma runtime. ' +
    'The target agent will be woken up if idle. Hierarchy rules are enforced.',
  input_schema: {
    type: 'object' as const,
    properties: {
      targetAgentId: {
        type: 'string',
        description: 'Agent ID or session key of the target agent.',
        maxLength: 128,
      },
      taskDescription: {
        type: 'string',
        description: 'Description of the task to delegate.',
        maxLength: MAX_TEXT_LENGTH,
      },
      priority: {
        type: 'number',
        description: 'Task priority (0 = normal, higher = more urgent). Defaults to 0.',
        minimum: 0,
        maximum: 100,
      },
    },
    required: ['targetAgentId', 'taskDescription'],
  },
};

/**
 * Execute the delegate_task tool by calling gamma-core's internal IPC API.
 */
export async function executeDelegateTask(
  input: DelegateTaskInput,
  context: { agentId: string },
  coreBaseUrl: string,
): Promise<DelegateTaskOutput> {
  // Client-side validation
  if (!input.targetAgentId || typeof input.targetAgentId !== 'string') {
    return { ok: false, error: 'targetAgentId is required and must be a string' };
  }
  if (!input.taskDescription || typeof input.taskDescription !== 'string') {
    return { ok: false, error: 'taskDescription is required and must be a string' };
  }
  if (input.taskDescription.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `taskDescription exceeds maximum length of ${MAX_TEXT_LENGTH}` };
  }

  const url = `${coreBaseUrl}/internal/ipc/delegate`;
  const token = process.env['GAMMA_CORE_TOKEN'] ?? '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      sourceAgentId: context.agentId,
      targetAgentId: input.targetAgentId,
      taskDescription: input.taskDescription,
      priority: input.priority ?? 0,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    return {
      ok: false,
      error: `IPC API returned HTTP ${response.status}: ${body}`,
    };
  }

  return (await response.json()) as DelegateTaskOutput;
}

// ── report_status ──────────────────────────────────────────────────────

export interface ReportStatusInput {
  taskId: string;
  status: 'completed' | 'failed';
  message: string;
  data?: unknown;
}

export interface ReportStatusOutput {
  ok: boolean;
  error?: string;
}

/** JSON Schema exposed to the LLM for argument validation. */
export const REPORT_STATUS_SCHEMA = {
  name: 'report_status',
  description:
    'Report the status of a delegated task back to the supervisor. ' +
    'Use when you have completed or failed a task assigned to you.',
  input_schema: {
    type: 'object' as const,
    properties: {
      taskId: {
        type: 'string',
        description: 'The taskId of the delegated task to report on.',
        maxLength: 128,
      },
      status: {
        type: 'string',
        enum: ['completed', 'failed'],
        description: 'Task outcome status.',
      },
      message: {
        type: 'string',
        description: 'Summary of what was accomplished or why the task failed.',
        maxLength: MAX_TEXT_LENGTH,
      },
      data: {
        type: 'object',
        description: 'Optional structured data/output from the task execution.',
      },
    },
    required: ['taskId', 'status', 'message'],
  },
};

/**
 * Execute the report_status tool by calling gamma-core's internal IPC API.
 */
export async function executeReportStatus(
  input: ReportStatusInput,
  context: { agentId: string },
  coreBaseUrl: string,
): Promise<ReportStatusOutput> {
  // Client-side validation
  if (!input.taskId || typeof input.taskId !== 'string') {
    return { ok: false, error: 'taskId is required and must be a string' };
  }
  if (input.status !== 'completed' && input.status !== 'failed') {
    return { ok: false, error: 'status must be "completed" or "failed"' };
  }
  if (!input.message || typeof input.message !== 'string') {
    return { ok: false, error: 'message is required and must be a string' };
  }
  if (input.message.length > MAX_TEXT_LENGTH) {
    return { ok: false, error: `message exceeds maximum length of ${MAX_TEXT_LENGTH}` };
  }

  // Validate data payload size
  if (input.data !== undefined) {
    try {
      const serialized = JSON.stringify(input.data);
      if (serialized.length > MAX_DATA_SIZE) {
        return { ok: false, error: `data payload exceeds maximum size of ${MAX_DATA_SIZE} bytes` };
      }
    } catch {
      return { ok: false, error: 'data payload is not JSON-serializable' };
    }
  }

  const url = `${coreBaseUrl}/internal/ipc/report`;
  const token = process.env['GAMMA_CORE_TOKEN'] ?? '';

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      agentId: context.agentId,
      taskId: input.taskId,
      status: input.status,
      message: input.message,
      data: input.data,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    return {
      ok: false,
      error: `IPC API returned HTTP ${response.status}: ${body}`,
    };
  }

  return (await response.json()) as ReportStatusOutput;
}
