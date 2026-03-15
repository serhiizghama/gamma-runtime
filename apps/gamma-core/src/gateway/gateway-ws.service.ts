import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { createPrivateKey, sign as cryptoSign } from 'crypto';
import { readFile } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';
import { ulid } from 'ulid';
import { REDIS_KEYS } from '@gamma/types';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SystemEventLog } from '../system/system-event-log.service';
import {
  classifyGatewayEventKind,
  isReasoningStream,
} from './event-classifier';
import { ToolWatchdogService } from './tool-watchdog.service';
import { ToolJailGuardService } from './tool-jail-guard.service';
import { SessionRegistryService } from '../sessions/session-registry.service';
import { AppStorageService } from '../scaffold/app-storage.service';
import { ContextInjectorService } from '../scaffold/context-injector.service';
import { MessageBusService } from '../messaging/message-bus.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import type { GWAgentEventPayload, MemoryBusEntry, TokenUsage, WindowSession } from '@gamma/types';

// ── Tool Scoping ──────────────────────────────────────────────────────────
// Role-based tool allowlists. App Owners are restricted to their jail;
// System Architect gets full access.

/** Tools available to App Owner agents — limited to their own app bundle. */
const APP_OWNER_TOOLS = [
  'shell_exec',   // Sandboxed shell within jail
  'fs_read',      // Read files within jail
  'fs_write',     // Write files within jail
  'fs_list',      // List directory within jail
  'update_app',   // Scaffold update (PATCH semantics)
  'read_context', // Read own context.md
  'list_assets',  // List own assets
  'add_asset',    // Upload asset to own bundle
] as const;

/** Tools available to System Architect — full system access. */
const SYSTEM_ARCHITECT_TOOLS = [
  'shell_exec',
  'fs_read',
  'fs_write',
  'fs_list',
  'scaffold',
  'unscaffold',
  'system_health',
  'list_apps',
  'read_file',
  'send_message',
] as const;

/** Tools available to App Inspector — read-only cross-app access + IPC. */
const APP_INSPECTOR_TOOLS = [
  'fs_read',
  'fs_list',
  'send_message',
] as const;

/**
 * Resolve the tool allowlist for a given session key.
 * Returns undefined for sessions without explicit scoping (fallback to gateway defaults).
 */
function resolveAllowedTools(sessionKey: string): readonly string[] | undefined {
  if (sessionKey === 'inspector') return APP_INSPECTOR_TOOLS;
  if (sessionKey.startsWith('app-owner-')) return APP_OWNER_TOOLS;
  if (sessionKey === 'system-architect') return SYSTEM_ARCHITECT_TOOLS;
  return undefined;
}

// ── Local types ───────────────────────────────────────────────────────────

interface GWFrame {
  type: string;
  id?: string;
  ok?: boolean;
  event?: string;
  method?: string;
  payload?: Record<string, unknown>;
  error?: Record<string, unknown> | string;
  seq?: number;
}

interface PendingRequest {
  resolve: (frame: GWFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Helpers ───────────────────────────────────────────────────────────────

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
export class GatewayWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Gateway');

  private ws: WebSocket | null = null;
  private connected = false;
  private destroyed = false;

  // Reconnect
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30_000;

  // Request/response tracking
  private pendingRequests = new Map<string, PendingRequest>();

  /** Inflight chat.send: frameId → { windowId, sessionKey } for error routing and usage accumulation */
  private inflightChatSend = new Map<string, { windowId: string; sessionKey: string }>();

  // Session → Window mapping (populated externally by SessionsService)
  public sessionToWindow = new Map<string, string>();

  /** Register a window↔session mapping in memory (spec: audit hotfix). */
  public registerWindowSession(sessionKey: string, windowId: string): void {
    if (!sessionKey || !windowId) return;
    this.sessionToWindow.set(sessionKey, windowId);
  }

  /** Remove a window↔session mapping from memory. */
  public unregisterWindowSession(sessionKey: string): void {
    if (!sessionKey) return;
    this.sessionToWindow.delete(sessionKey);
  }

  // ── OpenClaw session key boundary translation ──────────────────────────

  /**
   * Convert an internal Gamma session key to the OpenClaw native format.
   * Internal keys are used everywhere inside Gamma; OpenClaw keys are only
   * used in the WS frame params that cross the Gateway boundary.
   *
   * system-architect         → agent:system-architect:main
   * app-owner-<appId>        → agent:app-owner:<appId>
   * anything else            → unchanged (e.g. legacy "main" sessions)
   */
  private toOpenClawKey(internalKey: string): string {
    if (internalKey === 'system-architect') return 'agent:system-architect:main';
    if (internalKey === 'inspector') return 'agent:inspector:main';
    if (internalKey.startsWith('app-owner-')) {
      const appId = internalKey.replace('app-owner-', '');
      return `agent:app-owner:${appId}`;
    }
    return internalKey;
  }

  /**
   * Convert an OpenClaw native session key back to the internal Gamma key.
   * Applied immediately on inbound WS frames before any internal processing.
   *
   * agent:system-architect:main → system-architect
   * agent:app-owner:<appId>     → app-owner-<appId>
   * anything else               → unchanged
   */
  private toInternalKey(openClawKey: string): string {
    if (openClawKey === 'agent:system-architect:main') return 'system-architect';
    if (openClawKey === 'agent:inspector:main') return 'inspector';
    // OpenClaw actual format: agent:app-owner-<appId>:main
    if (openClawKey.startsWith('agent:app-owner-') && openClawKey.endsWith(':main')) {
      return openClawKey.replace(/^agent:/, '').replace(/:main$/, '');
      // e.g. agent:app-owner-terminal:main → app-owner-terminal
    }
    // Legacy / toOpenClawKey format: agent:app-owner:<appId>
    if (openClawKey.startsWith('agent:app-owner:')) {
      const appId = openClawKey.replace('agent:app-owner:', '');
      return `app-owner-${appId}`;
    }
    return openClawKey;
  }

  // ── Hierarchy tracking for memory bus (spec §3.6) ──
  // Maps runId → { seq, lastThinkingStepId, toolCallStepIds }
  /** In-memory cumulative text tracker — avoids Redis race on rapid events */
  private cumulativeText = new Map<string, string>();

  /** Serialize event processing per-window to prevent race conditions */
  private eventQueue = new Map<string, Promise<void>>();

  private runStepCounters = new Map<
    string,
    {
      seq: number;
      lastThinkingStepId: string | null;
      toolCallStepIds: Map<string, string>; // toolCallId → stepId
    }
  >();

  /** Stash fs_write file paths from tool_call phase for emission on result. */
  private pendingFsWritePaths = new Map<string, string>(); // toolCallId → filePath

  private readonly gatewayUrl: string;
  private readonly gatewayToken: string;
  // Device identity — reserved for future paired device auth
  // private readonly deviceId: string;
  // private readonly publicKey: string;
  // private readonly privateKey: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly toolWatchdog: ToolWatchdogService,
    private readonly toolJailGuard: ToolJailGuardService,
    private readonly sessionRegistry: SessionRegistryService,
    private readonly appStorage: AppStorageService,
    private readonly messageBus: MessageBusService,
    private readonly agentRegistry: AgentRegistryService,
    @Optional() private readonly contextInjector?: ContextInjectorService,
    @Optional() private readonly eventLog?: SystemEventLog,
  ) {
    this.gatewayUrl = this.config.get('OPENCLAW_GATEWAY_URL', 'ws://localhost:18789');
    this.gatewayToken = this.config.get('OPENCLAW_GATEWAY_TOKEN', '');
    // Device identity reserved for future paired device auth
    // this.deviceId = this.config.get('GAMMA_DEVICE_ID', 'gamma-bridge-001');
    // this.publicKey = this.config.get('GAMMA_DEVICE_PUBLIC_KEY', '');
    // this.privateKey = this.config.get('GAMMA_DEVICE_PRIVATE_KEY', '');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (!this.gatewayToken) {
      this.logger.warn('OPENCLAW_GATEWAY_TOKEN not set — Gateway connection disabled');
      return;
    }
    await this.loadExistingSessionsFromRedis();
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.closeWs();
  }

  isConnected(): boolean {
    return this.connected;
  }

  // ── Connection ─────────────────────────────────────────────────────────

  private async connect(): Promise<void> {
    if (this.destroyed) return;

    try {
      this.ws = new WebSocket(this.gatewayUrl);

      // Attach low-level error handler immediately after socket creation to
      // prevent native errors from bubbling to the Node.js event loop.
      this.ws.on('error', (err: Error) => {
        try {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.error(`WebSocket error: ${msg}`);
        } catch {
          // Swallow all logger or formatting failures to guarantee isolation
        }
      });

      this.ws.on('open', () => {
        this.logger.log(`WebSocket opened to ${this.gatewayUrl}`);
      });

      this.ws.on('message', (raw: WebSocket.RawData) => {
        try {
          const frame = JSON.parse(raw.toString()) as GWFrame;
          this.handleFrame(frame);
        } catch {
          this.logger.warn('Failed to parse Gateway frame');
        }
      });

      this.ws.on('close', (code: number, reason: Buffer) => {
        this.logger.warn(`WebSocket closed: ${code} ${reason.toString()}`);
        this.onDisconnect();
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to create WebSocket: ${msg}`);
      this.scheduleReconnect();
    }
  }

  private closeWs(): void {
    if (this.ws) {
      this.connected = false;
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch { /* ignore */ }
      this.ws = null;
    }
  }

  // ── Reconnection ──────────────────────────────────────────────────────

  private onDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.closeWs();

    // Clear run tracking to avoid orphaned counters when runs are interrupted
    this.runStepCounters.clear();
    this.inflightChatSend.clear();
    this.pendingFsWritePaths.clear();

    for (const [id, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error('Gateway disconnected'));
      this.pendingRequests.delete(id);
    }

    if (wasConnected) {
      this.broadcastGatewayStatus('disconnected');
    }
    this.scheduleReconnect();
  }

  // ── Restore session mappings on startup ────────────────────────────────

  private async loadExistingSessionsFromRedis(): Promise<void> {
    try {
      const raw = await this.redis.hgetall(REDIS_KEYS.SESSIONS);
      let restored = 0;

      for (const json of Object.values(raw)) {
        try {
          const session = JSON.parse(json) as WindowSession;
          if (session.sessionKey && session.windowId) {
            this.sessionToWindow.set(session.sessionKey, session.windowId);
            restored++;
          }
        } catch {
          // Ignore malformed session entries
        }
      }

      if (restored > 0) {
        this.logger.log(`Restored ${restored} session mappings from Redis`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to restore session mappings from Redis: ${msg}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;

    this.logger.log(`Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      await this.connect();
    }, this.reconnectDelay);
  }

  private onAuthenticated(): void {
    this.connected = true;
    this.reconnectDelay = 1000;
    this.logger.log('Connected and authenticated');
    this.broadcastGatewayStatus('connected');
  }

  // ── Frame handling ────────────────────────────────────────────────────

  private handleFrame(frame: GWFrame): void {
    // Response to request
    if (frame.type === 'res' && frame.id) {
      // chat.send is fire-and-forget — route errors to SSE; probe ok acks for usage
      const chatInflight = this.inflightChatSend.get(frame.id);
      if (chatInflight) {
        this.inflightChatSend.delete(frame.id);
        if (!frame.ok) {
          this.pushChatSendError(chatInflight.windowId, frame);
        } else if (frame.payload) {
          // Secondary path: some gateway versions attach usage to the chat.send ack
          this.applyUsageFromPayload(chatInflight.sessionKey, frame.payload, 'chat.send res').catch(() => {});
        }
        return;
      }

      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame);
      }
      return;
    }

    // Challenge → handshake
    if (frame.type === 'event' && frame.event === 'connect.challenge') {
      this.handleChallenge(frame).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Handshake failed: ${msg}`);
        this.closeWs();
        this.scheduleReconnect();
      });
      return;
    }

    // Runtime events (spec §5.2)
    if (frame.type === 'event' && frame.event) {
      this.logger.log(`WS event: ${frame.event} (seq=${frame.seq ?? '?'})`);
      const kind = classifyGatewayEventKind(frame.event);

      if (kind === 'runtime-agent') {
        this.logger.log(`raw agent payload keys: ${Object.keys(frame.payload ?? {}).join(', ')}`);
        this.enqueueAgentEvent(frame.payload as unknown as GWAgentEventPayload);
      }
      // runtime-chat, summary-refresh, ignore — no-op for now
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ══  PHASE-AWARE EVENT BRIDGE (spec §6)  ═════════════════════════════
  // ══════════════════════════════════════════════════════════════════════

  /** Enqueue agent event processing — serialized per session to prevent race conditions */
  private enqueueAgentEvent(payload: GWAgentEventPayload): void {
    // Translate inbound OpenClaw key back to internal Gamma key at the boundary
    const sessionKey = this.toInternalKey(payload.sessionKey);

    const prev = this.eventQueue.get(sessionKey) ?? Promise.resolve();
    const next = prev.then(() => this.handleAgentEvent({ ...payload, sessionKey })).catch(
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Event bridge error: ${msg}`);
      },
    );
    this.eventQueue.set(sessionKey, next);
  }

  private async handleAgentEvent(payload: GWAgentEventPayload): Promise<void> {
    // sessionKey already normalized by enqueueAgentEvent
    const sessionKey = payload.sessionKey;
    this.logger.log(`handleAgentEvent: key=${sessionKey}, stream=${payload.stream}, data=${JSON.stringify(payload.data).slice(0, 200)}`);

    // Update Agent Registry heartbeat on EVERY incoming event
    this.agentRegistry.heartbeat(sessionKey, `${payload.stream}`).catch(() => {});

    const windowId = this.sessionToWindow.get(sessionKey);
    if (!windowId) {
      // External sessions (e.g. Discord agents) have no UI window — silently skip
      const isExternal = /:(discord|telegram|slack|api):/.test(sessionKey);
      if (isExternal) {
        this.logger.debug(`agentEvent: ignoring external session ${sessionKey}`);
      } else {
        this.logger.warn(`agentEvent: no window mapping for sessionKey=${sessionKey}, known=[${[...this.sessionToWindow.keys()]}]`);
      }
      return;
    }

    const { stream, data, runId } = payload;
    const sseKey = `${REDIS_KEYS.SSE_PREFIX}${windowId}`;
    const nowMs = Date.now();

    // Event lag tracking (for system health / observability)
    if (payload.ts && payload.ts > 0) {
      const lagMs = nowMs - payload.ts;
      if (lagMs >= 0) {
        this.redis
          .pipeline()
          .lpush(REDIS_KEYS.EVENT_LAG, lagMs)
          .ltrim(REDIS_KEYS.EVENT_LAG, 0, 99)
          .exec()
          .catch(() => {}); // best-effort
      }
    }

    // ── LIFECYCLE ───────────────────────────────────────────────────────
    if (stream === 'lifecycle') {
      const phase = data?.phase;

      if (phase === 'start') {
        // Initialize run tracking
        this.runStepCounters.set(runId, {
          seq: 0,
          lastThinkingStepId: null,
          toolCallStepIds: new Map(),
        });

        const eventId = await this.pushSSE(sseKey, {
          type: 'lifecycle_start',
          windowId,
          runId,
        });

        // Reset in-memory cumulative text tracker
        this.cumulativeText.set(windowId, '');

        // Update Redis live state (spec §4.1)
        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'status', 'running',
          'runId', runId,
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
          'streamText', '',
          'thinkingTrace', '',
          'pendingToolLines', '[]',
        );
        await this.redis.expire(`${REDIS_KEYS.STATE_PREFIX}${windowId}`, 14400); // 4h TTL

        // Atomically increment runCount + mark running in session registry
        await this.sessionRegistry.onRunStart(sessionKey);

        // Mirror status to Agent Registry so UI sees 'running'
        await this.agentRegistry.update(sessionKey, { status: 'running' });
        return;
      }

      if (phase === 'end') {
        const eventId = await this.pushSSE(sseKey, {
          type: 'lifecycle_end',
          windowId,
          runId,
          stopReason: 'stop',
        });

        // Clear live state but keep lastEventId for gap protection
        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'status', 'idle',
          'runId', '',
          'streamText', '',
          'thinkingTrace', '',
          'pendingToolLines', '[]',
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );
        await this.redis.expire(`${REDIS_KEYS.STATE_PREFIX}${windowId}`, 14400); // 4h TTL

        // Flip status to idle immediately
        await this.sessionRegistry.upsert({
          sessionKey,
          status: 'idle',
          lastActiveAt: nowMs,
        });

        // Mirror status to Agent Registry
        await this.agentRegistry.update(sessionKey, { status: 'idle' });

        // NOTE: session-usage RPC was removed from the Gateway contract.
        // Token metrics are now derived from streamed lifecycle events.

        // Cleanup run tracking + watchdog timers
        this.runStepCounters.delete(runId);
        this.toolWatchdog.clearWindow(windowId);

        // Reset rollback cooldown on successful completion
        if (sessionKey.startsWith('app-owner-')) {
          this.toolWatchdog.resetRollbackCount(sessionKey.replace('app-owner-', ''));
        }
        return;
      }

      if (phase === 'error') {
        const eventId = await this.pushSSE(sseKey, {
          type: 'lifecycle_error',
          windowId,
          runId,
          message: typeof data?.text === 'string' ? data.text : 'Run error',
        });

        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'status', 'error',
          'runId', '',
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );

        // Update session registry status
        await this.sessionRegistry.upsert({
          sessionKey,
          status: 'error',
          lastActiveAt: nowMs,
        });

        // Mirror status to Agent Registry
        await this.agentRegistry.update(sessionKey, { status: 'error' });

        this.runStepCounters.delete(runId);
        this.toolWatchdog.clearWindow(windowId);

        // Automated rollback for app-owner sessions on lifecycle error
        if (sessionKey.startsWith('app-owner-')) {
          const appId = sessionKey.replace('app-owner-', '');
          this.toolWatchdog.triggerRollback(appId).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`[Lifecycle] Rollback failed for '${appId}': ${msg}`);
          });
        }
        return;
      }

      return;
    }

    // ── THINKING / REASONING STREAMS ────────────────────────────────────
    if (stream === 'thinking' || isReasoningStream(stream)) {
      const text = data?.text ?? data?.delta ?? '';
      if (!text) return;

      const eventId = await this.pushSSE(sseKey, {
        type: 'thinking',
        windowId,
        runId,
        text,
      });

      // Update live state for F5 recovery
      await this.redis.hset(
        `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
        'thinkingTrace', text,
        'lastEventAt', String(nowMs),
        'lastEventId', eventId,
      );

      // Memory bus with hierarchy
      const stepId = this.nextStepId(runId);
      const tracker = this.runStepCounters.get(runId);
      const parentId = tracker?.lastThinkingStepId ?? undefined;
      if (tracker) tracker.lastThinkingStepId = stepId;

      await this.pushMemoryBus({
        sessionKey: payload.sessionKey,
        windowId,
        kind: 'thought',
        content: text,
        ts: nowMs,
        stepId,
        parentId,
      });
      return;
    }

    // ── ASSISTANT TEXT ──────────────────────────────────────────────────
    if (stream === 'assistant') {
      const thinkingContent = data?.thinking;
      // OpenClaw sends cumulative text in data.text — use it directly (overwrite pattern)
      const fullText: string = data?.text ?? '';

      // Intercept embedded thinking (e.g. <think> tags)
      if (thinkingContent) {
        const thinkEventId = await this.pushSSE(sseKey, {
          type: 'thinking',
          windowId,
          runId,
          text: thinkingContent,
        });

        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'thinkingTrace', thinkingContent,
          'lastEventAt', String(nowMs),
          'lastEventId', thinkEventId,
        );

        const stepId = this.nextStepId(runId);
        const tracker = this.runStepCounters.get(runId);
        const parentId = tracker?.lastThinkingStepId ?? undefined;
        if (tracker) tracker.lastThinkingStepId = stepId;

        await this.pushMemoryBus({
          sessionKey: payload.sessionKey,
          windowId,
          kind: 'thought',
          content: thinkingContent,
          ts: nowMs,
          stepId,
          parentId,
        });
      }

      if (fullText) {
        const textEventId = await this.pushSSE(sseKey, {
          type: 'assistant_update',
          windowId,
          runId,
          text: fullText,
        });

        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'streamText', fullText,
          'lastEventAt', String(nowMs),
          'lastEventId', textEventId,
        );
      }
      return;
    }

    // ── TOOL CALLS ─────────────────────────────────────────────────────
    if (stream === 'tool') {
      const phase = data?.phase;
      const name = data?.name ?? 'tool';
      const toolCallId = data?.toolCallId ?? '';

      if (phase !== 'result') {
        // ── Jail Guard: validate tool arguments before execution ──────
        const violation = this.toolJailGuard.validate(
          sessionKey,
          name,
          (data?.arguments as Record<string, unknown>) ?? null,
        );
        if (violation) {
          this.logger.error(
            `[JailGuard] BLOCKED ${name} for ${sessionKey}: ${violation.reason}`,
          );
          this.eventLog?.push(
            `Jail violation blocked: ${name} by ${sessionKey} — ${violation.reason}`,
            'critical',
          );

          // Push a synthetic tool_result error to SSE so the UI sees the rejection
          await this.pushSSE(sseKey, {
            type: 'tool_result',
            windowId,
            runId,
            name,
            toolCallId,
            result: `BLOCKED: ${violation.reason}`,
            isError: true,
          });

          // Send rejection to the Gateway so the agent gets an error result
          if (toolCallId) {
            this.send({
              type: 'req',
              id: ulid(),
              method: 'tools.reject',
              params: {
                sessionKey: this.toOpenClawKey(sessionKey),
                toolCallId,
                error: `Security: ${violation.reason}`,
              },
            });
          }
          return;
        }

        // ── IPC: intercept send_message and handle locally ──────────
        if (name === 'send_message' && toolCallId) {
          await this.handleSendMessageTool(
            sessionKey, windowId, runId, toolCallId,
            (data?.arguments as Record<string, unknown>) ?? {},
            sseKey, nowMs,
          );
          return;
        }

        // Stash fs_write path for file_changed emission on successful result
        if (name === 'fs_write' && toolCallId) {
          const isRegularAppOwner = sessionKey.startsWith('app-owner-');
          this.logger.log(
            `[TRACE:EMITTER] fs_write CALL intercepted | session=${sessionKey} | toolCallId=${toolCallId} | isRegularAppOwner=${isRegularAppOwner}`,
          );
          if (isRegularAppOwner) {
            const args = (data?.arguments as Record<string, unknown>) ?? {};
            const filePath = (args.path ?? args.file ?? args.filePath ?? '') as string;
            this.logger.log(
              `[TRACE:EMITTER] Extracted filePath="${filePath}" from args keys=[${Object.keys(args).join(',')}]`,
            );
            if (filePath) {
              this.pendingFsWritePaths.set(toolCallId, filePath);
            }
          }
        }

        // Tool call initiated
        const eventId = await this.pushSSE(sseKey, {
          type: 'tool_call',
          windowId,
          runId,
          name,
          toolCallId,
          arguments: data?.arguments ?? null,
        });

        // Update pending tool lines in live state
        const raw = await this.redis.hget(`${REDIS_KEYS.STATE_PREFIX}${windowId}`, 'pendingToolLines');
        const lines: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        lines.push(`🔧 \`${name}\`(${JSON.stringify(data?.arguments ?? {})})`);
        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'pendingToolLines', JSON.stringify(lines),
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );

        // Register tool watchdog (spec §6.2) — fires after 30s if no result
        if (toolCallId) {
          this.toolWatchdog.register(windowId, toolCallId, runId, async () => {
            const timeoutMsg = `Tool '${name}' timed out after ${ToolWatchdogService.TIMEOUT_MS / 1000}s`;
            this.logger.warn(`[Watchdog] ${timeoutMsg} (window=${windowId})`);

            const errEventId = await this.pushSSE(sseKey, {
              type: 'lifecycle_error',
              windowId,
              runId,
              message: timeoutMsg,
            });

            await this.redis.hset(
              `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
              'status', 'error',
              'runId', '',
              'lastEventAt', String(Date.now()),
              'lastEventId', errEventId,
            );

            // Automated rollback for app-owner sessions (spec §6.2 self-healing)
            if (sessionKey.startsWith('app-owner-')) {
              const appId = sessionKey.replace('app-owner-', '');
              this.toolWatchdog.triggerRollback(appId).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.error(`[Watchdog] Rollback failed for '${appId}': ${msg}`);
              });
            }
          });
        }

        // Memory bus — tool_call with parent = last thinking step
        const stepId = this.nextStepId(runId);
        const tracker = this.runStepCounters.get(runId);
        const parentId = tracker?.lastThinkingStepId ?? undefined;

        // Track this tool call's stepId for the result to reference
        if (tracker && toolCallId) {
          tracker.toolCallStepIds.set(toolCallId, stepId);
        }

        await this.pushMemoryBus({
          sessionKey: payload.sessionKey,
          windowId,
          kind: 'tool_call',
          content: JSON.stringify({ name, arguments: data?.arguments }),
          ts: nowMs,
          stepId,
          parentId,
        });
      } else {
        // Resolve watchdog before processing result
        if (toolCallId) {
          this.toolWatchdog.resolve(windowId, toolCallId);
        }

        // Tool result received
        const eventId = await this.pushSSE(sseKey, {
          type: 'tool_result',
          windowId,
          runId,
          name,
          toolCallId,
          result: data?.result ?? null,
          isError: data?.isError ?? false,
        });

        // Update pending tool lines
        const raw = await this.redis.hget(`${REDIS_KEYS.STATE_PREFIX}${windowId}`, 'pendingToolLines');
        const lines: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        const status = data?.isError ? '❌' : '✅';
        lines.push(`${status} \`${name}\` → ${JSON.stringify(data?.result ?? null)}`);
        await this.redis.hset(
          `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
          'pendingToolLines', JSON.stringify(lines),
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );

        // Memory bus — tool_result with parent = matching tool_call
        const stepId = this.nextStepId(runId);
        const tracker = this.runStepCounters.get(runId);
        const parentId =
          (tracker && toolCallId
            ? tracker.toolCallStepIds.get(toolCallId)
            : undefined) ?? undefined;

        await this.pushMemoryBus({
          sessionKey: payload.sessionKey,
          windowId,
          kind: 'tool_result',
          content: JSON.stringify({ name, result: data?.result }),
          ts: nowMs,
          stepId,
          parentId,
        });

        // ── File-changed event for the Duty Architect loop (Phase 4.2) ──
        if (name === 'fs_write' && toolCallId) {
          const filePath = this.pendingFsWritePaths.get(toolCallId);
          this.pendingFsWritePaths.delete(toolCallId);

          const isRegularAppOwner = sessionKey.startsWith('app-owner-');
          this.logger.log(
            `[TRACE:EMITTER] fs_write RESULT | session=${sessionKey} | toolCallId=${toolCallId} | ` +
            `stashedPath="${filePath ?? '<none>'}" | isError=${!!data?.isError} | isRegularAppOwner=${isRegularAppOwner}`,
          );

          if (filePath && !data?.isError && isRegularAppOwner) {
            const appId = sessionKey.replace('app-owner-', '');
            this.logger.log(
              `[TRACE:EMITTER] Publishing file_changed to ${REDIS_KEYS.FILE_CHANGED_STREAM} | appId=${appId} | filePath=${filePath}`,
            );
            this.redis
              .xadd(
                REDIS_KEYS.FILE_CHANGED_STREAM,
                'MAXLEN', '~', '500',
                '*',
                'appId', appId,
                'filePath', filePath,
                'sessionKey', sessionKey,
                'toolCallId', toolCallId,
                'windowId', windowId,
                'timestamp', String(nowMs),
              )
              .then((streamId) => {
                this.logger.log(`[TRACE:EMITTER] xadd SUCCESS — streamId=${streamId}`);
              })
              .catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                this.logger.error(`[TRACE:EMITTER] xadd FAILED: ${msg}`);
              });
          }
        }
      }
      return;
    }
  }

  // ── Step ID generator (spec §3.6) ──────────────────────────────────

  private nextStepId(runId: string): string {
    let tracker = this.runStepCounters.get(runId);
    if (!tracker) {
      tracker = { seq: 0, lastThinkingStepId: null, toolCallStepIds: new Map() };
      this.runStepCounters.set(runId, tracker);
    }
    tracker.seq++;
    return `${runId}:step:${tracker.seq}`;
  }

  // ── Redis Stream helpers ──────────────────────────────────────────────

  private async pushSSE(
    streamKey: string,
    event: Record<string, unknown>,
  ): Promise<string> {
    const eventId = await this.redis.xadd(streamKey, '*', ...flattenEntry(event));
    return eventId!; // xadd always returns an ID when using '*'
  }

  private async pushMemoryBus(entry: Omit<MemoryBusEntry, 'id'>): Promise<void> {
    await this.redis.xadd(
      REDIS_KEYS.MEMORY_BUS,
      '*',
      ...flattenEntry({
        id: ulid(),
        ...entry,
      }),
    );
  }

  /** Push chat.send rejection to SSE so client sees the error */
  private pushChatSendError(windowId: string, frame: GWFrame): void {
    const errMsg =
      typeof frame.error === 'string'
        ? frame.error
        : (frame.error as Record<string, unknown>)?.message ?? JSON.stringify(frame.error ?? 'Gateway rejected message');
    this.logger.warn(`chat.send rejected for ${windowId}: ${errMsg}`);
    this.redis
      .xadd(
        `${REDIS_KEYS.SSE_PREFIX}${windowId}`,
        '*',
        ...flattenEntry({
          type: 'lifecycle_error',
          windowId,
          runId: '',
          message: String(errMsg),
        }),
      )
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to push chat.send error to SSE: ${msg}`);
      });
  }

  // ── Gateway status broadcast (spec §7.2) ──────────────────────────────

  private broadcastGatewayStatus(status: 'connected' | 'disconnected'): void {
    this.redis
      .xadd(REDIS_KEYS.SSE_BROADCAST, '*', ...flattenEntry({
        type: 'gateway_status',
        status,
        ts: String(Date.now()),
      }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to broadcast gateway_status: ${msg}`);
      });
  }

  // ── Ed25519 Handshake (spec §5.1) ─────────────────────────────────────

  private async handleChallenge(frame: GWFrame): Promise<void> {
    const nonce = frame.payload?.['nonce'] as string | undefined;
    this.logger.log(`Received challenge (nonce=${nonce ? 'present' : 'absent'}), authenticating...`);

    const frameId = ulid();

    // OpenClaw Gateway ConnectParams schema:
    //   client.id: one of the GATEWAY_CLIENT_IDS constants
    //   client.mode: one of GATEWAY_CLIENT_MODES (webchat|cli|ui|backend|node)
    //   auth.token: the gateway token
    // Load device identity from OpenClaw identity files
    let deviceId = process.env.OPENCLAW_DEVICE_ID;
    let devicePublicKey = process.env.OPENCLAW_DEVICE_PUBLIC_KEY;
    let deviceToken = process.env.OPENCLAW_DEVICE_TOKEN;
    let devicePrivateKeyPem: string | undefined;

    try {
      const identityPath = join(homedir(), '.openclaw', 'identity', 'device.json');
      const authPath = join(homedir(), '.openclaw', 'identity', 'device-auth.json');
      const [identityRaw, authRaw] = await Promise.all([
        readFile(identityPath, 'utf8'),
        readFile(authPath, 'utf8'),
      ]);
      const identity = JSON.parse(identityRaw);
      const auth = JSON.parse(authRaw);
      deviceId = identity.deviceId;
      devicePrivateKeyPem = identity.privateKeyPem;
      // Extract base64url raw public key from PEM
      const pemBody = identity.publicKeyPem
        .replace(/-----.*?-----/g, '')
        .replace(/\s/g, '');
      const derBytes = Buffer.from(pemBody, 'base64');
      const rawKey = derBytes.slice(-32);
      devicePublicKey = rawKey.toString('base64url');
      deviceToken = auth?.tokens?.operator?.token;
    } catch {
      // Fall back to env vars if files not available
    }

    const scopes = this.config.get<string>('GATEWAY_SCOPES', 'operator.write,operator.read').split(',');

    // Build device auth signature if device identity is configured
    let deviceAuth: Record<string, unknown> | undefined;
    if (deviceId && devicePublicKey && deviceToken && devicePrivateKeyPem && nonce) {
      try {
        const signedAtMs = Date.now();
        const clientId = 'gateway-client';
        const clientMode = 'backend';
        const role = 'operator';
        const platform = 'macos';
        const deviceFamily = '';

        // Build v3 payload (matches OpenClaw gateway protocol)
        // resolveSignatureToken uses auth.token (gateway token) first
        const signatureToken = this.gatewayToken ?? '';
        const payload = [
          'v3',
          deviceId,
          clientId,
          clientMode,
          role,
          scopes.join(','),
          String(signedAtMs),
          signatureToken,
          nonce,
          platform,
          deviceFamily,
        ].join('|');

        const privateKey = createPrivateKey(devicePrivateKeyPem);
        const sigBuf = cryptoSign(null, Buffer.from(payload, 'utf8'), privateKey);
        const signature = sigBuf.toString('base64url');

        deviceAuth = {
          id: deviceId,
          publicKey: devicePublicKey,
          signature,
          signedAt: signedAtMs,
          nonce,
        };
      } catch (e) {
        this.logger.warn(`Device signing failed: ${(e as Error).message} — connecting without device`);
      }
    }

    const params: Record<string, unknown> = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: 'gateway-client',
        version: '1.0.0',
        platform: 'macos',
        mode: 'backend',
      },
      role: 'operator',
      scopes,
      auth: {
        token: this.gatewayToken,
        ...(deviceToken ? { deviceToken } : {}),
      },
      ...(deviceAuth ? { device: deviceAuth } : {}),
    };

    // Device signing is optional — skip unless properly paired with the Gateway
    // (device ID must be derived from public key via deriveDeviceIdFromPublicKey)

    this.send({
      type: 'req',
      id: frameId,
      method: 'connect',
      params,
    });

    const response = await this.waitForResponse(frameId, 5000);
    if (response.ok) {
      this.logger.log('Gateway authenticated successfully');
      this.onAuthenticated();
    } else {
      const errMsg = response.error
        ? JSON.stringify(response.error)
        : JSON.stringify(response.payload);
      throw new Error(`Authentication rejected: ${errMsg}`);
    }
  }

  // signChallenge reserved for future device pairing auth

  // ── Send / Request helpers ─────────────────────────────────────────────

  send(data: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.logger.warn('Cannot send — WebSocket not open');
      return;
    }
    try {
      this.ws.send(JSON.stringify(data));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to send WebSocket frame: ${msg}`);
      // Best-effort cleanup: treat as a disconnect so higher layers can react.
      try {
        this.onDisconnect();
      } catch {
        // onDisconnect errors must never escape the send path
      }
    }
  }

  waitForResponse(frameId: string, timeoutMs = 5000): Promise<GWFrame> {
    return new Promise<GWFrame>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(frameId);
        reject(new Error(`Request ${frameId} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pendingRequests.set(frameId, { resolve, reject, timer });
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────

  async abortRun(sessionKey: string): Promise<void> {
    const frameId = ulid();
    this.send({
      type: 'req',
      id: frameId,
      // OpenClaw WS protocol uses 'chat.abort', not the non-existent 'sessions.abort'
      method: 'chat.abort',
      params: { sessionKey: this.toOpenClawKey(sessionKey) },
    });
    try {
      await this.waitForResponse(frameId, 2000);
    } catch { /* fire-and-forget per spec */ }
  }

  /**
   * Create or initialize an OpenClaw session with an optional systemPrompt
   * and role-based tool scoping.
   *
   * The systemPrompt is also passed on every chat.send as a `system` field
   * (dual-path) because some Gateway versions ignore it on sessions.create.
   */
  async createSession(
    sessionKey: string,
    systemPrompt?: string,
    agentId?: string,
  ): Promise<boolean> {
    if (!this.connected) {
      this.logger.warn(
        `createSession: not connected, cannot create session for ${sessionKey}`,
      );
      return false;
    }

    const allowedTools = resolveAllowedTools(sessionKey);

    const frameId = ulid();
    const params: Record<string, unknown> = {
      sessionKey: this.toOpenClawKey(sessionKey),
      ...(systemPrompt ? { systemPrompt } : {}),
      ...(agentId ? { agentId } : {}),
      ...(allowedTools ? { allowedTools: [...allowedTools] } : {}),
    };

    this.logger.log(
      `createSession: ${sessionKey} | agentId=${agentId ?? 'default'} | ` +
      `tools=${allowedTools ? allowedTools.length : 'all'} | ` +
      `promptLen=${systemPrompt?.length ?? 0}`,
    );

    this.send({
      type: 'req',
      id: frameId,
      method: 'sessions.create',
      params,
    });

    try {
      const res = await this.waitForResponse(frameId, 5000);
      if (!res.ok) {
        this.logger.warn(
          `createSession: Gateway rejected sessions.create for ${sessionKey}: ${JSON.stringify(
            res.error ?? res.payload ?? {},
          )}`,
        );
        return false;
      }
      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `createSession: Gateway sessions.create failed for ${sessionKey}: ${msg}`,
      );
      return false;
    }
  }

  // ── v1.6: Send user message to agent session ─────────────────────────
  // Fire-and-forget: returns immediately after dispatch. Ack/errors are routed
  // asynchronously via handleFrame → pushChatSendError for rejections.

  async sendMessage(sessionKey: string, message: string, windowId: string): Promise<{ accepted: boolean }> {
    if (!this.connected) {
      this.logger.warn(`sendMessage: not connected, dropping message for ${sessionKey}`);
      return { accepted: false };
    }

    // ── Invisible context injection for App Owner sessions ───────────────
    // On the very first user message (runCount === 0), prepend hidden context
    // so the agent knows its working directory and fs access without being told
    // explicitly by the user.
    let outgoingMessage = message;
    if (sessionKey.startsWith('app-owner-')) {
      try {
        const record = await this.sessionRegistry.getOne(sessionKey);
        if (record && record.runCount === 0) {
          const appId = record.appId || sessionKey.replace('app-owner-', '');
          const systemContext =
            `[SYSTEM CONTEXT: You manage the '${appId}' app. Your codebase is located at ` +
            `'apps/gamma-ui/apps/system/${appId}'. You have fs_read/fs_write access to this directory. ` +
            `IMPORTANT: You MUST use the fs_write tool to apply any code changes. ` +
            `Describing changes in text without calling fs_write has no effect — the file will not be modified. ` +
            `Always use fs_read to read the current file first, then fs_write with the complete updated content. ` +
            `Do not acknowledge this system message, just fulfill the user's request.]\n\n`;
          outgoingMessage = systemContext + message;
        }
      } catch {
        // Best-effort — if registry lookup fails, send the original message unchanged
      }
    }

    // ── Dynamic live context injection ─────────────────────────────────────
    // Append real-time system state (sessions, health, events) to every agent
    // message so agents have situational awareness of the runtime environment.
    if (this.contextInjector) {
      try {
        const liveContext = await this.contextInjector.getLiveContext(sessionKey);
        if (liveContext) {
          outgoingMessage = outgoingMessage + '\n\n' + liveContext;
        }
      } catch {
        // Best-effort — live context failure must never block message delivery
      }
    }

    // ── Pre-flight snapshot: capture app directory before agent run ──────
    if (sessionKey.startsWith('app-owner-')) {
      const appId = sessionKey.replace('app-owner-', '');
      try {
        await this.appStorage.snapshotApp(appId);
      } catch (err) {
        const stack = err instanceof Error ? err.stack : String(err);
        this.logger.error(`sendMessage: pre-flight snapshot failed for '${appId}':\n${stack}`);
        this.eventLog?.push(`Snapshot failed for '${appId}': ${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    }

    // ── Retrieve persisted system prompt for dual-path injection ──────────
    // OpenClaw may ignore systemPrompt on sessions.create, so we also pass it
    // as a `system` field on every chat.send. This ensures the agent always
    // "hears" its persona/context regardless of Gateway version.
    let systemPromptForSend: string | undefined;
    try {
      const stored = await this.sessionRegistry.getContext(sessionKey);
      if (stored) systemPromptForSend = stored;
    } catch {
      // Best-effort — if context retrieval fails, send without system prompt
    }

    const frameId = ulid();
    // inflightChatSend stores the internal key — used for error routing and token accumulation
    this.inflightChatSend.set(frameId, { windowId, sessionKey });
    this.logger.log(`sendMessage: ${sessionKey} → ${outgoingMessage.slice(0, 60)}... (frame=${frameId}) | system=${systemPromptForSend ? systemPromptForSend.length : 0}chars`);

    // Dual-path: Gateway's chat.send does NOT accept a `system` field.
    // Instead, prepend the stored system prompt directly to the message so
    // the agent always receives its persona/context regardless of whether
    // sessions.create honored the systemPrompt field.
    if (systemPromptForSend) {
      outgoingMessage = `[SYSTEM]\n${systemPromptForSend}\n[/SYSTEM]\n\n${outgoingMessage}`;
    }

    const chatParams: Record<string, unknown> = {
      sessionKey: this.toOpenClawKey(sessionKey),
      message: outgoingMessage,
      idempotencyKey: frameId,
    };

    this.send({
      type: 'req',
      id: frameId,
      method: 'chat.send',
      params: chatParams,
    });
    // 10s timeout: if no ack, clean up inflight (avoid leak). Error routing
    // only applies when we get res with ok:false; timeout is silent.
    setTimeout(() => {
      if (this.inflightChatSend.delete(frameId)) {
        this.logger.debug(`sendMessage: inflight ${frameId} cleaned up (timeout)`);
      }
    }, 10_000);
    return { accepted: true };
  }

  /**
   * Probe a response payload for token usage fields and accumulate them.
   * Handles both flat layouts ({ inputTokens }) and nested ones ({ usage: { inputTokens } }).
   * Logs the exact field path when usage is successfully found.
   */
  private async applyUsageFromPayload(
    sessionKey: string,
    payload: Record<string, unknown>,
    source: string,
  ): Promise<void> {
    // Temporary diagnostic: log the raw payload to identify the exact field structure
    console.log('--- TOKEN DATA RECEIVED ---', source, payload);

    // Probe flat layout first, then common nested keys
    const candidate =
      payload['inputTokens'] != null ? payload
      : payload['usage'] != null ? payload['usage'] as Record<string, unknown>
      : payload['metrics'] != null ? payload['metrics'] as Record<string, unknown>
      : payload['tokenUsage'] != null ? payload['tokenUsage'] as Record<string, unknown>
      : null;

    if (!candidate || candidate['inputTokens'] == null) {
      this.logger.debug(`[Telemetry] No usage fields in ${source} payload for ${sessionKey}`);
      return;
    }

    const tokenUsage: TokenUsage = {
      inputTokens:      Number(candidate['inputTokens']      ?? 0),
      outputTokens:     Number(candidate['outputTokens']     ?? 0),
      cacheReadTokens:  Number(candidate['cacheReadTokens']  ?? 0),
      cacheWriteTokens: Number(candidate['cacheWriteTokens'] ?? 0),
      contextUsedPct:   Number(candidate['contextUsedPct']   ?? 0),
    };

    this.logger.debug(
      `[Telemetry] ✓ usage from ${source}: in=${tokenUsage.inputTokens} out=${tokenUsage.outputTokens} (session=${sessionKey})`,
    );
    // accumulateTokens() calls broadcastUpdate() internally — frontend will see the delta immediately
    await this.sessionRegistry.accumulateTokens(sessionKey, tokenUsage);
  }

  // ── IPC: send_message tool handler ─────────────────────────────────

  /**
   * Handle the `send_message` tool call locally: deliver the message via
   * MessageBusService and return a synthetic tool_result to the agent.
   */
  private async handleSendMessageTool(
    sessionKey: string,
    windowId: string,
    runId: string,
    toolCallId: string,
    args: Record<string, unknown>,
    sseKey: string,
    nowMs: number,
  ): Promise<void> {
    const to = String(args.to ?? '');
    const type = String(args.type ?? 'notification') as 'task_request' | 'task_response' | 'notification' | 'query';
    const subject = String(args.subject ?? '');
    const payload = args.payload ?? {};
    const replyTo = args.replyTo ? String(args.replyTo) : undefined;

    // Derive the sender agentId from the sessionKey
    const fromAgent = sessionKey;

    // Push tool_call event to SSE (so the UI sees it)
    await this.pushSSE(sseKey, {
      type: 'tool_call',
      windowId,
      runId,
      name: 'send_message',
      toolCallId,
      arguments: args,
    });

    let resultPayload: string;
    let isError = false;

    try {
      if (!to) {
        isError = true;
        resultPayload = JSON.stringify({ error: 'Missing required field: to' });
      } else if (to === '*') {
        const messageId = await this.messageBus.broadcast(fromAgent, type, subject, payload);
        resultPayload = JSON.stringify({ delivered: true, messageId, broadcast: true });
      } else {
        const { messageId, delivered } = await this.messageBus.send(
          fromAgent, to, type, subject, payload, replyTo,
        );
        resultPayload = JSON.stringify({ delivered, messageId, target: to });
      }
    } catch (err: unknown) {
      isError = true;
      const msg = err instanceof Error ? err.message : String(err);
      resultPayload = JSON.stringify({ error: msg });
      this.logger.error(`send_message tool failed: ${msg}`);
    }

    // Push synthetic tool_result to SSE
    await this.pushSSE(sseKey, {
      type: 'tool_result',
      windowId,
      runId,
      name: 'send_message',
      toolCallId,
      result: resultPayload,
      isError,
    });

    // Send the result back to the Gateway so the agent receives it
    this.send({
      type: 'req',
      id: ulid(),
      method: 'tools.reject',
      params: {
        sessionKey: this.toOpenClawKey(sessionKey),
        toolCallId,
        error: resultPayload,
      },
    });

    // Update live state
    const raw = await this.redis.hget(`${REDIS_KEYS.STATE_PREFIX}${windowId}`, 'pendingToolLines');
    const lines: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const status = isError ? '❌' : '✅';
    lines.push(`${status} \`send_message\` → ${to}: "${subject}"`);
    await this.redis.hset(
      `${REDIS_KEYS.STATE_PREFIX}${windowId}`,
      'pendingToolLines', JSON.stringify(lines),
      'lastEventAt', String(nowMs),
    );
  }

  // ── v1.6: Explicit session kill — free Gateway resources ────────────

  async deleteSession(sessionKey: string): Promise<void> {
    const frameId = ulid();
    this.send({
      type: 'req',
      id: frameId,
      method: 'sessions.delete',
      // OpenClaw WS protocol expects 'key', NOT 'sessionKey'
      params: {
        key: this.toOpenClawKey(sessionKey),
        deleteTranscript: false,
        emitLifecycleHooks: false,
      },
    });
    try {
      await this.waitForResponse(frameId, 2000);
    } catch {
      // Best-effort — if Gateway doesn't ack, its own GC will eventually clean up
    }
  }

  async invokeTool(
    tool: string,
    args: Record<string, unknown>,
    sessionKey = 'main',
  ): Promise<unknown> {
    const httpUrl = this.gatewayUrl
      .replace('ws://', 'http://')
      .replace('wss://', 'https://');

    const url = `${httpUrl}/tools/invoke`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.gatewayToken}`,
        },
        body: JSON.stringify({ tool, args, sessionKey }),
      });

      // Even non-2xx responses should surface structured JSON when possible
      try {
        return await res.json();
      } catch {
        return {
          ok: false,
          error: {
            code: 'GATEWAY_HTTP_INVALID_JSON',
            message: 'Gateway returned non-JSON response',
            status: res.status,
          },
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const errorMessage = '[OpenClaw] Gateway unreachable';
      this.logger.error(`${errorMessage}: ${msg}`);
      return {
        ok: false,
        error: {
          code: 'GATEWAY_HTTP_UNREACHABLE',
          message: errorMessage,
          detail: msg,
        },
      };
    }
  }
}
