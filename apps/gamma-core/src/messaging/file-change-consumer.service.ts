import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEYS } from '@gamma/types';

/** Parsed file_changed stream entry. */
interface FileChangedEvent {
  appId: string;
  filePath: string;
  sessionKey: string;
  toolCallId: string;
  windowId: string;
  timestamp: string;
}

/** Debounce window per appId — accumulates file paths before triggering review. */
interface PendingReview {
  appId: string;
  ownerSessionKey: string;
  filePaths: Set<string>;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Consumes `gamma:system:file_changed` events and triggers the App Inspector
 * agent to review modified files. Events are debounced per appId so rapid
 * successive writes (e.g. multi-file scaffold) result in a single review.
 *
 * Phase 4.2 — Loop 3.
 */
@Injectable()
export class FileChangeConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileChangeConsumerService.name);

  /** Dedicated Redis connection for XREAD BLOCK (monopolizes the connection). */
  private blockingRedis: Redis | null = null;

  /** Last consumed stream ID — enables gap-free resumption after restart. */
  private lastStreamId = '0';

  /** Debounce buckets keyed by appId. */
  private pending = new Map<string, PendingReview>();

  /** Debounce window in milliseconds. */
  private static readonly DEBOUNCE_MS = 3_000;

  /** Controls the poll loop lifecycle. */
  private running = false;

  /**
   * Callback to dispatch a review request. Injected via `setDispatcher()`
   * after the full dependency graph is available (avoids circular imports
   * between MessagingModule ↔ SessionsModule).
   */
  private dispatcher: ((appId: string, ownerSessionKey: string, filePaths: string[]) => Promise<void>) | null = null;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────

  onModuleInit(): void {
    this.blockingRedis = this.redis.duplicate();
    this.running = true;
    // Fire-and-forget — the poll loop runs until onModuleDestroy.
    this.pollLoop().catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Poll loop terminated unexpectedly: ${msg}`);
    });
    this.logger.log('File change consumer started');
  }

  async onModuleDestroy(): Promise<void> {
    this.running = false;

    // Clear all pending debounce timers
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();

    // Disconnect the blocking Redis client
    if (this.blockingRedis) {
      await this.blockingRedis.quit().catch(() => {});
      this.blockingRedis = null;
    }

    this.logger.log('File change consumer stopped');
  }

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Register the dispatch callback. Called by SessionsModule after both
   * modules are fully initialized, to avoid circular dependency.
   */
  setDispatcher(fn: (appId: string, ownerSessionKey: string, filePaths: string[]) => Promise<void>): void {
    this.dispatcher = fn;
  }

  // ── Poll loop ──────────────────────────────────────────────────────────

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        if (!this.blockingRedis) break;

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const results = await (this.blockingRedis as any).xread(
          'BLOCK', 5000,
          'COUNT', 50,
          'STREAMS',
          REDIS_KEYS.FILE_CHANGED_STREAM,
          this.lastStreamId,
        ) as [string, [string, string[]][]][] | null;

        if (!results || !this.running) continue;

        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            this.lastStreamId = id;
            const event = this.parseFields(fields);
            if (event) {
              this.enqueue(event);
            }
          }
        }
      } catch (err: unknown) {
        if (!this.running) break; // shutdown in progress
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Poll error (will retry): ${msg}`);
        // Brief backoff before retrying to avoid tight error loops
        await this.sleep(1000);
      }
    }
  }

  // ── Debounce ───────────────────────────────────────────────────────────

  private enqueue(event: FileChangedEvent): void {
    const existing = this.pending.get(event.appId);

    if (existing) {
      // Reset the debounce timer and accumulate the new file path
      clearTimeout(existing.timer);
      existing.filePaths.add(event.filePath);
      existing.timer = setTimeout(
        () => this.flush(event.appId),
        FileChangeConsumerService.DEBOUNCE_MS,
      );
    } else {
      const filePaths = new Set<string>([event.filePath]);
      const timer = setTimeout(
        () => this.flush(event.appId),
        FileChangeConsumerService.DEBOUNCE_MS,
      );
      this.pending.set(event.appId, {
        appId: event.appId,
        ownerSessionKey: event.sessionKey,
        filePaths,
        timer,
      });
    }
  }

  private flush(appId: string): void {
    const entry = this.pending.get(appId);
    if (!entry) return;
    this.pending.delete(appId);

    const filePaths = [...entry.filePaths];

    if (!this.dispatcher) {
      this.logger.warn(
        `Dispatcher not registered — skipping review for ${appId} (${filePaths.length} files)`,
      );
      return;
    }

    this.dispatcher(appId, entry.ownerSessionKey, filePaths).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Review dispatch failed for ${appId}: ${msg}`);
      },
    );
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private parseFields(fields: string[]): FileChangedEvent | null {
    const map: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      map[fields[i]] = fields[i + 1];
    }

    const { appId, filePath, sessionKey } = map;
    if (!appId || !filePath || !sessionKey) {
      this.logger.debug(`Malformed file_changed event: ${JSON.stringify(map)}`);
      return null;
    }

    return {
      appId,
      filePath,
      sessionKey,
      toolCallId: map.toolCallId ?? '',
      windowId: map.windowId ?? '',
      timestamp: map.timestamp ?? String(Date.now()),
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
