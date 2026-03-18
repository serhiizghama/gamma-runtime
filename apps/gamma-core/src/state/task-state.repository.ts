/**
 * task-state.repository.ts — CRUD layer for the tasks table in gamma-state.db
 *
 * Manages persistent task state for inter-agent delegation.
 * Uses raw SQL + prepared statements (no ORM), matching the AgentStateRepository pattern.
 *
 * Safety invariants:
 * - Terminal states (completed, failed) are immutable — updateStatus/setResult
 *   reject transitions from terminal states.
 * - All writes are synchronous (better-sqlite3) so there are no intra-process
 *   race conditions.
 * - Payload/result sizes should be validated by the caller (IpcRoutingService)
 *   before reaching this layer.
 */

import { Injectable, Logger } from '@nestjs/common';
import type { Database as DatabaseType, Statement } from 'better-sqlite3';
import { getStateDb } from './state-db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** Valid forward transitions in the task state machine. */
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ['in_progress', 'completed', 'failed'],
  in_progress: ['completed', 'failed'],
  completed: [],
  failed: [],
};

export interface TaskRecord {
  id: string;
  sourceAgentId: string;
  targetAgentId: string;
  status: TaskStatus;
  payload: string;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Raw SQLite row shape (snake_case columns) */
interface TaskRow {
  id: string;
  source_agent_id: string;
  target_agent_id: string;
  status: TaskStatus;
  payload: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TaskStateRepository {
  private readonly logger = new Logger(TaskStateRepository.name);
  private readonly db: DatabaseType;

  // Prepared statements
  private _stmtInsert!: Statement;
  private _stmtFindById!: Statement;
  private _stmtFindByTarget!: Statement;
  private _stmtFindBySource!: Statement;
  private _stmtUpdateStatus!: Statement;
  private _stmtSetResult!: Statement;
  private _stmtFindStale!: Statement;

  constructor() {
    this.db = getStateDb();
    this.prepareStatements();
    this.logger.log('TaskStateRepository initialized (gamma-state.db)');
  }

  // ── Prepared Statements ──────────────────────────────────────────────

  private prepareStatements(): void {
    this._stmtInsert = this.db.prepare(`
      INSERT INTO tasks (id, source_agent_id, target_agent_id, status, payload, result, created_at, updated_at)
      VALUES (@id, @source_agent_id, @target_agent_id, @status, @payload, @result, @created_at, @updated_at)
    `);

    this._stmtFindById = this.db.prepare(`
      SELECT * FROM tasks WHERE id = ?
    `);

    this._stmtFindByTarget = this.db.prepare(`
      SELECT * FROM tasks WHERE target_agent_id = ? ORDER BY created_at DESC
    `);

    this._stmtFindBySource = this.db.prepare(`
      SELECT * FROM tasks WHERE source_agent_id = ? ORDER BY created_at DESC
    `);

    this._stmtUpdateStatus = this.db.prepare(`
      UPDATE tasks SET status = @status, updated_at = @updated_at
      WHERE id = @id AND status NOT IN ('completed', 'failed')
    `);

    this._stmtSetResult = this.db.prepare(`
      UPDATE tasks SET status = @status, result = @result, updated_at = @updated_at
      WHERE id = @id AND status NOT IN ('completed', 'failed')
    `);

    this._stmtFindStale = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('pending', 'in_progress')
        AND updated_at < ?
      ORDER BY updated_at ASC
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Insert a new task record. */
  insert(record: TaskRecord): void {
    this._stmtInsert.run({
      id: record.id,
      source_agent_id: record.sourceAgentId,
      target_agent_id: record.targetAgentId,
      status: record.status,
      payload: record.payload,
      result: record.result,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
    });
  }

  /** Find a task by its ID. Returns null if not found. */
  findById(id: string): TaskRecord | null {
    const row = this._stmtFindById.get(id) as TaskRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /** Find all tasks assigned to a target agent. */
  findByTarget(targetAgentId: string): TaskRecord[] {
    const rows = this._stmtFindByTarget.all(targetAgentId) as TaskRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /** Find all tasks assigned by a source agent. */
  findBySource(sourceAgentId: string): TaskRecord[] {
    const rows = this._stmtFindBySource.all(sourceAgentId) as TaskRow[];
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Update task status only.
   *
   * Enforces the state machine: transitions from terminal states (completed/failed)
   * are silently rejected at the SQL level (WHERE clause).
   *
   * @returns true if the row was actually updated, false if rejected
   */
  updateStatus(id: string, status: TaskStatus): boolean {
    const current = this.findById(id);
    if (current && !VALID_TRANSITIONS[current.status]?.includes(status)) {
      this.logger.warn(
        `Rejected task state transition: ${id} ${current.status} → ${status}`,
      );
      return false;
    }

    const result = this._stmtUpdateStatus.run({
      status,
      updated_at: Date.now(),
      id,
    });
    return result.changes > 0;
  }

  /**
   * Update task status and set the result payload.
   *
   * Enforces the state machine: transitions from terminal states (completed/failed)
   * are silently rejected at the SQL level (WHERE clause).
   *
   * @returns true if the row was actually updated, false if rejected
   */
  setResult(id: string, status: TaskStatus, result: string): boolean {
    const current = this.findById(id);
    if (current && !VALID_TRANSITIONS[current.status]?.includes(status)) {
      this.logger.warn(
        `Rejected task state transition: ${id} ${current.status} → ${status}`,
      );
      return false;
    }

    const info = this._stmtSetResult.run({
      status,
      result,
      updated_at: Date.now(),
      id,
    });
    return info.changes > 0;
  }

  /**
   * Find tasks that have been stuck in non-terminal states longer than
   * the specified threshold. Useful for zombie task detection.
   *
   * @param olderThanMs — only return tasks with updatedAt < (now - olderThanMs)
   */
  findStale(olderThanMs: number): TaskRecord[] {
    const cutoff = Date.now() - olderThanMs;
    const rows = this._stmtFindStale.all(cutoff) as TaskRow[];
    return rows.map((r) => this.toRecord(r));
  }

  // ── Row mapping ──────────────────────────────────────────────────────

  private toRecord(row: TaskRow): TaskRecord {
    return {
      id: row.id,
      sourceAgentId: row.source_agent_id,
      targetAgentId: row.target_agent_id,
      status: row.status,
      payload: row.payload,
      result: row.result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
