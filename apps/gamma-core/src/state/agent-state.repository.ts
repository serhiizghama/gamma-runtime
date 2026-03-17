/**
 * agent-state.repository.ts — CRUD layer for the agents table in gamma-state.db
 *
 * Lightweight repository using raw SQL + prepared statements (no ORM).
 * Provides the persistent backing store for agent identity and lifecycle.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { getStateDb, closeStateDb } from './state-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgentStatus = 'active' | 'archived' | 'corrupted';

export interface AgentStateRecord {
  id: string;
  name: string;
  roleId: string;
  avatarEmoji: string;
  uiColor: string;
  status: AgentStatus;
  workspacePath: string;
  createdAt: number;
  updatedAt: number;
}

/** Raw SQLite row shape (snake_case columns) */
interface AgentRow {
  id: string;
  name: string;
  role_id: string;
  avatar_emoji: string;
  ui_color: string;
  status: AgentStatus;
  workspace_path: string;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class AgentStateRepository implements OnModuleDestroy {
  private readonly logger = new Logger(AgentStateRepository.name);
  private readonly db: DatabaseType;

  // Prepared statements (lazy-init for testability)
  private _stmtUpsert!: Statement;
  private _stmtFindById!: Statement;
  private _stmtFindAllActive!: Statement;
  private _stmtFindAll!: Statement;
  private _stmtUpdateStatus!: Statement;

  constructor() {
    this.db = getStateDb();
    this.prepareStatements();
    this.logger.log('AgentStateRepository initialized (gamma-state.db)');
  }

  onModuleDestroy(): void {
    closeStateDb();
    this.logger.log('gamma-state.db connection closed');
  }

  // ── Prepared Statements ──────────────────────────────────────────────

  private prepareStatements(): void {
    this._stmtUpsert = this.db.prepare(`
      INSERT INTO agents (id, name, role_id, avatar_emoji, ui_color, status, workspace_path, created_at, updated_at)
      VALUES (@id, @name, @role_id, @avatar_emoji, @ui_color, @status, @workspace_path, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        name           = excluded.name,
        role_id        = excluded.role_id,
        avatar_emoji   = excluded.avatar_emoji,
        ui_color       = excluded.ui_color,
        status         = excluded.status,
        workspace_path = excluded.workspace_path,
        updated_at     = excluded.updated_at
    `);

    this._stmtFindById = this.db.prepare(`
      SELECT * FROM agents WHERE id = ?
    `);

    this._stmtFindAllActive = this.db.prepare(`
      SELECT * FROM agents WHERE status = 'active' ORDER BY created_at ASC
    `);

    this._stmtFindAll = this.db.prepare(`
      SELECT * FROM agents ORDER BY created_at ASC
    `);

    this._stmtUpdateStatus = this.db.prepare(`
      UPDATE agents SET status = ?, updated_at = ? WHERE id = ?
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Insert or update an agent record. */
  upsert(record: AgentStateRecord): void {
    this._stmtUpsert.run({
      id: record.id,
      name: record.name,
      role_id: record.roleId,
      avatar_emoji: record.avatarEmoji,
      ui_color: record.uiColor,
      status: record.status,
      workspace_path: record.workspacePath,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  /** Mark an agent as archived (soft delete). */
  markArchived(id: string): void {
    this._stmtUpdateStatus.run('archived', Date.now(), id);
  }

  /** Mark an agent as corrupted (workspace missing, etc.). */
  markCorrupted(id: string): void {
    this._stmtUpdateStatus.run('corrupted', Date.now(), id);
  }

  /** Find a single agent by ID. Returns null if not found. */
  findById(id: string): AgentStateRecord | null {
    const row = this._stmtFindById.get(id) as AgentRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /** Return all agents with status = 'active'. */
  findAllActive(): AgentStateRecord[] {
    const rows = this._stmtFindAllActive.all() as AgentRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /** Return all agents regardless of status. */
  findAll(): AgentStateRecord[] {
    const rows = this._stmtFindAll.all() as AgentRow[];
    return rows.map((r) => this.toRecord(r));
  }

  // ── Row mapping ──────────────────────────────────────────────────────

  private toRecord(row: AgentRow): AgentStateRecord {
    return {
      id: row.id,
      name: row.name,
      roleId: row.role_id,
      avatarEmoji: row.avatar_emoji,
      uiColor: row.ui_color,
      status: row.status,
      workspacePath: row.workspace_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
