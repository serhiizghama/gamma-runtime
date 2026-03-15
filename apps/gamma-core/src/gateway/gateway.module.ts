import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';
import { ToolJailGuardService } from './tool-jail-guard.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { AppStorageService } from '../scaffold/app-storage.service';

@Module({
  imports: [SessionRegistryModule],
  providers: [GatewayWsService, ToolWatchdogService, ToolJailGuardService, AppStorageService],
  exports: [GatewayWsService, ToolWatchdogService, ToolJailGuardService],
})
export class GatewayModule {}
