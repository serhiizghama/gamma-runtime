import { Injectable, Inject, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { ulid } from 'ulid';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEYS } from '@gamma/types';
import type { ActivityEvent } from '@gamma/types';

const ACTIVITY_MAXLEN = '5000';
const FLUSH_INTERVAL_MS = 50;

/** Flatten an object to [key, value, key, value, ...] for XADD */
function flattenEntry(obj: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    args.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return args;
}

/**
 * Global Activity Stream — publishes structured events to `gamma:system:activity`.
 *
 * All agent lifecycle, tool call, IPC, and system events are funneled through
 * this service for the Director dashboard to consume in real time.
 *
 * Events are batched in a 50ms window to avoid write storms under high load.
 */
@Injectable()
export class ActivityStreamService {
  private readonly logger = new Logger('ActivityStream');

  /** Pending events awaiting flush */
  private buffer: ActivityEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  /** Dedup guard: agentId → { kind, ts } for status change debouncing */
  private lastStatusChange = new Map<string, number>();

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Emit an activity event. Assigns id + timestamp automatically.
   * Events are buffered for 50ms before flushing to Redis.
   */
  emit(
    event: Omit<ActivityEvent, 'id' | 'ts'>,
  ): void {
    // Debounce agent_status_change: skip if same agent within 1s
    if (event.kind === 'agent_status_change') {
      const now = Date.now();
      const last = this.lastStatusChange.get(event.agentId);
      if (last && now - last < 1000) return;
      this.lastStatusChange.set(event.agentId, now);
    }

    const full: ActivityEvent = {
      ...event,
      id: ulid(),
      ts: Date.now(),
    };

    this.buffer.push(full);
    this.logger.debug(
      `[DIRECTOR-DEBUG] BUFFERED | kind=${full.kind} | agent=${full.agentId} | tool=${full.toolName ?? '-'} | bufferSize=${this.buffer.length}`,
    );

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Read events from the activity stream (REST catch-up).
   * @param since Redis stream ID to start after (exclusive), defaults to '-' (beginning)
   * @param count Max events to return
   */
  async read(since = '-', count = 200): Promise<ActivityEvent[]> {
    const results = await (this.redis as any).xrange( // eslint-disable-line @typescript-eslint/no-explicit-any
      REDIS_KEYS.SYSTEM_ACTIVITY,
      since === '-' ? '-' : `(${since}`,
      '+',
      'COUNT',
      count,
    ) as [string, string[]][] | null;

    if (!results) return [];

    return results.map(([, fields]) => parseStreamFields(fields) as unknown as ActivityEvent);
  }

  /** Flush buffered events to Redis in a single pipeline. */
  private flush(): void {
    this.flushTimer = null;
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);
    const pipeline = this.redis.pipeline();

    for (const event of batch) {
      pipeline.xadd(
        REDIS_KEYS.SYSTEM_ACTIVITY,
        'MAXLEN', '~', ACTIVITY_MAXLEN,
        '*',
        ...flattenEntry(event as unknown as Record<string, unknown>),
      );
    }

    this.logger.log(
      `[DIRECTOR-DEBUG] FLUSH ${batch.length} event(s) → ${REDIS_KEYS.SYSTEM_ACTIVITY} | kinds=[${batch.map(e => e.kind).join(',')}]`,
    );

    pipeline.exec().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`[DIRECTOR-DEBUG] FLUSH FAILED: ${msg}`);
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseStreamFields(fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const raw = fields[i + 1];
    if (
      raw.startsWith('{') ||
      raw.startsWith('[') ||
      raw === 'true' ||
      raw === 'false' ||
      raw === 'null'
    ) {
      try {
        obj[key] = JSON.parse(raw);
        continue;
      } catch {
        // fall through
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      obj[key] = Number(raw);
      continue;
    }
    obj[key] = raw;
  }
  return obj;
}
