import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import * as nodePty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { randomBytes } from 'crypto';
import * as http from 'http';
import { homedir } from 'os';

interface PtySession {
  pty: nodePty.IPty;
  ws: WebSocket;
  id: string;
}

@Injectable()
export class PtyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('PtyService');

  private wss: WebSocketServer | null = null;
  private sessions = new Map<string, PtySession>();
  // One-time tokens: token → expiry timestamp
  private pendingTokens = new Map<string, number>();
  private readonly TOKEN_TTL_MS = 60_000;

  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
  ) {}

  // ── Token management ───────────────────────────────────────────────────

  generateToken(): string {
    // Clean up stale tokens
    const now = Date.now();
    for (const [t, expiry] of this.pendingTokens) {
      if (now > expiry) this.pendingTokens.delete(t);
    }
    const token = randomBytes(24).toString('hex');
    this.pendingTokens.set(token, now + this.TOKEN_TTL_MS);
    return token;
  }

  private consumeToken(token: string): boolean {
    const expiry = this.pendingTokens.get(token);
    if (!expiry) return false;
    this.pendingTokens.delete(token); // one-time use
    if (Date.now() > expiry) return false;
    return true;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────

  onModuleInit(): void {
    // Attach raw WS server to the underlying HTTP server (Fastify-compatible)
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as http.Server;

    this.wss = new WebSocketServer({ server: httpServer, path: '/pty' });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    this.logger.log('PTY WebSocket server ready at ws://.../pty');
  }

  onModuleDestroy(): void {
    for (const session of this.sessions.values()) {
      try { session.pty.kill(); } catch { /* ignore */ }
      try { session.ws.close(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.wss?.close();
  }

  // ── Connection handler ─────────────────────────────────────────────────

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const token = url.searchParams.get('token') ?? '';

    if (!this.consumeToken(token)) {
      this.logger.warn(`PTY: rejected unauthorized connection from ${req.socket.remoteAddress}`);
      ws.close(4401, 'Unauthorized');
      return;
    }

    // Read initial terminal size from query params (optional)
    const cols = Math.max(10, Math.min(500, parseInt(url.searchParams.get('cols') ?? '220', 10)));
    const rows = Math.max(5,  Math.min(200, parseInt(url.searchParams.get('rows') ?? '50',  10)));

    const shell = process.env.SHELL ?? '/bin/zsh';
    const cwd   = homedir();

    let ptyProcess: nodePty.IPty;
    try {
      ptyProcess = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`PTY spawn failed: ${msg}`);
      ws.close(4500, 'PTY spawn failed');
      return;
    }

    const id = randomBytes(8).toString('hex');
    this.sessions.set(id, { pty: ptyProcess, ws, id });
    this.logger.log(`PTY session opened: ${id} (pid=${ptyProcess.pid}, shell=${shell})`);

    // ── pty → ws (output) ──────────────────────────────────────────────
    ptyProcess.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'data', data }));
        } catch { /* ignore — ws may have closed */ }
      }
    });

    ptyProcess.onExit(({ exitCode, signal }) => {
      this.logger.log(`PTY session exited: ${id} (code=${exitCode}, signal=${signal})`);
      this.sessions.delete(id);
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: 'exit', code: exitCode }));
          ws.close(1000, 'Shell exited');
        } catch { /* ignore */ }
      }
    });

    // ── ws → pty (input + resize) ──────────────────────────────────────
    ws.on('message', (raw: Buffer | string) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; data?: string; cols?: number; rows?: number };
        if (msg.type === 'data' && typeof msg.data === 'string') {
          ptyProcess.write(msg.data);
        } else if (msg.type === 'resize' && msg.cols && msg.rows) {
          const c = Math.max(10, Math.min(500, msg.cols));
          const r = Math.max(5,  Math.min(200, msg.rows));
          ptyProcess.resize(c, r);
        }
      } catch { /* malformed message — ignore */ }
    });

    ws.on('close', () => {
      this.logger.log(`PTY WS closed: ${id}`);
      this.sessions.delete(id);
      try { ptyProcess.kill(); } catch { /* already exited */ }
    });

    ws.on('error', (err) => {
      this.logger.error(`PTY WS error [${id}]: ${err.message}`);
    });
  }

  // ── Stats (optional, for health/debug) ────────────────────────────────

  getActiveSessionCount(): number {
    return this.sessions.size;
  }
}
