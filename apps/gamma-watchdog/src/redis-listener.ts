import Redis from 'ioredis';
import type { Logger } from 'pino';
import type { CrashReport } from './types';

const STREAM_KEY = 'gamma:memory:bus';
const CONSUMER_GROUP = 'watchdog';
const CONSUMER_NAME = 'watchdog-1';
const BLOCK_MS = 5_000;

type CrashHandler = (report: CrashReport) => void | Promise<void>;

/**
 * Subscribes to `gamma:memory:bus` Redis Stream and filters for
 * CRASH_REPORT events, forwarding them to the registered handler.
 */
export class RedisListener {
  private redis: Redis;
  private running = false;
  private handler: CrashHandler | null = null;

  constructor(
    redisUrl: string,
    private readonly logger: Logger,
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });

    this.redis.on('error', (err) => {
      this.logger.error({ err: err.message }, 'Redis connection error');
    });

    this.redis.on('connect', () => {
      this.logger.info('Redis connected');
    });
  }

  /** Register the callback that receives validated CrashReport events. */
  onCrashReport(handler: CrashHandler): void {
    this.handler = handler;
  }

  /** Start the consumer loop. */
  async start(): Promise<void> {
    // Ensure the consumer group exists (create from ID '0' if missing)
    try {
      await this.redis.xgroup('CREATE', STREAM_KEY, CONSUMER_GROUP, '0', 'MKSTREAM');
      this.logger.info({ group: CONSUMER_GROUP, stream: STREAM_KEY }, 'Consumer group created');
    } catch (err: unknown) {
      // BUSYGROUP = group already exists — safe to ignore
      if (err instanceof Error && err.message.includes('BUSYGROUP')) {
        this.logger.debug('Consumer group already exists, reusing');
      } else {
        throw err;
      }
    }

    this.running = true;
    this.logger.info({ stream: STREAM_KEY }, 'Redis listener started');
    this.readLoop();
  }

  /** Stop the consumer loop and disconnect. */
  async stop(): Promise<void> {
    this.running = false;
    this.redis.disconnect();
    this.logger.info('Redis listener stopped');
  }

  // ── Private ───────────────────────────────────────────────────────────

  private async readLoop(): Promise<void> {
    while (this.running) {
      try {
        const results = await this.redis.xreadgroup(
          'GROUP', CONSUMER_GROUP, CONSUMER_NAME,
          'COUNT', '10',
          'BLOCK', BLOCK_MS,
          'STREAMS', STREAM_KEY,
          '>',
        );

        if (!results) continue;

        for (const [, entries] of results as [string, [string, string[]][]][]) {
          for (const [id, fields] of entries) {
            this.processEntry(id, fields);
          }
        }
      } catch (err) {
        if (!this.running) break;
        this.logger.error({ err }, 'Redis read error, retrying in 1s...');
        await sleep(1_000);
      }
    }
  }

  private processEntry(id: string, fields: string[]): void {
    // fields is a flat array: [key, value, key, value, ...]
    const obj = fieldsToObject(fields);

    if (obj.type !== 'CRASH_REPORT') return;

    const report = parseCrashReport(obj);
    if (!report) {
      this.logger.warn({ streamId: id, raw: obj }, 'Malformed CRASH_REPORT, skipping');
      return;
    }

    this.logger.info(
      {
        streamId: id,
        service: report.service,
        crashType: report.crashType,
        affectedFile: report.affectedFile,
        agentSessionId: report.agentSessionId,
      },
      `CRASH_REPORT detected: ${report.crashType} in ${report.service}`,
    );

    // ACK the message so it won't be redelivered
    this.redis.xack(STREAM_KEY, CONSUMER_GROUP, id).catch((err) => {
      this.logger.error({ err, streamId: id }, 'Failed to ACK stream entry');
    });

    if (this.handler) {
      Promise.resolve(this.handler(report)).catch((err) => {
        this.logger.error({ err }, 'Crash handler threw');
      });
    }
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────

function fieldsToObject(fields: string[]): Record<string, string> {
  const obj: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) {
    obj[fields[i]] = fields[i + 1];
  }
  return obj;
}

function parseCrashReport(obj: Record<string, string>): CrashReport | null {
  const validServices = new Set(['gamma-core', 'gamma-ui', 'gamma-proxy']);
  const validCrashTypes = new Set(['HARD_CRASH', 'SOFT_CRASH', 'BUILD_ERROR']);

  if (!validServices.has(obj.service) || !validCrashTypes.has(obj.crashType)) {
    return null;
  }
  if (!obj.errorLog || !obj.timestamp) {
    return null;
  }

  return {
    type: 'CRASH_REPORT',
    service: obj.service as CrashReport['service'],
    crashType: obj.crashType as CrashReport['crashType'],
    timestamp: obj.timestamp,
    agentSessionId: obj.agentSessionId || null,
    affectedFile: obj.affectedFile || null,
    errorLog: obj.errorLog,
    exitCode: obj.exitCode ? parseInt(obj.exitCode, 10) : null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
