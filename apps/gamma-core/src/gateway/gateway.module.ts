import { Module, forwardRef } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';
import { ToolWatchdogService } from './tool-watchdog.service';
import { ToolJailGuardService } from './tool-jail-guard.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { AppStorageService } from '../scaffold/app-storage.service';
import { ToolsModule } from '../tools/tools.module';

@Module({
  imports: [SessionRegistryModule, MessagingModule, ActivityModule, forwardRef(() => ToolsModule)],
  providers: [GatewayWsService, ToolWatchdogService, ToolJailGuardService, AppStorageService],
  exports: [GatewayWsService, ToolWatchdogService, ToolJailGuardService],
})
export class GatewayModule {}
