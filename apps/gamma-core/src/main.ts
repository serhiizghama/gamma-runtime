import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCors from '@fastify/cors';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // ── TLS + HTTP/2 ──────────────────────────────────────────────────────
  // Resolve certs relative to the monorepo root (two levels up from src/).
  const repoRoot = join(__dirname, '..', '..', '..');
  const keyPath = join(repoRoot, 'certs', 'localhost.key');
  const certPath = join(repoRoot, 'certs', 'localhost.cert');

  const hasCerts = existsSync(keyPath) && existsSync(certPath);

  const adapterOpts: Record<string, unknown> = { logger: true };

  if (hasCerts) {
    adapterOpts.http2 = true;
    adapterOpts.https = {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
      allowHTTP1: true,  // graceful fallback for clients that don't speak h2
    };
  }

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(adapterOpts),
  );

  // ── CORS — explicit origin allowlist (spec §11) ───────────────────────
  const protocol = hasCerts ? 'https' : 'http';
  await app.register(fastifyCors as any, {
    origin: [
      `${protocol}://localhost:5173`,
      `${protocol}://127.0.0.1:5173`,
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://100.123.78.76:5173',
      'http://sputniks-mac-mini.tailcde006.ts.net:5173',
      'https://sputniks-mac-mini.tailcde006.ts.net:5173',
      'https://sputniks-mac-mini.tailcde006.ts.net',
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
    credentials: false,
  });

  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen(port, '0.0.0.0');

  const url = `${protocol}://localhost:${port}`;
  console.log(`Gamma Core listening on ${url} (HTTP/${hasCerts ? '2' : '1.1'})`);
}

bootstrap();
