import Redis from 'ioredis';
import { existsSync, copyFileSync } from 'fs';
import type { Logger } from 'pino';
import type { CrashReport, SessionAbort } from './types';

const WATCHDOG_COMMANDS_CHANNEL = 'gamma:watchdog:commands';

/**
 * Orchestrates the healing sequence: FREEZE → ROLLBACK → (future: RESTART → FEEDBACK)
 */
export class HealingLoop {
  private redis: Redis;

  constructor(
    redisUrl: string,
    private readonly logger: Logger,
  ) {
    this.redis = new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });

    this.redis.on('error', (err) => {
      this.logger.error({ err: err.message }, 'HealingLoop Redis error');
    });
  }

  /**
   * Execute the full healing sequence for a detected crash.
   */
  async handle(report: CrashReport): Promise<void> {
    this.logger.warn(
      {
        service: report.service,
        crashType: report.crashType,
        affectedFile: report.affectedFile,
        agentSessionId: report.agentSessionId,
      },
      `[HEALING] ${report.crashType} in ${report.service}`,
    );

    // ── PHASE 1: FREEZE ────────────────────────────────────────────────
    if (report.agentSessionId) {
      await this.freeze(report);
    } else {
      this.logger.info('No agentSessionId — skipping FREEZE phase');
    }

    // ── PHASE 2: ROLLBACK ──────────────────────────────────────────────
    if (report.affectedFile) {
      this.rollback(report.affectedFile);
    } else {
      this.logger.info('No affectedFile — skipping ROLLBACK phase');
    }

    // ── PHASE 3+4: RESTART & FEEDBACK (future milestones) ─────────────
  }

  async stop(): Promise<void> {
    this.redis.disconnect();
  }

  // ── FREEZE ──────────────────────────────────────────────────────────

  private async freeze(report: CrashReport): Promise<void> {
    const abort: SessionAbort = {
      type: 'SESSION_ABORT',
      targetAgentSessionId: report.agentSessionId!,
      timestamp: new Date().toISOString(),
      reason: `Watchdog: ${report.crashType} in ${report.service} — quarantining agent`,
    };

    await this.redis.publish(
      WATCHDOG_COMMANDS_CHANNEL,
      JSON.stringify(abort),
    );

    this.logger.warn(
      { sessionId: report.agentSessionId },
      `[FREEZE] SESSION_ABORT published for agent ${report.agentSessionId}`,
    );
  }

  // ── ROLLBACK ────────────────────────────────────────────────────────

  private rollback(affectedFile: string): void {
    const bakPath = `${affectedFile}.bak`;

    if (!existsSync(bakPath)) {
      this.logger.error(
        { affectedFile, bakPath },
        `[ROLLBACK] CRITICAL: .bak file not found — gateway backup contract was violated`,
      );
      return;
    }

    try {
      copyFileSync(bakPath, affectedFile);
      this.logger.warn(
        { affectedFile },
        `[ROLLBACK] Rollback successful for ${affectedFile}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { affectedFile, err: msg },
        `[ROLLBACK] CRITICAL: Failed to restore .bak — ${msg}`,
      );
    }
  }
}
