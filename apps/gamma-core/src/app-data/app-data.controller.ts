import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Inject,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

const MAX_VALUE_SIZE = 65_536; // 64 KB
const MAX_KEYS_PER_APP = 50;
const KEY_PREFIX = 'gamma:app-data';

@Controller('api/app-data')
export class AppDataController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Get(':appId/:key')
  async get(
    @Param('appId') appId: string,
    @Param('key') key: string,
  ): Promise<{ value: unknown }> {
    const safeAppId = appId.replace(/[^a-z0-9-]/gi, '');
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '');
    if (!safeAppId) throw new BadRequestException('Invalid appId');
    if (!safeKey) throw new BadRequestException('Invalid key');

    const raw = await this.redis.get(`${KEY_PREFIX}:${safeAppId}:${safeKey}`);
    return { value: raw ? (JSON.parse(raw) as unknown) : null };
  }

  @Put(':appId/:key')
  async put(
    @Param('appId') appId: string,
    @Param('key') key: string,
    @Body() body: { value: unknown },
  ): Promise<{ ok: true }> {
    const safeAppId = appId.replace(/[^a-z0-9-]/gi, '');
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '');
    if (!safeAppId) throw new BadRequestException('Invalid appId');
    if (!safeKey) throw new BadRequestException('Invalid key');
    const redisKey = `${KEY_PREFIX}:${safeAppId}:${safeKey}`;

    // Enforce size limit
    const serialized = JSON.stringify(body.value);
    if (serialized.length > MAX_VALUE_SIZE) {
      throw new BadRequestException(
        `Value too large for app-data key (${serialized.length} chars, max ${MAX_VALUE_SIZE})`,
      );
    }

    // Enforce key limit — only check if this is a NEW key
    const exists = await this.redis.exists(redisKey);
    if (!exists) {
      const existingKeys = await this.redis.keys(
        `${KEY_PREFIX}:${safeAppId}:*`,
      );
      if (existingKeys.length >= MAX_KEYS_PER_APP) {
        throw new HttpException(
          `Too many app-data keys for app '${safeAppId}' (max ${MAX_KEYS_PER_APP})`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    await this.redis.set(redisKey, serialized);
    return { ok: true };
  }
}
