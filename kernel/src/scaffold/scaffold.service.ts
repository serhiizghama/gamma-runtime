import {
  Injectable,
  ForbiddenException,
  Logger,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as path from 'path';
import * as fs from 'fs/promises';
import simpleGit, { SimpleGit } from 'simple-git';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionsService } from '../sessions/sessions.service';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Convert kebab-case / snake_case id to PascalCase */
function pascal(id: string): string {
  return id
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

/** Flatten an object into key-value string pairs for Redis XADD */
function flattenEntry(obj: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    args.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return args;
}

// ── Security deny patterns (spec §9.3) ──────────────────────────────────

interface DenyPattern {
  pattern: RegExp;
  reason: string;
}

const SECURITY_DENY_PATTERNS: DenyPattern[] = [
  {
    pattern: /\beval\s*\(/,
    reason: 'eval() is forbidden — arbitrary code execution risk',
  },
  {
    pattern: /\.innerHTML\s*=/,
    reason: 'innerHTML assignment — XSS risk; use React JSX instead',
  },
  {
    pattern: /\.outerHTML\s*=/,
    reason: 'outerHTML assignment — XSS risk',
  },
  {
    pattern: /document\.write\s*\(/,
    reason: 'document.write() — XSS risk',
  },
  {
    pattern: /localStorage\s*\./,
    reason:
      'Direct localStorage access forbidden in generated apps — use OS store',
  },
  {
    pattern: /sessionStorage\s*\./,
    reason: 'Direct sessionStorage access forbidden in generated apps',
  },
  {
    pattern: /require\s*\(\s*['"`]child_process/,
    reason: 'child_process require — server-side escape attempt',
  },
  {
    pattern: /process\.env\b/,
    reason: 'process.env access forbidden in generated client apps',
  },
  {
    pattern: /fetch\s*\(\s*['"`]https?:\/\/(?!localhost|127\.0\.0\.1)/,
    reason: 'External fetch calls require explicit allowlisting',
  },
];

// ── Interfaces ───────────────────────────────────────────────────────────

export interface ScaffoldAsset {
  path: string;
  content: string;
  encoding: 'base64' | 'utf8';
}

export interface ScaffoldRequest {
  appId: string;
  displayName: string;
  sourceCode: string;
  commit?: boolean;
  strictCheck?: boolean;
  files?: ScaffoldAsset[];
  contextDoc?: string;
  agentPrompt?: string;
}

export interface ScaffoldResult {
  ok: boolean;
  error?: string;
  filePath?: string;
  commitHash?: string;
  modulePath?: string;
}

/**
 * Scaffold Service — Path Jail, Security Scanner, Smart Commit (spec §9.2–§9.6).
 *
 * Provides:
 * - jailPath(): prevents path traversal outside web/apps/generated/
 * - validateSource(): security scan + syntax validation for generated code
 * - scaffold(): full pipeline — validate → write → git commit → Redis → SSE
 * - remove(): delete app → git commit → Redis → SSE
 */
@Injectable()
export class ScaffoldService {
  private readonly logger = new Logger(ScaffoldService.name);
  private readonly JAIL_ROOT: string;
  private readonly branch: string;
  private readonly autoPush: boolean;
  private readonly privateRepoUrl: string | null;
  private readonly gitAuthorName: string;
  private readonly gitAuthorEmail: string;
  private gitReady = false;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly sessionsService: SessionsService,
  ) {
    const repoRoot = this.config.get<string>(
      'GAMMA_OS_REPO',
      path.resolve(__dirname, '../../..'),
    );
    this.JAIL_ROOT = path.resolve(repoRoot, 'web/apps/generated');
    this.branch = this.config.get<string>(
      'SCAFFOLD_GIT_BRANCH',
      'private-apps',
    );
    this.autoPush =
      this.config.get<string>('SCAFFOLD_AUTO_PUSH', 'false') === 'true';
    this.privateRepoUrl =
      this.config.get<string>('SCAFFOLD_PRIVATE_REPO_URL', '') || null;
    this.gitAuthorName = this.config.get<string>(
      'GIT_AUTHOR_NAME',
      'gamma-os',
    );
    this.gitAuthorEmail = this.config.get<string>(
      'GIT_AUTHOR_EMAIL',
      'gamma@localhost',
    );
  }

  // ── Path Jail Guard (spec §9.5) ────────────────────────────────────────

  /**
   * Resolves a relative path and verifies it stays within JAIL_ROOT.
   * Throws ForbiddenException if path traversal is attempted.
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

  // ── Security Scanner (spec §9.3) ───────────────────────────────────────

  validateSource(
    source: string,
    fileName = 'generated.tsx',
  ): { ok: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const { pattern, reason } of SECURITY_DENY_PATTERNS) {
      if (pattern.test(source)) {
        errors.push(`Security violation in ${fileName}: ${reason}`);
      }
    }

    if (errors.length > 0) {
      return { ok: false, errors };
    }

    if (!source.includes('export')) {
      errors.push(`${fileName}: must contain at least one export`);
    }

    if (!source.includes('React') && !source.includes('react')) {
      errors.push(
        `${fileName}: must import React or reference react for JSX`,
      );
    }

    return { ok: errors.length === 0, errors };
  }

  // ── Nested Git (spec §9.2 v1.5) ───────────────────────────────────────

  /**
   * Ensures the nested Git repo exists inside web/apps/generated/.
   * Called lazily on first scaffold/remove operation.
   * The main .gitignore excludes web/apps/generated/.
   */
  private async ensureNestedGit(): Promise<SimpleGit> {
    const git = simpleGit(this.JAIL_ROOT);

    if (!this.gitReady) {
      await fs.mkdir(this.JAIL_ROOT, { recursive: true });

      const isRepo = await git.checkIsRepo().catch(() => false);

      if (!isRepo) {
        this.logger.log('Initializing nested Git repo in web/apps/generated/');
        await git.init();
        await git.addConfig('user.name', this.gitAuthorName);
        await git.addConfig('user.email', this.gitAuthorEmail);

        await git.checkoutLocalBranch(this.branch);
        await fs.writeFile(
          path.join(this.JAIL_ROOT, '.gitkeep'),
          '# AI-generated apps directory\n',
        );
        await git.add('.');
        await git.commit('init: generated apps workspace');

        if (this.privateRepoUrl) {
          await git.addRemote('origin', this.privateRepoUrl);
        }
      } else {
        const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
        if (currentBranch.trim() !== this.branch) {
          try {
            await git.checkout(this.branch);
          } catch {
            await git.checkoutLocalBranch(this.branch);
          }
        }
      }

      this.gitReady = true;
    }

    return git;
  }

  // ── Main Scaffold Flow (spec §9.2) ────────────────────────────────────

  async scaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
    const safeId = req.appId.replace(/[^a-z0-9-]/gi, '');
    const pascalName = pascal(safeId);
    const fileName = `${pascalName}App.tsx`;

    // Security scan + structural validation
    const validation = this.validateSource(req.sourceCode, fileName);
    if (!validation.ok) {
      return {
        ok: false,
        error: `Validation failed:\n${validation.errors.join('\n')}`,
      };
    }

    // Bundle directory: web/apps/generated/{safeId}/
    const bundleDir = this.jailPath(safeId);
    await fs.mkdir(bundleDir, { recursive: true });

    // Write source file into bundle
    const filePath = this.jailPath(`${safeId}/${fileName}`);
    await fs.writeFile(filePath, req.sourceCode, 'utf8');

    // PATCH/Merge semantics: only write contextDoc/agentPrompt if provided
    if (req.contextDoc !== undefined) {
      const contextPath = this.jailPath(`${safeId}/context.md`);
      await fs.writeFile(contextPath, req.contextDoc, 'utf8');
    }

    if (req.agentPrompt !== undefined) {
      const agentPath = this.jailPath(`${safeId}/agent-prompt.md`);
      await fs.writeFile(agentPath, req.agentPrompt, 'utf8');
    }

    // Write assets into bundle (v1.3)
    if (req.files?.length) {
      for (const asset of req.files) {
        const assetPath = this.jailPath(
          `${safeId}/assets/${safeId}/${path.basename(asset.path)}`,
        );
        await fs.mkdir(path.dirname(assetPath), { recursive: true });
        const buffer =
          asset.encoding === 'base64'
            ? Buffer.from(asset.content, 'base64')
            : Buffer.from(asset.content, 'utf8');
        await fs.writeFile(assetPath, buffer);
      }
    }

    // Git commit in the NESTED repo (v1.5)
    let commitHash: string | undefined;
    if (req.commit) {
      const git = await this.ensureNestedGit();
      await git.add('.');
      const result = await git.commit(
        `feat: generated ${req.displayName} app`,
        {
          '--author': `${this.gitAuthorName} <${this.gitAuthorEmail}>`,
        },
      );
      commitHash = result.commit || undefined;

      if (this.autoPush && this.privateRepoUrl) {
        try {
          await git.push('origin', this.branch);
        } catch (err) {
          this.logger.warn(`Auto-push failed (best-effort): ${err}`);
        }
      }
    }

    // Determine hasAgent: true if agent-prompt.md exists on disk (written now or previously)
    const agentPromptPath = this.jailPath(`${safeId}/agent-prompt.md`);
    let hasAgent = false;
    try {
      await fs.access(agentPromptPath);
      hasAgent = true;
    } catch {
      /* file doesn't exist */
    }

    // Register in app registry with bundle fields
    const modulePath = `./web/apps/generated/${safeId}/${pascalName}App`;
    const bundlePath = `./web/apps/generated/${safeId}/`;
    const now = Date.now();

    // Preserve createdAt from existing entry if present
    let createdAt = now;
    try {
      const existing = await this.redis.hget('gamma:app:registry', safeId);
      if (existing) {
        const parsed = JSON.parse(existing);
        if (parsed.createdAt) createdAt = parsed.createdAt;
      }
    } catch {
      /* use now */
    }

    await this.redis.hset(
      'gamma:app:registry',
      safeId,
      JSON.stringify({
        appId: safeId,
        displayName: req.displayName,
        modulePath,
        createdAt,
        bundlePath,
        hasAgent,
        updatedAt: now,
      }),
    );

    // Broadcast component_ready via SSE
    await this.redis.xadd(
      'gamma:sse:broadcast',
      '*',
      ...flattenEntry({ type: 'component_ready', appId: safeId, modulePath }),
    );

    this.logger.log(`Scaffolded app '${safeId}' → ${modulePath}`);
    return { ok: true, filePath, commitHash, modulePath };
  }

  // ── App Deletion (spec §9.6 v1.4) ─────────────────────────────────────

  async remove(appId: string): Promise<{ ok: boolean }> {
    const safeId = appId.replace(/[^a-z0-9-]/gi, '');

    // Remove entire bundle directory
    const bundleDir = this.jailPath(safeId);
    try {
      await fs.rm(bundleDir, { recursive: true, force: true });
    } catch {
      /* already gone */
    }

    // Clean up user-persisted app data from Redis
    const dataKeys = await this.redis.keys(`gamma:app-data:${safeId}:*`);
    if (dataKeys.length > 0) {
      await this.redis.del(...dataKeys);
      this.logger.log(`Deleted ${dataKeys.length} app-data keys for '${safeId}'`);
    }

    // Kill App Owner Gateway session (best-effort)
    try {
      await this.sessionsService.remove(`app-owner-${safeId}`);
    } catch {
      /* session may not exist — that's fine */
    }

    // Git: stage removal and commit in the NESTED repo (v1.5)
    const git = await this.ensureNestedGit();
    await git.add('.');
    const hasChanges = (await git.status()).files.length > 0;
    if (hasChanges) {
      await git.commit(`chore: remove generated ${safeId} app`, {
        '--author': `${this.gitAuthorName} <${this.gitAuthorEmail}>`,
      });

      if (this.autoPush && this.privateRepoUrl) {
        try {
          await git.push('origin', this.branch);
        } catch (err) {
          this.logger.warn(`Auto-push failed (best-effort): ${err}`);
        }
      }
    }

    // Remove from app registry
    await this.redis.hdel('gamma:app:registry', safeId);

    // Broadcast removal
    await this.redis.xadd(
      'gamma:sse:broadcast',
      '*',
      ...flattenEntry({ type: 'component_removed', appId: safeId }),
    );

    this.logger.log(`Removed app '${safeId}'`);
    return { ok: true };
  }

  /** Expose jail root for other services (e.g. asset serving) */
  getJailRoot(): string {
    return this.JAIL_ROOT;
  }
}
