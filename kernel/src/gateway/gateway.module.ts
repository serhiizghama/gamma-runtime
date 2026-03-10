import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';

@Module({
  providers: [GatewayWsService, ToolWatchdogService],
  exports: [GatewayWsService, ToolWatchdogService],
})
export class GatewayModule {}
