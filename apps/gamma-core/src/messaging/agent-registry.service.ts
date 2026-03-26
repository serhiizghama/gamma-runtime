import { Injectable, Inject, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ActivityStreamService } from '../activity/activity-stream.service';
import { AgentStateRepository } from '../state/agent-state.repository';
import type { AgentRegistryEntry, AgentRole, AgentStatus } from '@gamma/types';
import { REDIS_KEYS } from '@gamma/types';

const TTL_24H = 86_400; // seconds

/**
 * Manages the Agent Registry — a Redis-backed directory of all active agents
 * in the system. Used for agent discovery, capability advertisement, and
 * IPC readiness tracking (Phase 4).
 *
 * Each agent is stored as a Redis Hash at gamma:agent-registry:<agentId>,
 * with a membership Set at gamma:agent-registry:index.
 */
@Injectable()
export class AgentRegistryService {
  private readonly logger = new Logger(AgentRegistryService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Optional() private readonly activityStream?: ActivityStreamService,
    @Optional() private readonly eventEmitter?: EventEmitter2,
    @Optional() private readonly agentStateRepo?: AgentStateRepository,
  ) {}

  // ── Public API ────────────────────────────────────────────────────────

  /**
   * Register a new agent or update an existing entry.
   * Adds the agentId to the index Set and resets the 24h TTL.
   */
  async register(entry: AgentRegistryEntry): Promise<void> {
    const key = `${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${entry.agentId}`;

    // Read existing Redis entry once — used to preserve sticky fields below.
    const existingRole = await this.redis.hget(key, 'role');
    const existingSupervisor = await this.redis.hget(key, 'supervisorId');

    // Preserve a previously assigned custom role (e.g. 'team-leader') so that
    // re-registration on session restart doesn't downgrade the role back to 'daemon'.
    // Only 'daemon' is considered a default role — architect/app-owner/team-leader are sticky.
    let effectiveRole = entry.role;
    if (entry.role === 'daemon' && existingRole && existingRole !== 'daemon' && existingRole !== '') {
      effectiveRole = existingRole as AgentRegistryEntry['role'];
    }

    // Preserve a previously assigned custom supervisorId so that re-registration
    // on session restart doesn't reset hierarchy back to system-architect.
    // Only override if the caller explicitly passes a non-default supervisor.
    // Default: sessions.service registers with 'system-architect' as supervisor.
    const defaultSupervisor = 'system-architect';
    let effectiveSupervisor = entry.supervisorId ?? '';
    if (
      (effectiveSupervisor === defaultSupervisor || effectiveSupervisor === '') &&
      existingSupervisor &&
      existingSupervisor !== defaultSupervisor &&
      existingSupervisor !== ''
    ) {
      effectiveSupervisor = existingSupervisor;
    }

    const flat: Record<string, string> = {
      agentId: entry.agentId,
      role: effectiveRole,
      sessionKey: entry.sessionKey,
      windowId: entry.windowId,
      appId: entry.appId,
      status: entry.status,
      capabilities: JSON.stringify(entry.capabilities),
      lastHeartbeat: String(entry.lastHeartbeat),
      lastActivity: entry.lastActivity,
      acceptsMessages: entry.acceptsMessages ? '1' : '0',
      createdAt: String(entry.createdAt),
      supervisorId: effectiveSupervisor,
    };

    await this.redis
      .pipeline()
      .hset(key, flat)
      .expire(key, TTL_24H)
      .sadd(REDIS_KEYS.AGENT_REGISTRY_INDEX, entry.agentId)
      .exec();

    this.activityStream?.emit({
      kind: 'agent_registered',
      agentId: entry.agentId,
      windowId: entry.windowId || undefined,
      appId: entry.appId || undefined,
      severity: 'info',
    });

    this.broadcastUpdate();
  }

  /**
   * Update specific fields on an existing agent entry.
   * Resets the 24h TTL. No-op if the agent doesn't exist.
   */
  async update(agentId: string, fields: Partial<Omit<AgentRegistryEntry, 'agentId'>>): Promise<void> {
    const key = `${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${agentId}`;
    const exists = await this.redis.exists(key);
    if (!exists) return;

    const flat: Record<string, string> = {};
    if (fields.role != null) flat.role = fields.role;
    if (fields.sessionKey != null) flat.sessionKey = fields.sessionKey;
    if (fields.windowId != null) flat.windowId = fields.windowId;
    if (fields.appId != null) flat.appId = fields.appId;
    if (fields.status != null) flat.status = fields.status;
    if (fields.capabilities != null) flat.capabilities = JSON.stringify(fields.capabilities);
    if (fields.lastHeartbeat != null) flat.lastHeartbeat = String(fields.lastHeartbeat);
    if (fields.lastActivity != null) flat.lastActivity = fields.lastActivity;
    if (fields.acceptsMessages != null) flat.acceptsMessages = fields.acceptsMessages ? '1' : '0';
    if (fields.createdAt != null) flat.createdAt = String(fields.createdAt);
    if (fields.supervisorId !== undefined) flat.supervisorId = fields.supervisorId ?? '';

    if (Object.keys(flat).length === 0) return;

    await this.redis
      .pipeline()
      .hset(key, flat)
      .expire(key, TTL_24H)
      .exec();

    if (fields.status != null) {
      this.activityStream?.emit({
        kind: 'agent_status_change',
        agentId,
        payload: fields.status,
        severity: fields.status === 'error' ? 'error' : 'info',
      });

      // Emit agent.idle event for task claim system
      if (fields.status === 'idle' && this.eventEmitter) {
        const agentState = this.agentStateRepo?.findById(agentId);
        this.eventEmitter.emit('agent.idle', {
          agentId,
          teamId: agentState?.teamId ?? undefined,
          roleId: agentState?.roleId ?? undefined,
        });
      }
    }

    this.broadcastUpdate();
  }

  /**
   * Record a heartbeat: update lastHeartbeat + optional lastActivity,
   * and refresh the TTL. Lightweight — only touches two or three fields.
   */
  async heartbeat(agentId: string, activity?: string): Promise<void> {
    const key = `${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${agentId}`;
    const exists = await this.redis.exists(key);
    if (!exists) return;

    const flat: Record<string, string> = {
      lastHeartbeat: String(Date.now()),
    };
    if (activity) flat.lastActivity = activity;

    await this.redis
      .pipeline()
      .hset(key, flat)
      .expire(key, TTL_24H)
      .exec();
  }

  /**
   * Unregister an agent — removes the hash and the index entry.
   */
  async unregister(agentId: string): Promise<void> {
    const key = `${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${agentId}`;
    await this.redis
      .pipeline()
      .del(key)
      .srem(REDIS_KEYS.AGENT_REGISTRY_INDEX, agentId)
      .exec();

    this.activityStream?.emit({
      kind: 'agent_deregistered',
      agentId,
      severity: 'info',
    });

    this.eventEmitter?.emit('agent.offline', { agentId });

    this.broadcastUpdate();
  }

  /**
   * Return all registered agents. Cleans up stale index entries whose
   * hashes have expired (TTL lapse).
   */
  async getAll(): Promise<AgentRegistryEntry[]> {
    const agentIds = await this.redis.smembers(REDIS_KEYS.AGENT_REGISTRY_INDEX);
    if (agentIds.length === 0) return [];

    const entries: AgentRegistryEntry[] = [];
    const stale: string[] = [];

    for (const id of agentIds) {
      const raw = await this.redis.hgetall(`${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${id}`);
      if (!raw || !raw.agentId) {
        stale.push(id);
        continue;
      }
      entries.push(this.parseEntry(raw));
    }

    // Clean up stale index entries
    if (stale.length > 0) {
      await this.redis.srem(REDIS_KEYS.AGENT_REGISTRY_INDEX, ...stale);
      this.logger.debug(`Cleaned ${stale.length} stale agent registry index entries`);
    }

    return entries;
  }

  /**
   * Get a single agent entry by ID, or null if not found.
   */
  async getOne(agentId: string): Promise<AgentRegistryEntry | null> {
    const raw = await this.redis.hgetall(`${REDIS_KEYS.AGENT_REGISTRY_PREFIX}${agentId}`);
    if (!raw || !raw.agentId) return null;
    return this.parseEntry(raw);
  }

  // ── Broadcast ─────────────────────────────────────────────────────────

  private broadcastUpdate(): void {
    this.getAll()
      .then((entries) =>
        this.redis.xadd(
          REDIS_KEYS.SSE_BROADCAST, '*',
          'type', 'agent_registry_update',
          'agents', JSON.stringify(entries),
        ),
      )
      .catch(() => {
        // best-effort; SSE broadcast failure must never block normal operations
      });
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  private parseEntry(raw: Record<string, string>): AgentRegistryEntry {
    let capabilities: string[] = [];
    try {
      capabilities = JSON.parse(raw.capabilities || '[]');
    } catch {
      capabilities = [];
    }

    return {
      agentId: raw.agentId,
      role: (raw.role || 'app-owner') as AgentRole,
      sessionKey: raw.sessionKey || '',
      windowId: raw.windowId || '',
      appId: raw.appId || '',
      status: (raw.status || 'offline') as AgentStatus | 'offline',
      capabilities,
      lastHeartbeat: Number(raw.lastHeartbeat || 0),
      lastActivity: raw.lastActivity || '',
      acceptsMessages: raw.acceptsMessages === '1',
      createdAt: Number(raw.createdAt || 0),
      supervisorId: raw.supervisorId || null,
    };
  }

  // ── Hierarchy (Phase 5.3) ──────────────────────────────────────────

  /**
   * Set or change the supervisor of an agent.
   * Validates: target exists, supervisor exists (or null for root), no self-loop, no cycles.
   */
  async setSupervisor(agentId: string, supervisorId: string | null): Promise<{ ok: boolean; error?: string }> {
    if (agentId === supervisorId) {
      return { ok: false, error: 'Agent cannot supervise itself' };
    }

    const agent = await this.getOne(agentId);
    if (!agent) return { ok: false, error: `Agent '${agentId}' not found` };

    if (supervisorId) {
      const supervisor = await this.getOne(supervisorId);
      if (!supervisor) return { ok: false, error: `Supervisor '${supervisorId}' not found` };

      // Cycle detection: walk up from the proposed supervisor
      let current: string | null = supervisorId;
      const visited = new Set<string>();
      while (current) {
        if (current === agentId) {
          return { ok: false, error: 'Cycle detected: this assignment would create a supervision loop' };
        }
        if (visited.has(current)) break; // already checked
        visited.add(current);
        const entry = await this.getOne(current);
        current = entry?.supervisorId ?? null;
      }
    }

    await this.update(agentId, { supervisorId });

    this.activityStream?.emit({
      kind: 'hierarchy_change',
      agentId,
      targetAgentId: supervisorId ?? undefined,
      payload: supervisorId ? `supervisor → ${supervisorId}` : 'promoted to root',
      severity: 'info',
    });

    return { ok: true };
  }
}
