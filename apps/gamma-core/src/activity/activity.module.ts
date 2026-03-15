import { Module } from '@nestjs/common';
import { ActivityStreamService } from './activity-stream.service';

@Module({
  providers: [ActivityStreamService],
  exports: [ActivityStreamService],
})
export class ActivityModule {}
