import { Global, Module } from '@nestjs/common';
import { ContextInjectorService } from './context-injector.service';
import { SessionRegistryModule } from '../sessions/session-registry.module';
import { SystemHealthService } from '../system/system-health.service';
import { GatewayModule } from '../gateway/gateway.module';

/**
 * Global module providing the ContextInjectorService.
 *
 * Imports SessionRegistryModule (for session data) and GatewayModule
 * (required by SystemHealthService for gateway ping).
 * SystemEventLog is already global, so no explicit import needed.
 */
@Global()
@Module({
  imports: [SessionRegistryModule, GatewayModule],
  providers: [ContextInjectorService, SystemHealthService],
  exports: [ContextInjectorService],
})
export class ContextInjectorModule {}
