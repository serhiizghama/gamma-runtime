import {
  Injectable,
  Inject,
  Logger,
  ServiceUnavailableException,
  forwardRef,
} from '@nestjs/common';
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

  async sendMessage(windowId: string, message: string): Promise<boolean> {
    const session = await this.findByWindowId(windowId);
    if (!session) return false;

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

    // 3. Enrich message for app-owner sessions (Loop 9 — Context Injection)
    const messageToSend = await this.enrichMessageForAppOwner(
      session.sessionKey,
      message,
    );

    // 4. Forward to OpenClaw Gateway (fire-and-forget dispatch)
    const { accepted } = this.gatewayWs.sendMessage(
      session.sessionKey,
      messageToSend,
      windowId,
    );
    if (!accepted) {
      await this.redis.xadd(
        `gamma:sse:${windowId}`, '*',
        ...flattenEntry({
          type: 'lifecycle_error',
          windowId,
          runId: '',
          message: 'Gateway not connected — message not sent',
        }),
      );
      throw new ServiceUnavailableException('OpenClaw Gateway not connected');
    }

    // 5. Update lastEventAt for GC freshness tracking
    await this.redis.hset(`gamma:state:${windowId}`, 'lastEventAt', String(nowMs));

    return true;
  }

  /**
   * Enrich user message with app context for app-owner sessions (Loop 9).
   * Reads context.md, agent-prompt.md, and main .tsx source via jailPath.
   * Gracefully skips missing files; returns original message if not app-owner.
   */
  private async enrichMessageForAppOwner(
    sessionKey: string,
    message: string,
  ): Promise<string> {
    // Guard: sessionKey must be non-null string
    if (!sessionKey || typeof sessionKey !== 'string') {
      this.logger.warn('enrichMessageForAppOwner: sessionKey is empty or invalid');
      return message;
    }

    if (!sessionKey.startsWith(APP_OWNER_PREFIX)) {
      return message;
    }

    const rawAppId = sessionKey.slice(APP_OWNER_PREFIX.length);
    const appId = rawAppId.replace(/[^a-z0-9-]/gi, '');

    // Strict validation: reject empty, null-like, or literal "undefined"
    // (occurs when frontend passes win.appId when it is undefined)
    if (
      !appId ||
      appId === 'undefined' ||
      rawAppId.toLowerCase() === 'undefined'
    ) {
      this.logger.warn(
        `app-owner session with invalid appId: ${JSON.stringify(rawAppId)} — skipping context injection`,
      );
      return message;
    }

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
        let contextContent: string | null = null;

        for (const candidate of contextCandidates) {
          try {
            const content = await fs.readFile(candidate, 'utf8');
            contextContent = content;
            break;
          } catch {
            // try next candidate
          }
        }

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
          } catch {
            // try next candidate
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
        this.logger.warn(
          `App Owner ${appId}: no context files found, sending raw message`,
        );
        return message;
      }

      parts.push('--- USER REQUEST ---', message);
      return parts.join('\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `App Owner context injection failed for ${appId}: ${msg}`,
      );
      return message;
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
