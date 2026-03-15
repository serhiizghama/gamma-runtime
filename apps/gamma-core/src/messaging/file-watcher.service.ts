import {
  Injectable,
  Logger,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as fs from 'fs';
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEYS } from '@gamma/types';

/** Walk up from startDir looking for gamma-runtime root package.json */
function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as { name?: string };
        if (pkg.name === 'gamma-runtime') return dir;
      } catch { /* keep walking */ }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot find gamma-runtime root (searched up from ${startDir})`);
}

/**
 * FileWatcherService — native filesystem watcher for the private apps jail.
 *
 * WHY THIS EXISTS:
 * OpenClaw executes its native `fs_write` tool internally without forwarding
 * tool-call events to gamma-core via WebSocket. The previous approach of
 * intercepting `stream='tool'` events in handleAgentEvent was therefore dead code.
 *
 * This service watches JAIL_ROOT (`apps/gamma-ui/apps/private/`) using Node.js
 * native `fs.watch` (recursive, macOS + Linux ≥ 5.x supported) and publishes
 * a `gamma:system:file_changed` stream entry whenever an .tsx / .md / .ts file
 * is written, enabling the FileChangeConsumerService to trigger the Inspector.
 *
 * Debounce: 800ms per (appId, filePath) to coalesce rapid multi-write sequences.
 */
@Injectable()
export class FileWatcherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FileWatcherService.name);
  private watchers: fs.FSWatcher[] = [];
  private jailRoot = '';
  private systemAppsRoot = '';

  /** Debounce: appId:filePath → timer */
  private readonly debounce = new Map<string, ReturnType<typeof setTimeout>>();
  private static readonly DEBOUNCE_MS = 3_000;

  /** Content hash cache: absolutePath → SHA-256 hex. Suppresses false triggers. */
  private readonly contentHashes = new Map<string, string>();

  /** mtime cache: absolutePath → mtime ms. Fast pre-check before hashing. */
  private readonly lastMtime = new Map<string, number>();

  /** Extensions that trigger the Inspector loop */
  private static readonly WATCHED_EXTS = new Set(['.tsx', '.ts', '.md', '.css', '.json']);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    const repoRoot = findRepoRoot(__dirname);
    this.jailRoot = path.resolve(repoRoot, 'apps/gamma-ui/apps/private');
    this.systemAppsRoot = path.resolve(repoRoot, 'apps/gamma-ui/apps/system');

    for (const dir of [this.jailRoot, this.systemAppsRoot]) {
      this.startWatcher(dir);
    }
  }

  onModuleDestroy(): void {
    for (const timer of this.debounce.values()) clearTimeout(timer);
    this.debounce.clear();
    for (const w of this.watchers) w.close();
    this.watchers = [];
    this.logger.log('FileWatcher stopped');
  }

  private startWatcher(dir: string): void {
    try {
      const w = fs.watch(
        dir,
        { recursive: true, persistent: false },
        (eventType, filename) => {
          // 'change' = content modified; 'rename' = file created/deleted/moved.
          // Both must be handled — macOS emits 'rename' for new file creation.
          if ((eventType === 'change' || eventType === 'rename') && filename) {
            this.handleFsEvent(filename, dir);
          }
        },
      );
      w.on('error', (err) => {
        this.logger.error(`FSWatcher error on ${dir}: ${err.message}`);
      });
      this.watchers.push(w);
      this.logger.log(`Watching for file changes: ${dir}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to start FSWatcher on ${dir}: ${msg}`);
    }
  }

  // ── Private ────────────────────────────────────────────────────────────

  private handleFsEvent(filename: string, baseDir: string): void {
    const ext = path.extname(filename);
    if (!FileWatcherService.WATCHED_EXTS.has(ext)) return;

    // filename is relative to baseDir, e.g. "terminal/TerminalApp.tsx"
    const segments = filename.split(path.sep);
    if (segments.length < 2) return; // ignore top-level noise

    const appId = segments[0];
    // Skip .bak_session directories and hidden files
    if (appId.endsWith('.bak_session') || appId.startsWith('.')) return;

    const absolutePath = path.join(baseDir, filename);
    const debounceKey = `${appId}:${filename}`;

    const existing = this.debounce.get(debounceKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.debounce.delete(debounceKey);
      this.publish(appId, absolutePath).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Publish failed for ${appId}/${filename}: ${msg}`);
      });
    }, FileWatcherService.DEBOUNCE_MS);

    this.debounce.set(debounceKey, timer);
  }

  private async publish(appId: string, filePath: string): Promise<void> {
    // Fast mtime pre-check: skip hash if file hasn't been modified
    let stat: fs.Stats;
    try {
      stat = await fs.promises.stat(filePath);
    } catch {
      // File may have been deleted between event and publish — skip
      return;
    }
    const mtimeMs = stat.mtimeMs;
    const prevMtime = this.lastMtime.get(filePath);
    if (prevMtime !== undefined && prevMtime === mtimeMs) {
      this.logger.debug(`[WATCHER] mtime unchanged — skipping publish for ${path.basename(filePath)}`);
      return;
    }
    this.lastMtime.set(filePath, mtimeMs);

    // Hash-based dedup: suppress publish if file content hasn't actually changed
    let currentHash: string;
    try {
      const content = await fs.promises.readFile(filePath);
      currentHash = createHash('sha256').update(content).digest('hex');
    } catch {
      // File may have been deleted between event and publish — skip
      return;
    }

    const prevHash = this.contentHashes.get(filePath);
    if (prevHash === currentHash) {
      this.logger.debug(`[WATCHER] content unchanged — skipping publish for ${path.basename(filePath)}`);
      return;
    }
    this.contentHashes.set(filePath, currentHash);

    const sessionKey = `app-owner-${appId}`;
    const nowMs = Date.now();

    const streamId = await this.redis.xadd(
      REDIS_KEYS.FILE_CHANGED_STREAM,
      'MAXLEN', '~', '500',
      '*',
      'appId', appId,
      'filePath', filePath,
      'sessionKey', sessionKey,
      'toolCallId', '',
      'windowId', '',
      'timestamp', String(nowMs),
    );

    this.logger.log(
      `[WATCHER] file_changed published | appId=${appId} | file=${path.basename(filePath)} | streamId=${streamId}`,
    );
  }
}
