import { Global, Module } from '@nestjs/common';
import { SystemEventLog } from './system-event-log.service';
import { WatchdogEventBridgeService } from './watchdog-event-bridge.service';

@Global()
@Module({
  providers: [SystemEventLog, WatchdogEventBridgeService],
  exports: [SystemEventLog],
})
export class SystemEventLogModule {}
