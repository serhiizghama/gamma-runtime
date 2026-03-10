import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { AppDataController } from './app-data.controller';

@Module({
  imports: [RedisModule],
  controllers: [AppDataController],
})
export class AppDataModule {}
