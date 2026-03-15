import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEYS } from '@gamma/types';
import type { AgentMessage } from '@gamma/types';
import { AgentRegistryService } from './agent-registry.service';

const INBOX_MAXLEN = 100;
const BROADCAST_MAXLEN = 200;

/**
 * Redis Streams-based message bus for inter-agent communication.
 * Each agent has a personal inbox (gamma:agent:<id>:inbox) and there is
 * a shared broadcast stream (gamma:agent:broadcast).
 */
@Injectable()
export class MessageBusService {
  private readonly logger = new Logger(MessageBusService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  /**
   * Send a message to a specific agent's inbox.
   * The message is persisted even if the target is offline.
   * Returns the message ID on success.
   */
  async send(
    from: string,
    to: string,
    type: AgentMessage['type'],
    subject: string,
    payload: unknown,
    replyTo?: string,
  ): Promise<{ messageId: string; delivered: boolean }> {
    const target = await this.agentRegistry.getOne(to);
    const delivered = target != null;

    if (target && !target.acceptsMessages) {
      this.logger.debug(`Agent '${to}' has acceptsMessages=false, storing anyway`);
    }

    const msg: AgentMessage = {
      id: ulid(),
      from,
      to,
      type,
      subject,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      ts: Date.now(),
      ...(replyTo ? { replyTo } : {}),
    };

    const streamKey = REDIS_KEYS.AGENT_INBOX(to);
    await this.redis.xadd(
      streamKey, 'MAXLEN', '~', String(INBOX_MAXLEN), '*',
      ...this.flattenMessage(msg),
    );

    this.logger.log(`IPC: ${from} → ${to} [${type}] "${subject}" (id=${msg.id})`);
    return { messageId: msg.id, delivered };
  }

  /**
   * Broadcast a message to all agents via the shared broadcast stream.
   */
  async broadcast(
    from: string,
    type: AgentMessage['type'],
    subject: string,
    payload: unknown,
  ): Promise<string> {
    const msg: AgentMessage = {
      id: ulid(),
      from,
      to: '*',
      type,
      subject,
      payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
      ts: Date.now(),
    };

    await this.redis.xadd(
      REDIS_KEYS.AGENT_BROADCAST, 'MAXLEN', '~', String(BROADCAST_MAXLEN), '*',
      ...this.flattenMessage(msg),
    );

    this.logger.log(`IPC broadcast: ${from} [${type}] "${subject}" (id=${msg.id})`);
    return msg.id;
  }

  /**
   * Read messages from an agent's inbox, optionally starting from a stream ID.
   */
  async readInbox(agentId: string, since = '0'): Promise<AgentMessage[]> {
    const streamKey = REDIS_KEYS.AGENT_INBOX(agentId);
    const results = await this.redis.xrange(streamKey, since === '0' ? '-' : since, '+', 'COUNT', 100);
    return results.map(([, fields]) => this.parseMessage(fields));
  }

  /**
   * Read broadcast messages, optionally starting from a stream ID.
   */
  async readBroadcast(since = '0'): Promise<AgentMessage[]> {
    const results = await this.redis.xrange(
      REDIS_KEYS.AGENT_BROADCAST, since === '0' ? '-' : since, '+', 'COUNT', 200,
    );
    return results.map(([, fields]) => this.parseMessage(fields));
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private flattenMessage(msg: AgentMessage): string[] {
    const args: string[] = [
      'id', msg.id,
      'from', msg.from,
      'to', msg.to,
      'type', msg.type,
      'subject', msg.subject,
      'payload', msg.payload,
      'ts', String(msg.ts),
    ];
    if (msg.replyTo) args.push('replyTo', msg.replyTo);
    if (msg.ttl != null) args.push('ttl', String(msg.ttl));
    return args;
  }

  private parseMessage(fields: string[]): AgentMessage {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      map[fields[i]] = fields[i + 1];
    }
    return {
      id: map.id ?? '',
      from: map.from ?? '',
      to: map.to ?? '',
      type: (map.type ?? 'notification') as AgentMessage['type'],
      subject: map.subject ?? '',
      payload: map.payload ?? '{}',
      ts: Number(map.ts ?? 0),
      ...(map.replyTo ? { replyTo: map.replyTo } : {}),
      ...(map.ttl ? { ttl: Number(map.ttl) } : {}),
    };
  }
}
