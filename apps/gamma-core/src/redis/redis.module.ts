import {
  Global,
  Module,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: ConfigService): Redis => {
        const url = config.get<string>('REDIS_URL', 'redis://localhost:6379');
        return new Redis(url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true, // connect explicitly in onModuleInit
        });
      },
      inject: [ConfigService],
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Redis');

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.connect();
      const url = this.redis.options.host ?? 'localhost';
      const port = this.redis.options.port ?? 6379;
      this.logger.log(`Connected to redis://${url}:${port}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to connect to Redis: ${message}`);
      this.logger.error('Exiting — Redis is required for Gamma Agent Runtime');
      process.exit(1);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.logger.log('Disconnecting...');
    await this.redis.quit();
  }
}
