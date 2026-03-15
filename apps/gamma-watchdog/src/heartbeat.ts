import Redis from 'ioredis';
import type { Logger } from 'pino';

const HEARTBEAT_KEY = 'gamma:watchdog:heartbeat';
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_S = 60; // auto-expire if watchdog dies without cleanup

/**
 * Watchdog Heartbeat — writes a timestamp to Redis every 10 seconds.
 *
 * gamma-core's SystemHealthService reads this key and reports
 * 'WARNING: Watchdog Offline' if the heartbeat is stale (>30s).
 */
export class Heartbeat {
  private redis: Redis;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    redisUrl: string,
    private readonly logger: Logger,
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });

    this.redis.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Heartbeat Redis error');
    });
  }

  start(): void {
    // Emit immediately, then on interval
    this.beat();
    this.timer = setInterval(() => this.beat(), HEARTBEAT_INTERVAL_MS);
    this.logger.info(
      { key: HEARTBEAT_KEY, intervalMs: HEARTBEAT_INTERVAL_MS },
      '[HEARTBEAT] Started',
    );
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Clean up the key on graceful shutdown
    try {
      await this.redis.del(HEARTBEAT_KEY);
    } catch {
      // best-effort
    }
    this.redis.disconnect();
    this.logger.info('[HEARTBEAT] Stopped');
  }

  private beat(): void {
    const now = Date.now();
    this.redis
      .set(HEARTBEAT_KEY, String(now), 'EX', HEARTBEAT_TTL_S)
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn({ err: msg }, '[HEARTBEAT] Failed to write');
      });
  }
}
