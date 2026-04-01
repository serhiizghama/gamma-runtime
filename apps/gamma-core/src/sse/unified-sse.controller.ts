import { Controller, Query, Sse, MessageEvent, Inject, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { StreamBatcher } from './stream-batcher';
import { REDIS_KEYS } from '@gamma/types';
import type { GammaSSEEvent } from '@gamma/types';
import { parseStreamFields } from '../redis/redis-stream.util';

/**
 * Unified SSE Multiplexer — one connection, many Redis Streams.
 *
 * Replaces the pattern of 6-12+ individual EventSource connections per page.
 * The client specifies which channels to subscribe to via the `channels` query
 * param, and events are returned with a `_ch` field indicating their source.
 *
 * Channel syntax:
 *   - `window:<windowId>`  → gamma:sse:<windowId>
 *   - `broadcast`          → gamma:sse:broadcast
 *   - `activity`           → gamma:system:activity
 *
 * Example: GET /api/stream/unified?ticket=xxx&channels=broadcast,activity,window:abc123
 */
@Controller('api/stream')
export class UnifiedSseController {
  private readonly logger = new Logger(UnifiedSseController.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Sse('unified')
  stream(
    @Query('ticket') ticket?: string,
    @Query('channels') channelsParam?: string,
    @Query('lastEventIds') lastEventIdsParam?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // ── Parse channels ──────────────────────────────────────────────
      const channelMap = this.parseChannels(channelsParam || 'broadcast');
      if (channelMap.size === 0) {
        subscriber.next({
          data: JSON.stringify({ type: 'error', message: 'no valid channels specified' }),
        } as MessageEvent);
        subscriber.complete();
        return;
      }

      // ── Parse lastEventIds (channel=id,channel=id) ──────────────────
      const lastIds = this.parseLastEventIds(lastEventIdsParam, channelMap);

      // ── Ticket validation (same as SseController) ───────────────────
      const validateTicket = async (): Promise<boolean> => {
        if (!ticket) return false;
        const key = `${REDIS_KEYS.SSE_TICKET_PREFIX}${ticket}`;
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, 30);
        return count <= 10;
      };

      const blockingRedis = this.redis.duplicate();
      let closed = false;

      // Reverse map: Redis key → channel name (for _ch metadata)
      const redisKeyToChannel = new Map<string, string>();
      for (const [ch, rk] of channelMap) redisKeyToChannel.set(rk, ch);

      // StreamBatcher for window channels (thinking/assistant debounce)
      const batcher = new StreamBatcher((event) => {
        if (closed) return;
        // Find the channel from the event's windowId
        const windowId = (event as Record<string, unknown>).windowId as string | undefined;
        const ch = windowId ? `window:${windowId}` : 'broadcast';
        subscriber.next({
          data: JSON.stringify({ _ch: ch, ...event }),
        } as MessageEvent);
      });

      // ── Poll loop ───────────────────────────────────────────────────
      const poll = async (): Promise<void> => {
        const streamKeys = Array.from(channelMap.values());
        const streamIds = streamKeys.map((k) => lastIds.get(k) || '$');

        while (!closed) {
          try {
            const results = await (blockingRedis as any).xread( // eslint-disable-line @typescript-eslint/no-explicit-any
              'BLOCK', 4000,
              'COUNT', 50,
              'STREAMS',
              ...streamKeys,
              ...streamIds.map((_, i) => lastIds.get(streamKeys[i]) || '$'),
            ) as [string, [string, string[]][]][] | null;

            if (!results || closed) continue;

            for (const [streamKey, messages] of results) {
              const ch = redisKeyToChannel.get(streamKey) || streamKey;
              const isWindowChannel = ch.startsWith('window:');

              for (const [id, fields] of messages) {
                lastIds.set(streamKey, id);
                const event = parseStreamFields(fields) as GammaSSEEvent;

                if (closed) break;

                if (isWindowChannel) {
                  // Route through batcher for thinking/assistant debounce
                  batcher.push(event);
                } else {
                  // Activity and broadcast — pass through immediately with _ch
                  subscriber.next({
                    data: JSON.stringify({ _ch: ch, ...event }),
                  } as MessageEvent);
                }
              }
            }
          } catch (err: unknown) {
            if (closed) break;
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes('Connection is closed') ||
              msg.includes("Stream isn't readable")
            ) {
              break;
            }
            await sleep(500);
          }
        }
      };

      // ── Keep-alive heartbeat ────────────────────────────────────────
      const keepAliveInterval = setInterval(() => {
        if (!closed) {
          subscriber.next({
            data: JSON.stringify({ type: 'keep_alive' }),
          } as MessageEvent);
        }
      }, 4_000);

      // ── Start ───────────────────────────────────────────────────────
      validateTicket()
        .then((valid) => {
          if (!valid) {
            this.logger.warn('Unified SSE rejected: invalid or expired ticket');
            subscriber.next({
              data: JSON.stringify({ type: 'error', message: 'invalid or expired ticket' }),
            } as MessageEvent);
            subscriber.complete();
            return;
          }
          this.logger.log(`Unified SSE connected: channels=[${Array.from(channelMap.keys()).join(',')}]`);
          poll().catch(() => {});
        })
        .catch(() => subscriber.complete());

      // ── Cleanup ─────────────────────────────────────────────────────
      return () => {
        closed = true;
        clearInterval(keepAliveInterval);
        batcher.destroy();
        blockingRedis.disconnect();
      };
    });
  }

  /** Map channel names to Redis stream keys */
  private parseChannels(param: string): Map<string, string> {
    const map = new Map<string, string>();
    for (const ch of param.split(',').map((s) => s.trim()).filter(Boolean)) {
      if (ch === 'broadcast') {
        map.set('broadcast', REDIS_KEYS.SSE_BROADCAST);
      } else if (ch === 'activity') {
        map.set('activity', REDIS_KEYS.SYSTEM_ACTIVITY);
      } else if (ch.startsWith('window:')) {
        const windowId = ch.slice(7);
        if (windowId) map.set(ch, `${REDIS_KEYS.SSE_PREFIX}${windowId}`);
      }
      // Unknown channels are silently ignored
    }
    return map;
  }

  /** Parse lastEventIds query param: "channel=id,channel=id" → Map<redisKey, id> */
  private parseLastEventIds(
    param: string | undefined,
    channelMap: Map<string, string>,
  ): Map<string, string> {
    const lastIds = new Map<string, string>();
    // Default all to '$'
    for (const rk of channelMap.values()) lastIds.set(rk, '$');

    if (!param) return lastIds;

    for (const pair of param.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx < 0) continue;
      const ch = pair.slice(0, eqIdx).trim();
      const id = pair.slice(eqIdx + 1).trim();
      const rk = channelMap.get(ch);
      if (rk && id) lastIds.set(rk, id);
    }

    return lastIds;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
