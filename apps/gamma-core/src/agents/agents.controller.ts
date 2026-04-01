/**
 * agents.controller.ts — Agent Genesis API
 *
 * Endpoints:
 *   GET    /api/agents/roles      — List available community role templates
 *   GET    /api/agents            — List all agents (active + archived)
 *   POST   /api/agents            — Create a new generative agent
 *   DELETE /api/agents/:id        — Soft-delete (archive) an agent
 *   GET    /api/agents/:id/soul   — Read agent SOUL.md persona summary
 *   GET    /api/agents/:id/tasks  — List tasks associated with an agent
 *   GET    /api/agents/:id/trace  — Historical trace from memory bus
 *   SSE    /api/agents/:id/trace/stream — Real-time trace via SSE
 */

import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  Sse,
  Inject,
  Logger,
  UseGuards,
  HttpCode,
  BadRequestException,
  NotFoundException,
  MessageEvent,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import Redis from 'ioredis';
import { resolve, join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { REDIS_KEYS } from '@gamma/types';
import type { MemoryBusEntry } from '@gamma/types';
import { parseStreamFields } from '../redis/redis-stream.util';
import { SystemAppGuard } from '../sessions/system-guard';
import { CreateAgentBody } from '../dto/create-agent.dto';
import { AgentFactoryService } from './agent-factory.service';
import { AgentRegistryService } from '../messaging/agent-registry.service';
import { TaskStateRepository, type TaskRecord } from '../state/task-state.repository';

// Agent IDs are always `agent.<26-char ULID>`
const AGENT_ID_RE = /^agent\.[A-Z0-9]{26}$/i;

/** Max characters returned from SOUL.md to avoid oversized responses. */
const SOUL_MAX_CHARS = 2000;

/** Max entries returned from a single XRANGE trace query. */
const TRACE_MAX_COUNT = 500;

/**
 * Safety cap on XRANGE scan iterations. Prevents runaway scans on a
 * memory bus with millions of entries where the target agent has few.
 * 20 iterations × 500 entries/batch = 10,000 entries scanned max.
 */
const TRACE_MAX_SCAN_ITERATIONS = 20;

@Controller('api/agents')
@UseGuards(SystemAppGuard)
export class AgentsController {
  private readonly logger = new Logger(AgentsController.name);

  constructor(
    private readonly factory: AgentFactoryService,
    private readonly taskRepo: TaskStateRepository,
    private readonly registry: AgentRegistryService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** List all available community role templates from the manifest. */
  @Get('roles')
  getRoles() {
    return this.factory.getRoles();
  }

  /** List all agents (any status). */
  @Get()
  listAgents() {
    return this.factory.findAllAgents();
  }

  /** Create a new agent via generative LLM pipeline. */
  @Post()
  async createAgent(@Body() body: CreateAgentBody) {
    return this.factory.createAgent({
      roleId: body.roleId,
      name: body.name,
      customDirectives: body.customDirectives,
      teamId: body.teamId,
    });
  }

  /** Assign an agent to a team (or remove from team with teamId=null). */
  @Post(':id/team')
  @HttpCode(200)
  async assignTeam(
    @Param('id') id: string,
    @Body() body: { teamId: string | null },
  ) {
    if (!AGENT_ID_RE.test(id)) {
      throw new BadRequestException(`Invalid agent ID format: ${id}`);
    }
    this.factory.updateTeamId(id, body.teamId ?? null);
    return { ok: true, agentId: id, teamId: body.teamId ?? null };
  }

  /** Soft-delete an agent (archive). Preserves knowledge chunks. */
  @Delete(':id')
  @HttpCode(200)
  async deleteAgent(@Param('id') id: string) {
    return this.factory.deleteAgent(id);
  }

  // ── Stage 3: Visualizer Detail Panel Endpoints ──────────────────────

  /**
   * Read the agent's SOUL.md persona file.
   *
   * Security:
   *  - Validates agentId format strictly (ULID regex).
   *  - Resolves workspace path from the database record (not from user input).
   *  - Verifies resolved SOUL.md path stays within the agent's workspace.
   */
  @Get(':id/soul')
  getAgentSoul(@Param('id') id: string): { ok: true; soul: string } {
    this.validateAgentId(id);

    const agent = this.factory.findAgent(id);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${id}`);
    }

    const workspacePath = resolve(agent.workspacePath);
    const soulPath = join(workspacePath, 'SOUL.md');

    // Path traversal guard: ensure resolved path stays inside workspace
    if (!resolve(soulPath).startsWith(workspacePath + '/')) {
      throw new BadRequestException('Path resolution error');
    }

    if (!existsSync(soulPath)) {
      throw new NotFoundException(`SOUL.md not found for agent ${id}`);
    }

    const content = readFileSync(soulPath, 'utf-8');
    return { ok: true, soul: content.slice(0, SOUL_MAX_CHARS) };
  }

  /**
   * List tasks associated with an agent.
   *
   * Query params:
   *  - role: "target" (default) — tasks assigned TO this agent
   *          "source"           — tasks delegated BY this agent
   *  - status: optional comma-separated filter (e.g. "pending,in_progress")
   *  - limit:  max results (default 50, max 200)
   */
  @Get(':id/tasks')
  getAgentTasks(
    @Param('id') id: string,
    @Query('role') role?: string,
    @Query('status') status?: string,
    @Query('limit') limitStr?: string,
  ): { ok: true; tasks: TaskRecord[] } {
    this.validateAgentId(id);

    // Verify agent exists
    const agent = this.factory.findAgent(id);
    if (!agent) {
      throw new NotFoundException(`Agent not found: ${id}`);
    }

    // Fetch tasks by role
    const queryRole = role === 'source' ? 'source' : 'target';
    let tasks: TaskRecord[] =
      queryRole === 'source'
        ? this.taskRepo.findBySource(id)
        : this.taskRepo.findByTarget(id);

    // Apply status filter
    if (status) {
      const allowed = new Set(status.split(',').map((s) => s.trim()));
      tasks = tasks.filter((t) => allowed.has(t.status));
    }

    // Apply limit
    const limit = Math.min(Math.max(parseInt(limitStr || '50', 10) || 50, 1), 200);
    tasks = tasks.slice(0, limit);

    return { ok: true, tasks };
  }

  // ── Stage 3 / Micro-Task 2: Trace Endpoints ─────────────────────────

  /**
   * Historical trace — reads past events from `gamma:memory:bus` filtered
   * by the agent's `sessionKey`.
   *
   * Uses XRANGE on the entire memory bus, then filters client-side by
   * `sessionKey` match. XRANGE is O(log N + M) where M = entries in range,
   * which is efficient for bounded COUNT reads. We read up to TRACE_MAX_COUNT
   * entries at a time, filtering as we go, to keep memory bounded.
   *
   * Query params:
   *  - since: Redis stream ID to start from (default '-' = beginning)
   *  - count: max events to return (default 200, max 500)
   */
  @Get(':id/trace')
  async getAgentTrace(
    @Param('id') id: string,
    @Query('since') since?: string,
    @Query('count') countStr?: string,
  ): Promise<{ ok: true; trace: MemoryBusEntry[] }> {
    this.validateAgentId(id);

    const entry = await this.registry.getOne(id);
    if (!entry) {
      // Agent not in registry — return empty, not an error
      return { ok: true, trace: [] };
    }

    const maxCount = Math.min(
      Math.max(parseInt(countStr || '200', 10) || 200, 1),
      TRACE_MAX_COUNT,
    );

    // XRANGE gamma:memory:bus <since> + COUNT <batch>
    // We over-fetch because not all entries belong to this agent;
    // loop until we collect enough or exhaust the stream.
    const trace: MemoryBusEntry[] = [];
    let cursor = since || '-';
    let iterations = 0;

    while (trace.length < maxCount && iterations < TRACE_MAX_SCAN_ITERATIONS) {
      iterations++;

      const batch = (await this.redis.xrange(
        REDIS_KEYS.MEMORY_BUS,
        cursor,
        '+',
        'COUNT',
        TRACE_MAX_COUNT,
      )) as [string, string[]][];

      if (!batch || batch.length === 0) break;

      for (const [, fields] of batch) {
        const parsed = parseStreamFields(fields) as unknown as MemoryBusEntry;

        // Filter: only events belonging to this agent's session
        if (parsed.sessionKey === entry.sessionKey) {
          trace.push(parsed);
          if (trace.length >= maxCount) break;
        }
      }

      // Advance cursor past the last returned ID to avoid re-reading
      cursor = this.incrementStreamId(batch[batch.length - 1][0]);

      // If batch was smaller than requested, we've exhausted the stream
      if (batch.length < TRACE_MAX_COUNT) break;
    }

    return { ok: true, trace };
  }

  /**
   * Real-time trace SSE — proxies the agent's `gamma:sse:<windowId>` stream
   * using the same XREAD BLOCK pattern as SseController.
   *
   * Only streams when the agent is 'running'. If the agent is offline/idle,
   * returns an empty completed stream.
   */
  @Sse(':id/trace/stream')
  traceStream(@Param('id') id: string): Observable<MessageEvent> {
    this.validateAgentId(id);

    return new Observable<MessageEvent>((subscriber) => {
      // closed flag lives in the outer scope so the teardown function
      // returned below can set it even if start() hasn't resolved yet.
      let closed = false;
      let keepAlive: ReturnType<typeof setInterval> | null = null;
      let blockingRedis: Redis | null = null;

      const start = async () => {
        if (closed) return;

        const entry = await this.registry.getOne(id);

        if (closed) return; // client disconnected during await

        if (!entry || entry.status === 'offline' || entry.status === 'idle') {
          subscriber.next({
            data: JSON.stringify({ type: 'trace_end', reason: entry?.status ?? 'not_found' }),
          } as MessageEvent);
          subscriber.complete();
          return;
        }

        const windowKey = `${REDIS_KEYS.SSE_PREFIX}${entry.windowId}`;
        blockingRedis = this.redis.duplicate();
        let lastId = '$';

        keepAlive = setInterval(() => {
          if (!closed) {
            subscriber.next({
              data: JSON.stringify({ type: 'keep_alive' }),
            } as MessageEvent);
          }
        }, 15_000);

        // If client already disconnected while we were setting up
        if (closed) {
          clearInterval(keepAlive);
          keepAlive = null;
          blockingRedis.disconnect();
          blockingRedis = null;
          return;
        }

        const poll = async (): Promise<void> => {
          while (!closed) {
            try {
              const results = await (blockingRedis as any).xread(
                'BLOCK', 5000,
                'COUNT', 50,
                'STREAMS', windowKey,
                lastId,
              ) as [string, [string, string[]][]][] | null;

              if (!results || closed) continue;

              for (const [, messages] of results) {
                for (const [msgId, fields] of messages) {
                  lastId = msgId;
                  const event = parseStreamFields(fields);
                  if (!closed) {
                    subscriber.next({
                      data: JSON.stringify(event),
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
              await new Promise((r) => setTimeout(r, 500));
            }
          }
        };

        poll().catch((err) => {
          this.logger.error(`Trace stream error for ${id}: ${err}`);
        });
      };

      start().catch(() => subscriber.complete());

      // Teardown: returned from the Observable constructor so it fires
      // immediately on unsubscribe, even if start() is still in-flight.
      return () => {
        closed = true;
        if (keepAlive !== null) {
          clearInterval(keepAlive);
          keepAlive = null;
        }
        if (blockingRedis !== null) {
          blockingRedis.disconnect();
          blockingRedis = null;
        }
      };
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private validateAgentId(id: string): void {
    if (!AGENT_ID_RE.test(id)) {
      throw new BadRequestException(
        `Invalid agentId format: "${id}". Expected: agent.<26-char ULID>`,
      );
    }
  }

  /**
   * Increment a Redis stream ID by 1 (sequence part) to use as an
   * exclusive lower bound for the next XRANGE call.
   */
  private incrementStreamId(id: string): string {
    const [ms, seq] = id.split('-');
    return `${ms}-${Number(seq) + 1}`;
  }
}
