import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SessionsModule } from '../sessions/sessions.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { SystemController } from './system.controller';
import { SystemHealthService } from './system-health.service';
import { SystemMonitorService } from './system-monitor.service';

@Module({
  imports: [GatewayModule, SessionsModule, MessagingModule, ActivityModule],
  controllers: [SystemController],
  providers: [SystemHealthService, SystemMonitorService],
})
export class SystemModule {}
