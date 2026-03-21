/**
 * task-state.repository.ts — CRUD layer for the tasks table in gamma-state.db
 *
 * Manages persistent task state for inter-agent delegation.
 * Uses raw SQL + prepared statements (no ORM), matching the AgentStateRepository pattern.
 *
 * Safety invariants:
 * - Terminal states (done, failed) are immutable — updateStatus/setResult
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

export type TaskStatus = 'backlog' | 'pending' | 'in_progress' | 'review' | 'done' | 'failed';

export type TaskKind = 'generic' | 'design' | 'backend' | 'frontend' | 'qa' | 'devops' | 'content' | 'research';

/** Valid forward transitions in the task state machine. */
const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  backlog: ['pending', 'in_progress', 'failed'],
  pending: ['in_progress', 'done', 'failed'],
  in_progress: ['review', 'done', 'failed'],
  review: ['done', 'failed'],
  done: [],
  failed: [],
};

export interface TaskRecord {
  id: string;
  title: string;
  sourceAgentId: string;
  targetAgentId: string | null;
  teamId: string | null;
  projectId: string | null;
  kind: TaskKind;
  priority: number;
  status: TaskStatus;
  payload: string;
  result: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Raw SQLite row shape (snake_case columns) */
interface TaskRow {
  id: string;
  title: string;
  source_agent_id: string;
  target_agent_id: string | null;
  team_id: string | null;
  project_id: string | null;
  kind: TaskKind;
  priority: number;
  status: TaskStatus;
  payload: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}

export interface TaskFindFilters {
  status?: TaskStatus;
  kind?: TaskKind;
  limit?: number;
  offset?: number;
}

export interface TaskStatusCounts {
  backlog: number;
  pending: number;
  in_progress: number;
  review: number;
  done: number;
  failed: number;
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

@Injectable()
export class TaskStateRepository {
  private readonly logger = new Logger(TaskStateRepository.name);
  public readonly db: DatabaseType;

  // Prepared statements
  private _stmtInsert!: Statement;
  private _stmtFindById!: Statement;
  private _stmtFindByTarget!: Statement;
  private _stmtFindBySource!: Statement;
  private _stmtUpdateStatus!: Statement;
  private _stmtSetResult!: Statement;
  private _stmtFindStale!: Statement;
  private _stmtClearAssignment!: Statement;

  constructor() {
    this.db = getStateDb();
    this.prepareStatements();
    this.logger.log('TaskStateRepository initialized (gamma-state.db)');
  }

  // ── Prepared Statements ──────────────────────────────────────────────

  private prepareStatements(): void {
    this._stmtInsert = this.db.prepare(`
      INSERT INTO tasks (id, title, source_agent_id, target_agent_id, team_id, project_id, kind, priority, status, payload, result, created_at, updated_at)
      VALUES (@id, @title, @source_agent_id, @target_agent_id, @team_id, @project_id, @kind, @priority, @status, @payload, @result, @created_at, @updated_at)
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
      WHERE id = @id AND status NOT IN ('done', 'failed')
    `);

    this._stmtSetResult = this.db.prepare(`
      UPDATE tasks SET status = @status, result = @result, updated_at = @updated_at
      WHERE id = @id AND status NOT IN ('done', 'failed')
    `);

    this._stmtFindStale = this.db.prepare(`
      SELECT * FROM tasks
      WHERE status IN ('backlog', 'pending', 'in_progress', 'review')
        AND updated_at < ?
      ORDER BY updated_at ASC
    `);

    this._stmtClearAssignment = this.db.prepare(`
      UPDATE tasks SET target_agent_id = NULL, status = 'backlog', updated_at = ?
      WHERE id = ?
    `);
  }

  // ── Public API ───────────────────────────────────────────────────────

  /** Insert a new task record. */
  insert(record: TaskRecord): void {
    this._stmtInsert.run({
      id: record.id,
      title: record.title,
      source_agent_id: record.sourceAgentId,
      target_agent_id: record.targetAgentId,
      team_id: record.teamId,
      project_id: record.projectId,
      kind: record.kind,
      priority: record.priority,
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

  /** Find all tasks for a given team, with optional filters. */
  findByTeam(teamId: string, filters?: TaskFindFilters): TaskRecord[] {
    const conditions: string[] = ['team_id = ?'];
    const params: unknown[] = [teamId];

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
    return rows.map((r) => this.toRecord(r));
  }

  /** Find all tasks for a given project, with optional filters. */
  findByProject(projectId: string, filters?: TaskFindFilters): TaskRecord[] {
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
    return rows.map((r) => this.toRecord(r));
  }

  /** Return status counts for a project (for donut charts). */
  countByProject(projectId: string): TaskStatusCounts {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as count FROM tasks WHERE project_id = ? GROUP BY status`)
      .all(projectId) as { status: TaskStatus; count: number }[];

    const counts: TaskStatusCounts = {
      backlog: 0,
      pending: 0,
      in_progress: 0,
      review: 0,
      done: 0,
      failed: 0,
    };

    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  /**
   * Update task status only.
   *
   * Enforces the state machine: transitions from terminal states (done/failed)
   * are silently rejected at the SQL level (WHERE clause).
   *
   * @returns true if the row was actually updated, false if rejected
   */
  updateStatus(id: string, status: TaskStatus): boolean {
    const current = this.findById(id);
    if (current && !VALID_TRANSITIONS[current.status]?.includes(status)) {
      this.logger.warn(
        `Rejected task state transition: ${id} ${current.status} -> ${status}`,
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
   * Enforces the state machine: transitions from terminal states (done/failed)
   * are silently rejected at the SQL level (WHERE clause).
   *
   * @returns true if the row was actually updated, false if rejected
   */
  setResult(id: string, status: TaskStatus, result: string): boolean {
    const current = this.findById(id);
    if (current && !VALID_TRANSITIONS[current.status]?.includes(status)) {
      this.logger.warn(
        `Rejected task state transition: ${id} ${current.status} -> ${status}`,
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

  /** Clear target agent assignment and reset status to backlog. */
  clearAssignment(taskId: string): boolean {
    const result = this._stmtClearAssignment.run(Date.now(), taskId);
    return result.changes > 0;
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
