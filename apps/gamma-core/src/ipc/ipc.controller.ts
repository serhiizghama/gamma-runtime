import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Logger,
  Headers,
  ForbiddenException,
} from '@nestjs/common';
import { IpcRoutingService } from './ipc-routing.service';
import type { DelegateTaskPayload, ReportStatusPayload } from './ipc-routing.service';

// ── Constants ─────────────────────────────────────────────────────────────

/**
 * Bearer token required for internal IPC calls.
 * Set via GAMMA_CORE_TOKEN env var. When unset, all requests are rejected.
 */
const CORE_TOKEN = process.env['GAMMA_CORE_TOKEN'] ?? '';

// ── DTOs ──────────────────────────────────────────────────────────────────

/**
 * DTO for the POST /internal/ipc/delegate endpoint.
 * sourceAgentId identifies the caller (set by the OpenClaw plugin bridge).
 */
interface DelegateRequestBody {
  sourceAgentId: string;
  targetAgentId: string;
  taskDescription: string;
  priority?: number;
}

/**
 * DTO for the POST /internal/ipc/report endpoint.
 */
interface ReportRequestBody {
  agentId: string;
  taskId: string;
  status: 'done' | 'failed';
  message: string;
  data?: unknown;
}

// ── Controller ────────────────────────────────────────────────────────────

/**
 * Internal IPC API — called by OpenClaw Gateway/Plugins, NOT by external clients.
 *
 * All endpoints are under /internal/ipc to clearly separate them from the
 * public /api/* surface.
 *
 * Authentication: requires `Authorization: Bearer <GAMMA_CORE_TOKEN>` header.
 * When GAMMA_CORE_TOKEN is unset (empty), ALL requests are rejected to prevent
 * accidental unauthenticated operation.
 */
@Controller('internal/ipc')
export class IpcController {
  private readonly logger = new Logger(IpcController.name);

  constructor(private readonly ipcRouting: IpcRoutingService) {}

  /**
   * POST /internal/ipc/delegate
   *
   * Delegates a task from one agent to another. The OpenClaw `delegate_task`
   * tool calls this endpoint and returns the generated taskId to the LLM.
   */
  @Post('delegate')
  @HttpCode(HttpStatus.OK)
  async delegate(
    @Body() body: DelegateRequestBody,
    @Headers('authorization') authHeader?: string,
  ) {
    this.verifyBearerToken(authHeader);

    const { sourceAgentId, targetAgentId, taskDescription, priority } = body;

    // ── Input validation ───────────────────────────────────────────────
    if (!sourceAgentId || typeof sourceAgentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: sourceAgentId' };
    }
    if (!targetAgentId || typeof targetAgentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: targetAgentId' };
    }
    if (!taskDescription || typeof taskDescription !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: taskDescription' };
    }
    if (priority !== undefined && (typeof priority !== 'number' || priority < 0 || priority > 100)) {
      return { ok: false, error: 'Invalid priority: must be a number between 0 and 100' };
    }

    const payload: DelegateTaskPayload = {
      targetAgentId,
      taskDescription,
      priority,
    };

    const result = await this.ipcRouting.delegateTask(sourceAgentId, payload);

    this.logger.log(
      `POST /internal/ipc/delegate → ${result.ok ? `taskId=${result.taskId}` : `error: ${result.error}`}`,
    );

    return result;
  }

  /**
   * POST /internal/ipc/report
   *
   * Reports the status of a delegated task. The OpenClaw `report_status`
   * tool calls this endpoint to notify the supervisor of task completion/failure.
   */
  @Post('report')
  @HttpCode(HttpStatus.OK)
  async report(
    @Body() body: ReportRequestBody,
    @Headers('authorization') authHeader?: string,
  ) {
    this.verifyBearerToken(authHeader);

    const { agentId, taskId, status, message, data } = body;

    // ── Input validation ───────────────────────────────────────────────
    if (!agentId || typeof agentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: agentId' };
    }
    if (!taskId || typeof taskId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: taskId' };
    }
    if (!message || typeof message !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: message' };
    }

    if (status !== 'done' && status !== 'failed') {
      return {
        ok: false,
        error: `Invalid status '${String(status)}'. Must be 'done' or 'failed'.`,
      };
    }

    const payload: ReportStatusPayload = {
      taskId,
      status,
      message,
      data,
    };

    const result = await this.ipcRouting.reportTaskStatus(agentId, payload);

    this.logger.log(
      `POST /internal/ipc/report → ${result.ok ? `task=${taskId} [${status}]` : `error: ${result.error}`}`,
    );

    return result;
  }

  // ── Auth helper ─────────────────────────────────────────────────────

  /**
   * Verify the `Authorization: Bearer <token>` header against GAMMA_CORE_TOKEN.
   *
   * When GAMMA_CORE_TOKEN is empty (not configured), ALL requests are rejected
   * to prevent unauthenticated operation in misconfigured deployments.
   */
  private verifyBearerToken(authHeader?: string): void {
    if (!CORE_TOKEN) {
      throw new ForbiddenException(
        'GAMMA_CORE_TOKEN is not configured. Internal IPC endpoints are disabled.',
      );
    }

    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.slice(7)
      : undefined;

    if (!token || token !== CORE_TOKEN) {
      throw new ForbiddenException('Invalid or missing bearer token');
    }
  }
}
