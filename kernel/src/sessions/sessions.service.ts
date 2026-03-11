import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ulid } from 'ulid';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { GatewayWsService } from '../gateway/gateway-ws.service';
import type { WindowSession, CreateSessionDto } from './sessions.interfaces';
import { ToolWatchdogService } from '../gateway/tool-watchdog.service';
import type { AgentStatus, WindowStateSyncSnapshot } from '@gamma/types';
import { ScaffoldService } from '../scaffold/scaffold.service';

const SESSIONS_KEY = 'gamma:sessions';
const APP_OWNER_PREFIX = 'app-owner-';
const APP_OWNER_INIT_FIELD = 'appOwnerInitialized';

/** Convert kebab-case / snake_case id to PascalCase (matches scaffold.service) */
function pascal(id: string): string {
  return id
    .replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (_, c: string) => c.toUpperCase());
}

/** Flatten an object to [key, value, key, value, ...] for XADD */
function flattenEntry(obj: Record<string, unknown>): string[] {
  const args: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    args.push(k, typeof v === 'string' ? v : JSON.stringify(v));
  }
  return args;
}

export interface SendMessageResult {
  ok: boolean;
  error?: {
    code: string;
    message: string;
    detail?: string;
  };
}

@Injectable()
export class SessionsService {
  private readonly logger = new Logger(SessionsService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly gatewayWs: GatewayWsService,
    private readonly toolWatchdog: ToolWatchdogService,
    @Inject(forwardRef(() => ScaffoldService))
    private readonly scaffoldService: ScaffoldService,
  ) {}

  /** Create a new window↔session mapping */
  async create(dto: CreateSessionDto): Promise<WindowSession> {
    const session: WindowSession = {
      windowId: dto.windowId,
      appId: dto.appId,
      sessionKey: dto.sessionKey,
      agentId: dto.agentId,
      createdAt: Date.now(),
      status: 'idle',
    };

    await this.redis.hset(SESSIONS_KEY, dto.windowId, JSON.stringify(session));

    // Keep Gateway's in-memory mapping in sync so events can be routed
    this.gatewayWs.registerWindowSession(dto.sessionKey, dto.windowId);

    // Initialize App Owner sessions with a dedicated system prompt + source context.
    if (dto.sessionKey?.startsWith(APP_OWNER_PREFIX)) {
      this.initializeAppOwnerSession(dto.sessionKey, dto.windowId, dto.appId).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to initialize App Owner session ${dto.sessionKey}: ${msg}`,
          );
        },
      );
    }

    return session;
  }

  /** List all active sessions */
  async findAll(): Promise<WindowSession[]> {
    const raw = await this.redis.hgetall(SESSIONS_KEY);
    return Object.values(raw).map(
      (json) => JSON.parse(json) as WindowSession,
    );
  }

  /** Get a session by windowId */
  async findByWindowId(windowId: string): Promise<WindowSession | null> {
    const raw = await this.redis.hget(SESSIONS_KEY, windowId);
    if (!raw) return null;
    return JSON.parse(raw) as WindowSession;
  }

  /** Find a session by OpenClaw sessionKey */
  async findBySessionKey(
    sessionKey: string,
  ): Promise<WindowSession | null> {
    const all = await this.findAll();
    return all.find((s) => s.sessionKey === sessionKey) ?? null;
  }

  /** Update session status in Redis */
  async updateStatus(
    windowId: string,
    status: WindowSession['status'],
  ): Promise<void> {
    const session = await this.findByWindowId(windowId);
    if (!session) return;
    session.status = status;
    await this.redis.hset(
      SESSIONS_KEY,
      windowId,
      JSON.stringify(session),
    );
  }

  /** Abort a running agent session (spec §4.2) */
  async abort(windowId: string): Promise<boolean> {
    const session = await this.findByWindowId(windowId);
    if (!session) return false;

    // Send abort to Gateway
    await this.gatewayWs.abortRun(session.sessionKey);

    // Immediately update Redis state — don't wait for Gateway confirmation
    await this.redis.hset(
      `gamma:state:${windowId}`,
      'status', 'aborted',
      'runId', '',
    );

    // Push aborted lifecycle event to SSE stream
    await this.redis.xadd(
      `gamma:sse:${windowId}`, '*',
      'type', 'lifecycle_error',
      'windowId', windowId,
      'runId', '',
      'message', 'Run aborted by user',
    );

    // Clear watchdog timers for this window
    this.toolWatchdog.clearWindow(windowId);

    return true;
  }

  /** Get F5 recovery snapshot from gamma:state:<windowId> (spec §4.1) */
  async getSyncSnapshot(windowId: string): Promise<WindowStateSyncSnapshot | null> {
    const session = await this.findByWindowId(windowId);
    if (!session) return null;

    const raw = await this.redis.hgetall(`gamma:state:${windowId}`);

    return {
      windowId,
      sessionKey: session.sessionKey,
      status: (raw.status as AgentStatus) ?? 'idle',
      runId: raw.runId || null,
      streamText: raw.streamText || null,
      thinkingTrace: raw.thinkingTrace || null,
      pendingToolLines: raw.pendingToolLines ? (JSON.parse(raw.pendingToolLines) as string[]) : [],
      lastEventAt: raw.lastEventAt ? Number(raw.lastEventAt) : null,
      lastEventId: raw.lastEventId || null,
    };
  }

  // ── v1.6: Send user message to agent ──────────────────────────────────

  async sendMessage(
    windowId: string,
    message: string,
  ): Promise<SendMessageResult | null> {
    const session = await this.findByWindowId(windowId);
    if (!session) return null;

    const nowMs = Date.now();

    // 1. Echo user message into SSE for instant UI feedback
    await this.redis.xadd(
      `gamma:sse:${windowId}`, '*',
      ...flattenEntry({
        type: 'user_message',
        windowId,
        text: message,
        ts: nowMs,
      }),
    );

    // 2. Write to memory bus for decision tree reconstruction
    await this.redis.xadd(
      'gamma:memory:bus', '*',
      ...flattenEntry({
        id: ulid(),
        sessionKey: session.sessionKey,
        windowId,
        kind: 'text',
        content: message,
        ts: nowMs,
      }),
    );

    // 3. Forward to OpenClaw Gateway (fire-and-forget dispatch)
    try {
      const { accepted } = this.gatewayWs.sendMessage(
        session.sessionKey,
        message,
        windowId,
      );

      if (!accepted) {
        const errorMessage = '[OpenClaw] Gateway unreachable';
        await this.redis.xadd(
          `gamma:sse:${windowId}`,
          '*',
          ...flattenEntry({
            type: 'lifecycle_error',
            windowId,
            runId: '',
            message: 'Gateway not connected — message not sent',
          }),
        );
        this.logger.error(errorMessage);
        return {
          ok: false,
          error: {
            code: 'GATEWAY_DISCONNECTED',
            message: errorMessage,
          },
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMessage = '[OpenClaw] Gateway unreachable';
      this.logger.error(`${errorMessage}: ${msg}`);
      await this.redis.xadd(
        `gamma:sse:${windowId}`,
        '*',
        ...flattenEntry({
          type: 'lifecycle_error',
          windowId,
          runId: '',
          message: errorMessage,
        }),
      );
      return {
        ok: false,
        error: {
          code: 'GATEWAY_SEND_FAILED',
          message: errorMessage,
          detail: msg,
        },
      };
    }

    // 5. Update lastEventAt for GC freshness tracking
    await this.redis.hset(
      `gamma:state:${windowId}`,
      'lastEventAt',
      String(nowMs),
    );

    return { ok: true };
  }

  /**
   * Initialize an App Owner Gateway session with a dedicated system prompt that
   * injects the app's source code and context. This runs once per session
   * lifecycle (guarded by a Redis flag on gamma:state:{windowId}).
   */
  private async initializeAppOwnerSession(
    sessionKey: string,
    windowId: string,
    appIdFromDto?: string | null,
  ): Promise<void> {
    if (!sessionKey || typeof sessionKey !== 'string') {
      this.logger.warn(
        'initializeAppOwnerSession: sessionKey is empty or invalid',
      );
      return;
    }

    if (!sessionKey.startsWith(APP_OWNER_PREFIX)) {
      return;
    }

    // Guard: only run once per window/session lifecycle
    const stateKey = `gamma:state:${windowId}`;
    const alreadyInit = await this.redis.hget(stateKey, APP_OWNER_INIT_FIELD);
    if (alreadyInit === '1') {
      return;
    }

    const rawAppId =
      appIdFromDto && typeof appIdFromDto === 'string'
        ? appIdFromDto
        : sessionKey.slice(APP_OWNER_PREFIX.length);
    const appId = rawAppId.replace(/[^a-z0-9-]/gi, '');

    // Diagnostic: what app session did we actually intercept?
    console.log('[Backend] Intercepted App Session:', appId);

    if (
      !appId ||
      appId === 'undefined' ||
      rawAppId.toLowerCase() === 'undefined'
    ) {
      this.logger.warn(
        `initializeAppOwnerSession: invalid appId for sessionKey=${sessionKey}: ${JSON.stringify(
          rawAppId,
        )}`,
      );
      return;
    }

    const contextBlock = await this.buildAppOwnerContextBlock(appId);
    if (!contextBlock) {
      this.logger.warn(
        `initializeAppOwnerSession: no context available for appId=${appId}`,
      );
      // Still mark as initialized to avoid hammering filesystem on every create
      await this.redis.hset(stateKey, APP_OWNER_INIT_FIELD, '1');
      return;
    }

    const systemPromptLines = [
      `You are the Dedicated Local Agent for the '${appId}' application.`,
      'Here is your current source code and context:',
      '',
      contextBlock,
      '',
      'Your goal is to help the user modify and understand this specific application.',
    ];

    const systemPrompt = systemPromptLines.join('\n');

    // Explicitly create/initialize the OpenClaw session with a systemPrompt
    const created = await this.gatewayWs.createSession(sessionKey, systemPrompt);
    if (!created) {
      this.logger.warn(
        `initializeAppOwnerSession: Gateway sessions.create failed for appId=${appId}, sessionKey=${sessionKey}`,
      );
      // Do not mark as initialized so we can try again on a future attempt
      return;
    }

    await this.redis.hset(stateKey, APP_OWNER_INIT_FIELD, '1');
  }

  /**
   * Build the shared App Owner context block combining persona, context.md and
   * main .tsx source, searching both generated and system app directories.
   */
  private async buildAppOwnerContextBlock(appId: string): Promise<string | null> {
    const parts: string[] = [];
    const pascalName = pascal(appId);
    const tsxFileName = `${pascalName}App.tsx`;

    // Resolve candidate bundle locations for this appId.
    // 1) Generated apps: web/apps/generated/{appId}/ (via ScaffoldService jail)
    // 2) Built-in system apps: web/apps/system/{appId}/ (direct filesystem read)
    const repoRoot = path.resolve(__dirname, '../../..');
    const systemBundleDir = path.resolve(
      repoRoot,
      'web/apps/system',
      appId,
    );

    try {
      // agent-prompt.md (optional — generated apps only; skip if missing)
      try {
        const agentPath = this.scaffoldService.jailPath(
          `${appId}/agent-prompt.md`,
        );
        const content = await fs.readFile(agentPath, 'utf8');
        parts.push('--- AGENT PERSONA ---', content.trim(), '');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(
          `App Owner agent-prompt.md for ${appId}: ${msg} — using default persona`,
        );
        parts.push(
          '--- AGENT PERSONA ---',
          'You are the Dedicated Maintainer of this application. Your role is to understand, improve, and extend it based on user requests. Apply changes via the update_app tool.',
          '',
        );
      }

      // context.md (first match wins: generated → system)
      try {
        const contextCandidates = [
          this.scaffoldService.jailPath(`${appId}/context.md`),
          path.join(systemBundleDir, 'context.md'),
        ];
        console.log(
          '[Backend] Checking paths:',
          contextCandidates[0],
          contextCandidates[1],
        );

        let contextContent: string | null = null;

        for (const candidate of contextCandidates) {
          try {
            const content = await fs.readFile(candidate, 'utf8');
            contextContent = content;
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(
              '[Backend] Failed to read context candidate',
              candidate,
              'error:',
              msg,
            );
          }
        }

        console.log('[Backend] Context found?:', !!contextContent);

        if (contextContent) {
          parts.push('--- APP CONTEXT ---', contextContent.trim(), '');
        } else {
          this.logger.debug(
            `App Owner context.md not found for ${appId} in generated or system bundles`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.debug(
          `App Owner context lookup failed for ${appId}: ${msg}`,
        );
      }

      // Main .tsx source (first match wins: generated → system)
      try {
        const sourceCandidates = [
          this.scaffoldService.jailPath(`${appId}/${tsxFileName}`),
          path.join(systemBundleDir, tsxFileName),
        ];
        let sourceCode: string | null = null;

        for (const candidate of sourceCandidates) {
          try {
            sourceCode = await fs.readFile(candidate, 'utf8');
            break;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.log(
              '[Backend] Failed to read source candidate',
              candidate,
              'error:',
              msg,
            );
          }
        }

        if (sourceCode) {
          parts.push(
            '--- CURRENT SOURCE CODE ---',
            '```tsx',
            sourceCode.trim(),
            '```',
            '',
          );
        } else {
          this.logger.warn(
            `App Owner source ${tsxFileName} for ${appId} not found in generated or system bundles — skipping source injection`,
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(
          `App Owner source lookup failed for ${appId}: ${msg}`,
        );
      }

      if (parts.length === 0) {
        return null;
      }

      return parts.join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `buildAppOwnerContextBlock failed for ${appId}: ${msg}`,
      );
      return null;
    }
  }

  /** Remove a session mapping (v1.6: explicit Gateway kill) */
  async remove(windowId: string): Promise<boolean> {
    const existing = await this.findByWindowId(windowId);
    if (!existing) return false;

    // 1. Kill the Gateway session to free LLM context memory
    try {
      await this.gatewayWs.deleteSession(existing.sessionKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to kill Gateway session ${existing.sessionKey}: ${msg}`);
    }

    // 2. Clean up Redis
    await this.redis.hdel(SESSIONS_KEY, windowId);
    await this.redis.del(`gamma:sse:${windowId}`);
    await this.redis.del(`gamma:state:${windowId}`);

    // 3. Clear watchdog timers
    this.toolWatchdog.clearWindow(windowId);

    // 4. Unregister from in-memory routing
    this.gatewayWs.unregisterWindowSession(existing.sessionKey);

    this.logger.log(`Removed session ${windowId} (sessionKey=${existing.sessionKey})`);
    return true;
  }
}
