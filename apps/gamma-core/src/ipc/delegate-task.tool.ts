import { Injectable } from '@nestjs/common';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from '../tools/interfaces';
import { IpcRoutingService } from './ipc-routing.service';

/**
 * Internal tool: delegate_task
 *
 * Delegates a task to another agent via the IPC Routing Service.
 * Validates hierarchy, delivers the message, and wakes idle agents.
 * Available to 'architect' and 'app-owner' roles.
 */
@Injectable()
export class DelegateTaskTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'delegate_task',
    description:
      'Delegate a task to another agent. The target agent will receive the task ' +
      'in their inbox and will be woken up if idle. Hierarchy rules are enforced: ' +
      'you must be the target\'s supervisor or hold a more senior role.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        targetAgentId: {
          type: 'string',
          description: 'Agent ID of the target agent to delegate the task to. Optional if teamId is provided.',
        },
        teamId: {
          type: 'string',
          description: 'Team ID to assign task to team backlog. Use instead of targetAgentId for team-based delegation.',
        },
        projectId: {
          type: 'string',
          description: 'Parent project ID to link the task to.',
        },
        title: {
          type: 'string',
          description: 'Short human-readable task title.',
        },
        taskDescription: {
          type: 'string',
          description: 'Description of the task to delegate.',
          required: true,
        },
        kind: {
          type: 'string',
          description: 'Task kind for role-based matching.',
          enum: ['generic', 'design', 'backend', 'frontend', 'qa', 'devops', 'content', 'research'],
        },
        priority: {
          type: 'number',
          description: 'Task priority (0 = normal, higher = more urgent).',
          default: 0,
        },
      },
      outputDescription:
        'Object with taskId (ULID) that can be used to track the delegated task.',
    },
  };

  readonly toolName = DelegateTaskTool.DEFINITION.name;

  constructor(private readonly ipcRouting: IpcRoutingService) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const targetAgentId = args.targetAgentId as string | undefined;
    const teamId = args.teamId as string | undefined;
    const projectId = args.projectId as string | undefined;
    const title = args.title as string | undefined;
    const taskDescription = args.taskDescription as string;
    const kind = args.kind as string | undefined;
    const priority = args.priority as number | undefined;

    const result = await this.ipcRouting.delegateTask(context.agentId, {
      targetAgentId,
      teamId,
      projectId,
      title,
      taskDescription,
      kind,
      priority,
    });

    if (!result.ok) {
      return {
        ok: false,
        toolName: this.toolName,
        error: result.error ?? 'Failed to delegate task',
        durationMs: 0,
      };
    }

    return {
      ok: true,
      toolName: this.toolName,
      data: {
        taskId: result.taskId,
        targetAgentId: targetAgentId ?? null,
        teamId: teamId ?? null,
        delegatedBy: context.agentId,
      },
      durationMs: 0,
    };
  }
}
