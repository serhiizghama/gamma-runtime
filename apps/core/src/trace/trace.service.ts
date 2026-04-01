import { Injectable } from '@nestjs/common';
import { TraceRepository } from '../repositories/trace.repository';
import { DatabaseService } from '../database/database.service';
import { EventBusService } from '../events/event-bus.service';
import { TraceEvent } from '../common/types';
import { EventKind } from '../events/types';

@Injectable()
export class TraceService {
  constructor(
    private readonly traceRepo: TraceRepository,
    private readonly db: DatabaseService,
    private readonly eventBus: EventBusService,
  ) {}

  async record(event: {
    agentId: string;
    teamId?: string;
    taskId?: string;
    kind: EventKind | string;
    content?: unknown;
  }): Promise<TraceEvent> {
    // 1. Persist to DB
    const trace = await this.traceRepo.insert({
      agent_id: event.agentId,
      team_id: event.teamId,
      task_id: event.taskId,
      kind: event.kind,
      content: event.content ? JSON.stringify(event.content) : undefined,
    });

    // 2. Emit to SSE via EventBus
    this.eventBus.emit({
      id: trace.id,
      kind: event.kind,
      agentId: event.agentId,
      teamId: event.teamId,
      taskId: event.taskId,
      content: event.content,
      createdAt: trace.created_at,
    });

    return trace;
  }

  async query(filters: {
    teamId?: string;
    agentId?: string;
    taskId?: string;
    kind?: string;
    limit?: number;
    since?: number;
  }): Promise<TraceEvent[]> {
    // Build dynamic query based on filters
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filters.agentId) {
      conditions.push(`agent_id = $${idx++}`);
      params.push(filters.agentId);
    }
    if (filters.teamId) {
      conditions.push(`team_id = $${idx++}`);
      params.push(filters.teamId);
    }
    if (filters.taskId) {
      conditions.push(`task_id = $${idx++}`);
      params.push(filters.taskId);
    }
    if (filters.kind) {
      conditions.push(`kind = $${idx++}`);
      params.push(filters.kind);
    }
    if (filters.since) {
      conditions.push(`created_at > $${idx++}`);
      params.push(filters.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 100;
    params.push(limit);

    const { rows } = await this.db.query<TraceEvent>(
      `SELECT * FROM trace_events ${where} ORDER BY created_at DESC LIMIT $${idx}`,
      params,
    );
    return rows;
  }
}
