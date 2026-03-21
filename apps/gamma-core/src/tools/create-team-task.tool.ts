import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ulid } from 'ulid';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from './interfaces';
import { TaskStateRepository } from '../state/task-state.repository';
import { TeamStateRepository } from '../state/team-state.repository';
import { ActivityStreamService } from '../activity/activity-stream.service';

@Injectable()
export class CreateTeamTaskTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'create_team_task',
    description:
      'Create a task in a team backlog. The task will be automatically picked up by a qualified team member.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect'],
    schema: {
      parameters: {
        teamId: {
          type: 'string',
          description: 'Target team ID',
          required: true,
        },
        projectId: {
          type: 'string',
          description: 'Parent project ID (optional)',
        },
        title: {
          type: 'string',
          description: 'Short task title',
          required: true,
        },
        description: {
          type: 'string',
          description: 'Detailed task description',
          required: true,
        },
        kind: {
          type: 'string',
          enum: ['design', 'backend', 'frontend', 'qa', 'devops', 'content', 'research', 'generic'],
          description: 'Task type for role-based matching',
          required: true,
        },
        priority: {
          type: 'number',
          description: '0=normal, 1=high, 2=critical',
          default: 0,
        },
      },
      outputDescription: 'Object with taskId of the created task.',
    },
  };

  readonly toolName = CreateTeamTaskTool.DEFINITION.name;
  private readonly logger = new Logger(CreateTeamTaskTool.name);

  constructor(
    private readonly taskRepo: TaskStateRepository,
    private readonly teamRepo: TeamStateRepository,
    private readonly activityStream: ActivityStreamService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolResult> {
    const teamId = args.teamId as string;
    const projectId = (args.projectId as string) || null;
    const title = args.title as string;
    const description = args.description as string;
    const kind = (args.kind as string) || 'generic';
    const priority = (args.priority as number) || 0;

    // Validate team exists
    const team = this.teamRepo.findById(teamId);
    if (!team) {
      return { ok: false, toolName: this.toolName, error: `Team '${teamId}' not found`, durationMs: 0 };
    }

    const taskId = ulid();
    const now = Date.now();

    this.taskRepo.insert({
      id: taskId,
      title,
      sourceAgentId: context.agentId,
      targetAgentId: null,
      teamId,
      projectId,
      kind: kind as any,
      priority,
      status: 'backlog',
      payload: JSON.stringify({ description, priority }),
      result: null,
      createdAt: now,
      updatedAt: now,
    });

    this.activityStream.emit({
      kind: 'task_status_change',
      agentId: context.agentId,
      payload: JSON.stringify({ taskId, teamId, taskKind: kind, status: 'backlog' }),
      severity: 'info',
    });

    this.eventEmitter.emit('backlog.task.created', { taskId, teamId, kind });

    this.logger.log(`Created team task ${taskId} in team ${teamId} (${kind})`);

    return {
      ok: true,
      toolName: this.toolName,
      data: { taskId, teamId, kind, status: 'backlog' },
      durationMs: 0,
    };
  }
}
