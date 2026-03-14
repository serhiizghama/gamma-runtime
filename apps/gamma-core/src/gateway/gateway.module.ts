import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { AppStorageService } from '../scaffold/app-storage.service';

@Module({
  imports: [SessionRegistryModule],
  providers: [GatewayWsService, ToolWatchdogService, AppStorageService],
  exports: [GatewayWsService, ToolWatchdogService],
})
export class GatewayModule {}
