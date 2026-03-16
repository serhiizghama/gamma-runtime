import { Global, Module, forwardRef } from '@nestjs/common';
import { ContextInjectorService } from './context-injector.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SystemHealthService } from '../system/system-health.service';
import { RedisModule } from '../redis/redis.module';
import { ToolsModule } from '../tools/tools.module';

/**
 * Global module providing the ContextInjectorService.
 *
 * Does NOT import GatewayModule to avoid the circular dependency:
 * ContextInjectorModule → GatewayModule → GatewayWsService → ContextInjectorService
 * SystemHealthService uses @Optional() for GatewayWsService — it will be undefined
 * in this context (gateway status available via SystemModule's instance in SystemController).
 * ToolsModule is imported via forwardRef to break the circular chain through SessionsModule.
 */
@Global()
@Module({
  imports: [SessionRegistryModule, MessagingModule, RedisModule, forwardRef(() => ToolsModule)],
  providers: [ContextInjectorService, SystemHealthService],
  exports: [ContextInjectorService],
})
export class ContextInjectorModule {}
