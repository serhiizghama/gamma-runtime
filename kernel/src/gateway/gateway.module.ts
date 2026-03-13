import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';

@Module({
  imports: [SessionRegistryModule],
  providers: [GatewayWsService, ToolWatchdogService],
  exports: [GatewayWsService, ToolWatchdogService],
})
export class GatewayModule {}
