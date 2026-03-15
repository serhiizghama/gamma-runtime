import { Global, Module } from '@nestjs/common';
import { SystemEventLog } from './system-event-log.service';

@Global()
@Module({
  providers: [SystemEventLog],
  exports: [SystemEventLog],
})
export class SystemEventLogModule {}
