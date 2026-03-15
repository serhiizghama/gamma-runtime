import { Global, Module } from '@nestjs/common';
import { ContextInjectorService } from './context-injector.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SystemHealthService } from '../system/system-health.service';
import { RedisModule } from '../redis/redis.module';

/**
 * Global module providing the ContextInjectorService.
 *
 * Does NOT import GatewayModule to avoid the circular dependency:
 * ContextInjectorModule → GatewayModule → GatewayWsService → ContextInjectorService
 * SystemHealthService uses @Optional() for GatewayWsService — it will be undefined
 * in this context (gateway status available via SystemModule's instance in SystemController).
 */
@Global()
@Module({
  imports: [SessionRegistryModule, MessagingModule, RedisModule],
  providers: [ContextInjectorService, SystemHealthService],
  exports: [ContextInjectorService],
})
export class ContextInjectorModule {}
