import { Injectable, Logger, ForbiddenException, NotFoundException } from '@nestjs/common';
import { WorkspaceService } from '../agents/workspace.service';
import { existsSync, statSync, readdirSync, readFileSync } from 'fs';
import { join, resolve, extname, relative } from 'path';

export interface AppStatus {
  exists: boolean;
  lastModified: number | null;
  files: string[];
  sizeBytes: number;
}

interface FileResult {
  content: Buffer;
  mimeType: string;
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.map': 'application/json',
};

@Injectable()
export class TeamAppService {
  private readonly logger = new Logger(TeamAppService.name);

  constructor(private readonly workspace: WorkspaceService) {}

  getAppDir(teamId: string): string {
    return join(this.workspace.getTeamPath(teamId), 'project', 'app');
  }

  getStatus(teamId: string): AppStatus {
    const appDir = this.getAppDir(teamId);
    const indexPath = join(appDir, 'index.html');

    if (!existsSync(indexPath)) {
      return { exists: false, lastModified: null, files: [], sizeBytes: 0 };
    }

    const files = this.listFilesRecursive(appDir);
    let totalSize = 0;
    let latestModified = 0;

    for (const file of files) {
      const fullPath = join(appDir, file);
      const stat = statSync(fullPath);
      totalSize += stat.size;
      const mtime = stat.mtimeMs;
      if (mtime > latestModified) latestModified = mtime;
    }

    return {
      exists: true,
      lastModified: Math.floor(latestModified),
      files,
      sizeBytes: totalSize,
    };
  }

  readFile(teamId: string, filePath: string): FileResult {
    const appDir = this.getAppDir(teamId);

    // Security: resolve to absolute and ensure it's within appDir
    const resolved = resolve(appDir, filePath);
    if (!resolved.startsWith(resolve(appDir))) {
      throw new ForbiddenException('Path traversal is not allowed');
    }

    if (!existsSync(resolved)) {
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const stat = statSync(resolved);
    if (stat.isDirectory()) {
      // Try index.html inside directory
      const indexPath = join(resolved, 'index.html');
      if (existsSync(indexPath)) {
        return {
          content: readFileSync(indexPath),
          mimeType: 'text/html',
        };
      }
      throw new NotFoundException(`File not found: ${filePath}`);
    }

    const ext = extname(resolved).toLowerCase();
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream';

    return {
      content: readFileSync(resolved),
      mimeType,
    };
  }

  private listFilesRecursive(dir: string, prefix = ''): string[] {
    if (!existsSync(dir)) return [];

    const files: string[] = [];
    const entries = readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        files.push(...this.listFilesRecursive(join(dir, entry.name), relativePath));
      } else {
        files.push(relativePath);
      }
    }

    return files;
  }
}
