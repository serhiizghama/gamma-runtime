import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { SystemEventLog } from '../system/system-event-log.service';
import { AppStorageService } from '../scaffold/app-storage.service';

const TOOL_TIMEOUT_MS = 30_000;
const MAX_CONSECUTIVE_ROLLBACKS = 3;

/**
 * In-memory watchdog for tool calls (spec §6.2).
 *
 * If a tool_call fires but no matching tool_result arrives within 30s,
 * the timeout callback fires — injecting a lifecycle_error into SSE
 * and updating Redis state to prevent the UI from hanging.
 *
 * On timeout, triggers automated rollback via AppStorageService if
 * a .bak_session exists, with a safety cooldown to prevent loops.
 */
@Injectable()
export class ToolWatchdogService implements OnModuleDestroy {
  private readonly logger = new Logger(ToolWatchdogService.name);
  private pendingCalls = new Map<string, ReturnType<typeof setTimeout>>();

  /** Consecutive rollback counter per appId — resets on successful resolve */
  private rollbackCounts = new Map<string, number>();

  constructor(
    @Optional() private readonly eventLog?: SystemEventLog,
    @Optional() private readonly appStorage?: AppStorageService,
  ) {}

  /** Timeout duration exposed for integration callbacks */
  static readonly TIMEOUT_MS = TOOL_TIMEOUT_MS;

  /**
   * Register a tool call. If no result arrives within TOOL_TIMEOUT_MS,
   * fire the timeout callback.
   */
  register(
    windowId: string,
    toolCallId: string,
    _runId: string,
    onTimeout: () => void | Promise<void>,
  ): void {
    const key = `${windowId}:${toolCallId}`;

    // Clear existing timer for this key if re-registered
    const existing = this.pendingCalls.get(key);
    if (existing) clearTimeout(existing);

    this.eventLog?.push(`Watchdog registered: ${windowId} / ${toolCallId}`);

    const timer = setTimeout(() => {
      this.pendingCalls.delete(key);
      this.eventLog?.push(`Watchdog timeout: ${windowId} / ${toolCallId} (${TOOL_TIMEOUT_MS / 1000}s)`, 'warn');
      // Fire-and-forget — errors logged by caller
      Promise.resolve(onTimeout()).catch(() => {});
    }, TOOL_TIMEOUT_MS);

    this.pendingCalls.set(key, timer);
  }

  /** Cancel the watchdog when a tool_result arrives in time. */
  resolve(windowId: string, toolCallId: string): void {
    const key = `${windowId}:${toolCallId}`;
    const timer = this.pendingCalls.get(key);
    if (timer) {
      clearTimeout(timer);
      this.pendingCalls.delete(key);
      this.eventLog?.push(`Watchdog resolved: ${windowId} / ${toolCallId}`);
    }
  }

  /** Clean up all pending timers for a window (on lifecycle_end / abort / error). */
  clearWindow(windowId: string): void {
    const prefix = `${windowId}:`;
    for (const [key, timer] of this.pendingCalls) {
      if (key.startsWith(prefix)) {
        clearTimeout(timer);
        this.pendingCalls.delete(key);
      }
    }
  }

  // ── Automated Rollback ────────────────────────────────────────────────

  /**
   * Trigger an automated rollback for an app after a lifecycle_error or timeout.
   * Enforces a safety cooldown: max 3 consecutive rollbacks per appId.
   */
  async triggerRollback(appId: string): Promise<boolean> {
    if (!this.appStorage) {
      this.logger.warn(`[Rollback] AppStorageService not available — skipping rollback for '${appId}'`);
      return false;
    }

    const count = this.rollbackCounts.get(appId) ?? 0;
    if (count >= MAX_CONSECUTIVE_ROLLBACKS) {
      const msg = `Rollback cooldown: '${appId}' hit ${MAX_CONSECUTIVE_ROLLBACKS} consecutive rollbacks — manual intervention required`;
      this.logger.error(`[Rollback] ${msg}`);
      this.eventLog?.push(msg, 'critical');
      return false;
    }

    this.rollbackCounts.set(appId, count + 1);

    const success = await this.appStorage.rollbackApp(appId);
    if (success) {
      this.eventLog?.push(`Automated rollback triggered for '${appId}' (attempt ${count + 1}/${MAX_CONSECUTIVE_ROLLBACKS})`, 'critical');
    }
    return success;
  }

  /** Reset rollback counter for an app (called on successful run resolution). */
  resetRollbackCount(appId: string): void {
    this.rollbackCounts.delete(appId);
  }

  /** Clean up all timers on module shutdown. */
  onModuleDestroy(): void {
    for (const timer of this.pendingCalls.values()) {
      clearTimeout(timer);
    }
    this.pendingCalls.clear();
  }
}
