import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
// crypto reserved for future device auth signing
import { ulid } from 'ulid';
import { REDIS_KEYS } from '@gamma/types';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  classifyGatewayEventKind,
  isReasoningStream,
} from './event-classifier';
import { ToolWatchdogService } from './tool-watchdog.service';
import type { GWAgentEventPayload, WindowSession } from '@gamma/types';

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
  ) {
    this.gatewayUrl = this.config.get('OPENCLAW_GATEWAY_URL', 'ws://localhost:18789');
    this.gatewayToken = this.config.get('OPENCLAW_GATEWAY_TOKEN', '');
    // Device identity reserved for future paired device auth
    // this.deviceId = this.config.get('GAMMA_DEVICE_ID', 'gamma-os-bridge-001');
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

      this.ws.on('error', (err: Error) => {
        this.logger.error(`WebSocket error: ${err.message}`);
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
    // Response to pending request
    if (frame.type === 'res' && frame.id) {
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
    // Normalize session key
    let sessionKey = payload.sessionKey;
    if (sessionKey.startsWith('agent:main:')) {
      sessionKey = sessionKey.replace('agent:main:', '');
    } else if (sessionKey.startsWith('agent:')) {
      sessionKey = sessionKey.replace(/^agent:[^:]+:/, '');
    }

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
    const windowId = this.sessionToWindow.get(sessionKey);
    if (!windowId) {
      this.logger.warn(`agentEvent: no window mapping for sessionKey=${sessionKey}, known=[${[...this.sessionToWindow.keys()]}]`);
      return;
    }

    const { stream, data, runId } = payload;
    const sseKey = `gamma:sse:${windowId}`;
    const nowMs = Date.now();

    // Event lag tracking (for system health / observability)
    if (payload.ts && payload.ts > 0) {
      const lagMs = nowMs - payload.ts;
      if (lagMs >= 0) {
        this.redis
          .pipeline()
          .lpush('gamma:metrics:event_lag', lagMs)
          .ltrim('gamma:metrics:event_lag', 0, 99)
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
          `gamma:state:${windowId}`,
          'status', 'running',
          'runId', runId,
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
          'streamText', '',
          'thinkingTrace', '',
          'pendingToolLines', '[]',
        );
        await this.redis.expire(`gamma:state:${windowId}`, 14400); // 4h TTL
        return;
      }

      if (phase === 'end') {
        // Extract tokenUsage (v1.4)
        const tokenUsage =
          data?.inputTokens != null
            ? {
                inputTokens: Number(data.inputTokens ?? 0),
                outputTokens: Number(data.outputTokens ?? 0),
                cacheReadTokens: Number(data.cacheReadTokens ?? 0),
                cacheWriteTokens: Number(data.cacheWriteTokens ?? 0),
                contextUsedPct: Number(data.contextUsedPct ?? 0),
              }
            : undefined;

        const eventId = await this.pushSSE(sseKey, {
          type: 'lifecycle_end',
          windowId,
          runId,
          stopReason: 'stop',
          ...(tokenUsage ? { tokenUsage } : {}),
        });

        // Clear live state but keep lastEventId for gap protection
        await this.redis.hset(
          `gamma:state:${windowId}`,
          'status', 'idle',
          'runId', '',
          'streamText', '',
          'thinkingTrace', '',
          'pendingToolLines', '[]',
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );
        await this.redis.expire(`gamma:state:${windowId}`, 14400); // 4h TTL

        // Cleanup run tracking + watchdog timers
        this.runStepCounters.delete(runId);
        this.toolWatchdog.clearWindow(windowId);
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
          `gamma:state:${windowId}`,
          'status', 'error',
          'runId', '',
          'lastEventAt', String(nowMs),
          'lastEventId', eventId,
        );

        this.runStepCounters.delete(runId);
        this.toolWatchdog.clearWindow(windowId);
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
        `gamma:state:${windowId}`,
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
          `gamma:state:${windowId}`,
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
          `gamma:state:${windowId}`,
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
        const raw = await this.redis.hget(`gamma:state:${windowId}`, 'pendingToolLines');
        const lines: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        lines.push(`🔧 \`${name}\`(${JSON.stringify(data?.arguments ?? {})})`);
        await this.redis.hset(
          `gamma:state:${windowId}`,
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
              `gamma:state:${windowId}`,
              'status', 'error',
              'runId', '',
              'lastEventAt', String(Date.now()),
              'lastEventId', errEventId,
            );
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
        const raw = await this.redis.hget(`gamma:state:${windowId}`, 'pendingToolLines');
        const lines: string[] = raw ? (JSON.parse(raw) as string[]) : [];
        const status = data?.isError ? '❌' : '✅';
        lines.push(`${status} \`${name}\` → ${JSON.stringify(data?.result ?? null)}`);
        await this.redis.hset(
          `gamma:state:${windowId}`,
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

  private async pushMemoryBus(entry: {
    sessionKey: string;
    windowId: string;
    kind: string;
    content: string;
    ts: number;
    stepId: string;
    parentId?: string;
  }): Promise<void> {
    await this.redis.xadd(
      'gamma:memory:bus',
      '*',
      ...flattenEntry({
        id: ulid(),
        ...entry,
      }),
    );
  }

  // ── Gateway status broadcast (spec §7.2) ──────────────────────────────

  private broadcastGatewayStatus(status: 'connected' | 'disconnected'): void {
    this.redis
      .xadd('gamma:sse:broadcast', '*', ...flattenEntry({
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
      scopes: ['operator.admin'],
      auth: {
        token: this.gatewayToken,
      },
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
    this.ws.send(JSON.stringify(data));
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
      method: 'sessions.abort',
      params: { sessionKey },
    });
    try {
      await this.waitForResponse(frameId, 2000);
    } catch { /* fire-and-forget per spec */ }
  }

  // ── v1.6: Send user message to agent session ─────────────────────────

  async sendMessage(sessionKey: string, message: string): Promise<void> {
    if (!this.connected) {
      this.logger.warn(`sendMessage: not connected, dropping message for ${sessionKey}`);
      return;
    }
    const frameId = ulid();
    this.logger.log(`sendMessage: ${sessionKey} → ${message.slice(0, 60)}... (frame=${frameId})`);
    this.send({
      type: 'req',
      id: frameId,
      method: 'chat.send',
      params: { sessionKey, message, idempotencyKey: frameId },
    });
    try {
      const response = await this.waitForResponse(frameId, 10000);
      this.logger.log(`sendMessage response: ${JSON.stringify(response).slice(0, 200)}`);
    } catch (err) {
      this.logger.warn(`sendMessage: no ack within timeout for ${sessionKey}: ${err}`);
    }
  }

  // ── v1.6: Explicit session kill — free Gateway resources ────────────

  async deleteSession(sessionKey: string): Promise<void> {
    const frameId = ulid();
    this.send({
      type: 'req',
      id: frameId,
      method: 'sessions.delete',
      params: { sessionKey },
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

    const res = await fetch(`${httpUrl}/tools/invoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.gatewayToken}`,
      },
      body: JSON.stringify({ tool, args, sessionKey }),
    });
    return res.json();
  }
}
