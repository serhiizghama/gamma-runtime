import { Injectable, Inject, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionsService } from './sessions.service';
import { SessionRegistryService } from './session-registry.service';
import type { WindowSession } from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';

/**
 * Session Garbage Collector (spec §4.4 v1.6)
 *
 * Runs every hour. Scans all sessions in gamma:sessions,
 * checks gamma:state:<windowId>.lastEventAt, and kills sessions
 * idle longer than SESSION_GC_TTL_HOURS (default 24h).
 *
 * This prevents orphaned sessions from leaking Gateway memory
 * when users F5/close tabs without explicit session cleanup.
 */
@Injectable()
export class SessionGcService {
  private readonly logger = new Logger(SessionGcService.name);
  private readonly ttlMs: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sessionsService: SessionsService,
    private readonly registry: SessionRegistryService,
  ) {
    const ttlHours = parseInt(
      this.config.get<string>('SESSION_GC_TTL_HOURS', '24'),
      10,
    );
    this.ttlMs = ttlHours * 3600 * 1000;
    this.logger.log(`Session GC initialized — TTL: ${ttlHours}h`);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async pruneIdleSessions(): Promise<void> {
    const raw = await this.redis.hgetall(REDIS_KEYS.SESSIONS);
    const now = Date.now();
    let collected = 0;

    for (const [windowId, json] of Object.entries(raw)) {
      try {
        const session: WindowSession = JSON.parse(json);

        // Check lastEventAt from the state hash
        const lastEventAt = await this.redis.hget(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'lastEventAt',
        );

        const lastActivity = lastEventAt
          ? Number(lastEventAt)
          : session.createdAt;
        const age = now - lastActivity;

        if (age > this.ttlMs) {
          this.logger.log(
            `GC: killing orphaned session ${windowId} ` +
              `(sessionKey=${session.sessionKey}, idle ${Math.round(age / 3600_000)}h)`,
          );

          // registry.remove is also called inside sessionsService.remove,
          // but we call it explicitly here so orphan cleanup is self-contained.
          await this.registry.remove(session.sessionKey);
          await this.sessionsService.remove(windowId);
          collected++;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`GC: failed to process session ${windowId}: ${msg}`);
      }
    }

    if (collected > 0) {
      this.logger.log(`GC: collected ${collected} orphaned session(s)`);
    }
  }
}
