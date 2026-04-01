import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.setGlobalPrefix('api');
  app.enableCors();

  const port = process.env.CORE_PORT ?? 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Gamma Core running on http://localhost:${port}`);
}

bootstrap();
