/**
 * StreamBatcher — debounces high-frequency thinking/assistant_delta events
 * into 50ms windows to prevent React re-render storms (spec §7.3).
 *
 * How it works:
 * - `thinking` and `assistant_delta` events are buffered per windowId:runId key
 * - After 50ms of no new events for that key, the last accumulated value is flushed
 * - All other event types (tool_call, tool_result, lifecycle, etc.) pass through immediately
 * - Gateway sends full accumulated text (not deltas), so "last value wins"
 *
 * Result: ~500 events/s → ~7 flushes/s (one per 50ms window)
 */

import type { GammaSSEEvent } from '@gamma/types';

const BATCH_WINDOW_MS = 50;

interface PendingBatch {
  windowId: string;
  runId: string;
  thinkingText: string | null;
  deltaText: string | null;
  flushTimer: ReturnType<typeof setTimeout> | null;
}

export class StreamBatcher {
  private batches = new Map<string, PendingBatch>();

  constructor(
    private readonly flush: (event: GammaSSEEvent) => void,
  ) {}

  /**
   * Push an event through the batcher.
   * - thinking / assistant_delta / assistant_update → batched (50ms debounce)
   * - everything else → immediate passthrough
   */
  push(event: GammaSSEEvent): void {
    const { type } = event;

    // Only batch thinking and assistant text (delta + update both carry cumulative text)
    if (type !== 'thinking' && type !== 'assistant_delta' && type !== 'assistant_update') {
      // Immediate passthrough — also force-flush any pending batch for this window
      if ('windowId' in event && 'runId' in event) {
        this.flushBatch(`${event.windowId}:${event.runId}`);
      }
      this.flush(event);
      return;
    }

    // type is narrowed to 'thinking' | 'assistant_delta' | 'assistant_update'
    // all three variants carry windowId: string, runId: string, text: string
    const { windowId, runId } = event;
    const key = `${windowId}:${runId}`;

    let batch = this.batches.get(key);
    if (!batch) {
      batch = {
        windowId,
        runId,
        thinkingText: null,
        deltaText: null,
        flushTimer: null,
      };
      this.batches.set(key, batch);
    }

    // Gateway sends full accumulated text — last value wins
    if (type === 'thinking') {
      batch.thinkingText = event.text;
    } else {
      // assistant_delta or assistant_update — both are cumulative; normalize to assistant_delta on flush
      batch.deltaText = event.text;
    }

    // Reset debounce timer
    if (batch.flushTimer !== null) {
      clearTimeout(batch.flushTimer);
    }
    batch.flushTimer = setTimeout(() => this.flushBatch(key), BATCH_WINDOW_MS);
  }

  /** Flush a specific batch by key */
  private flushBatch(key: string): void {
    const batch = this.batches.get(key);
    if (!batch) return;

    // Clear timer
    if (batch.flushTimer !== null) {
      clearTimeout(batch.flushTimer);
      batch.flushTimer = null;
    }

    // Emit merged thinking (last accumulated value)
    if (batch.thinkingText !== null) {
      this.flush({
        type: 'thinking',
        windowId: batch.windowId,
        runId: batch.runId,
        text: batch.thinkingText,
      });
    }

    // Emit merged assistant delta (last accumulated value)
    if (batch.deltaText !== null) {
      this.flush({
        type: 'assistant_delta',
        windowId: batch.windowId,
        runId: batch.runId,
        text: batch.deltaText,
      });
    }

    this.batches.delete(key);
  }

  /** Clean up all pending batches and timers */
  destroy(): void {
    for (const [key, batch] of this.batches) {
      if (batch.flushTimer !== null) {
        clearTimeout(batch.flushTimer);
      }
      this.batches.delete(key);
    }
  }
}
