import pino from 'pino';
import { RedisListener } from './redis-listener';

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

  // ── Redis Listener (Detect phase) ──────────────────────────────────
  const listener = new RedisListener(REDIS_URL, logger);

  listener.onCrashReport((report) => {
    logger.warn(
      {
        service: report.service,
        crashType: report.crashType,
        affectedFile: report.affectedFile,
        agentSessionId: report.agentSessionId,
        exitCode: report.exitCode,
      },
      `[HEALING] ${report.crashType} in ${report.service} — ${report.errorLog.slice(0, 200)}`,
    );
    // Future milestones: FREEZE → ROLLBACK → RESTART → FEEDBACK
  });

  await listener.start();
  logger.info('Gamma Watchdog daemon is online');

  // ── Graceful shutdown ──────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal, exiting...');
    await listener.stop();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Watchdog failed to start');
  process.exit(1);
});
