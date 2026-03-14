import Redis from 'ioredis';
import { existsSync, copyFileSync, rmSync, cpSync } from 'fs';
import * as path from 'path';
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
    const appDir = this.resolveAppDir(affectedFile);
    const bakDir = `${appDir}.bak_session`;

    // Prefer directory-level snapshot; fall back to legacy per-file .bak
    if (existsSync(bakDir)) {
      this.rollbackDirectory(appDir, bakDir);
    } else {
      this.rollbackSingleFile(affectedFile);
    }
  }

  /**
   * Restores the entire app directory from a `.bak_session` snapshot.
   */
  private rollbackDirectory(appDir: string, bakDir: string): void {
    try {
      rmSync(appDir, { recursive: true, force: true });
      cpSync(bakDir, appDir, { recursive: true });
      this.logger.warn(
        { appDir },
        `[ROLLBACK] Directory restored: ${appDir} ← ${bakDir}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { appDir, err: msg },
        `[ROLLBACK] CRITICAL: directory restore failed — ${msg}`,
      );
    }
  }

  /**
   * Legacy fallback: restores a single file from its `.bak` copy.
   */
  private rollbackSingleFile(affectedFile: string): void {
    const bakPath = `${affectedFile}.bak`;

    if (!existsSync(bakPath)) {
      this.logger.error(
        { affectedFile, bakPath },
        `[ROLLBACK] CRITICAL: no .bak_session or .bak found — backup contract violated`,
      );
      return;
    }

    try {
      copyFileSync(bakPath, affectedFile);
      this.logger.warn(
        { affectedFile },
        `[ROLLBACK] Single-file rollback successful for ${affectedFile}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { affectedFile, err: msg },
        `[ROLLBACK] CRITICAL: Failed to restore .bak — ${msg}`,
      );
    }
  }

  /**
   * Derives the app root directory from any file path within it.
   * E.g. `.../apps/private/weather/WeatherApp.tsx` → `.../apps/private/weather`
   */
  private resolveAppDir(affectedFile: string): string {
    // Walk up to find the `apps/private` boundary
    const marker = `apps${path.sep}private${path.sep}`;
    const idx = affectedFile.indexOf(marker);
    if (idx === -1) {
      // Cannot determine app directory — return parent as best effort
      return path.dirname(affectedFile);
    }
    const afterMarker = affectedFile.slice(idx + marker.length);
    const appId = afterMarker.split(path.sep)[0];
    return path.join(affectedFile.slice(0, idx), 'apps', 'private', appId);
  }
}
