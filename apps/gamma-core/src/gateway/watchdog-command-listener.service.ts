import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionsService } from '../sessions/sessions.service';

const WATCHDOG_COMMANDS_CHANNEL = 'gamma:watchdog:commands';

interface WatchdogCommand {
  type: string;
  targetAgentSessionId?: string;
  reason?: string;
  timestamp?: string;
}

/**
 * Subscribes to the `gamma:watchdog:commands` Redis Pub/Sub channel.
 * On `SESSION_ABORT`, immediately kills the offending agent session
 * so the watchdog can safely rollback and restart.
 */
@Injectable()
export class WatchdogCommandListenerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('WatchdogCmdListener');
  private subscriber: Redis | null = null;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sessions: SessionsService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Duplicate the connection for Pub/Sub (subscriber mode blocks the client)
    this.subscriber = this.redis.duplicate();

    this.subscriber.on('error', (err) => {
      this.logger.error(`Redis subscriber error: ${err.message}`);
    });

    await this.subscriber.subscribe(WATCHDOG_COMMANDS_CHANNEL);
    this.logger.log(`Subscribed to ${WATCHDOG_COMMANDS_CHANNEL}`);

    this.subscriber.on('message', (_channel: string, message: string) => {
      this.handleMessage(message);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.unsubscribe(WATCHDOG_COMMANDS_CHANNEL);
      this.subscriber.disconnect();
      this.subscriber = null;
    }
  }

  private handleMessage(raw: string): void {
    let cmd: WatchdogCommand;
    try {
      cmd = JSON.parse(raw) as WatchdogCommand;
    } catch {
      this.logger.warn(`Malformed watchdog command: ${raw.slice(0, 200)}`);
      return;
    }

    if (cmd.type === 'SESSION_ABORT' && cmd.targetAgentSessionId) {
      this.logger.warn(
        `SESSION_ABORT received for session=${cmd.targetAgentSessionId} — reason: ${cmd.reason ?? 'unknown'}`,
      );
      this.sessions.killBySessionKey(cmd.targetAgentSessionId).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `Failed to kill session ${cmd.targetAgentSessionId}: ${msg}`,
        );
      });
    }
  }
}
