import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SessionsModule } from '../sessions/sessions.module';
import { SystemController } from './system.controller';
import { SystemHealthService } from './system-health.service';
import { SystemMonitorService } from './system-monitor.service';

@Module({
  imports: [GatewayModule, SessionsModule],
  controllers: [SystemController],
  providers: [SystemHealthService, SystemMonitorService],
})
export class SystemModule {}
