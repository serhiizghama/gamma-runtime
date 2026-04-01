/**
 * Thin HTTP/2 reverse proxy in front of Vite dev server.
 *
 * Browser  --[HTTP/2, port 5173]-->  h2-proxy  --[HTTP/1.1, port 5174]-->  Vite
 *
 * This gives the browser true HTTP/2 multiplexing, eliminating the 6-connection
 * limit that causes SSE connections to starve regular fetch requests.
 *
 * Usage:
 *   1. Start Vite on port 5174:  pnpm dev --port 5174
 *   2. Start this proxy:         node scripts/h2-proxy.mjs
 *   3. Open https://localhost:5173 in browser
 */

import http2 from 'http2';
import http from 'http';
import https from 'https';
import net from 'net';
import tls from 'tls';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const KEY_PATH  = path.join(REPO_ROOT, 'certs', 'tailscale.key');
const CERT_PATH = path.join(REPO_ROOT, 'certs', 'tailscale.crt');

if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
  console.error('Certificates not found. Run ./scripts/generate-certs.sh first.');
  process.exit(1);
}

const PROXY_PORT  = parseInt(process.env.H2_PORT ?? '5173', 10);
const VITE_PORT   = parseInt(process.env.VITE_PORT ?? '5174', 10);
const CORE_PORT   = parseInt(process.env.CORE_PORT ?? '3001', 10);
// gamma-core runs HTTPS/HTTP2 — backend WS connections must use TLS
const CORE_TLS    = true;
// Vite runs as plain HTTP when started with H2_PROXY=1
const VITE_HTTPS  = false;
const viteAgent   = undefined;

const server = http2.createSecureServer({
  key:          fs.readFileSync(KEY_PATH),
  cert:         fs.readFileSync(CERT_PATH),
  allowHTTP1:   true, // graceful fallback for HTTP/1.1 clients
  // Increase flow control window so SSE streams don't stall under backpressure
  settings: {
    initialWindowSize: 1024 * 1024, // 1MB (default 65535)
  },
});

server.on('stream', (stream, headers) => {
  const method  = headers[':method'] ?? 'GET';
  const path_   = headers[':path']   ?? '/';

  const transport = http;
  const options = {
    hostname: '127.0.0.1',
    port:     VITE_PORT,
    path:     path_,
    method,
    headers:  buildForwardHeaders(headers),
  };

  // HTTP/1.1 connection-specific headers must be stripped before forwarding
  // to an HTTP/2 stream (Node.js http2 will throw ERR_HTTP2_INVALID_CONNECTION_HEADERS).
  const H1_ONLY_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-connection',
    'transfer-encoding', 'upgrade',
  ]);

  const proxy = transport.request(options, (res) => {
    const replyHeaders = { ':status': res.statusCode ?? 200 };
    for (const [k, v] of Object.entries(res.headers)) {
      if (H1_ONLY_HEADERS.has(k.toLowerCase())) continue;
      replyHeaders[k] = v;
    }
    if (!stream.destroyed) {
      stream.respond(replyHeaders);
      res.pipe(stream);

      // For SSE streams (text/event-stream), disable socket timeout so
      // long-lived connections aren't killed by Node.js idle timeout.
      const contentType = res.headers['content-type'] ?? '';
      if (contentType.includes('text/event-stream')) {
        proxy.setTimeout(0);
        // Flush immediately on each chunk — SSE must not be buffered
        res.on('data', () => { if (!stream.destroyed) stream.setDefaultEncoding('utf8'); });
      }
    }
  });

  proxy.on('error', (err) => {
    if (!stream.destroyed) {
      stream.respond({ ':status': 502 });
      stream.end(`Bad Gateway: ${err.message}`);
    }
  });

  stream.pipe(proxy);
});

// ── WebSocket upgrade handler ──────────────────────────────────────────────────
// Forward ALL WS upgrades to Vite (plain HTTP, port 5174).
// Vite's proxy config already handles:
//   /pty  → wss://localhost:3001  (PTY shell)
//   HMR   → internal Vite WS
server.on('upgrade', (req, socket, head) => {
  const backend = net.connect(VITE_PORT, '127.0.0.1', () => {
    const headerLines = Object.entries(req.headers)
      .filter(([k]) => k !== 'host')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\r\n');

    backend.write(
      `GET ${req.url} HTTP/1.1\r\n` +
      `Host: 127.0.0.1:${VITE_PORT}\r\n` +
      headerLines + '\r\n\r\n'
    );
    if (head?.length) backend.write(head);
  });

  backend.on('error', (err) => {
    console.error(`[h2-proxy] WS upgrade error (→ Vite:${VITE_PORT}):`, err.message);
    socket.destroy();
  });

  socket.on('error', () => backend.destroy());

  // Bidirectional pipe — Vite handles the 101 + proxies frames to core
  backend.pipe(socket);
  socket.pipe(backend);
});

// HTTP/2 streams that use unknownProtocol (non-WS) — still destroy
server.on('unknownProtocol', (socket) => {
  socket.destroy();
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[h2-proxy] Port ${PROXY_PORT} in use — retrying in 3s...`);
    setTimeout(() => {
      server.close();
      server.listen(PROXY_PORT, '0.0.0.0');
    }, 3000);
  } else {
    console.error('[h2-proxy] Server error:', err);
    process.exit(1);
  }
});

server.listen(PROXY_PORT, '0.0.0.0', () => {
  console.log(`HTTP/2 proxy listening on https://0.0.0.0:${PROXY_PORT}`);
  console.log(`Forwarding to Vite on http://127.0.0.1:${VITE_PORT}`);
  console.log(`Open: https://sputniks-mac-mini.tailcde006.ts.net:${PROXY_PORT}`);
});

function buildForwardHeaders(h2headers) {
  const out = {};
  for (const [k, v] of Object.entries(h2headers)) {
    if (k.startsWith(':')) continue; // strip pseudo-headers
    out[k] = v;
  }
  out['host'] = `127.0.0.1:${VITE_PORT}`;
  return out;
}
