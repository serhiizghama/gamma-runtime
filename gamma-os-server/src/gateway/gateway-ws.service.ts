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
import { classifyGatewayEventKind } from './event-classifier';

/** WS frame types received from OpenClaw Gateway (spec §3.2) */
interface GWFrame {
  type: string;
  id?: string;
  ok?: boolean;
  event?: string;
  method?: string;
  payload?: Record<string, unknown>;
  seq?: number;
}

/** Pending request awaiting a response frame */
interface PendingRequest {
  resolve: (frame: GWFrame) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

@Injectable()
export class GatewayWsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Gateway');

  private ws: WebSocket | null = null;
  private connected = false;
  private destroyed = false;

  // Reconnect state
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30_000;

  // Request/response tracking
  private pendingRequests = new Map<string, PendingRequest>();

  // Session → Window mapping (populated by SessionsService later)
  public sessionToWindow = new Map<string, string>();

  private readonly gatewayUrl: string;
  private readonly gatewayToken: string;
  private readonly deviceId: string;
  private readonly publicKey: string;
  private readonly privateKey: string;

  constructor(
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.gatewayUrl = this.config.get<string>(
      'OPENCLAW_GATEWAY_URL',
      'ws://localhost:18789',
    );
    this.gatewayToken = this.config.get<string>(
      'OPENCLAW_GATEWAY_TOKEN',
      '',
    );
    this.deviceId = this.config.get<string>(
      'GAMMA_DEVICE_ID',
      'gamma-os-bridge-001',
    );
    this.publicKey = this.config.get<string>(
      'GAMMA_DEVICE_PUBLIC_KEY',
      '',
    );
    this.privateKey = this.config.get<string>(
      'GAMMA_DEVICE_PRIVATE_KEY',
      '',
    );
  }

  async onModuleInit(): Promise<void> {
    if (!this.gatewayToken) {
      this.logger.warn(
        'OPENCLAW_GATEWAY_TOKEN not set — Gateway connection disabled',
      );
      return;
    }
    await this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.closeWs();
  }

  /** Is the Gateway WebSocket connected and authenticated? */
  isConnected(): boolean {
    return this.connected;
  }

  // ── Connection ──────────────────────────────────────────────────────────

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
        this.logger.warn(
          `WebSocket closed: ${code} ${reason.toString()}`,
        );
        this.onDisconnect();
      });

      this.ws.on('error', (err: Error) => {
        this.logger.error(`WebSocket error: ${err.message}`);
        // 'close' event will follow — reconnect happens there
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
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  // ── Reconnection with exponential backoff ──────────────────────────────

  private onDisconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;
    this.closeWs();

    // Reject all pending requests
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
    if (this.destroyed) return;
    if (this.reconnectTimer) return; // already scheduled

    this.logger.log(`Reconnecting in ${this.reconnectDelay}ms...`);

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      // Exponential backoff: 1s → 2s → 4s → ... → 30s max
      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        this.maxReconnectDelay,
      );
      await this.connect();
    }, this.reconnectDelay);
  }

  private onAuthenticated(): void {
    this.connected = true;
    this.reconnectDelay = 1000; // reset backoff on success
    this.logger.log('Connected and authenticated');
    this.broadcastGatewayStatus('connected');
  }

  // ── Frame handling ─────────────────────────────────────────────────────

  private handleFrame(frame: GWFrame): void {
    // Response to a pending request
    if (frame.type === 'res' && frame.id) {
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(frame.id);
        pending.resolve(frame);
      }
      return;
    }

    // Challenge → initiate handshake
    if (
      frame.type === 'event' &&
      frame.event === 'connect.challenge'
    ) {
      this.handleChallenge(frame).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Handshake failed: ${msg}`);
        this.closeWs();
        this.scheduleReconnect();
      });
      return;
    }

    // Classify runtime events (spec §5.2)
    if (frame.type === 'event' && frame.event) {
      const kind = classifyGatewayEventKind(frame.event);

      switch (kind) {
        case 'runtime-agent':
          // Will be implemented in Task 2.3 (Event Bridge)
          break;
        case 'runtime-chat':
          break;
        case 'summary-refresh':
          // heartbeat/presence — no action needed yet
          break;
        case 'ignore':
          break;
      }
    }
  }

  // ── Ed25519 Handshake (spec §5.1) ─────────────────────────────────────

  private async handleChallenge(frame: GWFrame): Promise<void> {
    const nonce = frame.payload?.['nonce'] as string | undefined;
    if (!nonce) {
      throw new Error('Challenge frame missing nonce');
    }

    this.logger.log('Received challenge, signing nonce...');

    const signature = this.signChallenge(nonce);
    const signedAt = Date.now();
    const frameId = ulid();

    this.send({
      type: 'req',
      id: frameId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: 'gamma-os-bridge',
          version: '1.0.0',
          platform: 'macos',
          mode: 'operator',
        },
        role: 'operator',
        scopes: ['operator.read', 'operator.write'],
        auth: { token: this.gatewayToken },
        device: {
          id: this.deviceId,
          publicKey: this.publicKey,
          signature,
          signedAt,
          nonce,
        },
      },
    });

    // Wait for hello-ok response
    const response = await this.waitForResponse(frameId, 5000);
    if (response.ok) {
      this.onAuthenticated();
    } else {
      throw new Error(
        `Authentication rejected: ${JSON.stringify(response.payload)}`,
      );
    }
  }

  private signChallenge(nonce: string): string {
    if (!this.privateKey) {
      throw new Error(
        'GAMMA_DEVICE_PRIVATE_KEY not configured — cannot sign challenge',
      );
    }

    const privateKeyBytes = Buffer.from(this.privateKey, 'base64');
    const messageBytes = new TextEncoder().encode(nonce);
    // @noble/ed25519 v3: sign() is synchronous
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
        reject(
          new Error(`Request ${frameId} timed out after ${timeoutMs}ms`),
        );
      }, timeoutMs);

      this.pendingRequests.set(frameId, { resolve, reject, timer });
    });
  }

  // ── Gateway status broadcast (spec §7.2) ───────────────────────────────

  private broadcastGatewayStatus(
    status: 'connected' | 'disconnected',
  ): void {
    const entry = {
      type: 'gateway_status',
      status,
      ts: String(Date.now()),
    };

    const args: string[] = [];
    for (const [k, v] of Object.entries(entry)) {
      args.push(k, v);
    }

    this.redis
      .xadd('gamma:sse:broadcast', '*', ...args)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`Failed to broadcast gateway_status: ${msg}`);
      });
  }

  // ── Public API for other services ──────────────────────────────────────

  /**
   * Abort a running agent session (spec §4.2).
   * Fire-and-forget with 2s timeout for ack.
   */
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
    } catch {
      // Gateway may not ack abort — acceptable per spec
    }
  }

  /**
   * Invoke a tool on the Gateway (spec §5.1).
   */
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
