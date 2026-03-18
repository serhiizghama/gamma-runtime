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
  private readonly TOKEN_TTL_MS  = 60_000;
  private readonly AUTH_TIMEOUT_MS = 5_000; // max wait for auth message after WS open

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
    // Use noServer mode to avoid EADDRINUSE with Fastify HTTP/2.
    // We manually handle the 'upgrade' event on the underlying server.
    const httpServer = this.httpAdapterHost.httpAdapter.getHttpServer() as http.Server;

    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req);
    });

    httpServer.on('upgrade', (req: http.IncomingMessage, socket: import('stream').Duplex, head: Buffer) => {
      const pathname = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`).pathname;
      if (pathname === '/pty') {
        this.wss!.handleUpgrade(req, socket, head, (ws) => {
          this.wss!.emit('connection', ws, req);
        });
      }
      // Non-/pty upgrades are left for other handlers (e.g. Vite HMR proxy)
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

    // DEF-1 fix: token is NO LONGER read from the URL query string.
    // The client must send { type: "auth", token } as the first WS message.
    // cols/rows are still in query params (not sensitive).
    const cols = Math.max(10, Math.min(500, parseInt(url.searchParams.get('cols') ?? '220', 10)));
    const rows = Math.max(5,  Math.min(200, parseInt(url.searchParams.get('rows') ?? '50',  10)));

    // Auth timeout — close if no valid auth message arrives within AUTH_TIMEOUT_MS
    const authTimeout = setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.logger.warn(`PTY: auth timeout from ${req.socket.remoteAddress}`);
        ws.close(4401, 'Auth timeout');
      }
    }, this.AUTH_TIMEOUT_MS);

    // Single-use first-message listener for auth handshake
    const onFirstMessage = (raw: Buffer | string): void => {
      try {
        const msg = JSON.parse(raw.toString()) as { type?: string; token?: unknown };
        if (msg.type !== 'auth' || typeof msg.token !== 'string') {
          clearTimeout(authTimeout);
          this.logger.warn(`PTY: invalid auth message from ${req.socket.remoteAddress}`);
          ws.close(4401, 'Unauthorized');
          return;
        }

        if (!this.consumeToken(msg.token)) {
          clearTimeout(authTimeout);
          this.logger.warn(`PTY: rejected bad/expired token from ${req.socket.remoteAddress}`);
          ws.close(4401, 'Unauthorized');
          return;
        }

        clearTimeout(authTimeout);
        // Auth OK — remove this one-shot listener and start PTY session
        ws.off('message', onFirstMessage);
        this.startPtySession(ws, req, cols, rows);
      } catch {
        clearTimeout(authTimeout);
        ws.close(4401, 'Unauthorized');
      }
    };

    ws.on('message', onFirstMessage);

    ws.on('error', (err) => {
      clearTimeout(authTimeout);
      this.logger.error(`PTY WS pre-auth error: ${err.message}`);
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
    });
  }

  private startPtySession(ws: WebSocket, _req: http.IncomingMessage, cols: number, rows: number): void {
    const shell = process.env.SHELL ?? '/bin/zsh';
    const cwd   = homedir();

    // Sanitize environment — strip secrets before passing to the PTY shell.
    // The spawned shell should have a clean user environment, not the server's
    // credentials (gateway tokens, Redis URLs, private keys, etc.).
    const SENSITIVE_PREFIXES = ['OPENCLAW_', 'GAMMA_DEVICE_', 'REDIS_', 'SCAFFOLD_'];
    const SENSITIVE_EXACT = ['GATEWAY_SCOPES', 'ALLOWED_ORIGINS'];
    const sanitizedEnv: Record<string, string> = {};
    for (const [key, val] of Object.entries(process.env)) {
      if (val === undefined) continue;
      if (SENSITIVE_EXACT.includes(key)) continue;
      if (SENSITIVE_PREFIXES.some((p) => key.startsWith(p))) continue;
      sanitizedEnv[key] = val;
    }

    let ptyProcess: nodePty.IPty;
    try {
      ptyProcess = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: sanitizedEnv,
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
