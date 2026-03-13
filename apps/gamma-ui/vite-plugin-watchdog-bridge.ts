import type { Plugin, ViteDevServer } from 'vite';
import Redis from 'ioredis';

const STREAM_KEY = 'gamma:memory:bus';

/**
 * Vite plugin that bridges HMR / build errors to the Gamma Watchdog
 * via Redis Stream `gamma:memory:bus` as CRASH_REPORT events.
 *
 * Handles Redis being offline gracefully — Vite will never crash due
 * to a missing Redis connection.
 */
export function watchdogBridge(): Plugin {
  let redis: Redis | null = null;
  let redisReady = false;

  function ensureRedis(): Redis | null {
    if (redis) return redisReady ? redis : null;

    const url = process.env.REDIS_URL || 'redis://localhost:6379';
    redis = new Redis(url, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 1000, 10_000),
      lazyConnect: true,
    });

    redis.on('error', () => {
      redisReady = false;
    });
    redis.on('ready', () => {
      redisReady = true;
    });

    redis.connect().catch(() => {});
    return null; // not ready yet on first call
  }

  function inferSessionKey(filePath: string | undefined): string | null {
    if (!filePath) return null;
    // Monorepo apps: apps/gamma-ui/apps/{system|generated|*}/{appId}/...
    const match = filePath.match(/apps\/gamma-ui\/apps\/[^/]+\/([a-z0-9-]+)\//i);
    if (match) return `app-owner-${match[1]}`;
    return null;
  }

  async function publishCrashReport(
    errorMessage: string,
    file: string | undefined,
  ): Promise<void> {
    const client = ensureRedis();
    if (!client) return;

    const sessionKey = inferSessionKey(file);

    try {
      await client.xadd(
        STREAM_KEY, '*',
        'type', 'CRASH_REPORT',
        'service', 'gamma-ui',
        'crashType', 'SOFT_CRASH',
        'timestamp', new Date().toISOString(),
        'agentSessionId', sessionKey ?? '',
        'affectedFile', file ?? '',
        'errorLog', errorMessage.slice(0, 4000),
        'exitCode', '',
      );
    } catch {
      // Swallow — watchdog bridge must never break Vite
    }
  }

  return {
    name: 'gamma-watchdog-bridge',
    apply: 'serve', // dev server only

    configureServer(server: ViteDevServer) {
      // Warm up Redis connection early
      ensureRedis();

      // Intercept HMR error payloads sent to the browser
      const origSend = server.ws.send;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server.ws as any).send = (payload: any, ...rest: any[]) => {
        if (
          payload &&
          typeof payload === 'object' &&
          payload.type === 'error'
        ) {
          const message: string = payload.err?.message ?? 'Unknown Vite error';
          const file: string | undefined = payload.err?.id;
          publishCrashReport(message, file);
        }
        return origSend.call(server.ws, payload, ...rest);
      };
    },

    buildEnd(error?: Error) {
      if (error) {
        publishCrashReport(error.message, undefined);
      }
    },

    closeBundle() {
      if (redis) {
        redis.disconnect();
        redis = null;
        redisReady = false;
      }
    },
  };
}
