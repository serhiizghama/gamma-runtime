import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import * as ed from '@noble/ed25519';
import { ulid } from 'ulid';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import {
  classifyGatewayEventKind,
  isReasoningStream,
} from './event-classifier';
import type { GWAgentEventPayload } from '@gamma/types';
// REDIS_KEYS available from @gamma/types when needed

// ── Local types ───────────────────────────────────────────────────────────

interface GWFrame {
  type: string;
  id?: string;
  ok?: boolean;
  event?: string;
  method?: string;
  payload?: Record<string, unknown>;
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

  // ── Hierarchy tracking for memory bus (spec §3.6) ──
  // Maps runId → { seq, lastThinkingStepId, toolCallStepIds }
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
  private readonly deviceId: string;
  private readonly publicKey: string;
  private readonly privateKey: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.gatewayUrl = this.config.get('OPENCLAW_GATEWAY_URL', 'ws://localhost:18789');
    this.gatewayToken = this.config.get('OPENCLAW_GATEWAY_TOKEN', '');
    this.deviceId = this.config.get('GAMMA_DEVICE_ID', 'gamma-os-bridge-001');
    this.publicKey = this.config.get('GAMMA_DEVICE_PUBLIC_KEY', '');
    this.privateKey = this.config.get('GAMMA_DEVICE_PRIVATE_KEY', '');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    if (!this.gatewayToken) {
      this.logger.warn('OPENCLAW_GATEWAY_TOKEN not set — Gateway connection disabled');
      return;
    }
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
      const kind = classifyGatewayEventKind(frame.event);

      if (kind === 'runtime-agent') {
        this.handleAgentEvent(frame.payload as unknown as GWAgentEventPayload).catch(
          (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`Event bridge error: ${msg}`);
          },
        );
      }
      // runtime-chat, summary-refresh, ignore — no-op for now
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ══  PHASE-AWARE EVENT BRIDGE (spec §6)  ═════════════════════════════
  // ══════════════════════════════════════════════════════════════════════

  private async handleAgentEvent(payload: GWAgentEventPayload): Promise<void> {
    const windowId = this.sessionToWindow.get(payload.sessionKey);
    if (!windowId) return; // no mapping — ignore

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

        await this.pushSSE(sseKey, {
          type: 'lifecycle_start',
          windowId,
          runId,
        });

        // Update Redis live state (spec §4.1)
        await this.redis.hset(
          `gamma:state:${windowId}`,
          'status', 'running',
          'runId', runId,
          'lastEventAt', String(nowMs),
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

        await this.pushSSE(sseKey, {
          type: 'lifecycle_end',
          windowId,
          runId,
          stopReason: 'stop',
          ...(tokenUsage ? { tokenUsage } : {}),
        });

        // Clear live state
        await this.redis.hset(
          `gamma:state:${windowId}`,
          'status', 'idle',
          'runId', '',
          'streamText', '',
          'thinkingTrace', '',
          'pendingToolLines', '[]',
          'lastEventAt', String(nowMs),
        );

        // Cleanup run tracking
        this.runStepCounters.delete(runId);
        return;
      }

      if (phase === 'error') {
        await this.pushSSE(sseKey, {
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
        );

        this.runStepCounters.delete(runId);
        return;
      }

      return;
    }

    // ── THINKING / REASONING STREAMS ────────────────────────────────────
    if (stream === 'thinking' || isReasoningStream(stream)) {
      const text = data?.text ?? data?.delta ?? '';
      if (!text) return;

      await this.pushSSE(sseKey, {
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
      const text = data?.text ?? data?.delta ?? '';

      // Intercept embedded thinking (e.g. <think> tags)
      if (thinkingContent) {
        await this.pushSSE(sseKey, {
          type: 'thinking',
          windowId,
          runId,
          text: thinkingContent,
        });

        await this.redis.hset(
          `gamma:state:${windowId}`,
          'thinkingTrace', thinkingContent,
          'lastEventAt', String(nowMs),
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

      if (text) {
        await this.pushSSE(sseKey, {
          type: 'assistant_delta',
          windowId,
          runId,
          text,
        });

        await this.redis.hset(
          `gamma:state:${windowId}`,
          'streamText', text,
          'lastEventAt', String(nowMs),
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
        await this.pushSSE(sseKey, {
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
        );

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
        // Tool result received
        await this.pushSSE(sseKey, {
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
  ): Promise<void> {
    await this.redis.xadd(streamKey, '*', ...flattenEntry(event));
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
    if (!nonce) throw new Error('Challenge frame missing nonce');

    this.logger.log('Received challenge, signing nonce...');

    const signature = this.signChallenge(nonce);
    const frameId = ulid();

    this.send({
      type: 'req',
      id: frameId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: { id: 'gamma-os-bridge', version: '1.0.0', platform: 'macos', mode: 'operator' },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth: { token: this.gatewayToken },
        device: {
          id: this.deviceId,
          publicKey: this.publicKey,
          signature,
          signedAt: Date.now(),
          nonce,
        },
      },
    });

    const response = await this.waitForResponse(frameId, 5000);
    if (response.ok) {
      this.onAuthenticated();
    } else {
      throw new Error(`Authentication rejected: ${JSON.stringify(response.payload)}`);
    }
  }

  private signChallenge(nonce: string): string {
    if (!this.privateKey) {
      throw new Error('GAMMA_DEVICE_PRIVATE_KEY not configured');
    }
    const privateKeyBytes = Buffer.from(this.privateKey, 'base64');
    const messageBytes = new TextEncoder().encode(nonce);
    const signatureBytes = ed.sign(messageBytes, privateKeyBytes);
    return Buffer.from(signatureBytes).toString('base64');
  }

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
