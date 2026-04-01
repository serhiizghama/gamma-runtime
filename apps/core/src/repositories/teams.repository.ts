import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { Team } from '../common/types';
import { teamId } from '../common/ulid';

@Injectable()
export class TeamsRepository {
  constructor(private readonly db: DatabaseService) {}

  async create(data: { name: string; description?: string }): Promise<Team> {
    const now = Date.now();
    const id = teamId();
    const { rows } = await this.db.query<Team>(
      `INSERT INTO teams (id, name, description, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING *`,
      [id, data.name, data.description ?? '', now, now],
    );
    return rows[0];
  }

  async findAll(): Promise<Team[]> {
    const { rows } = await this.db.query<Team>(
      `SELECT * FROM teams WHERE status != 'archived' ORDER BY created_at DESC`,
    );
    return rows;
  }

  async findById(id: string): Promise<Team | null> {
    const { rows } = await this.db.query<Team>(
      'SELECT * FROM teams WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  async update(id: string, data: { name?: string; description?: string }): Promise<Team | null> {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(data.description);
    }

    if (fields.length === 0) return this.findById(id);

    fields.push(`updated_at = $${idx++}`);
    values.push(Date.now());
    values.push(id);

    const { rows } = await this.db.query<Team>(
      `UPDATE teams SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      values,
    );
    return rows[0] ?? null;
  }

  async archive(id: string): Promise<Team | null> {
    const { rows } = await this.db.query<Team>(
      `UPDATE teams SET status = 'archived', updated_at = $1 WHERE id = $2 RETURNING *`,
      [Date.now(), id],
    );
    return rows[0] ?? null;
  }
}
