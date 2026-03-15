import { Injectable, ForbiddenException, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { SystemEventLog } from '../system/system-event-log.service';

/**
 * Walks up from a starting directory to find the monorepo root.
 * Identifies root by a package.json with `"name": "gamma-runtime"`.
 * Works both from src/ (ts-node dev) and dist/ (compiled prod).
 */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    const candidate = path.join(dir, 'package.json');
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, 'utf8'));
        if (pkg.name === 'gamma-runtime') return dir;
      } catch {
        // not valid JSON, keep walking
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  throw new Error(
    `Cannot find gamma-runtime monorepo root (searched up from ${startDir})`,
  );
}

/**
 * App Storage Service — Jailed File System (spec §9.5).
 *
 * Solely responsible for all file system I/O within the generated-apps jail:
 * - Path traversal prevention via jailPath()
 * - CRUD operations (ensureDir, writeFile, removeDir, fileExists)
 *
 * All public methods that perform I/O accept pre-resolved absolute paths
 * obtained via jailPath(), ensuring callers cannot bypass the jail.
 */
@Injectable()
export class AppStorageService implements OnModuleInit {
  private readonly logger = new Logger(AppStorageService.name);
  readonly JAIL_ROOT: string;
  private readonly repoRoot: string;

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly eventLog?: SystemEventLog,
  ) {
    this.repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      findRepoRoot(__dirname),
    );
    this.JAIL_ROOT = path.resolve(this.repoRoot, 'apps/gamma-ui/apps/private');
  }

  onModuleInit(): void {
    mkdirSync(this.JAIL_ROOT, { recursive: true });
    this.logger.log(`Repo root: ${this.repoRoot}`);
    this.logger.log(`Jail root ensured: ${this.JAIL_ROOT}`);
  }

  // ── Path Jail Guard ───────────────────────────────────────────────────

  /**
   * Resolves a relative path and verifies it stays within JAIL_ROOT.
   * Throws ForbiddenException on absolute paths, hidden files, or traversal.
   *
   * @param relativePath — path relative to apps/gamma-ui/apps/private/
   * @returns absolute resolved path within the jail
   */
  jailPath(relativePath: string): string {
    if (path.isAbsolute(relativePath)) {
      throw new ForbiddenException(
        `Path traversal attempt blocked: absolute path '${relativePath}' is forbidden`,
      );
    }

    const normalized = path.normalize(relativePath);
    if (
      normalized.split(path.sep).some((segment) => segment.startsWith('.'))
    ) {
      throw new ForbiddenException(
        `Hidden files and directories (.git, etc.) are strictly forbidden: '${relativePath}'`,
      );
    }

    const resolved = path.resolve(this.JAIL_ROOT, normalized);

    if (
      resolved !== this.JAIL_ROOT &&
      !resolved.startsWith(this.JAIL_ROOT + path.sep)
    ) {
      throw new ForbiddenException(
        `Path traversal attempt blocked: '${relativePath}' resolves outside jail`,
      );
    }

    return resolved;
  }

  /** Expose jail root for consumers that need to know the base directory */
  getJailRoot(): string {
    return this.JAIL_ROOT;
  }

  // ── File System Operations ────────────────────────────────────────────

  async ensureDir(absolutePath: string): Promise<void> {
    await fs.mkdir(absolutePath, { recursive: true });
  }

  async writeFile(absolutePath: string, content: string | Buffer): Promise<void> {
    // Watchdog contract: create .bak before every agent write (§4 rollback)
    if (await this.fileExists(absolutePath)) {
      await fs.copyFile(absolutePath, `${absolutePath}.bak`);
    }

    if (typeof content === 'string') {
      await fs.writeFile(absolutePath, content, 'utf8');
    } else {
      await fs.writeFile(absolutePath, content);
    }
  }

  /** Removes a directory tree. Silently succeeds if path does not exist (force). */
  async removeDir(absolutePath: string): Promise<void> {
    await fs.rm(absolutePath, { recursive: true, force: true });
  }

  // ── Pre-flight Snapshot ────────────────────────────────────────────

  /**
   * Creates a directory-level snapshot of the app bundle before an agent run.
   * Resolves the app from system/ (lowercase) or private/ (kebab-case).
   * Stored as `{appDir}.bak_session` — self-cleaning on next invocation.
   */
  async snapshotApp(appId: string): Promise<string> {
    this.logger.debug(`[SNAPSHOT] snapshotApp called for '${appId}'`);
    const appDir = await this.resolveAppRoot(appId);
    if (!appDir) {
      throw new Error(`[SNAPSHOT] App directory not found for '${appId}' in system/ or private/`);
    }

    const bakDir = `${appDir}.bak_session`;

    this.logger.debug(`[SNAPSHOT] Copying '${appDir}' → '${bakDir}'`);

    // Remove stale snapshot from previous run (Strategy B cleanup)
    await fs.rm(bakDir, { recursive: true, force: true });

    // Recursive copy of the entire app directory
    await fs.cp(appDir, bakDir, { recursive: true });

    this.logger.log(`[SNAPSHOT] ${appId} → ${bakDir}`);
    this.eventLog?.push(`Snapshot created for '${appId}'`);
    return bakDir;
  }

  /**
   * Resolves the actual app directory, checking system/ first (lowercase),
   * then private/ (kebab-case). Returns null if neither exists.
   */
  private async resolveAppRoot(appId: string): Promise<string | null> {
    const candidates = [
      path.resolve(this.repoRoot, 'apps/gamma-ui/apps/system', appId),
      path.resolve(this.JAIL_ROOT, appId),
    ];

    this.logger.debug(`[SNAPSHOT] resolveAppRoot '${appId}' — candidates: ${JSON.stringify(candidates)}`);

    for (const dir of candidates) {
      const exists = await this.fileExists(dir);
      this.logger.debug(`[SNAPSHOT]   ${dir} → ${exists ? 'EXISTS' : 'MISSING'}`);
      if (exists) {
        return dir;
      }
    }

    return null;
  }

  // ── Automated Rollback ───────────────────────────────────────────────

  /**
   * Restores an app from its `.bak_session` snapshot.
   * Returns true if rollback succeeded, false if no valid snapshot exists.
   */
  async rollbackApp(appId: string): Promise<boolean> {
    const appDir = await this.resolveAppRoot(appId);
    if (!appDir) {
      this.logger.warn(`[ROLLBACK] App directory not found for '${appId}' — skipping`);
      return false;
    }

    const bakDir = `${appDir}.bak_session`;

    // Sanity check: .bak_session must exist and contain at least one file
    if (!(await this.fileExists(bakDir))) {
      this.logger.warn(`[ROLLBACK] No .bak_session found for '${appId}' — skipping`);
      return false;
    }

    try {
      const entries = await fs.readdir(bakDir);
      if (entries.length === 0) {
        this.logger.warn(`[ROLLBACK] .bak_session for '${appId}' is empty — skipping`);
        return false;
      }
    } catch {
      this.logger.warn(`[ROLLBACK] .bak_session for '${appId}' is unreadable — skipping`);
      return false;
    }

    // Remove the corrupted app directory and restore from snapshot
    await fs.rm(appDir, { recursive: true, force: true });
    await fs.cp(bakDir, appDir, { recursive: true });

    this.logger.log(`[ROLLBACK] ${appId} restored from ${bakDir}`);
    this.eventLog?.push(`Automated rollback completed for '${appId}'`, 'critical');
    return true;
  }

  async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}
