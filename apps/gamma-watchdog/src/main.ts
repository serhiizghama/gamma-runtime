import pino from 'pino';
import { RedisListener } from './redis-listener';
import { HealingLoop } from './healing-loop';
import { Heartbeat } from './heartbeat';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const logger = pino({
  name: 'gamma-watchdog',
  transport: {
    target: 'pino/file',
    options: { destination: 1 }, // stdout
  },
});

async function main() {
  logger.info('Gamma Watchdog daemon is starting...');

  // ── Heartbeat (Observability §4) ──────────────────────────────────
  const heartbeat = new Heartbeat(REDIS_URL, logger);
  heartbeat.start();

  // ── Healing Loop (FREEZE → ROLLBACK → FEEDBACK) ──────────────────
  const healer = new HealingLoop(REDIS_URL, logger);

  // ── Redis Listener (Detect phase) ──────────────────────────────────
  const listener = new RedisListener(REDIS_URL, logger);

  listener.onCrashReport((report) => healer.handle(report));

  await listener.start();
  logger.info('Gamma Watchdog daemon is online');

  // ── Graceful shutdown ──────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, exiting...');
    await listener.stop();
    await healer.stop();
    await heartbeat.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Watchdog failed to start');
  process.exit(1);
});
