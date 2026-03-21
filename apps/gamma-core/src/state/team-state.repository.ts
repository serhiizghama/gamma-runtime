/**
 * team-state.repository.ts — CRUD layer for the teams table in gamma-state.db
 *
 * Manages persistent team state for the Corporation feature.
 * Uses raw SQL + prepared statements (no ORM), matching the AgentStateRepository pattern.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { getStateDb } from './state-db';
import type { AgentStateRecord } from './agent-state.repository';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TeamStateRecord {
  id: string;
  name: string;
  description: string;
  blueprint: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Raw SQLite row shape (snake_case columns) */
interface TeamRow {
  id: string;
  name: string;
  description: string;
  blueprint: string | null;
  created_at: number;
  updated_at: number;
}

/** Raw SQLite row shape for agents (snake_case columns) */
interface AgentRow {
  id: string;
  name: string;
  role_id: string;
  avatar_emoji: string;
  ui_color: string;
  status: string;
  workspace_path: string;
  team_id: string | null;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TeamStateRepository {
  private readonly logger = new Logger(TeamStateRepository.name);
  public readonly db: DatabaseType;

  // Prepared statements
  private _stmtInsert!: Statement;
  private _stmtFindById!: Statement;
  private _stmtFindAll!: Statement;
  private _stmtDelete!: Statement;
  private _stmtFindMembers!: Statement;

  constructor() {
    this.db = getStateDb();
    this.prepareStatements();
    this.logger.log('TeamStateRepository initialized (gamma-state.db)');
  }

  // ── Prepared Statements ──────────────────────────────────────────────

  private prepareStatements(): void {
    this._stmtInsert = this.db.prepare(`
      INSERT INTO teams (id, name, description, blueprint, created_at, updated_at)
      VALUES (@id, @name, @description, @blueprint, @created_at, @updated_at)
    `);

    this._stmtFindById = this.db.prepare(`
      SELECT * FROM teams WHERE id = ?
    `);

    this._stmtFindAll = this.db.prepare(`
      SELECT * FROM teams ORDER BY created_at ASC
    `);

    this._stmtDelete = this.db.prepare(`
      DELETE FROM teams WHERE id = ?
    `);

    this._stmtFindMembers = this.db.prepare(`
      SELECT * FROM agents WHERE team_id = ? ORDER BY created_at ASC
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Insert a new team record. */
  insert(record: TeamStateRecord): void {
    this._stmtInsert.run({
      id: record.id,
      name: record.name,
      description: record.description,
      blueprint: record.blueprint,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  /** Find a team by its ID. Returns null if not found. */
  findById(id: string): TeamStateRecord | null {
    const row = this._stmtFindById.get(id) as TeamRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /** Return all teams. */
  findAll(): TeamStateRecord[] {
    const rows = this._stmtFindAll.all() as TeamRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /** Partial update of a team record. */
  update(id: string, fields: Partial<Omit<TeamStateRecord, 'id' | 'createdAt'>>): boolean {
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
    if (fields.blueprint !== undefined) {
      setClauses.push('blueprint = @blueprint');
      params['blueprint'] = fields.blueprint;
    }

    setClauses.push('updated_at = @updated_at');
    params['updated_at'] = fields.updatedAt ?? Date.now();

    const sql = `UPDATE teams SET ${setClauses.join(', ')} WHERE id = @id`;
    const result = this.db.prepare(sql).run(params);
    return result.changes > 0;
  }

  /** Delete a team by ID. */
  delete(id: string): boolean {
    const result = this._stmtDelete.run(id);
    return result.changes > 0;
  }

  /** Find all agents that belong to this team. */
  findMembers(teamId: string): AgentStateRecord[] {
    const rows = this._stmtFindMembers.all(teamId) as AgentRow[];
    return rows.map((r) => this.toAgentRecord(r));
  }

  // ── Row mapping ──────────────────────────────────────────────────────

  private toRecord(row: TeamRow): TeamStateRecord {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      blueprint: row.blueprint,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toAgentRecord(row: AgentRow): AgentStateRecord {
    return {
      id: row.id,
      name: row.name,
      roleId: row.role_id,
      avatarEmoji: row.avatar_emoji,
      uiColor: row.ui_color,
      status: row.status as AgentStateRecord['status'],
      workspacePath: row.workspace_path,
      teamId: row.team_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
