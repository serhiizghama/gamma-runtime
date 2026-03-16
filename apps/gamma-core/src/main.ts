import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { ValidationPipe, Logger } from '@nestjs/common';
import fastifyCors from '@fastify/cors';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // ── TLS + HTTP/2 ──────────────────────────────────────────────────────
  // Resolve certs relative to the monorepo root.
  // dist path: dist/ — need 3 levels up to reach repo root (dist → gamma-core → apps → root).
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

  // ── CORS — origin allowlist from ALLOWED_ORIGINS env (spec §11) ────────
  const protocol = hasCerts ? 'https' : 'http';
  const envOrigins = process.env['ALLOWED_ORIGINS'];
  const origins: string[] = envOrigins
    ? envOrigins.split(',').map((o) => o.trim()).filter(Boolean)
    : [
        `${protocol}://localhost:5173`,
        `${protocol}://127.0.0.1:5173`,
        'http://localhost:5173',
        'http://127.0.0.1:5173',
      ];
  await app.register(fastifyCors as any, {
    origin: origins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control', 'X-Gamma-System-Token'],
    credentials: false,
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen(port, '0.0.0.0');

  const url = `${protocol}://localhost:${port}`;
  console.log(`Gamma Core listening on ${url} (HTTP/${hasCerts ? '2' : '1.1'})`);
}

bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Failed to start Gamma Core', err);
  process.exit(1);
});
