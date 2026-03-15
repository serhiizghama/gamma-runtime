import { Injectable, Inject, Logger, forwardRef } from '@nestjs/common';
import Redis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ulid } from 'ulid';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { GatewayWsService } from '../gateway/gateway-ws.service';
import { ToolWatchdogService } from '../gateway/tool-watchdog.service';
import type {
  AgentStatus,
  MemoryBusEntry,
  WindowSession,
  CreateSessionDto,
  WindowStateSyncSnapshot,
} from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';
import { SessionRegistryService } from './session-registry.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { ScaffoldService } from '../scaffold/scaffold.service';
const APP_OWNER_PREFIX = 'app-owner-';
const APP_OWNER_INIT_FIELD = 'appOwnerInitialized';

/**
 * Explicit identity overrides for well-known global sessions that are not
 * created via the app-owner flow and therefore lack appId/windowId in the DTO.
 */
const GLOBAL_SESSION_IDENTITY: Record<string, { appId: string; windowId: string }> = {
  'system-architect': { appId: 'system-architect', windowId: 'system-architect-window' },
  'app-owner-inspector': { appId: 'app-owner-inspector', windowId: 'app-owner-inspector-window' },
};

/**
 * Parse appId from an app-owner session key.
 * "app-owner-notes" → "notes", "app-owner-" → null.
 * Any segment after a colon (e.g. "app-owner-notes:v2") is stripped.
 */
function parseAppIdFromKey(sessionKey: string): string | null {
  if (!sessionKey || !sessionKey.startsWith(APP_OWNER_PREFIX)) return null;
  const raw = sessionKey.slice(APP_OWNER_PREFIX.length).split(':')[0].trim();
  const appId = raw.replace(/[^a-z0-9-]/gi, '');
  return appId || null;
}

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
    private readonly registry: SessionRegistryService,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  /** Create a new window↔session mapping */
  async create(dto: CreateSessionDto): Promise<WindowSession> {
    // Robust appId resolution: DTO field is canonical, but fall back to parsing
    // from sessionKey so "app-owner-notes" always yields appId="notes" even if
    // the client omits or sends an empty appId.
    const globalIdentity = GLOBAL_SESSION_IDENTITY[dto.sessionKey];
    const appId = dto.appId || parseAppIdFromKey(dto.sessionKey) || globalIdentity?.appId || '';
    const windowId = dto.windowId || globalIdentity?.windowId || dto.windowId;

    const session: WindowSession = {
      windowId,
      appId,
      sessionKey: dto.sessionKey,
      agentId: dto.agentId,
      createdAt: Date.now(),
      status: 'idle',
    };

    await this.redis.hset(REDIS_KEYS.SESSIONS, windowId, JSON.stringify(session));

    // Register initial telemetry entry in the session registry
    await this.registry.upsert({
      sessionKey: dto.sessionKey,
      windowId,
      appId,
      status: 'idle',
      createdAt: session.createdAt,
      lastActiveAt: session.createdAt,
      runCount: 0,
      systemPromptSnippet: '',
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        contextUsedPct: 0,
      },
    });

    // Keep Gateway's in-memory mapping in sync so events can be routed
    this.gatewayWs.registerWindowSession(dto.sessionKey, windowId);

    // Register in the Agent Registry for discovery and IPC.
    // Use sessionKey as the canonical agentId — dto.agentId is a generic role
    // hint ("app-owner", "architect") and is NOT unique across agents.
    const agentId = dto.sessionKey;
    const role = this.resolveAgentRole(dto.sessionKey);
    await this.agentRegistry.register({
      agentId,
      role,
      sessionKey: dto.sessionKey,
      windowId,
      appId,
      status: 'idle',
      capabilities: [],
      lastHeartbeat: Date.now(),
      lastActivity: 'session created',
      acceptsMessages: true,
      createdAt: session.createdAt,
    });

    // Initialize App Owner sessions with a dedicated system prompt + source context.
    // Exclude the inspector daemon — it has its own init path via ensureAppInspectorSession().
    if (dto.sessionKey?.startsWith(APP_OWNER_PREFIX) && dto.sessionKey !== 'app-owner-inspector') {
      this.initializeAppOwnerSession(dto.sessionKey, windowId, appId).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `Failed to initialize App Owner session ${dto.sessionKey}: ${msg}`,
          );
        },
      );
    }

    // Route the global system-architect session to its dedicated OpenClaw agent.
    if (dto.sessionKey === 'system-architect') {
      this.initializeSystemArchitectSession(dto.sessionKey, windowId).catch(
        (err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`Failed to initialize system-architect Gateway session: ${msg}`);
        },
      );
    }

    // NOTE: app-inspector initialization is handled by ensureAppInspectorSession()
    // which awaits the Gateway session creation before returning. This avoids the
    // race condition where sendMessage is called before the session is ready.

    return session;
  }

  /** List all active sessions */
  async findAll(): Promise<WindowSession[]> {
    const raw = await this.redis.hgetall(REDIS_KEYS.SESSIONS);
    return Object.values(raw).map(
      (json) => JSON.parse(json) as WindowSession,
    );
  }

  /** Get a session by windowId */
  async findByWindowId(windowId: string): Promise<WindowSession | null> {
    const raw = await this.redis.hget(REDIS_KEYS.SESSIONS, windowId);
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

  /** Update session status in Redis and mirror to the session registry */
  async updateStatus(
    windowId: string,
    status: WindowSession['status'],
  ): Promise<void> {
    const session = await this.findByWindowId(windowId);
    if (!session) return;
    session.status = status;
    await this.redis.hset(
      REDIS_KEYS.SESSIONS,
      windowId,
      JSON.stringify(session),
    );

    const globalIdentity = GLOBAL_SESSION_IDENTITY[session.sessionKey];
    const resolvedAppId = session.appId || parseAppIdFromKey(session.sessionKey) || globalIdentity?.appId || '';
    const resolvedWindowId = session.windowId || globalIdentity?.windowId || session.windowId;

    // Mirror to registry — onRunStart handles the atomic increment for 'running'
    if (status === 'running') {
      await this.registry.onRunStart(session.sessionKey, {
        windowId: resolvedWindowId,
        appId: resolvedAppId || undefined,
      });
    } else {
      await this.registry.upsert({
        sessionKey: session.sessionKey,
        windowId: resolvedWindowId,
        appId: resolvedAppId || undefined,
        status,
        lastActiveAt: Date.now(),
      });
    }
  }

  /** Return all session keys currently tracked in gamma:sessions */
  async getActiveSessionKeys(): Promise<string[]> {
    const sessions = await this.findAll();
    return sessions.map((s) => s.sessionKey);
  }

  /**
   * Fully remove a session by its sessionKey — aborts the run, deletes the
   * Gateway session, and cleans up all Redis state and registry entries.
   * Used by the Agent Control Plane kill endpoint.
   */
  async killBySessionKey(sessionKey: string): Promise<boolean> {
    const session = await this.findBySessionKey(sessionKey);
    if (!session) return false;
    return this.remove(session.windowId);
  }

  /**
   * Kill and fully remove ALL active sessions.
   * Calls remove() on each — which handles Gateway deletion, Redis cleanup,
   * registry removal, and watchdog teardown.
   *
   * NOTE: Global system sessions (e.g. system-architect) are intentionally
   * excluded — they are infrastructure singletons and must survive flush
   * operations. Only app-owner and user-spawned sessions are killed.
   *
   * Returns the number of sessions that were removed.
   */
  async killAll(): Promise<number> {
    const sessions = await this.findAll();
    // Exclude global system-level sessions from bulk kill
    const killable = sessions.filter((s) => !GLOBAL_SESSION_IDENTITY[s.sessionKey]);
    await Promise.all(
      killable.map((s) => this.remove(s.windowId).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`killAll: failed to remove session ${s.windowId}: ${msg}`);
      })),
    );
    return killable.length;
  }

  /** Abort a running agent session (spec §4.2) */
  async abort(windowId: string): Promise<boolean> {
    const session = await this.findByWindowId(windowId);
    if (!session) return false;

    // Send abort to Gateway
    await this.gatewayWs.abortRun(session.sessionKey);

    // Immediately update Redis state — don't wait for Gateway confirmation
    await this.redis.hset(
      `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
      'status', 'aborted',
      'runId', '',
    );

    // Push aborted lifecycle event to SSE stream
    await this.redis.xadd(
      `${REDIS_KEYS.SSE_PREFIX}${windowId}`, '*',
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

    const raw = await this.redis.hgetall(`${REDIS_KEYS.STATE_PREFIX}${windowId}`);

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
      `${REDIS_KEYS.SSE_PREFIX}${windowId}`, '*',
      ...flattenEntry({
        type: 'user_message',
        windowId,
        text: message,
        ts: nowMs,
      }),
    );

    // 2. Write to memory bus for decision tree reconstruction
    const busEntry: Omit<MemoryBusEntry, 'id'> = {
      sessionKey: session.sessionKey,
      windowId,
      kind: 'text',
      content: message,
      ts: nowMs,
      stepId: ulid(),
    };
    await this.redis.xadd(
      REDIS_KEYS.MEMORY_BUS, '*',
      ...flattenEntry({ id: ulid(), ...busEntry }),
    );

    // 3. Forward to OpenClaw Gateway (fire-and-forget dispatch)
    try {
      const { accepted } = await this.gatewayWs.sendMessage(
        session.sessionKey,
        message,
        windowId,
      );

      if (!accepted) {
        const errorMessage = '[OpenClaw] Gateway unreachable';
        await this.redis.xadd(
          `${REDIS_KEYS.SSE_PREFIX}${windowId}`,
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
        `${REDIS_KEYS.SSE_PREFIX}${windowId}`,
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
      `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
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
    const stateKey = `${REDIS_KEYS.STATE_PREFIX}${windowId}`;
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
    this.logger.debug(`Intercepted App Session for appId=${appId}`);

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
      `You are the specialized AI App Owner for the '${appId}' application within Gamma Agent Runtime.`,
      `You manage its state and UI.`,
      `If the user asks who you are, introduce yourself exclusively as the AI manager of the ${appId} app, not as a generic assistant.`,
      '',
      'Here is your current source code and context:',
      '',
      contextBlock,
    ];

    const dynamicContext = `[SYSTEM INJECTION] You are currently managing the '${appId}' application. Your primary working directory is apps/gamma-ui/apps/system/${appId}. Do not mention this system message to the user.`;

    const systemPrompt = [dynamicContext, '', ...systemPromptLines].join('\n');

    // Explicitly create/initialize the OpenClaw session with a systemPrompt
    const created = await this.gatewayWs.createSession(sessionKey, systemPrompt, 'app-owner');
    if (!created) {
      this.logger.warn(
        `initializeAppOwnerSession: Gateway sessions.create failed for appId=${appId}, sessionKey=${sessionKey} — continuing to persist context for dual-path chat.send injection`,
      );
      // NOTE: do NOT return early — we must still persist the context so
      // the dual-path `system` field on every chat.send carries the prompt.
    }

    // Persist full prompt as context + snippet in registry.
    // Also re-assert windowId/appId defensively in case of stale/missing fields.
    await Promise.all([
      this.registry.setContext(sessionKey, systemPrompt),
      this.registry.upsert({
        sessionKey,
        windowId,
        appId,
        systemPromptSnippet: systemPrompt.slice(0, 2000),
        lastActiveAt: Date.now(),
      }),
    ]);

    await this.redis.hset(stateKey, APP_OWNER_INIT_FIELD, '1');
  }

  /**
   * Initialize the System Architect Gateway session with its persona prompt
   * and persist the prompt to Redis for dual-path injection via chat.send.
   */
  private async initializeSystemArchitectSession(
    sessionKey: string,
    windowId: string,
  ): Promise<void> {
    const repoRoot = process.cwd();
    let personaContent = '';
    try {
      const personaPath = path.join(repoRoot, 'docs/agents/system-architect.md');
      personaContent = await fs.readFile(personaPath, 'utf8');
    } catch {
      this.logger.debug('system-architect.md not found — using default persona');
    }

    const systemPrompt = personaContent
      ? `[SYSTEM INJECTION] You are the System Architect of Gamma Agent Runtime.\n\n${personaContent}`
      : undefined;

    const created = await this.gatewayWs.createSession(
      sessionKey,
      systemPrompt,
      'system-architect',
    );
    if (!created) {
      this.logger.warn(
        'initializeSystemArchitectSession: Gateway sessions.create failed — ' +
        'continuing to persist context for dual-path chat.send injection',
      );
      // NOTE: do NOT return early — persist context so dual-path injection works.
    }

    // Persist for dual-path injection on chat.send
    if (systemPrompt) {
      await Promise.all([
        this.registry.setContext(sessionKey, systemPrompt),
        this.registry.upsert({
          sessionKey,
          windowId,
          appId: 'system-architect',
          systemPromptSnippet: systemPrompt.slice(0, 2000),
          lastActiveAt: Date.now(),
        }),
      ]);
    }
  }

  /**
   * Initialize the App Inspector daemon session with its persona prompt.
   * Mirrors the System Architect init pattern — loads persona from
   * docs/agents/app-inspector.md and registers with daemon capabilities.
   */
  private async initializeAppInspectorSession(
    sessionKey: string,
    windowId: string,
  ): Promise<void> {
    const repoRoot = process.cwd();
    let personaContent = '';
    try {
      const personaPath = path.join(repoRoot, 'docs/agents/app-inspector.md');
      personaContent = await fs.readFile(personaPath, 'utf8');
    } catch {
      this.logger.debug('app-inspector.md not found — using default persona');
    }

    const systemPrompt = personaContent
      ? `[SYSTEM INJECTION] You are the App Inspector daemon of Gamma Agent Runtime.\n\n${personaContent}`
      : '[SYSTEM INJECTION] You are the App Inspector daemon. Review files for bugs, security issues, and React anti-patterns. Send feedback via send_message.';

    this.logger.log(
      `[TRACE:SESSION] initializeAppInspectorSession | sessionKey=${sessionKey} | promptLen=${systemPrompt.length}`,
    );

    // sessions.create is best-effort — some Gateway versions don't support it.
    // Context and registry are always stored regardless of Gateway response so
    // that dual-path prompt injection works even if sessions.create is rejected.
    const created = await this.gatewayWs.createSession(
      sessionKey,
      systemPrompt,
      'app-owner-inspector',
    );
    this.logger.log(
      `[TRACE:SESSION] Gateway sessions.create result: ${created ? 'OK' : 'FAILED (will use dual-path injection)'}`,
    );
    if (!created) {
      this.logger.warn(
        'initializeAppInspectorSession: Gateway sessions.create failed — ' +
        'continuing with local context storage (dual-path injection will apply on first send)',
      );
    }

    // Update Agent Registry with daemon role and capabilities
    this.logger.log(`[TRACE:SESSION] Updating Agent Registry: role=daemon, capabilities=[code_review, ipc]`);
    await this.agentRegistry.update(sessionKey, {
      role: 'daemon',
      capabilities: ['code_review', 'ipc'],
    });

    // Persist for dual-path injection on chat.send
    await Promise.all([
      this.registry.setContext(sessionKey, systemPrompt),
      this.registry.upsert({
        sessionKey,
        windowId,
        appId: 'app-owner-inspector',
        systemPromptSnippet: systemPrompt.slice(0, 2000),
        lastActiveAt: Date.now(),
      }),
    ]);
  }

  /**
   * Ensure the App Inspector daemon session exists, creating it if needed.
   * Blocks until the OpenClaw Gateway session is fully initialized so that
   * callers can immediately send messages to the inspector.
   * Returns the windowId for the inspector session.
   */
  async ensureAppInspectorSession(): Promise<string> {
    const inspectorWindowId = 'app-owner-inspector-window';
    const existing = await this.findBySessionKey('app-owner-inspector');
    if (existing) {
      this.logger.log(`[TRACE:SESSION] Inspector already exists — windowId=${existing.windowId}`);
      return existing.windowId;
    }

    this.logger.log(`[TRACE:SESSION] Inspector not found — creating session with windowId=${inspectorWindowId}`);

    // Create the session record in Redis + Agent Registry
    await this.create({
      windowId: inspectorWindowId,
      appId: 'app-owner-inspector',
      sessionKey: 'app-owner-inspector',
      agentId: 'app-owner-inspector',
    });

    this.logger.log(`[TRACE:SESSION] Session record created — now initializing Gateway session...`);

    // Block until the OpenClaw Gateway session is ready, with a 15s timeout
    // to prevent hanging if the Gateway is unreachable.
    const INIT_TIMEOUT_MS = 15_000;
    try {
      await Promise.race([
        this.initializeAppInspectorSession('app-owner-inspector', inspectorWindowId),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Inspector Gateway init timed out after 15s')), INIT_TIMEOUT_MS),
        ),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`[TRACE:SESSION] Inspector init failed/timed out: ${msg} — session exists but Gateway may not be ready`);
    }

    this.logger.log(`[TRACE:SESSION] Inspector fully initialized — ready to receive messages`);
    return inspectorWindowId;
  }

  /**
   * Build the shared App Owner context block combining persona, context.md and
   * main .tsx source, searching both generated and system app directories.
   */
  private async buildAppOwnerContextBlock(appId: string): Promise<string | null> {
    const parts: string[] = [];
    const pascalName = pascal(appId);
    const tsxFileName = `${pascalName}App.tsx`;

    // Resolve candidate base directories for this appId.
    // 1) System apps:   <repoRoot>/apps/gamma-ui/apps/system/<PascalAppId>/
    // 2) Generated apps: <JAIL_ROOT>/<appId>/ (exposed via ScaffoldService)
    const repoRoot = process.cwd();
    const systemDir = path.join(
      repoRoot,
      'apps/gamma-ui/apps/system',
      pascalName,
    );
    const generatedRoot = this.scaffoldService.getJailRoot();
    const generatedDir = path.join(generatedRoot, appId);

    const candidateDirs = [systemDir, generatedDir];

    let baseDir: string | null = null;
    for (const dir of candidateDirs) {
      try {
        const stat = await fs.stat(dir);
        if (stat.isDirectory()) {
          this.logger.debug(
            `App Owner context directory found for ${appId}: ${dir}`,
          );
          baseDir = dir;
          break;
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if ((err as { code?: string })?.code === 'ENOENT') {
          this.logger.debug(
            `App Owner context directory missing for ${appId}: ${dir}`,
          );
        } else {
          this.logger.warn(
            `App Owner context directory probe failed for ${appId} at ${dir}: ${msg}`,
          );
        }
      }
    }

    if (!baseDir) {
      this.logger.warn(`[Context] Failed to locate source for ${appId}`);
      // We still return the default persona-only block below (no context/source).
    }

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
      if (baseDir) {
        try {
          const contextPath = path.join(baseDir, 'context.md');
          try {
            const content = await fs.readFile(contextPath, 'utf8');
            parts.push('--- APP CONTEXT ---', content.trim(), '');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if ((err as { code?: string })?.code === 'ENOENT') {
              this.logger.debug(
                `App Owner context.md not found for ${appId} at ${contextPath}`,
              );
            } else {
              this.logger.warn(
                `App Owner context.md read failed for ${appId} at ${contextPath}: ${msg}`,
              );
            }
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.debug(
            `App Owner context lookup failed for ${appId}: ${msg}`,
          );
        }
      }

      // Main .tsx source (first match wins: generated → system)
      if (baseDir) {
        try {
          const sourcePath = path.join(baseDir, tsxFileName);
          let sourceCode: string | null = null;

          try {
            sourceCode = await fs.readFile(sourcePath, 'utf8');
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if ((err as { code?: string })?.code === 'ENOENT') {
              this.logger.warn(
                `App Owner source ${tsxFileName} for ${appId} not found at ${sourcePath} — skipping source injection`,
              );
            } else {
              this.logger.error(
                `App Owner source lookup failed for ${appId} at ${sourcePath}: ${msg}`,
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
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(
            `App Owner source lookup failed for ${appId}: ${msg}`,
          );
        }
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

    // 2. Clean up Redis (session hash, SSE stream, state hash, registry)
    await this.redis.hdel(REDIS_KEYS.SESSIONS, windowId);
    await this.redis.del(`${REDIS_KEYS.SSE_PREFIX}${windowId}`);
    await this.redis.del(`${REDIS_KEYS.STATE_PREFIX}${windowId}`);
    await this.registry.remove(existing.sessionKey);

    // 3. Clear watchdog timers
    this.toolWatchdog.clearWindow(windowId);

    // 4. Unregister from in-memory routing
    this.gatewayWs.unregisterWindowSession(existing.sessionKey);

    // 5. Remove from Agent Registry (keyed by sessionKey, not dto.agentId)
    await this.agentRegistry.unregister(existing.sessionKey);

    this.logger.log(`Removed session ${windowId} (sessionKey=${existing.sessionKey})`);
    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────

  private resolveAgentRole(sessionKey: string): 'architect' | 'app-owner' | 'daemon' {
    if (sessionKey === 'system-architect') return 'architect';
    if (sessionKey === 'app-owner-inspector') return 'daemon';
    if (sessionKey.startsWith(APP_OWNER_PREFIX)) return 'app-owner';
    return 'daemon';
  }
}
