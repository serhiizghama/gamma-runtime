import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { ScaffoldModule } from '../scaffold/scaffold.module';
import { SessionRegistryModule } from './session-registry.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionGcService } from './session-gc.service';
import { SessionRegistryService } from './session-registry.service';
import { SystemAppGuard } from './system-guard';
import { WatchdogCommandListenerService } from '../gateway/watchdog-command-listener.service';

@Module({
  imports: [
    GatewayModule,
    forwardRef(() => ScaffoldModule),
    SessionRegistryModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionGcService, SystemAppGuard, WatchdogCommandListenerService],
  exports: [SessionsService, SessionRegistryModule],
})
export class SessionsModule implements OnModuleInit {
  private readonly logger = new Logger(SessionsModule.name);

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly registry: SessionRegistryService,
  ) {}

  /**
   * Boot flush — runs once after all providers are initialized.
   * Removes registry entries that belong to sessions that no longer exist
   * in gamma:sessions (i.e. leftover from a previous crashed server process).
   */
  async onModuleInit(): Promise<void> {
    const allRecords = await this.registry.getAll();
    if (allRecords.length === 0) return;

    const activeKeys = new Set(await this.sessionsService.getActiveSessionKeys());
    let flushed = 0;

    for (const record of allRecords) {
      if (!activeKeys.has(record.sessionKey)) {
        await this.registry.remove(record.sessionKey);
        flushed++;
      }
    }

    if (flushed > 0) {
      this.logger.log(
        `Boot flush: removed ${flushed} stale registry entry/entries from previous server instance`,
      );
    }
  }
}
