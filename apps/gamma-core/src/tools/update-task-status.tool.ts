import { Injectable, Logger } from '@nestjs/common';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from './interfaces';
import { TaskStateRepository } from '../state/task-state.repository';
import { ActivityStreamService } from '../activity/activity-stream.service';

@Injectable()
export class UpdateTaskStatusTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'update_task_status',
    description: 'Update a task status through the Kanban workflow.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect', 'app-owner', 'daemon'],
    schema: {
      parameters: {
        taskId: { type: 'string', description: 'The task ID to update', required: true },
        status: {
          type: 'string',
          enum: ['in_progress', 'review', 'done', 'failed'],
          description: 'New task status',
          required: true,
        },
        message: { type: 'string', description: 'Status update message', required: true },
        data: { type: 'string', description: 'Optional result data (JSON)' },
      },
      outputDescription: 'Confirmation of the status update.',
    },
  };

  readonly toolName = UpdateTaskStatusTool.DEFINITION.name;
  private readonly logger = new Logger(UpdateTaskStatusTool.name);

  constructor(
    private readonly taskRepo: TaskStateRepository,
    private readonly activityStream: ActivityStreamService,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const taskId = args.taskId as string;
    const status = args.status as string;
    const message = args.message as string;
    const data = (args.data as string) || null;

    const task = this.taskRepo.findById(taskId);
    if (!task) {
      return { ok: false, toolName: this.toolName, error: `Task '${taskId}' not found`, durationMs: 0 };
    }

    // Verify the agent is the assigned target or the source
    if (task.targetAgentId !== context.agentId && task.sourceAgentId !== context.agentId) {
      return { ok: false, toolName: this.toolName, error: `Agent '${context.agentId}' is not assigned to task '${taskId}'`, durationMs: 0 };
    }

    const prevStatus = task.status;

    if (status === 'done' || status === 'failed') {
      const resultPayload = JSON.stringify({ message, data });
      const updated = this.taskRepo.setResult(taskId, status as any, resultPayload);
      if (!updated) {
        return { ok: false, toolName: this.toolName, error: `Cannot transition task from '${prevStatus}' to '${status}'`, durationMs: 0 };
      }
    } else {
      const updated = this.taskRepo.updateStatus(taskId, status as any);
      if (!updated) {
        return { ok: false, toolName: this.toolName, error: `Cannot transition task from '${prevStatus}' to '${status}'`, durationMs: 0 };
      }
    }

    this.activityStream.emit({
      kind: 'task_status_change',
      agentId: context.agentId,
      payload: JSON.stringify({ taskId, from: prevStatus, to: status, message }),
      severity: status === 'failed' ? 'warn' : 'info',
    });

    this.logger.log(`Task ${taskId}: ${prevStatus} → ${status}`);

    return {
      ok: true,
      toolName: this.toolName,
      data: { taskId, previousStatus: prevStatus, newStatus: status },
      durationMs: 0,
    };
  }
}
