import { Module } from '@nestjs/common';
import { SessionRegistryService } from './session-registry.service';

/**
 * Standalone module — only depends on the global REDIS_CLIENT token.
 * Import this in any module that needs registry access without creating
 * circular dependencies (e.g. GatewayModule ↔ SessionsModule).
 */
@Module({
  providers: [SessionRegistryService],
  exports: [SessionRegistryService],
})
export class SessionRegistryModule {}
