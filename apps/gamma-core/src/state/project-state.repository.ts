/**
 * project-state.repository.ts — CRUD layer for the projects table in gamma-state.db
 *
 * Manages persistent project state for the Corporation feature.
 * Uses raw SQL + prepared statements (no ORM), matching the AgentStateRepository pattern.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { getStateDb } from './state-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProjectType = 'epic' | 'continuous';
export type ProjectStatus = 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';

export interface ProjectStateRecord {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  status: ProjectStatus;
  teamId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Raw SQLite row shape (snake_case columns) */
interface ProjectRow {
  id: string;
  name: string;
  description: string;
  type: ProjectType;
  status: ProjectStatus;
  team_id: string | null;
  created_at: number;
  updated_at: number;
}

/** Raw SQLite row shape for tasks (snake_case columns) */
interface TaskRow {
  id: string;
  title: string;
  source_agent_id: string;
  target_agent_id: string | null;
  team_id: string | null;
  project_id: string | null;
  kind: string;
  priority: number;
  status: string;
  payload: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectFindAllFilters {
  status?: ProjectStatus;
  type?: ProjectType;
  teamId?: string;
}

export interface ProjectTaskFilters {
  status?: string;
  kind?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class ProjectStateRepository {
  private readonly logger = new Logger(ProjectStateRepository.name);
  public readonly db: DatabaseType;

  // Prepared statements
  private _stmtInsert!: Statement;
  private _stmtFindById!: Statement;
  private _stmtDelete!: Statement;

  constructor() {
    this.db = getStateDb();
    this.prepareStatements();
    this.logger.log('ProjectStateRepository initialized (gamma-state.db)');
  }

  // ── Prepared Statements ──────────────────────────────────────────────

  private prepareStatements(): void {
    this._stmtInsert = this.db.prepare(`
      INSERT INTO projects (id, name, description, type, status, team_id, created_at, updated_at)
      VALUES (@id, @name, @description, @type, @status, @team_id, @created_at, @updated_at)
    `);

    this._stmtFindById = this.db.prepare(`
      SELECT * FROM projects WHERE id = ?
    `);

    this._stmtDelete = this.db.prepare(`
      DELETE FROM projects WHERE id = ?
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Insert a new project record. */
  insert(record: ProjectStateRecord): void {
    this._stmtInsert.run({
      id: record.id,
      name: record.name,
      description: record.description,
      type: record.type,
      status: record.status,
      team_id: record.teamId,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  /** Find a project by its ID. Returns null if not found. */
  findById(id: string): ProjectStateRecord | null {
    const row = this._stmtFindById.get(id) as ProjectRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /** Return all projects, optionally filtered by status, type, or teamId. */
  findAll(filters?: ProjectFindAllFilters): ProjectStateRecord[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.type) {
      conditions.push('type = ?');
      params.push(filters.type);
    }
    if (filters?.teamId) {
      conditions.push('team_id = ?');
      params.push(filters.teamId);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `SELECT * FROM projects ${where} ORDER BY created_at ASC`;
    const rows = this.db.prepare(sql).all(...params) as ProjectRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /** Partial update of a project record. */
  update(id: string, fields: Partial<Omit<ProjectStateRecord, 'id' | 'createdAt'>>): boolean {
    const existing = this.findById(id);
    if (!existing) return false;

    const setClauses: string[] = [];
    const params: Record<string, unknown> = { id };

    if (fields.name !== undefined) {
      setClauses.push('name = @name');
      params['name'] = fields.name;
    }
    if (fields.description !== undefined) {
      setClauses.push('description = @description');
      params['description'] = fields.description;
    }
    if (fields.type !== undefined) {
      setClauses.push('type = @type');
      params['type'] = fields.type;
    }
    if (fields.status !== undefined) {
      setClauses.push('status = @status');
      params['status'] = fields.status;
    }
    if (fields.teamId !== undefined) {
      setClauses.push('team_id = @team_id');
      params['team_id'] = fields.teamId;
    }

    setClauses.push('updated_at = @updated_at');
    params['updated_at'] = fields.updatedAt ?? Date.now();

    const sql = `UPDATE projects SET ${setClauses.join(', ')} WHERE id = @id`;
    const result = this.db.prepare(sql).run(params);
    return result.changes > 0;
  }

  /** Delete a project by ID. */
  delete(id: string): boolean {
    const result = this._stmtDelete.run(id);
    return result.changes > 0;
  }

  /** Find all tasks for a given project, with optional filters. */
  findTasks(projectId: string, filters?: ProjectTaskFilters): { id: string; title: string; sourceAgentId: string; targetAgentId: string | null; teamId: string | null; projectId: string | null; kind: string; priority: number; status: string; payload: string; result: string | null; createdAt: number; updatedAt: number }[] {
    const conditions: string[] = ['project_id = ?'];
    const params: unknown[] = [projectId];

    if (filters?.status) {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    if (filters?.kind) {
      conditions.push('kind = ?');
      params.push(filters.kind);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = filters?.limit ? `LIMIT ${filters.limit}` : '';
    const offset = filters?.offset ? `OFFSET ${filters.offset}` : '';
    const sql = `SELECT * FROM tasks ${where} ORDER BY priority DESC, created_at ASC ${limit} ${offset}`;
    const rows = this.db.prepare(sql).all(...params) as TaskRow[];
    return rows.map((r) => this.toTaskRecord(r));
  }

  // ── Row mapping ──────────────────────────────────────────────────────

  private toRecord(row: ProjectRow): ProjectStateRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      type: row.type,
      status: row.status,
      teamId: row.team_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toTaskRecord(row: TaskRow) {
    return {
      id: row.id,
      title: row.title,
      sourceAgentId: row.source_agent_id,
      targetAgentId: row.target_agent_id,
      teamId: row.team_id,
      projectId: row.project_id,
      kind: row.kind,
      priority: row.priority,
      status: row.status,
      payload: row.payload,
      result: row.result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
