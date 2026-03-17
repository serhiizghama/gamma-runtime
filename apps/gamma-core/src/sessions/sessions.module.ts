import { Module, OnModuleInit, Logger, forwardRef } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { GatewayModule } from '../gateway/gateway.module';
import { ScaffoldModule } from '../scaffold/scaffold.module';
import { MessagingModule } from '../messaging/messaging.module';
import { ActivityModule } from '../activity/activity.module';
import { StateModule } from '../state/state.module';
import { SessionRegistryModule } from './session-registry.module';
import { SessionsController } from './sessions.controller';
import { SessionsService } from './sessions.service';
import { SessionGcService } from './session-gc.service';
import { SessionRegistryService } from './session-registry.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { AgentStateRepository } from '../state/agent-state.repository';
import { SystemAppGuard } from './system-guard';
import { WatchdogCommandListenerService } from '../gateway/watchdog-command-listener.service';
import type { AgentRole } from '@gamma/types';

const APP_OWNER_PREFIX = 'app-owner-';

function resolveRole(sessionKey: string): AgentRole {
  if (sessionKey === 'system-architect') return 'architect';
  if (sessionKey.startsWith(APP_OWNER_PREFIX)) return 'app-owner';
  return 'daemon';
}

@Module({
  imports: [
    GatewayModule,
    forwardRef(() => ScaffoldModule),
    SessionRegistryModule,
    MessagingModule,
    ActivityModule,
    StateModule,
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
    private readonly agentStateRepo: AgentStateRepository,
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
          supervisorId: session.sessionKey === 'system-architect' ? null : 'system-architect',
        });
        synced++;
      }
    }
    if (synced > 0) {
      this.logger.log(
        `Agent registry sync: back-filled ${synced} missing agent entry/entries`,
      );
    }

    // ── Hydrate generative agents from gamma-state.db ──
    await this.hydrateGenerativeAgents();
  }

  /**
   * Re-register generative agents (from gamma-state.db) into the Redis
   * agent registry on boot. Validates that each agent's workspace directory
   * still exists on disk — marks it 'corrupted' in the DB if missing.
   */
  private async hydrateGenerativeAgents(): Promise<void> {
    const activeAgents = this.agentStateRepo.findAllActive();
    if (activeAgents.length === 0) return;

    let hydrated = 0;
    let corrupted = 0;

    for (const agent of activeAgents) {
      try {
        // Validate workspace directory exists on disk
        if (!existsSync(agent.workspacePath)) {
          this.logger.warn(
            `Workspace missing for agent "${agent.name}" (${agent.id}) at ${agent.workspacePath} — marking corrupted`,
          );
          this.agentStateRepo.markCorrupted(agent.id);
          corrupted++;
          continue;
        }

        // Re-register in Redis (status = 'offline' — no live session yet)
        const existing = await this.agentRegistry.getOne(agent.id);
        if (!existing) {
          await this.agentRegistry.register({
            agentId: agent.id,
            role: 'daemon',
            sessionKey: agent.id,
            windowId: '',
            appId: '',
            status: 'offline',
            capabilities: [],
            lastHeartbeat: Date.now(),
            lastActivity: 'hydrated from state db',
            acceptsMessages: true,
            createdAt: agent.createdAt,
            supervisorId: null,
          });
          hydrated++;
        }
      } catch (err) {
        this.logger.error(
          `Failed to hydrate agent "${agent.name}" (${agent.id}): ${err}`,
        );
      }
    }

    if (hydrated > 0 || corrupted > 0) {
      this.logger.log(
        `State DB hydration: ${hydrated} agent(s) restored, ${corrupted} marked corrupted`,
      );
    }
  }
}
