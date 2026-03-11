import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
export class AppStorageService {
  readonly JAIL_ROOT: string;

  constructor(private readonly config: ConfigService) {
    const repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      path.resolve(__dirname, '../../..'),
    );
    this.JAIL_ROOT = path.resolve(repoRoot, 'web/apps/generated');
  }

  // ── Path Jail Guard ───────────────────────────────────────────────────

  /**
   * Resolves a relative path and verifies it stays within JAIL_ROOT.
   * Throws ForbiddenException on absolute paths, hidden files, or traversal.
   *
   * @param relativePath — path relative to web/apps/generated/
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

  async fileExists(absolutePath: string): Promise<boolean> {
    try {
      await fs.access(absolutePath);
      return true;
    } catch {
      return false;
    }
  }
}
