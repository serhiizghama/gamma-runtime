import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';
import { ToolJailGuardService } from './tool-jail-guard.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { AppStorageService } from '../scaffold/app-storage.service';

// ToolsModule is imported by AppModule and resolves via ModuleRef in GatewayWsService
// to break the circular: GatewayModule → ToolsModule → SessionsModule → GatewayModule.
@Module({
  imports: [SessionRegistryModule, MessagingModule, ActivityModule],
  providers: [GatewayWsService, ToolWatchdogService, ToolJailGuardService, AppStorageService],
  exports: [GatewayWsService, ToolWatchdogService, ToolJailGuardService],
})
export class GatewayModule {}
