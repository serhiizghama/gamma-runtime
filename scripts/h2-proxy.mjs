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
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const KEY_PATH  = path.join(REPO_ROOT, 'certs', 'localhost.key');
const CERT_PATH = path.join(REPO_ROOT, 'certs', 'localhost.cert');

if (!fs.existsSync(KEY_PATH) || !fs.existsSync(CERT_PATH)) {
  console.error('Certificates not found. Run ./scripts/generate-certs.sh first.');
  process.exit(1);
}

const PROXY_PORT = parseInt(process.env.H2_PORT ?? '5173', 10);
const VITE_PORT  = parseInt(process.env.VITE_PORT ?? '5174', 10);

const server = http2.createSecureServer({
  key:          fs.readFileSync(KEY_PATH),
  cert:         fs.readFileSync(CERT_PATH),
  allowHTTP1:   true, // graceful fallback for HTTP/1.1 clients
});

server.on('stream', (stream, headers) => {
  const method  = headers[':method'] ?? 'GET';
  const path_   = headers[':path']   ?? '/';

  const options = {
    hostname: '127.0.0.1',
    port:     VITE_PORT,
    path:     path_,
    method,
    headers: buildForwardHeaders(headers),
  };

  const proxy = http.request(options, (res) => {
    const replyHeaders = { ':status': res.statusCode ?? 200 };
    for (const [k, v] of Object.entries(res.headers)) {
      if (k.toLowerCase() === 'transfer-encoding') continue; // strip TE for h2
      replyHeaders[k] = v;
    }
    stream.respond(replyHeaders);
    res.pipe(stream);
  });

  proxy.on('error', (err) => {
    if (!stream.destroyed) {
      stream.respond({ ':status': 502 });
      stream.end(`Bad Gateway: ${err.message}`);
    }
  });

  stream.pipe(proxy);
});

// Handle WebSocket upgrades (Vite HMR)
server.on('unknownProtocol', (socket) => {
  socket.destroy();
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
