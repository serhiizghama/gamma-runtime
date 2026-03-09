import { Module } from '@nestjs/common';
import { GatewayWsService } from './gateway-ws.service';

@Module({
  providers: [GatewayWsService],
  exports: [GatewayWsService],
})
export class GatewayModule {}
