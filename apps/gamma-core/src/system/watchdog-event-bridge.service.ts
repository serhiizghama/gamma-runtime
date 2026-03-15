import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SystemEventLog } from './system-event-log.service';
import type { SystemEventType } from './system-event-log.service';

const SYSTEM_EVENTS_CHANNEL = 'gamma:system:events';

interface WatchdogSystemEvent {
  type: SystemEventType;
  message: string;
  ts?: number;
  meta?: Record<string, unknown>;
}

/**
 * Bridges Watchdog events into the in-process SystemEventLog.
 *
 * The gamma-watchdog daemon is an isolated process — it cannot directly inject
 * into gamma-core's in-memory ring buffer. Instead, it publishes to the
 * `gamma:system:events` Redis Pub/Sub channel. This service subscribes to
 * that channel and forwards messages into SystemEventLog, making them
 * visible in the Sentinel Activity Feed.
 *
 * Connection: uses a dedicated Redis subscriber (separate from the main client)
 * because ioredis subscriber connections cannot execute regular commands.
 */
@Injectable()
export class WatchdogEventBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WatchdogEventBridgeService.name);
  private readonly subscriber: Redis;

  constructor(
    @Inject(REDIS_CLIENT) redis: Redis,
    private readonly eventLog: SystemEventLog,
  ) {
    // Duplicate the main Redis connection — subscriber mode requires a
    // dedicated connection that cannot run regular commands.
    this.subscriber = redis.duplicate();

    this.subscriber.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Subscriber Redis error');
    });
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(SYSTEM_EVENTS_CHANNEL);

    this.subscriber.on('message', (channel: string, message: string) => {
      if (channel !== SYSTEM_EVENTS_CHANNEL) return;
      this.handleSystemEvent(message);
    });

    this.logger.log(`Subscribed to ${SYSTEM_EVENTS_CHANNEL} — Sentinel bridge active`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.subscriber.unsubscribe(SYSTEM_EVENTS_CHANNEL);
    } catch {
      // Ignore unsubscribe errors on shutdown
    }
    this.subscriber.disconnect();
    this.logger.log('Watchdog event bridge disconnected');
  }

  // ── Private ───────────────────────────────────────────────────────────

  private handleSystemEvent(raw: string): void {
    try {
      const event = JSON.parse(raw) as WatchdogSystemEvent;

      const type: SystemEventType =
        event.type && ['info', 'warn', 'error', 'critical'].includes(event.type)
          ? event.type
          : 'critical';

      const message =
        typeof event.message === 'string' && event.message.trim()
          ? event.message.trim()
          : 'Watchdog: unstructured system event received';

      this.eventLog.push(message, type);

      this.logger.log(
        { type, channel: SYSTEM_EVENTS_CHANNEL },
        `[BRIDGE] SystemEventLog ← "${message}"`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: msg, raw }, '[BRIDGE] Malformed event payload, skipping');
    }
  }
}
