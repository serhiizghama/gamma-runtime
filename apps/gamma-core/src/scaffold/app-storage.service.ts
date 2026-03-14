import { Injectable, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdirSync } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';

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

  constructor(private readonly config: ConfigService) {
    this.repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      path.resolve(__dirname, '../../..'),
    );
    this.JAIL_ROOT = path.resolve(this.repoRoot, 'apps/gamma-ui/apps/private');
  }

  onModuleInit(): void {
    mkdirSync(this.JAIL_ROOT, { recursive: true });
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
   * Resolves the app from system/ (PascalCase) or private/ (kebab-case).
   * Stored as `{appDir}.bak_session` — self-cleaning on next invocation.
   */
  async snapshotApp(appId: string): Promise<string> {
    const appDir = await this.resolveAppRoot(appId);
    if (!appDir) {
      throw new Error(`[SNAPSHOT] App directory not found for '${appId}' in system/ or private/`);
    }

    const bakDir = `${appDir}.bak_session`;

    // Remove stale snapshot from previous run (Strategy B cleanup)
    await fs.rm(bakDir, { recursive: true, force: true });

    // Recursive copy of the entire app directory
    await fs.cp(appDir, bakDir, { recursive: true });

    this.logger.log(`[SNAPSHOT] ${appId} → ${bakDir}`);
    return bakDir;
  }

  /**
   * Resolves the actual app directory, checking system/ first (PascalCase),
   * then private/ (kebab-case). Returns null if neither exists.
   */
  private async resolveAppRoot(appId: string): Promise<string | null> {
    const pascalName = appId
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join('');

    const candidates = [
      path.resolve(this.repoRoot, 'apps/gamma-ui/apps/system', pascalName),
      path.resolve(this.JAIL_ROOT, appId),
    ];

    for (const dir of candidates) {
      if (await this.fileExists(dir)) {
        return dir;
      }
    }

    return null;
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
