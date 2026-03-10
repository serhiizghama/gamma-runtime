import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyCors from '@fastify/cors';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
  );

  // ── CORS — explicit origin allowlist (spec §11) ───────────────────────
  await app.register(fastifyCors as any, {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://100.123.78.76:5173',
      'http://sputniks-mac-mini.tailcde006.ts.net:5173',
      'https://sputniks-mac-mini.tailcde006.ts.net',
    ],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cache-Control'],
    credentials: false,
  });

  const port = parseInt(process.env['PORT'] ?? '3001', 10);
  await app.listen(port, '0.0.0.0');
}

bootstrap();
