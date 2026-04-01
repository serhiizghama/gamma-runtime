import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Task, TaskStage } from '../common/types';
import { taskId } from '../common/ulid';

@Injectable()
export class TasksRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: {
    title: string;
    team_id: string;
    description?: string;
    project_id?: string;
    kind?: string;
    assigned_to?: string;
    created_by?: string;
    priority?: number;
  }): Promise<Task> {
    const now = Date.now();
    const id = taskId();
    const { rows } = await this.db.query<Task>(
      `INSERT INTO tasks (id, title, description, project_id, team_id, kind, assigned_to, created_by, priority, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        id,
        data.title,
        data.description ?? '',
        data.project_id ?? null,
        data.team_id,
        data.kind ?? 'generic',
        data.assigned_to ?? null,
        data.created_by ?? null,
        data.priority ?? 0,
        now,
        now,
      ],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      'SELECT * FROM tasks WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByProject(projectId: string): Promise<Task[]> {
    const { rows } = await this.db.query<Task>(
      'SELECT * FROM tasks WHERE project_id = $1 ORDER BY priority DESC, created_at ASC',
      [projectId],
    );
    return rows;
  }

  async findByTeam(teamId: string): Promise<Task[]> {
    const { rows } = await this.db.query<Task>(
      'SELECT * FROM tasks WHERE team_id = $1 ORDER BY priority DESC, created_at ASC',
      [teamId],
    );
    return rows;
  }

  async updateStage(id: string, stage: TaskStage): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      'UPDATE tasks SET stage = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [stage, Date.now(), id],
    );
    return rows[0] ?? null;
  }

  async setResult(id: string, result: string): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      `UPDATE tasks SET result = $1, stage = 'done', updated_at = $2 WHERE id = $3 RETURNING *`,
      [result, Date.now(), id],
    );
    return rows[0] ?? null;
  }

  async assignTo(id: string, agentId: string | null): Promise<Task | null> {
    const { rows } = await this.db.query<Task>(
      'UPDATE tasks SET assigned_to = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [agentId, Date.now(), id],
    );
    return rows[0] ?? null;
  }

  async failByTeam(teamId: string): Promise<void> {
    await this.db.query(
      `UPDATE tasks SET stage = 'failed', updated_at = $1 WHERE team_id = $2 AND stage NOT IN ('done', 'failed')`,
      [Date.now(), teamId],
    );
  }

  async unassignAgent(agentId: string): Promise<void> {
    await this.db.query(
      'UPDATE tasks SET assigned_to = NULL, updated_at = $1 WHERE assigned_to = $2',
      [Date.now(), agentId],
    );
  }
}
