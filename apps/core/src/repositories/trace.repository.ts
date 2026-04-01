import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { TraceEvent } from '../common/types';
import { traceEventId } from '../common/ulid';

@Injectable()
export class TraceRepository {
  constructor(private readonly db: DatabaseService) {}

  async insert(data: {
    agent_id: string;
    team_id?: string;
    task_id?: string;
    kind: string;
    content?: string;
  }): Promise<TraceEvent> {
    const now = Date.now();
    const id = traceEventId();
    const { rows } = await this.db.query<TraceEvent>(
      `INSERT INTO trace_events (id, agent_id, team_id, task_id, kind, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        id,
        data.agent_id,
        data.team_id ?? null,
        data.task_id ?? null,
        data.kind,
        data.content ?? null,
        now,
      ],
    );
    return rows[0];
  }

  async findByAgent(agentId: string, limit = 100): Promise<TraceEvent[]> {
    const { rows } = await this.db.query<TraceEvent>(
      'SELECT * FROM trace_events WHERE agent_id = $1 ORDER BY created_at DESC LIMIT $2',
      [agentId, limit],
    );
    return rows;
  }

  async findByTeam(teamId: string, limit = 100): Promise<TraceEvent[]> {
    const { rows } = await this.db.query<TraceEvent>(
      'SELECT * FROM trace_events WHERE team_id = $1 ORDER BY created_at DESC LIMIT $2',
      [teamId, limit],
    );
    return rows;
  }

  async findByTask(taskId: string, limit = 100): Promise<TraceEvent[]> {
    const { rows } = await this.db.query<TraceEvent>(
      'SELECT * FROM trace_events WHERE task_id = $1 ORDER BY created_at DESC LIMIT $2',
      [taskId, limit],
    );
    return rows;
  }
}
