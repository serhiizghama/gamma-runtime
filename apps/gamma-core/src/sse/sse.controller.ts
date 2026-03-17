import { Controller, Param, Query, Sse, MessageEvent, Inject, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { StreamBatcher } from './stream-batcher';
import { REDIS_KEYS } from '@gamma/types';
import type { GammaSSEEvent } from '@gamma/types';
import { parseStreamFields } from '../redis/redis-stream.util';

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
  private readonly logger = new Logger(SseController.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Sse(':windowId')
  stream(
    @Param('windowId') windowId: string,
    @Query('ticket') ticket?: string,
    @Query('lastEventId') lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // Validate SSE ticket. Tickets are short-lived (30s TTL) but reusable
      // within that window to survive ERR_NETWORK_CHANGED reconnects where the
      // browser immediately retries with the same URL before the client can
      // fetch a fresh ticket. We do NOT delete on first use; Redis TTL ensures
      // the ticket expires naturally. A ticket allows up to 10 uses to prevent
      // unlimited reuse while still supporting rapid reconnects.
      const validateTicket = async (): Promise<boolean> => {
        if (!ticket) return false;
        const key = `${REDIS_KEYS.SSE_TICKET_PREFIX}${ticket}`;
        // INCR is atomic — returns the new count (1 on first use)
        const count = await this.redis.incr(key);
        if (count === 1) {
          // First use: set the TTL (30s). Key was just created by INCR.
          await this.redis.expire(key, 30);
        }
        // Allow up to 10 uses within the TTL window (covers rapid reconnects)
        return count <= 10;
      };

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

      // Gap protection (spec §4.1): if lastEventId is provided, resume from
      // that point instead of '$'. This prevents losing events between the
      // sync snapshot call and the SSE connection opening.
      const lastIds: Record<string, string> = {
        [windowKey]: lastEventId ?? '$',
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
                // Cast to GammaSSEEvent — trusted internal boundary (Redis ← kernel)
                const event = parseStreamFields(fields) as GammaSSEEvent;

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

      // ── Keep-alive heartbeat (spec §7.1) ──────────────────────────────
      // Sends { type: "keep_alive" } every 15s to prevent browser/proxy timeouts.
      const keepAliveInterval = setInterval(() => {
        if (!closed) {
          subscriber.next({
            data: JSON.stringify({ type: 'keep_alive' }),
          } as MessageEvent);
        }
      }, 15_000);

      // Validate ticket before starting the poll loop
      validateTicket()
        .then((valid) => {
          if (!valid) {
            this.logger.warn(`SSE rejected for ${windowId}: invalid or expired ticket`);
            subscriber.next({
              data: JSON.stringify({ type: 'error', message: 'invalid or expired ticket' }),
            } as MessageEvent);
            subscriber.complete();
            return;
          }
          poll().catch(() => {});
        })
        .catch(() => {
          subscriber.complete();
        });

      // Cleanup on client disconnect
      return () => {
        closed = true;
        clearInterval(keepAliveInterval);
        batcher.destroy();
        blockingRedis.disconnect();
      };
    });
  }
}


function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
