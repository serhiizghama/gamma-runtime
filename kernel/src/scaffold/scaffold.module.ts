import { Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { ScaffoldService } from './scaffold.service';
import { ScaffoldController } from './scaffold.controller';

@Module({
  imports: [RedisModule],
  controllers: [ScaffoldController],
  providers: [ScaffoldService],
  exports: [ScaffoldService],
})
export class ScaffoldModule {}
