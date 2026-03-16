import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Sse,
  MessageEvent,
  Inject,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { SystemHealthService } from './system-health.service';
import { SystemMonitorService } from './system-monitor.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { SessionsService } from '../sessions/sessions.service';
import { ActivityStreamService } from '../activity/activity-stream.service';
import { SystemAppGuard } from '../sessions/system-guard';
import { REDIS_KEYS } from '@gamma/types';
import type {
  SystemHealthReport,
  BackupInventory,
  AgentRegistryEntry,
  ActivityEvent,
  SpawnAgentDto,
} from '@gamma/types';

@Controller('api/system')
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(
    private readonly health: SystemHealthService,
    private readonly monitor: SystemMonitorService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly sessions: SessionsService,
    private readonly activityStream: ActivityStreamService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get('health')
  async getHealth(): Promise<SystemHealthReport> {
    return this.health.getHealth();
  }

  // ── SSE Ticket (Phase 5.5 — Security Hardening) ─────────────────────────

  /**
   * Exchange a system token for a short-lived, single-use SSE ticket.
   * The ticket is stored in Redis with a 30s TTL and returned to the caller.
   * SSE endpoints validate the ticket instead of the long-lived system token.
   */
  @Post('sse-ticket')
  @UseGuards(SystemAppGuard)
  async createSseTicket(): Promise<{ ticket: string }> {
    const ticket = randomBytes(32).toString('hex');
    const key = `${REDIS_KEYS.SSE_TICKET_PREFIX}${ticket}`;
    await this.redis.set(key, '1', 'EX', 30);
    return { ticket };
  }

  @Get('backups')
  @UseGuards(SystemAppGuard)
  async getBackups(): Promise<BackupInventory> {
    return this.monitor.getBackupInventory();
  }

  @Get('agents')
  @UseGuards(SystemAppGuard)
  async getAgents(): Promise<AgentRegistryEntry[]> {
    return this.agentRegistry.getAll();
  }

  // ── Panic Button (Phase 5) ─────────────────────────────────────────────

  /**
   * Emergency stop — aborts ALL running agent sessions immediately.
   * Broadcasts `emergency_stop` via SSE and logs to activity stream.
   */
  @Post('panic')
  @UseGuards(SystemAppGuard)
  async panic(): Promise<{ ok: boolean; killedCount: number }> {
    this.logger.warn('PANIC endpoint triggered');
    const killedCount = await this.sessions.emergencyStopAll();
    return { ok: true, killedCount };
  }

  // ── Hierarchy (Phase 5.3) ─────────────────────────────────────────────

  @Patch('agents/:id/hierarchy')
  @UseGuards(SystemAppGuard)
  async setHierarchy(
    @Param('id') agentId: string,
    @Body() body: { supervisorId: string | null },
  ): Promise<{ ok: boolean; error?: string }> {
    const result = await this.agentRegistry.setSupervisor(agentId, body.supervisorId);
    if (!result.ok) return result;

    // Notify the agent about the hierarchy change via a system message
    this.notifyHierarchyChange(agentId, body.supervisorId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Failed to notify ${agentId} about hierarchy change: ${msg}`);
    });

    return result;
  }

  /**
   * Send a system-level notification to an agent about a hierarchy change.
   * Best-effort — failure never blocks the hierarchy update itself.
   */
  private async notifyHierarchyChange(agentId: string, newSupervisorId: string | null): Promise<void> {
    // Find the agent's session to get the windowId
    const agent = await this.agentRegistry.getOne(agentId);
    if (!agent?.windowId) return;

    const supervisorLabel = newSupervisorId ?? '(none — you are now a root-level agent)';
    const message =
      `[SYSTEM]: Your hierarchy has changed. Your new supervisor is: ${supervisorLabel}. ` +
      (newSupervisorId
        ? `Prioritize requests from ${newSupervisorId} and report progress to them.`
        : 'You now operate independently as a root agent.');

    await this.sessions.sendMessage(agent.windowId, message);
  }

  // ── Agent Spawning (Phase 5.3) ──────────────────────────────────────

  @Post('agents/spawn')
  @UseGuards(SystemAppGuard)
  async spawnAgent(
    @Body() body: SpawnAgentDto,
  ): Promise<{ ok: boolean; sessionKey?: string; windowId?: string; error?: string }> {
    return this.sessions.spawnAgent(body);
  }

  // ── Activity Stream (Phase 5) ──────────────────────────────────────────

  /**
   * REST endpoint for historical activity events (catch-up before SSE).
   */
  @Get('activity')
  @UseGuards(SystemAppGuard)
  async getActivity(
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ): Promise<ActivityEvent[]> {
    return this.activityStream.read(
      since || '-',
      limit ? Math.min(Number(limit), 500) : 200,
    );
  }

  /**
   * SSE endpoint — streams live activity events from `gamma:system:activity`.
   * Uses XREAD BLOCK for efficient long-polling (same pattern as per-window SSE).
   */
  @Sse('activity/stream')
  streamActivity(
    @Query('ticket') ticket?: string,
    @Query('lastEventId') lastEventId?: string,
  ): Observable<MessageEvent> {
    return new Observable<MessageEvent>((subscriber) => {
      // Validate single-use SSE ticket before allowing the stream
      const validateTicket = async (): Promise<boolean> => {
        if (!ticket) return false;
        const key = `${REDIS_KEYS.SSE_TICKET_PREFIX}${ticket}`;
        const deleted = await this.redis.del(key);
        return deleted === 1;
      };

      const blockingRedis = this.redis.duplicate();
      let closed = false;
      let lastId = lastEventId || '$';

      const poll = async (): Promise<void> => {
        while (!closed) {
          try {
            const results = await (blockingRedis as any).xread( // eslint-disable-line @typescript-eslint/no-explicit-any
              'BLOCK', 5000,
              'COUNT', 50,
              'STREAMS',
              REDIS_KEYS.SYSTEM_ACTIVITY,
              lastId,
            ) as [string, [string, string[]][]][] | null;

            if (!results || closed) continue;

            for (const [, messages] of results) {
              for (const [id, fields] of messages) {
                lastId = id;
                const event = parseStreamFields(fields);
                if (!closed) {
                  subscriber.next({
                    data: JSON.stringify(event),
                    id,
                  } as MessageEvent);
                }
              }
            }
          } catch (err: unknown) {
            if (closed) break;
            const msg = err instanceof Error ? err.message : String(err);
            if (
              msg.includes('Connection is closed') ||
              msg.includes("Stream isn't readable")
            ) {
              break;
            }
            await sleep(500);
          }
        }
      };

      // Keep-alive heartbeat every 15s
      const keepAlive = setInterval(() => {
        if (!closed) {
          subscriber.next({
            data: JSON.stringify({ type: 'keep_alive' }),
          } as MessageEvent);
        }
      }, 15_000);

      // Validate ticket before starting the poll loop
      validateTicket()
        .then((valid) => {
          if (!valid) {
            subscriber.next({
              data: JSON.stringify({ type: 'error', message: 'invalid or expired ticket' }),
            } as MessageEvent);
            subscriber.complete();
            return;
          }
          poll().catch(() => {});
        })
        .catch(() => {
          subscriber.complete();
        });

      return () => {
        closed = true;
        clearInterval(keepAlive);
        blockingRedis.disconnect();
      };
    });
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseStreamFields(fields: string[]): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < fields.length; i += 2) {
    const key = fields[i];
    const raw = fields[i + 1];
    if (
      raw.startsWith('{') ||
      raw.startsWith('[') ||
      raw === 'true' ||
      raw === 'false' ||
      raw === 'null'
    ) {
      try {
        obj[key] = JSON.parse(raw);
        continue;
      } catch {
        // fall through
      }
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
      obj[key] = Number(raw);
      continue;
    }
    obj[key] = raw;
  }
  return obj;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
