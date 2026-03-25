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
import { MessageBusService } from '../messaging/message-bus.service';
import { TaskStateRepository } from '../state/task-state.repository';
import { TeamStateRepository } from '../state/team-state.repository';
import { ActivityStreamService } from '../activity/activity-stream.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ulid } from 'ulid';
import type { AgentMessage } from '@gamma/types';

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

/**
 * DTO for the POST /internal/ipc/send-message endpoint.
 */
interface SendMessageRequestBody {
  fromAgentId: string;
  toAgentId: string;
  subject: string;
  body: string;
  type?: AgentMessage['type'];
  replyTo?: string;
}

/**
 * DTO for the POST /internal/ipc/create-team-task endpoint.
 */
interface CreateTeamTaskRequestBody {
  sourceAgentId: string;
  teamId: string;
  projectId?: string;
  title: string;
  description: string;
  kind: string;
  priority?: number;
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

  constructor(
    private readonly ipcRouting: IpcRoutingService,
    private readonly messageBus: MessageBusService,
    private readonly taskRepo: TaskStateRepository,
    private readonly teamRepo: TeamStateRepository,
    private readonly activityStream: ActivityStreamService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

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

  /**
   * POST /internal/ipc/send-message
   *
   * Sends an inter-agent message via Redis Streams inbox.
   * The OpenClaw `send_message` tool calls this endpoint.
   */
  @Post('send-message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Body() body: SendMessageRequestBody,
    @Headers('authorization') authHeader?: string,
  ) {
    this.verifyBearerToken(authHeader);

    const { fromAgentId, toAgentId, subject, body: messageBody, type, replyTo } = body;

    if (!fromAgentId || typeof fromAgentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: fromAgentId' };
    }
    if (!toAgentId || typeof toAgentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: toAgentId' };
    }
    if (!subject || typeof subject !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: subject' };
    }
    if (!messageBody || typeof messageBody !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: body' };
    }

    const msgType: AgentMessage['type'] = type ?? 'notification';
    const validTypes = ['task_request', 'task_response', 'notification', 'query'];
    if (!validTypes.includes(msgType)) {
      return { ok: false, error: `Invalid type '${String(type)}'. Must be one of: ${validTypes.join(', ')}` };
    }

    try {
      const result = await this.messageBus.send(
        fromAgentId,
        toAgentId,
        msgType,
        subject,
        messageBody,
        replyTo,
      );

      this.logger.log(
        `POST /internal/ipc/send-message → ${fromAgentId} → ${toAgentId} [${msgType}] "${subject}"`,
      );

      return { ok: true, messageId: result.messageId, delivered: result.delivered };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`POST /internal/ipc/send-message failed: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  /**
   * POST /internal/ipc/create-team-task
   *
   * Creates a task in a team's backlog. The task will be automatically
   * picked up by a qualified team member via TaskClaimService.
   */
  @Post('create-team-task')
  @HttpCode(HttpStatus.OK)
  async createTeamTask(
    @Body() body: CreateTeamTaskRequestBody,
    @Headers('authorization') authHeader?: string,
  ) {
    this.verifyBearerToken(authHeader);

    const { sourceAgentId, teamId, projectId, title, description, kind, priority } = body;

    if (!sourceAgentId || typeof sourceAgentId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: sourceAgentId' };
    }
    if (!teamId || typeof teamId !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: teamId' };
    }
    if (!title || typeof title !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: title' };
    }
    if (!description || typeof description !== 'string') {
      return { ok: false, error: 'Missing or invalid required field: description' };
    }

    const validKinds = ['design', 'backend', 'frontend', 'qa', 'devops', 'content', 'research', 'generic'];
    const taskKind = kind || 'generic';
    if (!validKinds.includes(taskKind)) {
      return { ok: false, error: `Invalid kind '${kind}'. Must be one of: ${validKinds.join(', ')}` };
    }

    const taskPriority = priority ?? 0;
    if (typeof taskPriority !== 'number' || taskPriority < 0 || taskPriority > 100) {
      return { ok: false, error: 'Invalid priority: must be a number between 0 and 100' };
    }

    // Validate team exists
    const team = this.teamRepo.findById(teamId);
    if (!team) {
      return { ok: false, error: `Team '${teamId}' not found` };
    }

    const taskId = ulid();
    const now = Date.now();

    try {
      this.taskRepo.insert({
        id: taskId,
        title,
        sourceAgentId,
        targetAgentId: null,
        teamId,
        projectId: projectId ?? null,
        kind: taskKind as any,
        priority: taskPriority,
        status: 'backlog',
        payload: JSON.stringify({ description, priority: taskPriority }),
        result: null,
        createdAt: now,
        updatedAt: now,
      });

      this.activityStream.emit({
        kind: 'task_status_change',
        agentId: sourceAgentId,
        payload: JSON.stringify({ taskId, teamId, taskKind, status: 'backlog' }),
        severity: 'info',
      });

      this.eventEmitter.emit('backlog.task.created', { taskId, teamId, kind: taskKind });

      this.logger.log(
        `POST /internal/ipc/create-team-task → taskId=${taskId} team=${teamId} kind=${taskKind}`,
      );

      return { ok: true, taskId, teamId, kind: taskKind, status: 'backlog' };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`POST /internal/ipc/create-team-task failed: ${msg}`);
      return { ok: false, error: msg };
    }
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
