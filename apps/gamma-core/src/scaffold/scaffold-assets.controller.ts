import {
  Controller,
  Get,
  Param,
  Res,
  ForbiddenException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { findRepoRoot } from './app-storage.service';

// ── Minimal MIME map (no external deps) ──────────────────────────────────

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/**
 * Static Asset Controller — serves files from apps/gamma-ui/apps/private/assets/:appId/
 * with strict path-jail security (spec §9.4).
 */
@Controller('api/assets')
export class ScaffoldAssetsController {
  private readonly logger = new Logger(ScaffoldAssetsController.name);
  private readonly assetsRoot: string;

  constructor(private readonly config: ConfigService) {
    const repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      findRepoRoot(__dirname),
    );
    this.assetsRoot = path.resolve(repoRoot, 'apps/gamma-ui/apps/private/assets');
  }

  @Get(':appId/*')
  async serveAsset(
    @Param('appId') appId: string,
    @Param('0') assetPath: string,
    @Res() res: FastifyReply,
  ): Promise<void> {
    // Sanitize appId — alphanumeric + hyphens only
    const safeAppId = appId.replace(/[^a-z0-9-]/gi, '');

    // Normalize and block hidden files/traversal
    const safeRelPath = path.normalize(assetPath);
    if (safeRelPath.split(path.sep).some((seg) => seg.startsWith('.'))) {
      this.logger.warn(
        `Blocked hidden/traversal path: /api/assets/${appId}/${assetPath}`,
      );
      throw new ForbiddenException('Path traversal or hidden file access blocked');
    }

    const resolved = path.resolve(this.assetsRoot, safeAppId, safeRelPath);

    // Jail check — must stay within assetsRoot
    if (!resolved.startsWith(this.assetsRoot + path.sep)) {
      this.logger.warn(
        `Path traversal blocked: ${assetPath} resolved to ${resolved}`,
      );
      throw new ForbiddenException('Path traversal blocked');
    }

    // Check file exists
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new NotFoundException(`Asset not found: ${safeAppId}/${safeRelPath}`);
    }

    // Determine MIME type
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Stream the file
    const stream = fs.createReadStream(resolved);
    void res
      .type(contentType)
      .header('Cache-Control', 'public, max-age=3600')
      .send(stream);
  }
}
