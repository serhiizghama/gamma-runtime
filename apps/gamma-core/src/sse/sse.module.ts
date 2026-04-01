import { Module } from '@nestjs/common';
import { SseController } from './sse.controller';
import { UnifiedSseController } from './unified-sse.controller';

@Module({
  controllers: [UnifiedSseController, SseController],
})
export class SseModule {}
