import { Injectable, Optional } from '@nestjs/common';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from '../interfaces';
import { SessionsService } from '../../sessions/sessions.service';

/**
 * Internal tool: spawn_sub_agent
 *
 * Creates a new app-owner agent under the calling agent's supervision.
 * Only available to the 'architect' role.
 */
@Injectable()
export class SpawnSubAgentTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'spawn_sub_agent',
    description:
      'Spawn a new sub-agent under the current agent\'s supervision. ' +
      'Creates a new app-owner session with the given appId and optional initial goal.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect'],
    schema: {
      parameters: {
        appId: {
          type: 'string',
          description: 'Unique application identifier for the new agent.',
          required: true,
        },
        displayName: {
          type: 'string',
          description: 'Human-readable name for the spawned agent.',
        },
        role: {
          type: 'string',
          description: 'Agent role.',
          enum: ['app-owner', 'daemon'],
          default: 'app-owner',
        },
        goal: {
          type: 'string',
          description:
            'Initial prompt/goal sent to the agent after creation.',
        },
      },
      outputDescription:
        'Object with sessionKey and windowId of the spawned agent.',
    },
  };

  readonly toolName = SpawnSubAgentTool.DEFINITION.name;

  constructor(@Optional() private readonly sessions: SessionsService) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const appId = args.appId as string;
    const displayName = (args.displayName as string | undefined) ?? appId;
    const goal = args.goal as string | undefined;

    const result = await this.sessions.spawnAgent({
      appId,
      displayName,
      role: (args.role as 'app-owner' | 'daemon') ?? 'app-owner',
      supervisorId: context.agentId,
      initialPrompt: goal,
    });

    if (!result.ok) {
      return {
        ok: false,
        toolName: this.toolName,
        error: result.error ?? 'Failed to spawn sub-agent',
        durationMs: 0,
      };
    }

    return {
      ok: true,
      toolName: this.toolName,
      data: {
        sessionKey: result.sessionKey,
        windowId: result.windowId,
        appId,
        displayName,
        supervisorId: context.agentId,
      },
      durationMs: 0,
    };
  }
}
