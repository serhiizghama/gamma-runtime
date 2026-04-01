import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Project, ProjectStatus } from '../common/types';
import { projectId } from '../common/ulid';

@Injectable()
export class ProjectsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: {
    name: string;
    team_id: string;
    description?: string;
  }): Promise<Project> {
    const now = Date.now();
    const id = projectId();
    const { rows } = await this.db.query<Project>(
      `INSERT INTO projects (id, name, description, team_id, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'planning', $5, $6)
       RETURNING *`,
      [id, data.name, data.description ?? '', data.team_id, now, now],
    );
    return rows[0];
  }

  async findById(id: string): Promise<Project | null> {
    const { rows } = await this.db.query<Project>(
      'SELECT * FROM projects WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async findByTeam(teamId: string): Promise<Project[]> {
    const { rows } = await this.db.query<Project>(
      'SELECT * FROM projects WHERE team_id = $1 ORDER BY created_at DESC',
      [teamId],
    );
    return rows;
  }

  async updateStatus(id: string, status: ProjectStatus): Promise<Project | null> {
    const { rows } = await this.db.query<Project>(
      'UPDATE projects SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [status, Date.now(), id],
    );
    return rows[0] ?? null;
  }

  async updatePlan(id: string, plan: string): Promise<Project | null> {
    const { rows } = await this.db.query<Project>(
      'UPDATE projects SET plan = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [plan, Date.now(), id],
    );
    return rows[0] ?? null;
  }

  async failByTeam(teamId: string): Promise<void> {
    await this.db.query(
      `UPDATE projects SET status = 'failed', updated_at = $1 WHERE team_id = $2 AND status IN ('planning', 'active')`,
      [Date.now(), teamId],
    );
  }
}
