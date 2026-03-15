import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { findRepoRoot } from '../scaffold/app-storage.service';
import { SystemEventLog } from './system-event-log.service';
import type { BackupInventory, BackupSessionEntry, BackupFileEntry } from '@gamma/types';

@Injectable()
export class SystemMonitorService {
  private readonly systemAppsDir: string;
  private readonly privateAppsDir: string;

  constructor(
    private readonly config: ConfigService,
    private readonly eventLog: SystemEventLog,
  ) {
    const repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      findRepoRoot(__dirname),
    );
    this.systemAppsDir = path.resolve(repoRoot, 'apps/gamma-ui/apps/system');
    this.privateAppsDir = path.resolve(repoRoot, 'apps/gamma-ui/apps/private');
  }

  async getBackupInventory(): Promise<BackupInventory> {
    const [systemSessions, systemFiles] = await this.scanTier(this.systemAppsDir, 'system');
    const [privateSessions, privateFiles] = await this.scanTier(this.privateAppsDir, 'private');

    const sessions = [...systemSessions, ...privateSessions];
    const files = [...systemFiles, ...privateFiles];

    const totalSizeBytes =
      sessions.reduce((sum, s) => sum + s.sizeBytes, 0) +
      files.reduce((sum, f) => sum + f.sizeBytes, 0);

    return { ts: Date.now(), sessions, files, totalSizeBytes, events: this.eventLog.getAll() };
  }

  // ── Tier scanner ────────────────────────────────────────────────────────

  private async scanTier(
    baseDir: string,
    tier: 'system' | 'private',
  ): Promise<[BackupSessionEntry[], BackupFileEntry[]]> {
    const sessions: BackupSessionEntry[] = [];
    const files: BackupFileEntry[] = [];

    let entries: string[];
    try {
      entries = await fs.readdir(baseDir);
    } catch {
      return [sessions, files]; // dir doesn't exist yet
    }

    for (const entry of entries) {
      const fullPath = path.join(baseDir, entry);

      // ── .bak_session directories ──
      if (entry.endsWith('.bak_session')) {
        const appId = entry.replace('.bak_session', '');
        const { size, count, mtime } = await this.dirStats(fullPath);
        sessions.push({
          appId,
          tier,
          bakSessionPath: fullPath,
          sizeBytes: size,
          fileCount: count,
          createdAt: mtime,
        });
        continue;
      }

      // ── Scan app directories for per-file .bak backups ──
      const stat = await fs.stat(fullPath).catch(() => null);
      if (stat?.isDirectory()) {
        const bakFiles = await this.findBakFiles(fullPath, entry, tier);
        files.push(...bakFiles);
      }
    }

    return [sessions, files];
  }

  // ── Per-file .bak scanner ──────────────────────────────────────────────

  private async findBakFiles(
    appDir: string,
    appId: string,
    tier: 'system' | 'private',
  ): Promise<BackupFileEntry[]> {
    const results: BackupFileEntry[] = [];

    let dirEntries: string[];
    try {
      dirEntries = await fs.readdir(appDir);
    } catch {
      return results;
    }

    for (const file of dirEntries) {
      if (!file.endsWith('.bak')) continue;
      const bakPath = path.join(appDir, file);
      const stat = await fs.stat(bakPath).catch(() => null);
      if (!stat?.isFile()) continue;

      results.push({
        appId,
        tier,
        originalFile: file.replace(/\.bak$/, ''),
        bakFile: bakPath,
        sizeBytes: stat.size,
        modifiedAt: stat.mtimeMs,
      });
    }

    return results;
  }

  // ── Directory stats helper ─────────────────────────────────────────────

  private async dirStats(
    dirPath: string,
  ): Promise<{ size: number; count: number; mtime: number }> {
    let size = 0;
    let count = 0;
    let mtime = 0;

    try {
      const dirStat = await fs.stat(dirPath);
      mtime = dirStat.mtimeMs;

      const entries = await fs.readdir(dirPath);
      for (const entry of entries) {
        const entryPath = path.join(dirPath, entry);
        const stat = await fs.stat(entryPath).catch(() => null);
        if (stat?.isFile()) {
          size += stat.size;
          count++;
        }
      }
    } catch {
      // silently skip unreadable dirs
    }

    return { size, count, mtime };
  }
}
