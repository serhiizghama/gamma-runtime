import { Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { SystemEventLog } from '../system/system-event-log.service';

const TOOL_TIMEOUT_MS = 30_000;

/**
 * In-memory watchdog for tool calls (spec §6.2).
 *
 * If a tool_call fires but no matching tool_result arrives within 30s,
 * the timeout callback fires — injecting a lifecycle_error into SSE
 * and updating Redis state to prevent the UI from hanging.
 */
@Injectable()
export class ToolWatchdogService implements OnModuleDestroy {
  private pendingCalls = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(@Optional() private readonly eventLog?: SystemEventLog) {}

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

  /** Clean up all timers on module shutdown. */
  onModuleDestroy(): void {
    for (const timer of this.pendingCalls.values()) {
      clearTimeout(timer);
    }
    this.pendingCalls.clear();
  }
}
