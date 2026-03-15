import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { GatewayModule } from '../gateway/gateway.module';
import { ScaffoldModule } from '../scaffold/scaffold.module';
import { MessagingModule } from '../messaging/messaging.module';
import { SessionRegistryModule } from './session-registry.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionGcService } from './session-gc.service';
import { SessionRegistryService } from './session-registry.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { FileChangeConsumerService } from '../messaging/file-change-consumer.service';
import { SystemAppGuard } from './system-guard';
import { WatchdogCommandListenerService } from '../gateway/watchdog-command-listener.service';
import type { AgentRole } from '@gamma/types';

const APP_OWNER_PREFIX = 'app-owner-';

function resolveRole(sessionKey: string): AgentRole {
  if (sessionKey === 'system-architect') return 'architect';
  if (sessionKey === 'app-owner-inspector') return 'daemon';
  if (sessionKey.startsWith(APP_OWNER_PREFIX)) return 'app-owner';
  return 'daemon';
}

@Module({
  imports: [
    GatewayModule,
    forwardRef(() => ScaffoldModule),
    SessionRegistryModule,
    MessagingModule,
  ],
  controllers: [SessionsController],
  providers: [SessionsService, SessionGcService, SystemAppGuard, WatchdogCommandListenerService],
  exports: [SessionsService, SessionRegistryModule, SystemAppGuard],
})
export class SessionsModule implements OnModuleInit {
  private readonly logger = new Logger(SessionsModule.name);

  constructor(
    private readonly sessionsService: SessionsService,
    private readonly registry: SessionRegistryService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly fileChangeConsumer: FileChangeConsumerService,
  ) {}

  /**
   * Boot flush + agent registry sync — runs once after all providers are initialized.
   * 1. Removes stale session-registry entries from previous server instances.
   * 2. Ensures every active session has a corresponding agent-registry entry
   *    (back-fills entries that were missed, e.g. sessions created before
   *    the agent registry feature existed).
   */
  async onModuleInit(): Promise<void> {
    const allRecords = await this.registry.getAll();
    const activeSessions = await this.sessionsService.findAll();
    const activeKeys = new Set(activeSessions.map((s) => s.sessionKey));

    // ── Flush stale session-registry entries ──
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

    // ── Sync agent registry: back-fill missing entries ──
    let synced = 0;
    for (const session of activeSessions) {
      const agentId = session.sessionKey;
      const existing = await this.agentRegistry.getOne(agentId);
      if (!existing) {
        await this.agentRegistry.register({
          agentId,
          role: resolveRole(session.sessionKey),
          sessionKey: session.sessionKey,
          windowId: session.windowId,
          appId: session.appId,
          status: session.status || 'idle',
          capabilities: [],
          lastHeartbeat: Date.now(),
          lastActivity: 'restored on boot',
          acceptsMessages: true,
          createdAt: session.createdAt,
        });
        synced++;
      }
    }
    if (synced > 0) {
      this.logger.log(
        `Agent registry sync: back-filled ${synced} missing agent entry/entries`,
      );
    }

    // ── Wire up the file-change consumer dispatcher (Phase 4.2) ──
    this.fileChangeConsumer.setDispatcher(
      async (appId: string, ownerSessionKey: string, filePaths: string[]) => {
        this.logger.log(
          `[TRACE:DISPATCH] Dispatcher called | appId=${appId} | owner=${ownerSessionKey} | files=[${filePaths.join(', ')}]`,
        );

        const windowId = await this.sessionsService.ensureAppInspectorSession();
        this.logger.log(`[TRACE:DISPATCH] Inspector session ready — windowId=${windowId}`);

        const fileList = filePaths.map((p) => `- ${p}`).join('\n');
        const reviewPrompt =
          `The following files in app '${appId}' were modified by ${ownerSessionKey}:\n` +
          `${fileList}\n\n` +
          `Please read each file using fs_read, analyze the changes for bugs, security issues, ` +
          `and architectural violations, then send your review feedback to '${ownerSessionKey}' ` +
          `using the send_message tool.`;

        this.logger.log(`[TRACE:DISPATCH] Sending review prompt to inspector (${reviewPrompt.length} chars)`);
        const result = await this.sessionsService.sendMessage(windowId, reviewPrompt);
        if (!result || !result.ok) {
          this.logger.warn(
            `[TRACE:DISPATCH] sendMessage FAILED for ${appId}: ${JSON.stringify(result?.error ?? 'null')}`,
          );
        } else {
          this.logger.log(`[TRACE:DISPATCH] sendMessage OK — review triggered for ${appId} (${filePaths.length} file(s))`);
        }
      },
    );
    this.logger.log('File change consumer dispatcher registered');
  }
}
