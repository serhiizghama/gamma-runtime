import { Injectable } from '@nestjs/common';
import type { ITool, ToolResult } from '@gamma/types';
import type { IToolExecutor, ToolExecutionContext } from '../interfaces';
import { MessageBusService } from '../../messaging/message-bus.service';

/**
 * Internal tool: send_message
 *
 * Sends a message to another agent via the Redis Streams message bus.
 * Available to both 'architect' and 'app-owner' roles.
 */
@Injectable()
export class SendMessageTool implements IToolExecutor {
  static readonly DEFINITION: ITool = {
    name: 'send_message',
    description:
      'Send a message to another agent via the inter-agent message bus. ' +
      'The message is persisted in the recipient\'s inbox even if they are offline.',
    type: 'internal',
    category: 'agent',
    allowedRoles: ['architect', 'app-owner'],
    schema: {
      parameters: {
        recipientId: {
          type: 'string',
          description: 'Agent ID or session key of the target agent.',
          required: true,
        },
        subject: {
          type: 'string',
          description: 'Short subject line for the message.',
          required: true,
        },
        body: {
          type: 'string',
          description: 'Message body content.',
          required: true,
        },
        type: {
          type: 'string',
          description: 'Message type classification.',
          enum: ['task_request', 'task_response', 'notification', 'query'],
          default: 'task_request',
        },
        replyTo: {
          type: 'string',
          description: 'Optional message ID this is a reply to.',
        },
      },
      outputDescription:
        'Object with messageId and delivered flag (true if recipient is registered).',
    },
  };

  readonly toolName = SendMessageTool.DEFINITION.name;

  constructor(private readonly messageBus: MessageBusService) {}

  async execute(
    args: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const recipientId = args.recipientId as string;
    const subject = args.subject as string;
    const body = args.body as string;
    const type = (args.type as 'task_request' | 'task_response' | 'notification' | 'query') ?? 'task_request';
    const replyTo = args.replyTo as string | undefined;

    const result = await this.messageBus.send(
      context.agentId,
      recipientId,
      type,
      subject,
      body,
      replyTo,
    );

    return {
      ok: true,
      toolName: this.toolName,
      data: {
        messageId: result.messageId,
        delivered: result.delivered,
        recipientId,
      },
      durationMs: 0,
    };
  }
}
