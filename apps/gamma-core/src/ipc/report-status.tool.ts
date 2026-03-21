import { Injectable } from '@nestjs/common';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from '../tools/interfaces';
import { IpcRoutingService } from './ipc-routing.service';

/**
 * Internal tool: report_status
 *
 * Reports the completion or failure of a delegated task back to the supervisor.
 * Updates the task record in gamma-state.db and delivers a callback to the
 * supervisor's inbox, waking them if idle.
 */
@Injectable()
export class ReportStatusTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'report_status',
    description:
      'Report the status of a delegated task back to the supervisor. ' +
      'Use this when you have finished or failed a task that was delegated to you. ' +
      'The supervisor will be notified and woken up if idle.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect', 'app-owner', 'daemon'],
    schema: {
      parameters: {
        taskId: {
          type: 'string',
          description: 'The taskId of the delegated task to report on.',
          required: true,
        },
        status: {
          type: 'string',
          description: 'Task outcome status.',
          enum: ['done', 'failed'],
          required: true,
        },
        message: {
          type: 'string',
          description: 'Summary of what was accomplished or why the task failed.',
          required: true,
        },
        data: {
          type: 'object',
          description: 'Optional structured data/output from the task execution.',
        },
      },
      outputDescription:
        'Object confirming the report was delivered to the supervisor.',
    },
  };

  readonly toolName = ReportStatusTool.DEFINITION.name;

  constructor(private readonly ipcRouting: IpcRoutingService) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const taskId = args.taskId as string;
    const status = args.status as 'done' | 'failed';
    const message = args.message as string;
    const data = args.data as unknown;

    const result = await this.ipcRouting.reportTaskStatus(context.agentId, {
      taskId,
      status,
      message,
      data,
    });

    if (!result.ok) {
      return {
        ok: false,
        toolName: this.toolName,
        error: result.error ?? 'Failed to report task status',
        durationMs: 0,
      };
    }

    return {
      ok: true,
      toolName: this.toolName,
      data: {
        taskId,
        status,
        reportedBy: context.agentId,
      },
      durationMs: 0,
    };
  }
}
