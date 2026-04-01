import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Agent } from '../common/types';
import { agentId } from '../common/ulid';

@Injectable()
export class AgentsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: {
    name: string;
    role_id: string;
    team_id: string;
    specialization?: string;
    description?: string;
    avatar_emoji?: string;
    is_leader?: boolean;
    workspace_path?: string;
  }): Promise<Agent> {
    const now = Date.now();
    const id = agentId();
    const { rows } = await this.db.query<Agent>(
      `INSERT INTO agents (id, name, role_id, team_id, specialization, description, avatar_emoji, is_leader, workspace_path, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        data.name,
        data.role_id,
        data.team_id,
        data.specialization ?? '',
        data.description ?? '',
        data.avatar_emoji ?? '🤖',
        data.is_leader ? 1 : 0,
        data.workspace_path ?? null,
        now,
        now,
      ],
    );
    return this.mapAgent(rows[0]);
  }

  async findAll(): Promise<Agent[]> {
    const { rows } = await this.db.query<Agent>(
      `SELECT * FROM agents WHERE status != 'archived' ORDER BY created_at DESC`,
    );
    return rows.map(this.mapAgent);
  }

  async findById(id: string): Promise<Agent | null> {
    const { rows } = await this.db.query<Agent>(
      'SELECT * FROM agents WHERE id = $1',
      [id],
    );
    return rows[0] ? this.mapAgent(rows[0]) : null;
  }

  async findByTeam(teamId: string): Promise<Agent[]> {
    const { rows } = await this.db.query<Agent>(
      `SELECT * FROM agents WHERE team_id = $1 AND status != 'archived' ORDER BY is_leader DESC, created_at ASC`,
      [teamId],
    );
    return rows.map(this.mapAgent);
  }

  async updateStatus(id: string, status: Agent['status']): Promise<Agent | null> {
    const { rows } = await this.db.query<Agent>(
      `UPDATE agents SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
      [status, Date.now(), id],
    );
    return rows[0] ? this.mapAgent(rows[0]) : null;
  }

  async updateSessionId(id: string, sessionId: string | null): Promise<void> {
    await this.db.query(
      'UPDATE agents SET session_id = $1, updated_at = $2 WHERE id = $3',
      [sessionId, Date.now(), id],
    );
  }

  async updateUsage(id: string, data: { context_tokens: number; total_turns: number }): Promise<void> {
    await this.db.query(
      'UPDATE agents SET context_tokens = $1, total_turns = $2, last_active_at = $3, updated_at = $3 WHERE id = $4',
      [data.context_tokens, data.total_turns, Date.now(), id],
    );
  }

  async resetSession(id: string): Promise<void> {
    await this.db.query(
      'UPDATE agents SET session_id = NULL, context_tokens = 0, updated_at = $1 WHERE id = $2',
      [Date.now(), id],
    );
  }

  async updateWorkspacePath(id: string, path: string): Promise<void> {
    await this.db.query(
      'UPDATE agents SET workspace_path = $1, updated_at = $2 WHERE id = $3',
      [path, Date.now(), id],
    );
  }

  async updateFields(id: string, fields: Record<string, unknown>): Promise<Agent | null> {
    const keys = Object.keys(fields);
    if (keys.length === 0) return this.findById(id);

    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const key of keys) {
      sets.push(`${key} = $${idx++}`);
      values.push(fields[key]);
    }

    sets.push(`updated_at = $${idx++}`);
    values.push(Date.now());
    values.push(id);

    const { rows } = await this.db.query<Agent>(
      `UPDATE agents SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ? this.mapAgent(rows[0]) : null;
  }

  async archiveByTeam(teamId: string): Promise<void> {
    await this.db.query(
      `UPDATE agents SET status = 'archived', updated_at = $1 WHERE team_id = $2`,
      [Date.now(), teamId],
    );
  }

  private mapAgent(row: Agent): Agent {
    return {
      ...row,
      is_leader: Boolean(row.is_leader),
    };
  }
}
