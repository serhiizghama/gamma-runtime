import { Injectable, Logger, Inject, BadRequestException, Optional } from '@nestjs/common';
import * as path from 'path';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SessionsService } from '../sessions/sessions.service';
import { AppStorageService } from './app-storage.service';
import { GitWorkspaceService } from './git-workspace.service';
import { ValidationService } from './validation.service';
import type { ScaffoldRequest, ScaffoldResult } from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';
import { flattenEntry, pascal } from '../redis/redis-stream.util';

// Re-export shared types so existing imports from this file keep working
export type { ScaffoldAsset, ScaffoldRequest, ScaffoldResult } from '@gamma/types';

// ── Kernel-internal interfaces ────────────────────────────────────────────

export interface JailedFileSaveParams {
  appId: string;
  /** Path inside the app bundle directory (e.g. "MyApp.tsx", "context.md", "agent-prompt.md") */
  relativePath: string;
  content: string;
  encoding?: 'utf8' | 'base64';
}

export interface JailedFileSaveResult {
  ok: boolean;
  filePath?: string;
  updatedAt?: number;
  error?: string;
}

/**
 * Scaffold Service — Orchestrator / Facade (spec §9.2–§9.6).
 *
 * Coordinates the scaffold lifecycle by delegating to domain services:
 * - AppStorageService: all file system I/O within the jail
 * - GitWorkspaceService: all version-control operations
 * - ValidationService: security scanning and structural validation
 *
 * Responsibilities retained here:
 * - App registry management (Redis hash)
 * - SSE lifecycle event broadcasting
 * - Session cleanup during removal
 */
@Injectable()
export class ScaffoldService {
  private readonly logger = new Logger(ScaffoldService.name);

  constructor(
    private readonly storage: AppStorageService,
    private readonly gitWorkspace: GitWorkspaceService,
    private readonly validation: ValidationService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    // @Optional to break circular: ScaffoldModule ↔ SessionsModule.
    // SessionsService.remove() is only called during app unscaffold (best-effort).
    @Optional() private readonly sessionsService: SessionsService,
  ) {}

  // ── Delegated accessors (backward compat for SessionsService) ─────────

  jailPath(relativePath: string): string {
    return this.storage.jailPath(relativePath);
  }

  getJailRoot(): string {
    return this.storage.getJailRoot();
  }

  validateSource(
    source: string,
    fileName?: string,
  ): { ok: boolean; errors: string[] } {
    return this.validation.validateSource(source, fileName);
  }

  // ── Main Scaffold Flow (spec §9.2) ────────────────────────────────────

  async scaffold(req: ScaffoldRequest): Promise<ScaffoldResult> {
    const safeId = req.appId.replace(/[^a-z0-9-]/gi, '');
    if (!safeId) {
      throw new BadRequestException('Invalid appId');
    }
    const pascalName = pascal(safeId);
    // Avoid double "App" suffix: smoke-test-app → SmokeTestApp (already ends in App)
    const componentName = pascalName.endsWith('App') ? pascalName : `${pascalName}App`;
    const fileName = `${componentName}.tsx`;

    // Security scan + structural validation
    const result = this.validation.validateSource(req.sourceCode, fileName);
    if (!result.ok) {
      return {
        ok: false,
        error: `Validation failed:\n${result.errors.join('\n')}`,
      };
    }

    // Write source file into bundle directory
    const bundleDir = this.storage.jailPath(safeId);
    await this.storage.ensureDir(bundleDir);

    const filePath = this.storage.jailPath(`${safeId}/${fileName}`);
    await this.storage.writeFile(filePath, req.sourceCode);

    // PATCH/Merge semantics: only write contextDoc/agentPrompt if provided
    if (req.contextDoc !== undefined) {
      await this.storage.writeFile(
        this.storage.jailPath(`${safeId}/context.md`),
        req.contextDoc,
      );
    }

    if (req.agentPrompt !== undefined) {
      await this.storage.writeFile(
        this.storage.jailPath(`${safeId}/agent-prompt.md`),
        req.agentPrompt,
      );
    }

    // Write assets into bundle (v1.3)
    if (req.files?.length) {
      for (const asset of req.files) {
        const assetPath = this.storage.jailPath(
          `${safeId}/assets/${safeId}/${path.basename(asset.path)}`,
        );
        await this.storage.ensureDir(path.dirname(assetPath));
        const buffer =
          asset.encoding === 'base64'
            ? Buffer.from(asset.content, 'base64')
            : Buffer.from(asset.content, 'utf8');
        await this.storage.writeFile(assetPath, buffer);
      }
    }

    // Git commit in the nested repo (v1.5)
    let commitHash: string | undefined;
    if (req.commit) {
      commitHash = await this.gitWorkspace.commitChanges(
        `feat: generated ${req.displayName} app`,
      );
    }

    // Determine hasAgent: true if agent-prompt.md exists on disk
    const agentPromptPath = this.storage.jailPath(`${safeId}/agent-prompt.md`);
    const hasAgent = await this.storage.fileExists(agentPromptPath);

    // Register in app registry — preserve createdAt from existing entry
    const modulePath = `./apps/gamma-ui/apps/private/${safeId}/${componentName}`;
    const bundlePath = `./apps/gamma-ui/apps/private/${safeId}/`;
    const now = Date.now();

    let createdAt = now;
    try {
      const existing = await this.redis.hget(REDIS_KEYS.APP_REGISTRY, safeId);
      if (existing) {
        const parsed = JSON.parse(existing) as { createdAt?: number };
        if (parsed.createdAt) createdAt = parsed.createdAt;
      }
    } catch {
      /* use now */
    }

    await this.redis.hset(
      REDIS_KEYS.APP_REGISTRY,
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

    // Broadcast component_ready via SSE (include updatedAt for frontend hot-reload)
    await this.redis.xadd(
      REDIS_KEYS.SSE_BROADCAST,
      '*',
      ...flattenEntry({
        type: 'component_ready',
        appId: safeId,
        modulePath,
        updatedAt: now,
      }),
    );

    this.logger.log(`Scaffolded app '${safeId}' → ${modulePath}`);
    return { ok: true, filePath, commitHash, modulePath };
  }

  /**
   * Jailed, app-local file save for AI agents (File System tool).
   *
   * - Writes directly under apps/gamma-ui/apps/private/{appId}/ via jailPath()
   * - Never touches the root git repo or executes git push
   * - Refreshes the app's registry updatedAt and broadcasts component_ready
   */
  async saveAppFileFromAgent(
    params: JailedFileSaveParams,
  ): Promise<JailedFileSaveResult> {
    const safeId = params.appId.replace(/[^a-z0-9-]/gi, '');
    if (!safeId) {
      return { ok: false, error: 'Invalid appId' };
    }

    try {
      const targetPath = this.storage.jailPath(
        `${safeId}/${params.relativePath}`,
      );
      await this.storage.ensureDir(path.dirname(targetPath));

      const buffer =
        params.encoding === 'base64'
          ? Buffer.from(params.content, 'base64')
          : Buffer.from(params.content, 'utf8');

      await this.storage.writeFile(targetPath, buffer);

      const now = Date.now();

      // Refresh app registry entry without mutating other fields
      let entry: import('@gamma/types').AppRegistryEntry | null = null;
      try {
        const raw = await this.redis.hget(REDIS_KEYS.APP_REGISTRY, safeId);
        if (raw) {
          entry = JSON.parse(raw) as import('@gamma/types').AppRegistryEntry;
        }
      } catch {
        entry = null;
      }

      const pascalName = pascal(safeId);
      const componentName = pascalName.endsWith('App') ? pascalName : `${pascalName}App`;
      const modulePath =
        entry?.modulePath ??
        `./apps/gamma-ui/apps/private/${safeId}/${componentName}`;
      const bundlePath =
        entry?.bundlePath ?? `./apps/gamma-ui/apps/private/${safeId}/`;

      const registryEntry: import('@gamma/types').AppRegistryEntry = {
        appId: safeId,
        displayName: entry?.displayName ?? pascalName,
        modulePath,
        bundlePath,
        createdAt: entry?.createdAt ?? now,
        updatedAt: now,
        hasAgent: entry?.hasAgent ?? false,
      };

      await this.redis.hset(
        REDIS_KEYS.APP_REGISTRY,
        safeId,
        JSON.stringify(registryEntry),
      );

      await this.redis.xadd(
        REDIS_KEYS.SSE_BROADCAST,
        '*',
        ...flattenEntry({
          type: 'component_ready',
          appId: safeId,
          modulePath,
          updatedAt: now,
        }),
      );

      this.logger.log(
        `Agent saved file for app '${safeId}' → ${params.relativePath}`,
      );

      return { ok: true, filePath: targetPath, updatedAt: now };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Failed to save jailed file for app '${params.appId}': ${msg}`,
      );
      return { ok: false, error: msg };
    }
  }

  /** Return full app registry from Redis for frontend */
  async getRegistry(): Promise<
    Record<string, import('@gamma/types').AppRegistryEntry>
  > {
    const raw = await this.redis.hgetall(REDIS_KEYS.APP_REGISTRY);
    const registry: Record<
      string,
      import('@gamma/types').AppRegistryEntry
    > = {};
    for (const [id, json] of Object.entries(raw)) {
      try {
        registry[id] = JSON.parse(
          json,
        ) as import('@gamma/types').AppRegistryEntry;
      } catch {
        /* skip malformed entries */
      }
    }
    return registry;
  }

  // ── App Deletion (spec §9.6 v1.4) ─────────────────────────────────────

  async remove(appId: string): Promise<{ ok: boolean }> {
    const safeId = appId.replace(/[^a-z0-9-]/gi, '');
    if (!safeId) {
      throw new BadRequestException('Invalid appId');
    }

    // Remove entire bundle directory
    await this.storage.removeDir(this.storage.jailPath(safeId));

    // Clean up user-persisted app data from Redis
    const dataKeys = await this.redis.keys(
      `${REDIS_KEYS.APP_DATA_PREFIX}${safeId}:*`,
    );
    if (dataKeys.length > 0) {
      await this.redis.del(...dataKeys);
      this.logger.log(
        `Deleted ${dataKeys.length} app-data keys for '${safeId}'`,
      );
    }

    // Kill App Owner Gateway session (best-effort)
    try {
      await this.sessionsService.remove(`app-owner-${safeId}`);
    } catch {
      /* session may not exist — that's fine */
    }

    // Git: stage removal and commit in the nested repo (v1.5)
    await this.gitWorkspace.stageAndCommitIfChanged(
      `chore: remove generated ${safeId} app`,
    );

    // Remove from app registry and broadcast removal
    await this.redis.hdel(REDIS_KEYS.APP_REGISTRY, safeId);
    await this.redis.xadd(
      REDIS_KEYS.SSE_BROADCAST,
      '*',
      ...flattenEntry({ type: 'component_removed', appId: safeId }),
    );

    this.logger.log(`Removed app '${safeId}'`);
    return { ok: true };
  }
}
