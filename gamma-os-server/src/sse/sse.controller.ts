import { Controller, Param, Sse, MessageEvent, Inject } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { StreamBatcher } from './stream-batcher';

// Redis key constants (from @gamma/types — inlined to avoid runtime path alias issues)
const REDIS_KEYS = {
  SSE_PREFIX: 'gamma:sse:',
  SSE_BROADCAST: 'gamma:sse:broadcast',
} as const;

/**
 * SSE Multiplexer — streams live events from Redis to the browser (spec §7.1).
 *
 * Each connection reads from two Redis Streams simultaneously:
 *   1. gamma:sse:<windowId>  — per-window events (thinking, assistant, tool, lifecycle)
 *   2. gamma:sse:broadcast   — global events (gateway_status, component_ready/removed)
 *
 * Uses XREAD BLOCK for efficient long-polling with minimal CPU usage.
 */
@Controller('api/stream')
export class SseController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Sse(':windowId')
  stream(@Param('windowId') windowId: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // Dedicated Redis connection for blocking reads —
      // XREAD BLOCK monopolizes the connection, so we duplicate it.
      const blockingRedis = this.redis.duplicate();
      let closed = false;

      // ── StreamBatcher (spec §7.3) ─────────────────────────────────────
      // Debounces thinking/assistant_delta by 50ms.
      // All other event types pass through immediately.
      const batcher = new StreamBatcher((event) => {
        if (!closed) {
          subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
        }
      });

      const windowKey = `${REDIS_KEYS.SSE_PREFIX}${windowId}`;
      const broadcastKey = REDIS_KEYS.SSE_BROADCAST;

      // Track last-seen IDs per stream — '$' means "only new entries"
      const lastIds: Record<string, string> = {
        [windowKey]: '$',
        [broadcastKey]: '$',
      };

      const poll = async (): Promise<void> => {
        while (!closed) {
          try {
            // ioredis xread with BLOCK requires the overload:
            // xread('BLOCK', ms, 'COUNT', n, 'STREAMS', ...keys, ...ids)
            const results = await (blockingRedis as any).xread( // eslint-disable-line @typescript-eslint/no-explicit-any
              'BLOCK', 5000,
              'COUNT', 50,
              'STREAMS',
              windowKey, broadcastKey,
              lastIds[windowKey], lastIds[broadcastKey],
            ) as [string, [string, string[]][]][] | null;

            if (!results || closed) continue;

            for (const [streamKey, messages] of results) {
              for (const [id, fields] of messages) {
                lastIds[streamKey] = id;

                // Parse flat field array [k1, v1, k2, v2, ...] → object
                const event = parseStreamFields(fields);

                if (!closed) {
                  batcher.push(event);
                }
              }
            }
          } catch (err: unknown) {
            if (closed) break;
            const msg = err instanceof Error ? err.message : String(err);
            // Connection closed errors are expected during shutdown
            if (
              msg.includes('Connection is closed') ||
              msg.includes('Stream isn\'t readable')
            ) {
              break;
            }
            // Unexpected error — brief pause then retry
            await sleep(500);
          }
        }
      };

      // Start polling loop (fire-and-forget — runs until closed)
      poll().catch(() => {});

      // Cleanup on client disconnect
      return () => {
        closed = true;
        batcher.destroy();
        blockingRedis.disconnect();
      };
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Convert Redis Stream field array [k1, v1, k2, v2, ...] to an object.
 * Attempts JSON.parse on values that look like JSON.
 */
function parseStreamFields(fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const raw = fields[i + 1];
    // Try to parse JSON values (arrays, objects, numbers, booleans)
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
        // fall through to string
      }
    }
    obj[key] = raw;
  }
  return obj;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
