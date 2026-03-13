import { Module } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { SystemController } from './system.controller';
import { SystemHealthService } from './system-health.service';

@Module({
  imports: [GatewayModule],
  controllers: [SystemController],
  providers: [SystemHealthService],
})
export class SystemModule {}
