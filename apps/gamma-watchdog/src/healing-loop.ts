import Redis from 'ioredis';
import { existsSync, copyFileSync, rmSync, cpSync } from 'fs';
import * as path from 'path';
import type { Logger } from 'pino';
import type { CrashReport, SessionAbort, AgentFeedback, FeedbackReason } from './types';

const WATCHDOG_COMMANDS_CHANNEL = 'gamma:watchdog:commands';
const SYSTEM_EVENTS_CHANNEL = 'gamma:system:events';
const AGENT_FEEDBACK_CHANNEL = 'gamma:watchdog:feedback';

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
    let rollbackOk = false;
    if (report.affectedFile) {
      rollbackOk = this.rollback(report.affectedFile);
    } else {
      this.logger.info('No affectedFile — skipping ROLLBACK phase');
    }

    // ── PHASE 2.5: PUBLISH SYSTEM EVENT (Sentinel visibility) ─────────
    await this.publishSystemEvent(report, rollbackOk);

    // ── PHASE 3: AGENT FEEDBACK ──────────────────────────────────────
    if (report.agentSessionId) {
      await this.sendAgentFeedback(report, rollbackOk);
    }
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

  // ── SYSTEM EVENT BRIDGE ─────────────────────────────────────────────

  private async publishSystemEvent(report: CrashReport, rollbackOk: boolean): Promise<void> {
    const appDir = report.affectedFile ? this.resolveAppDir(report.affectedFile) : 'unknown';
    const appId = appDir.split(path.sep).pop() ?? appDir;
    const agentPart = report.agentSessionId ? ` (agent: ${report.agentSessionId})` : '';

    const message = rollbackOk
      ? `CRITICAL: Rollback — '${appId}' restored from .bak_session${agentPart} [${report.crashType}]`
      : `CRITICAL: Rollback FAILED — could not restore '${appId}'${agentPart} [${report.crashType}]`;

    const payload = JSON.stringify({
      type: 'critical',
      message,
      ts: Date.now(),
      meta: {
        service: report.service,
        crashType: report.crashType,
        appId,
        agentSessionId: report.agentSessionId,
        rollbackOk,
      },
    });

    try {
      await this.redis.publish(SYSTEM_EVENTS_CHANNEL, payload);
      this.logger.info(
        { channel: SYSTEM_EVENTS_CHANNEL, appId, rollbackOk },
        '[BRIDGE] System event published to gamma:system:events',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: msg }, '[BRIDGE] Failed to publish system event');
    }
  }

  // ── AGENT FEEDBACK ─────────────────────────────────────────────────

  private async sendAgentFeedback(report: CrashReport, rollbackOk: boolean): Promise<void> {
    const reasonCode = this.deriveReasonCode(report);
    const rollbackNote = rollbackOk
      ? 'Your previous changes were rolled back.'
      : 'Rollback failed — manual intervention may be needed.';

    const instruction =
      `[WATCHDOG POST-MORTEM] Your last action caused a ${report.crashType} in ${report.service}. ` +
      `${rollbackNote} ` +
      `Reason: ${reasonCode}. ` +
      `Please review the error and avoid repeating the same mistake:\n\n` +
      report.errorLog.slice(0, 2000);

    const feedback: AgentFeedback = {
      type: 'WATCHDOG_FEEDBACK',
      targetAgentSessionId: report.agentSessionId!,
      timestamp: new Date().toISOString(),
      affectedFile: report.affectedFile,
      errorLog: report.errorLog,
      instruction,
      reasonCode,
    };

    try {
      await this.redis.publish(AGENT_FEEDBACK_CHANNEL, JSON.stringify(feedback));
      this.logger.info(
        { sessionId: report.agentSessionId, reasonCode },
        `[FEEDBACK] Post-mortem sent to ${report.agentSessionId}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: msg }, '[FEEDBACK] Failed to publish agent feedback');
    }
  }

  private deriveReasonCode(report: CrashReport): FeedbackReason {
    if (report.crashType === 'HARD_CRASH') return 'HARD_CRASH';
    if (report.crashType === 'BUILD_ERROR') return 'BUILD_FAILURE';
    if (report.errorLog.toLowerCase().includes('timeout')) return 'TOOL_TIMEOUT';
    if (report.crashType === 'SOFT_CRASH') return 'RUNTIME_CRASH';
    return 'UNKNOWN';
  }

  // ── ROLLBACK ────────────────────────────────────────────────────────

  private rollback(affectedFile: string): boolean {
    const appDir = this.resolveAppDir(affectedFile);
    const bakDir = `${appDir}.bak_session`;

    // Prefer directory-level snapshot; fall back to legacy per-file .bak
    if (existsSync(bakDir)) {
      return this.rollbackDirectory(appDir, bakDir);
    } else {
      return this.rollbackSingleFile(affectedFile);
    }
  }

  /**
   * Restores the entire app directory from a `.bak_session` snapshot.
   */
  private rollbackDirectory(appDir: string, bakDir: string): boolean {
    try {
      rmSync(appDir, { recursive: true, force: true });
      cpSync(bakDir, appDir, { recursive: true });
      this.logger.warn(
        { appDir },
        `[ROLLBACK] Directory restored: ${appDir} ← ${bakDir}`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { appDir, err: msg },
        `[ROLLBACK] CRITICAL: directory restore failed — ${msg}`,
      );
      return false;
    }
  }

  /**
   * Legacy fallback: restores a single file from its `.bak` copy.
   */
  private rollbackSingleFile(affectedFile: string): boolean {
    const bakPath = `${affectedFile}.bak`;

    if (!existsSync(bakPath)) {
      this.logger.error(
        { affectedFile, bakPath },
        `[ROLLBACK] CRITICAL: no .bak_session or .bak found — backup contract violated`,
      );
      return false;
    }

    try {
      copyFileSync(bakPath, affectedFile);
      this.logger.warn(
        { affectedFile },
        `[ROLLBACK] Single-file rollback successful for ${affectedFile}`,
      );
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { affectedFile, err: msg },
        `[ROLLBACK] CRITICAL: Failed to restore .bak — ${msg}`,
      );
      return false;
    }
  }

  /**
   * Derives the app root directory from any file path within it.
   * Handles both layouts:
   *   .../apps/system/Terminal/TerminalApp.tsx  → .../apps/system/Terminal
   *   .../apps/private/weather/WeatherApp.tsx   → .../apps/private/weather
   */
  private resolveAppDir(affectedFile: string): string {
    const markers = [
      `apps${path.sep}system${path.sep}`,
      `apps${path.sep}private${path.sep}`,
    ];

    for (const marker of markers) {
      const idx = affectedFile.indexOf(marker);
      if (idx !== -1) {
        const afterMarker = affectedFile.slice(idx + marker.length);
        const appName = afterMarker.split(path.sep)[0];
        return affectedFile.slice(0, idx) + marker + appName;
      }
    }

    // Cannot determine app directory — return parent as best effort
    return path.dirname(affectedFile);
  }
}
