# Phase 8 — "The Corporation"

> Transform Gamma OS from micro-managed point-to-point delegation into a backlog-driven, team-based autonomous ERP for AI agents.

**Status:** Draft
**Depends on:** Phase 7 (Syndicate Map, IPC routing, SQLite tasks, Agent Genesis)
**Outcome:** Human CEO drops business goals → System decomposes → Teams self-organize → Kanban tracks everything

---

## 1. Architecture Overview & Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CEO DASHBOARD (UI)                           │
│  Human drops goals: "Build calculator app" (Epic)                   │
│                      "Grow YouTube channel" (Continuous)             │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ POST /api/projects
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   SYSTEM ARCHITECT (Lead Decomposer)                │
│  Receives project → Decomposes into sub-tasks → Routes to teams    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ team_id assignment
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      TEAM BACKLOGS (SQLite Queues)                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                │
│  │ IT Dev Team  │  │ Content Team│  │ DevOps Team │  ...           │
│  │ Backlog      │  │ Backlog     │  │ Backlog     │                │
│  └──────┬───────┘  └──────┬──────┘  └──────┬──────┘                │
│         │                 │                 │                        │
│   Event-Driven    Event-Driven    Event-Driven                      │
│   Claim Model     Claim Model     Claim Model                       │
│         │                 │                 │                        │
│  ┌──────▼───────┐  ┌──────▼──────┐  ┌──────▼──────┐               │
│  │🏗 Architect   │  │✍ Writer     │  │🔧 SRE       │               │
│  │💻 Backend     │  │🎨 Designer  │  │📦 Builder   │               │
│  │🖼 Frontend    │  │📹 Editor    │  └─────────────┘               │
│  │🧪 QA          │  └─────────────┘                                │
│  └──────────────┘                                                   │
└─────────────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    KANBAN BOARD (UI)                                 │
│  ┌──────┐  ┌───────────┐  ┌────────┐  ┌──────┐                    │
│  │To Do │→ │In Progress│→ │ Review │→ │ Done │                     │
│  └──────┘  └───────────┘  └────────┘  └──────┘                    │
│  Filtered by team_id / project_id — Live via SSE                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Data Flow Summary:**

1. CEO creates a **Project** (epic or continuous) via dashboard
2. Activity event `project_created` is emitted → System Architect is woken
3. System Architect decomposes the project into **Tasks** with `team_id` (no `target_agent_id`)
4. Idle agents within the team **reactively claim** unassigned tasks matching their role capabilities (event-driven, not polling)
5. Agent works the task through the Kanban states: `backlog` → `in_progress` → `review` → `done`
6. Kanban Board and CEO Dashboard reflect real-time state via SSE activity stream

---

## 2. SQLite Schema — V3 Migration

**File:** `apps/gamma-core/src/state/state-db.ts` — add `migrateV3()` method

### 2.1 New Tables

```sql
-- Teams table
CREATE TABLE teams (
  id          TEXT PRIMARY KEY,       -- 'team.<ULID>'
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  blueprint   TEXT,                   -- JSON blueprint ID used to spawn this team (nullable)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE INDEX idx_teams_name ON teams(name);

-- Projects table
CREATE TABLE projects (
  id          TEXT PRIMARY KEY,       -- 'project.<ULID>'
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  type        TEXT NOT NULL CHECK(type IN ('epic', 'continuous')),
  status      TEXT NOT NULL DEFAULT 'planning'
              CHECK(status IN ('planning', 'active', 'paused', 'completed', 'cancelled')),
  team_id     TEXT,                   -- Primary team responsible (nullable for cross-team)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id)
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_team ON projects(team_id);
```

### 2.2 Altered Tables

#### `agents` — Simple ALTER (Safe)

SQLite `ALTER TABLE ADD COLUMN` is safe here because:
- The new column is **nullable** (no `NOT NULL` constraint)
- No `CHECK` constraint change on existing columns
- `better-sqlite3` handles this as a synchronous schema change
- `REFERENCES` clause is stored in schema and enforced at runtime by `PRAGMA foreign_keys = ON`

```sql
ALTER TABLE agents ADD COLUMN team_id TEXT REFERENCES teams(id);
CREATE INDEX idx_agents_team ON agents(team_id);
```

#### `tasks` — Full Recreate Required (Rename-Copy-Drop)

The `tasks` table **cannot** use simple `ALTER` because:
1. `target_agent_id` must become **nullable** (was `NOT NULL`) — SQLite cannot ALTER nullability
2. The `status` `CHECK` constraint must expand (`backlog`, `review`, `done` added) — SQLite cannot ALTER CHECK
3. New columns with `CHECK` constraints (`kind`) cannot be added via `ALTER TABLE ADD COLUMN` in SQLite

**Strategy:** Rename → Create new → Copy data → Drop old. This is the same pattern SQLite's own documentation recommends and is safe within a transaction (which our migration already wraps via `db.transaction()`).

**Updated Task Status State Machine:**

```
                    ┌─────────┐
                    │ backlog │  (team queue, unassigned)
                    └────┬────┘
                         │  agent pulls task
                         ▼
  ┌─────────┐      ┌─────────────┐      ┌────────┐      ┌──────┐
  │ pending │  →   │ in_progress │  →   │ review │  →   │ done │
  └─────────┘      └─────────────┘      └────────┘      └──────┘
       │                  │
       └──────────────────┴──────────────→ failed
```

**V3 migration also updates the `status` CHECK constraint on `tasks`:**

```sql
-- Recreate tasks table with expanded status (SQLite doesn't support ALTER CHECK)
-- Done via the standard rename-copy-drop pattern in migrateV3()
-- New statuses: 'backlog', 'pending', 'in_progress', 'review', 'done', 'failed'
```

### 2.3 Migration Implementation

**Critical:** The existing migration system in `state-db.ts` wraps all migrations in a single `db.transaction()` call (line 108). This means V3 runs atomically — if any statement fails, the entire migration rolls back and the DB stays at V2. We must **temporarily disable foreign keys** during the rename-copy-drop of `tasks` (SQLite requires this when rewriting tables that are FK targets).

```typescript
// In state-db.ts:
// 1. Update CURRENT_SCHEMA_VERSION to 3
// 2. Add `if (currentVersion < 3) migrateToV3(db);` in applyMigrations()
// 3. Add the migration function:

function migrateToV3(db: DatabaseType): void {
  // Must disable FK enforcement during table rebuild (SQLite requirement).
  // Re-enabled after migration. Safe because we're inside a transaction.
  db.pragma('foreign_keys = OFF');

  // ── Step 1: Create new tables ─────────────────────────────────────
  db.exec(`
    CREATE TABLE teams (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      blueprint TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE INDEX idx_teams_name ON teams(name);

    CREATE TABLE projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL CHECK(type IN ('epic', 'continuous')),
      status TEXT NOT NULL DEFAULT 'planning'
        CHECK(status IN ('planning', 'active', 'paused', 'completed', 'cancelled')),
      team_id TEXT,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id)
    );
    CREATE INDEX idx_projects_status ON projects(status);
    CREATE INDEX idx_projects_team ON projects(team_id);
  `);

  // ── Step 2: ALTER agents (safe — nullable column, no CHECK change) ─
  db.exec(`
    ALTER TABLE agents ADD COLUMN team_id TEXT REFERENCES teams(id);
    CREATE INDEX idx_agents_team ON agents(team_id);
  `);

  // ── Step 3: Recreate tasks (rename-copy-drop) ─────────────────────
  db.exec(`
    ALTER TABLE tasks RENAME TO _tasks_v2;

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      source_agent_id TEXT NOT NULL,
      target_agent_id TEXT,                   -- NOW NULLABLE (was NOT NULL)
      team_id TEXT,
      project_id TEXT,
      kind TEXT NOT NULL DEFAULT 'generic'
        CHECK(kind IN ('generic','design','backend','frontend','qa','devops','content','research')),
      priority INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'backlog'
        CHECK(status IN ('backlog','pending','in_progress','review','done','failed')),
      payload TEXT NOT NULL DEFAULT '{}',
      result TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (team_id) REFERENCES teams(id),
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );

    -- Migrate data: map 'completed' → 'done', preserve all other statuses
    INSERT INTO tasks (id, title, source_agent_id, target_agent_id, status, payload, result, created_at, updated_at)
      SELECT id, '', source_agent_id, target_agent_id,
        CASE status WHEN 'completed' THEN 'done' ELSE status END,
        payload, result, created_at, updated_at
      FROM _tasks_v2;

    DROP TABLE _tasks_v2;

    -- Rebuild indexes on new table
    CREATE INDEX idx_tasks_source ON tasks(source_agent_id);
    CREATE INDEX idx_tasks_target ON tasks(target_agent_id);
    CREATE INDEX idx_tasks_status ON tasks(status);
    CREATE INDEX idx_tasks_team ON tasks(team_id);
    CREATE INDEX idx_tasks_project ON tasks(project_id);
    CREATE INDEX idx_tasks_kind ON tasks(kind);
  `);

  // ── Step 4: FK integrity check ────────────────────────────────────
  // Verify no FK violations were introduced during rebuild
  const fkCheck = db.pragma('foreign_key_check') as unknown[];
  if (fkCheck.length > 0) {
    throw new Error(`V3 migration FK violation: ${JSON.stringify(fkCheck)}`);
  }

  // Re-enable foreign keys
  db.pragma('foreign_keys = ON');
}
```

> **Migration safety notes:**
> - `PRAGMA foreign_keys = OFF` is required by SQLite when doing rename-copy-drop on tables involved in FK relationships. It's re-enabled immediately after with a `foreign_key_check` integrity assertion.
> - The `db.transaction()` wrapper in `applyMigrations()` ensures atomicity — a crash mid-migration leaves the DB untouched.
> - `better-sqlite3` is synchronous, so no other queries can interleave during migration.
> - Existing V2 tasks with `status='completed'` are mapped to `'done'`. All other statuses (`pending`, `in_progress`, `failed`) are preserved as-is.

> **Note:** `target_agent_id` becomes nullable. When a task is assigned to a `team_id` with no `target_agent_id`, it enters the team backlog (Pull Model). Legacy point-to-point delegation still works when `target_agent_id` is set.

---

## 3. Backend API Additions (NestJS)

### 3.1 New Modules

#### `TeamsModule`

**Files to create:**
- `apps/gamma-core/src/teams/teams.module.ts`
- `apps/gamma-core/src/teams/teams.controller.ts`
- `apps/gamma-core/src/teams/teams.service.ts`
- `apps/gamma-core/src/teams/team-blueprint.service.ts`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/teams` | List all teams |
| `POST` | `/api/teams` | Create team manually |
| `GET` | `/api/teams/:id` | Get team details + members |
| `PATCH` | `/api/teams/:id` | Update team metadata |
| `DELETE` | `/api/teams/:id` | Archive team (moves agents to unassigned) |
| `GET` | `/api/teams/:id/backlog` | Get team's task backlog (filterable by status, kind, paginated: `?limit=50&offset=0`) |
| `POST` | `/api/teams/spawn-blueprint` | Spawn a team from a blueprint template |

#### `ProjectsModule`

**Files to create:**
- `apps/gamma-core/src/projects/projects.module.ts`
- `apps/gamma-core/src/projects/projects.controller.ts`
- `apps/gamma-core/src/projects/projects.service.ts`
- `apps/gamma-core/src/projects/project-decomposer.service.ts`

**Endpoints:**

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List all projects (filterable by status, type, team_id) |
| `POST` | `/api/projects` | Create project (CEO action) — triggers decomposition |
| `GET` | `/api/projects/:id` | Get project details + task breakdown |
| `PATCH` | `/api/projects/:id` | Update project (status transitions, reassign team) |
| `DELETE` | `/api/projects/:id` | Cancel project |
| `GET` | `/api/projects/:id/tasks` | Get tasks for project (Kanban data source, paginated: `?status=backlog,in_progress&limit=50&offset=0`) |

### 3.2 State Repositories

**Files to create:**
- `apps/gamma-core/src/state/team-state.repository.ts`
- `apps/gamma-core/src/state/project-state.repository.ts`

**TeamStateRepository:**
```typescript
class TeamStateRepository {
  insert(record: TeamRecord): void;
  findById(id: string): TeamRecord | undefined;
  findAll(): TeamRecord[];
  update(id: string, fields: Partial<TeamRecord>): void;
  delete(id: string): void;
  findMembers(teamId: string): AgentRecord[];
}
```

**ProjectStateRepository:**
```typescript
class ProjectStateRepository {
  insert(record: ProjectRecord): void;
  findById(id: string): ProjectRecord | undefined;
  findAll(filters?: { status?: string; type?: string; teamId?: string }): ProjectRecord[];
  update(id: string, fields: Partial<ProjectRecord>): void;
  delete(id: string): void;
  findTasks(projectId: string, filters?: { status?: string; kind?: string }): TaskRecord[];
}
```

### 3.3 Updated TaskStateRepository

Add methods to `apps/gamma-core/src/state/task-state.repository.ts`:

```typescript
// New query methods
findByTeam(teamId: string, filters?: { status?: string[]; kind?: string; limit?: number; offset?: number }): TaskRecord[];
findByProject(projectId: string, filters?: { status?: string[]; limit?: number; offset?: number }): TaskRecord[];
countByProject(projectId: string): Record<string, number>;  // status → count (for donut charts)

// Assignment management
clearAssignment(taskId: string): void;    // SET target_agent_id = NULL (for requeue on agent failure)

// Note: Atomic find-and-claim is handled by TaskClaimService via raw db.prepare()
// (see §3.5) — not exposed as a repository method to keep the atomic SQL self-contained.
```

**Pagination:** All list methods accept `limit` (default 50, max 200) and `offset` for cursor-based pagination. This is critical for the Kanban Done column (see §4.3).

### 3.4 IPC Routing Updates

**File:** `apps/gamma-core/src/ipc/ipc-routing.service.ts`

Update `delegateTask()` to support team-based delegation:

```typescript
interface DelegateTaskPayload {
  sourceAgentId: string;
  targetAgentId?: string;     // Optional now — if absent, uses teamId
  teamId?: string;            // New — assign to team backlog
  projectId?: string;         // New — link to project
  title: string;              // New — human-readable task title
  taskDescription: string;
  kind?: TaskKind;            // New — task type for role matching
  priority?: number;          // New — 0=normal, 1=high, 2=critical
}
```

**Validation changes:**
- If `targetAgentId` is set → existing point-to-point flow (unchanged)
- If `teamId` is set without `targetAgentId` → insert task with `status='backlog'` into team queue
- At least one of `targetAgentId` or `teamId` must be provided
- `teamId` must reference an existing team

### 3.5 Task Claim Service — Event-Driven Model (New)

**File:** `apps/gamma-core/src/teams/task-claim.service.ts`

> **Architecture Decision:** This system is fundamentally event-driven (Redis Streams, SSE, agent inboxes). Polling would introduce unnecessary latency and DB load. Instead, we use **NestJS EventEmitter2** (`@nestjs/event-emitter`) for internal service-to-service signals, keeping the claim logic fully reactive.
>
> **Why not ActivityStreamService?** The activity stream writes to Redis and is designed for external consumers (frontend SSE, dashboards). Internal service events need synchronous, in-process dispatch with zero Redis overhead. EventEmitter2 provides typed, in-process pub/sub — the right tool for this job.

**Dependency:** `@nestjs/event-emitter` — add to `apps/gamma-core/package.json`, register `EventEmitterModule.forRoot()` in `app.module.ts`.

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';

// ── Internal Events (typed, in-process only) ──────────────────────

/** Emitted by AgentRegistryService when an agent transitions to idle. */
interface AgentIdleEvent {
  agentId: string;
  teamId: string | null;
  roleId: string;
}

/** Emitted by IpcRoutingService when a task enters a team backlog. */
interface BacklogTaskCreatedEvent {
  taskId: string;
  teamId: string;
  kind: TaskKind;
}

/** Emitted by AgentRegistryService when an agent deregisters/goes offline. */
interface AgentOfflineEvent {
  agentId: string;
}

@Injectable()
class TaskClaimService {
  private readonly logger = new Logger(TaskClaimService.name);

  // Role-to-task-kind mapping
  private readonly ROLE_CAPABILITIES: Record<string, TaskKind[]> = {
    'dev/system-architect':   ['design', 'research', 'generic'],
    'dev/senior-developer':   ['backend', 'frontend', 'generic'],
    'dev/backend-developer':  ['backend', 'generic'],
    'dev/frontend-developer': ['frontend', 'generic'],
    'dev/qa-engineer':        ['qa', 'generic'],
    'dev/devops-engineer':    ['devops', 'generic'],
    'content/writer':         ['content', 'research', 'generic'],
  };

  constructor(
    private readonly taskRepo: TaskStateRepository,
    private readonly agentRepo: AgentStateRepository,
    private readonly agentRegistry: AgentRegistryService,
    private readonly messageBus: MessageBusService,
    private readonly activityStream: ActivityStreamService,
    private readonly sessions: SessionsService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ── Event Handlers (reactive, no polling) ───────────────────────

  /**
   * Trigger 1: Agent becomes idle → try to claim a task for it.
   * Fired by AgentRegistryService on status transition to 'idle'.
   */
  @OnEvent('agent.idle')
  async onAgentIdle(event: AgentIdleEvent): Promise<void> {
    if (!event.teamId) return; // Unassigned agents don't claim
    await this.claimForAgent(event.agentId, event.teamId, event.roleId);
  }

  /**
   * Trigger 2: New task enters team backlog → find an idle agent to claim it.
   * Fired by IpcRoutingService / create_team_task tool handler.
   */
  @OnEvent('backlog.task.created')
  async onBacklogTaskCreated(event: BacklogTaskCreatedEvent): Promise<void> {
    await this.matchTaskToIdleAgent(event.teamId, event.kind);
  }

  /**
   * Trigger 3: Agent goes offline → requeue its in-progress tasks.
   * Fired by AgentRegistryService on deregistration.
   */
  @OnEvent('agent.offline')
  async onAgentOffline(event: AgentOfflineEvent): Promise<void> {
    await this.requeueOrphanedTasks(event.agentId);
  }

  // ── Core Claim Logic ────────────────────────────────────────────

  /**
   * Atomically claim the highest-priority task matching this agent's capabilities.
   *
   * CONCURRENCY SAFETY:
   * better-sqlite3 is synchronous and Node.js is single-threaded, so there
   * are no true intra-process race conditions. However, there IS a TOCTOU risk
   * if we SELECT then UPDATE with an async gap between them (e.g., an await
   * to check agent status could yield the event loop, allowing another claim
   * to succeed first).
   *
   * Solution: Use a single atomic UPDATE...WHERE subquery so the find-and-claim
   * happens in one synchronous SQLite call with zero event-loop yields between
   * the read and the write.
   *
   * NOTE: A Redis distributed lock is NOT needed here because:
   * 1. better-sqlite3 is synchronous (no concurrent SQLite access within process)
   * 2. gamma-core is a single-process server (no multi-instance deployment)
   * 3. The atomic SQL statement eliminates the TOCTOU window entirely
   * If we ever move to multi-instance deployment, we would need Redis SETNX
   * or Redlock — but that's a future concern, not a Phase 8 requirement.
   */
  private claimForAgent(
    agentId: string,
    teamId: string,
    roleId: string,
  ): TaskRecord | null {
    const kinds = this.ROLE_CAPABILITIES[roleId] ?? ['generic'];
    const kindPlaceholders = kinds.map(() => '?').join(',');
    const now = Date.now();

    // Atomic find-and-claim in a single synchronous SQLite statement.
    // The subquery finds the best candidate; the outer UPDATE claims it.
    // If another agent claimed it between event dispatch and here (impossible
    // in single-threaded Node, but defensive), the WHERE clause prevents
    // double-claiming.
    const stmt = this.taskRepo.db.prepare(`
      UPDATE tasks
      SET target_agent_id = ?,
          status = 'pending',
          updated_at = ?
      WHERE id = (
        SELECT id FROM tasks
        WHERE team_id = ?
          AND target_agent_id IS NULL
          AND status = 'backlog'
          AND kind IN (${kindPlaceholders})
        ORDER BY priority DESC, created_at ASC
        LIMIT 1
      )
      AND target_agent_id IS NULL
      RETURNING *
    `);

    const row = stmt.get(agentId, now, teamId, ...kinds) as TaskRow | undefined;
    if (!row) return null;

    const task = this.toRecord(row);

    // Deliver task to agent's inbox + wake if needed (async, fire-and-forget)
    this.deliverClaimedTask(agentId, task);

    // Emit activity event for dashboard/SSE consumers
    this.activityStream.emit({
      kind: 'task_claimed',
      agentId,
      payload: JSON.stringify({ taskId: task.id, kind: task.kind }),
      severity: 'info',
    });

    this.logger.log(`Agent ${agentId} claimed task ${task.id} (${task.kind})`);
    return task;
  }

  /**
   * When a new task enters the backlog, find the best idle agent to claim it.
   */
  private async matchTaskToIdleAgent(teamId: string, taskKind: TaskKind): Promise<void> {
    // Find idle agents in this team from the live registry
    const members = this.agentRepo.findByTeam(teamId);
    for (const member of members) {
      const registryEntry = await this.agentRegistry.getOne(member.id);
      if (!registryEntry || registryEntry.status !== 'idle') continue;

      const capabilities = this.ROLE_CAPABILITIES[member.roleId] ?? ['generic'];
      if (!capabilities.includes(taskKind)) continue;

      // Try to claim — if this task was already claimed by a concurrent event, returns null
      const claimed = this.claimForAgent(member.id, teamId, member.roleId);
      if (claimed) return; // Task is assigned, done
    }
    // No idle agent available — task stays in backlog until an agent goes idle
  }

  /**
   * Requeue tasks that were in_progress for an agent that went offline.
   */
  private requeueOrphanedTasks(agentId: string): void {
    const orphaned = this.taskRepo.findByTarget(agentId)
      .filter(t => t.status === 'in_progress' || t.status === 'pending');

    for (const task of orphaned) {
      this.taskRepo.updateStatus(task.id, 'backlog');
      this.taskRepo.clearAssignment(task.id); // SET target_agent_id = NULL

      this.activityStream.emit({
        kind: 'task_status_change',
        agentId,
        payload: JSON.stringify({ taskId: task.id, from: task.status, to: 'backlog', reason: 'agent_offline' }),
        severity: 'warn',
      });

      // Notify team so another agent can pick it up
      if (task.teamId) {
        this.eventEmitter.emit('backlog.task.created', {
          taskId: task.id,
          teamId: task.teamId,
          kind: task.kind,
        });
      }
    }

    if (orphaned.length > 0) {
      this.logger.warn(`Requeued ${orphaned.length} orphaned tasks from agent ${agentId}`);
    }
  }

  private async deliverClaimedTask(agentId: string, task: TaskRecord): Promise<void> {
    // Deliver via MessageBusService + wake agent (same pattern as IpcRoutingService)
    await this.messageBus.send(
      task.sourceAgentId, agentId, 'task_request',
      `Claimed task [${task.id}]`,
      { taskId: task.id, description: task.payload, priority: task.priority },
    );
    // Wake agent via SessionsService if idle (reuses existing ensureAgentAwake pattern)
  }
}
```

**Integration points — Event Emitters to add:**

| Service | Event | When |
|---------|-------|------|
| `AgentRegistryService` | `eventEmitter.emit('agent.idle', { agentId, teamId, roleId })` | Agent status transitions to `idle` |
| `AgentRegistryService` | `eventEmitter.emit('agent.offline', { agentId })` | Agent deregisters or disconnects |
| `IpcRoutingService` | `eventEmitter.emit('backlog.task.created', { taskId, teamId, kind })` | Task inserted with `status='backlog'` |
| `create_team_task` tool | `eventEmitter.emit('backlog.task.created', { taskId, teamId, kind })` | Architect creates team task |

**New TaskStateRepository methods needed:**

```typescript
// Atomic claim (used internally by TaskClaimService via raw db.prepare)
// clearAssignment — for requeue on agent failure
clearAssignment(taskId: string): void {
  this.db.prepare('UPDATE tasks SET target_agent_id = NULL, updated_at = ? WHERE id = ?')
    .run(Date.now(), taskId);
}
// findByTeam — agents in a team
findByTeam(teamId: string): TaskRecord[] { ... }
```

### 3.6 Team Blueprint Service

**File:** `apps/gamma-core/src/teams/team-blueprint.service.ts`

```typescript
interface TeamBlueprint {
  id: string;                    // e.g. 'it-dev-team'
  name: string;                  // e.g. 'IT Development Team'
  description: string;
  members: BlueprintMember[];
}

interface BlueprintMember {
  roleId: string;                // e.g. 'dev/system-architect'
  name: string;                  // e.g. 'Architect-1'
  count: number;                 // How many to spawn (default 1)
  systemPromptOverride?: string; // Additional context injected into SOUL.md
}

@Injectable()
class TeamBlueprintService {
  // Built-in blueprints loaded from data/blueprints/*.json
  // Custom blueprints can be registered at runtime

  async spawnFromBlueprint(blueprintId: string): Promise<{
    team: TeamRecord;
    agents: AgentRecord[];
  }> {
    // 1. Load blueprint definition
    // 2. Create team record in SQLite
    // 3. For each member in blueprint:
    //    a. Call AgentCreatorService.createAgent() with role
    //    b. Set agent's team_id to new team
    //    c. Inject team context into workspace generation delegation:
    //       "You are part of team '{teamName}'. Your teammates are: [list].
    //        Your role within the team: {role description}.
    //        Team workflow: Pick tasks from your team's backlog that match your skills."
    // 4. Emit 'team_spawned' activity event
    // 5. Return team + agents
  }
}
```

**Blueprint storage:** `data/blueprints/` directory with JSON files.

**Example blueprint — `data/blueprints/it-dev-team.json`:**
```json
{
  "id": "it-dev-team",
  "name": "IT Development Team",
  "description": "Full-stack development team for building software applications",
  "members": [
    {
      "roleId": "dev/system-architect",
      "name": "Lead Architect",
      "count": 1
    },
    {
      "roleId": "dev/frontend-developer",
      "name": "Frontend Dev",
      "count": 1
    },
    {
      "roleId": "dev/backend-developer",
      "name": "Backend Dev",
      "count": 1
    },
    {
      "roleId": "dev/qa-engineer",
      "name": "QA Engineer",
      "count": 1
    }
  ]
}
```

### 3.7 Project Decomposer Service

**File:** `apps/gamma-core/src/projects/project-decomposer.service.ts`

When a project is created, the System Architect agent is tasked with breaking it down.

```typescript
@Injectable()
class ProjectDecomposerService {
  async decompose(project: ProjectRecord): Promise<void> {
    // 1. Find the system-architect agent (or first available architect)
    // 2. Delegate a meta-task via IPC:
    //    "Decompose the following project into actionable sub-tasks.
    //     Project: {name}
    //     Description: {description}
    //     Type: {type}
    //     Target team: {team_id}
    //
    //     For each sub-task, call the 'create_team_task' tool with:
    //     - title, description, kind (design|backend|frontend|qa|devops|content|research), priority
    //
    //     Guidelines:
    //     - Epic projects: finite set of tasks leading to a deliverable
    //     - Continuous projects: recurring/iterative tasks with no fixed end"
    // 3. The architect agent uses a new 'create_team_task' tool to create
    //    individual tasks in the team backlog
    // 4. Update project status from 'planning' to 'active'
  }
}
```

### 3.8 New Tool Definitions

**`create_team_task` tool** — `apps/gamma-core/src/tools/create-team-task.tool.ts`

Allows architect agents to create tasks in a team's backlog without specifying an individual target.

```typescript
{
  name: 'create_team_task',
  description: 'Create a task in a team backlog. The task will be automatically picked up by a qualified team member.',
  parameters: {
    teamId: { type: 'string', description: 'Target team ID' },
    projectId: { type: 'string', description: 'Parent project ID (optional)' },
    title: { type: 'string', description: 'Short task title' },
    description: { type: 'string', description: 'Detailed task description' },
    kind: { type: 'string', enum: ['design','backend','frontend','qa','devops','content','research','generic'] },
    priority: { type: 'number', enum: [0, 1, 2], description: '0=normal, 1=high, 2=critical' },
  },
  allowedRoles: ['architect'],
}
```

**`update_task_status` tool** — `apps/gamma-core/src/tools/update-task-status.tool.ts`

Extends `report_status` to support the Kanban flow:

```typescript
{
  name: 'update_task_status',
  description: 'Update a task status through the Kanban workflow.',
  parameters: {
    taskId: { type: 'string' },
    status: { type: 'string', enum: ['in_progress', 'review', 'done', 'failed'] },
    message: { type: 'string', description: 'Status update message' },
    data: { type: 'string', description: 'Optional result data (JSON)' },
  },
  allowedRoles: ['architect', 'app-owner', 'daemon'],
}
```

### 3.9 New Activity Event Kinds

Add to `packages/gamma-types/index.ts`:

```typescript
// New event kinds
| 'team_created'
| 'team_spawned'        // Blueprint spawned
| 'project_created'
| 'project_status_change'
| 'task_claimed'        // Agent pulled task from backlog
| 'task_status_change'  // Kanban state transition
```

### 3.10 Updated Type Definitions

Add to `packages/gamma-types/index.ts`:

```typescript
export interface TeamRecord {
  id: string;
  name: string;
  description: string;
  blueprint: string | null;
  created_at: number;
  updated_at: number;
}

export interface ProjectRecord {
  id: string;
  name: string;
  description: string;
  type: 'epic' | 'continuous';
  status: 'planning' | 'active' | 'paused' | 'completed' | 'cancelled';
  team_id: string | null;
  created_at: number;
  updated_at: number;
}

export type TaskKind = 'generic' | 'design' | 'backend' | 'frontend' | 'qa' | 'devops' | 'content' | 'research';

// Updated TaskRecord
export interface TaskRecord {
  id: string;
  title: string;
  source_agent_id: string;
  target_agent_id: string | null;      // Nullable for team backlog tasks
  team_id: string | null;
  project_id: string | null;
  kind: TaskKind;
  priority: number;
  status: 'backlog' | 'pending' | 'in_progress' | 'review' | 'done' | 'failed';
  payload: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}
```

---

## 4. Frontend Component Tree

### 4.1 New Top-Level Apps

```
apps/gamma-ui/
├── components/
│   ├── KanbanBoard/                    # STEP 4 — New
│   │   ├── index.tsx                   # Main Kanban container
│   │   ├── KanbanColumn.tsx            # Single column (Backlog, In Progress, Review, Done)
│   │   ├── KanbanCard.tsx              # Task card (title, kind badge, priority, assignee)
│   │   ├── KanbanFilters.tsx           # Team/project/kind filter bar
│   │   └── KanbanCard.css              # Card styling with priority colors
│   │
│   ├── CeoDashboard/                   # STEP 5 — New
│   │   ├── index.tsx                   # Dashboard container
│   │   ├── ProjectCreator.tsx          # Form: name, description, type, team assignment
│   │   ├── ProjectList.tsx             # Active projects with progress indicators
│   │   ├── ProjectCard.tsx             # Single project card (tasks breakdown donut)
│   │   ├── TeamOverview.tsx            # All teams with member count, active task count
│   │   ├── TeamCard.tsx                # Single team card
│   │   ├── BlueprintSpawner.tsx        # Blueprint selection + spawn button
│   │   └── GoalInput.tsx              # Quick goal input (natural language → project)
│   │
│   ├── SyndicateMap/                   # Existing — Updates needed
│   │   ├── AgentNode.tsx               # UPDATE: Show team badge on agent nodes
│   │   └── AgentDetailPanel.tsx        # UPDATE: Show team membership
│   ...
│
├── hooks/
│   ├── useTeams.ts                     # New — Fetch & cache teams
│   ├── useProjects.ts                  # New — Fetch & cache projects
│   ├── useKanbanTasks.ts               # New — Fetch tasks filtered by team/project for Kanban
│   └── useActivityStream.ts            # Existing — Add new event kind handlers
│
├── store/
│   └── useGammaStore.ts                # UPDATE: Add kanban/ceo panel state
```

### 4.2 Zustand Store Extensions

```typescript
// Add to useGammaStore.ts

interface GammaState {
  // ... existing state ...

  // Kanban state
  kanbanFilters: {
    teamId: string | null;
    projectId: string | null;
    kind: TaskKind | null;
  };
  setKanbanFilters: (filters: Partial<KanbanFilters>) => void;

  // CEO Dashboard state
  ceoDashboardOpen: boolean;
  toggleCeoDashboard: () => void;
}
```

### 4.3 Kanban Board Component Design

#### Data Hydration Strategy

> **Problem:** A long-running project could accumulate hundreds of completed tasks. Dumping all of them into Zustand would bloat memory and degrade render performance.
>
> **Solution:** Tiered fetching — active columns are fully loaded, the Done column is paginated.

| Column | Statuses | Fetch Strategy |
|--------|----------|----------------|
| Backlog | `backlog`, `pending` | Fetch all (bounded by team size — practical max ~50) |
| In Progress | `in_progress` | Fetch all (bounded by agent count in team) |
| Review | `review` | Fetch all (typically small — 1-3 at a time) |
| Done | `done`, `failed` | **Paginated:** initial fetch = last 20, "Load more" button fetches next 20 via `offset` param. Failed tasks shown with red indicator at top of column. |

**Server-side support:** `GET /api/teams/:id/backlog` and `GET /api/projects/:id/tasks` accept `?status=backlog,pending,in_progress,review&limit=50&offset=0`. The Kanban hook makes **two requests**: one for active statuses (no limit), one for done/failed (limit=20, paginated).

**`KanbanBoard/index.tsx`:**
- Uses `useKanbanTasks(teamId, projectId)` hook which internally splits active vs. done fetching
- Subscribes to `useActivityStream()` for live updates:
  - `task_status_change` → move card between columns in local state (optimistic, no refetch)
  - `task_claimed` → add assignee avatar to backlog card (optimistic patch)
  - If the SSE event references a task not in local state, trigger a targeted single-task fetch
- Renders 4 columns: Backlog, In Progress, Review, Done
- Each column receives filtered tasks by status mapping (see table above)

**`KanbanCard.tsx`:**
- Shows: title, kind badge (color-coded), priority indicator, assignee avatar (emoji from agent), source agent
- Click → opens task detail modal with full payload/result

**`KanbanFilters.tsx`:**
- Team dropdown (from `useTeams()`)
- Project dropdown (from `useProjects()`, filtered by selected team)
- Kind filter chips
- Connected to Zustand `kanbanFilters`

### 4.4 CEO Dashboard Component Design

**`CeoDashboard/index.tsx`:**
- Split layout: left panel = project list + team overview, right panel = project creator
- Header with system-wide stats: total agents, active tasks, projects in progress

**`GoalInput.tsx`:**
- Text area for natural language goal
- Type selector: Epic / Continuous
- Team assignment dropdown (optional — auto-assigned if only one team exists)
- Submit → `POST /api/projects` → triggers decomposition pipeline

**`ProjectCard.tsx`:**
- Project name, type badge (Epic=blue, Continuous=green)
- Mini donut chart: task status distribution (backlog/in_progress/review/done/failed)
- Progress bar for epics (done / total)
- Click → opens Kanban filtered to this project

**`TeamCard.tsx`:**
- Team name, member avatars (emojis)
- Active task count, backlog depth
- Click → opens Kanban filtered to this team

**`BlueprintSpawner.tsx`:**
- Lists available blueprints from `GET /api/teams/blueprints`
- Preview: shows roles that will be spawned
- "Spawn Team" button → `POST /api/teams/spawn-blueprint`
- Loading state during agent genesis (multiple agents)

### 4.5 Window Registration

Register new apps in the window manager / launchpad:

```typescript
// In Launchpad or app registry
{ id: 'kanban', name: 'Kanban Board', icon: '📋', component: KanbanBoard }
{ id: 'ceo-dashboard', name: 'CEO Dashboard', icon: '🏢', component: CeoDashboard }
```

---

## 5. Step-by-Step Developer Execution Plan

### Phase A: Database & Types Foundation (Day 1)

| # | Task | Files | Details |
|---|------|-------|---------|
| A1 | Define new TypeScript types | `packages/gamma-types/index.ts` | Add `TeamRecord`, `ProjectRecord`, updated `TaskRecord`, `TaskKind`, new `ActivityEventKind` values |
| A2 | Implement V3 migration | `apps/gamma-core/src/state/state-db.ts` | Add `migrateV3()` — create `teams`, `projects` tables; ALTER `agents` and recreate `tasks` with expanded schema |
| A3 | Create TeamStateRepository | `apps/gamma-core/src/state/team-state.repository.ts` | CRUD for teams table, `findMembers()` joins with agents |
| A4 | Create ProjectStateRepository | `apps/gamma-core/src/state/project-state.repository.ts` | CRUD for projects table, `findTasks()` joins with tasks |
| A5 | Update TaskStateRepository | `apps/gamma-core/src/state/task-state.repository.ts` | Add `findByTeam()`, `findUnassigned()`, `assignToAgent()`, handle nullable `target_agent_id` |
| A6 | Update AgentStateRepository | `apps/gamma-core/src/state/agent-state.repository.ts` | Handle `team_id` column in insert/update/find operations |
| A7 | Test migration | Manual | Delete `gamma-state.db`, restart, verify schema. Also test migration from V2 → V3 with existing data |

**Deliverable:** Database boots to V3, all repositories compile, existing functionality unbroken.

---

### Phase B: Teams & Blueprints Backend (Day 2)

| # | Task | Files | Details |
|---|------|-------|---------|
| B1 | Create TeamsModule | `apps/gamma-core/src/teams/teams.module.ts` | NestJS module, import StateModule |
| B2 | Create TeamsController | `apps/gamma-core/src/teams/teams.controller.ts` | CRUD endpoints: GET/POST/PATCH/DELETE `/api/teams`, GET `/api/teams/:id/backlog` |
| B3 | Create TeamsService | `apps/gamma-core/src/teams/teams.service.ts` | Business logic — validate team operations, manage membership |
| B4 | Create blueprint JSON files | `data/blueprints/it-dev-team.json`, `data/blueprints/content-team.json` | At least 2 blueprint definitions |
| B5 | Create TeamBlueprintService | `apps/gamma-core/src/teams/team-blueprint.service.ts` | Load blueprints, `spawnFromBlueprint()` — orchestrate team + agent creation |
| B6 | Add spawn-blueprint endpoint | `apps/gamma-core/src/teams/teams.controller.ts` | `POST /api/teams/spawn-blueprint` — calls `TeamBlueprintService` |
| B7 | Update AgentCreatorService | `apps/gamma-core/src/agents/agent-creator.service.ts` | Accept optional `teamId` parameter, set on agent record, inject team context into genesis delegation |
| B8 | Register TeamsModule | `apps/gamma-core/src/app.module.ts` | Import `TeamsModule` |
| B9 | Add activity events | `apps/gamma-core/src/activity/activity-stream.service.ts` | Emit `team_created`, `team_spawned` events |

**Deliverable:** Can create teams manually, spawn teams from blueprints, agents are born with team membership.

---

### Phase C: Task Manager Evolution — Event-Driven Claims (Day 3-4)

| # | Task | Files | Details |
|---|------|-------|---------|
| C1 | Install `@nestjs/event-emitter` | `apps/gamma-core/package.json`, `app.module.ts` | `npm i @nestjs/event-emitter`, register `EventEmitterModule.forRoot()` in AppModule |
| C2 | Update IPC delegate flow | `apps/gamma-core/src/ipc/ipc-routing.service.ts` | Support `teamId` as target (no `targetAgentId`), insert with `status='backlog'`, emit `backlog.task.created` via EventEmitter2 |
| C3 | Update delegate_task tool | `apps/gamma-core/src/ipc/delegate-task.tool.ts` | Add optional `teamId`, `projectId`, `title`, `kind`, `priority` parameters |
| C4 | Create `create_team_task` tool | `apps/gamma-core/src/tools/create-team-task.tool.ts` | New tool for architects to create backlog tasks directly, emit `backlog.task.created` |
| C5 | Create `update_task_status` tool | `apps/gamma-core/src/tools/update-task-status.tool.ts` | Kanban state transitions (in_progress → review → done) |
| C6 | Create TaskClaimService | `apps/gamma-core/src/teams/task-claim.service.ts` | Event-driven claim core: `@OnEvent('agent.idle')` + `@OnEvent('backlog.task.created')`, atomic SQL claiming, inbox delivery |
| C7 | Add event emitters to AgentRegistryService | `apps/gamma-core/src/messaging/agent-registry.service.ts` | Emit `agent.idle` when status → idle, emit `agent.offline` on deregistration |
| C8 | Handle agent failure (requeue) | `apps/gamma-core/src/teams/task-claim.service.ts` | `@OnEvent('agent.offline')` → requeue orphaned `in_progress`/`pending` tasks to `backlog`, re-emit `backlog.task.created` to trigger reassignment |
| C9 | Update IPC report flow | `apps/gamma-core/src/ipc/ipc-routing.service.ts` | Handle `review` and `done` statuses, emit `task_status_change` activity events |
| C10 | Add task activity events | Various | Emit `task_claimed`, `task_status_change` through ActivityStreamService |
| C11 | Register new tools | `apps/gamma-core/src/tools/tools.module.ts` | Register `create_team_task` and `update_task_status` in the tool registry |

**Deliverable:** Tasks flow into team backlogs, idle agents claim work reactively via events, Kanban states tracked end-to-end.

---

### Phase D: Kanban Board UI (Day 5)

| # | Task | Files | Details |
|---|------|-------|---------|
| D1 | Create `useTeams` hook | `apps/gamma-ui/hooks/useTeams.ts` | Fetch `GET /api/teams`, cache in state, refresh on `team_created`/`team_spawned` SSE events |
| D2 | Create `useProjects` hook | `apps/gamma-ui/hooks/useProjects.ts` | Fetch `GET /api/projects`, cache, refresh on `project_created`/`project_status_change` |
| D3 | Create `useKanbanTasks` hook | `apps/gamma-ui/hooks/useKanbanTasks.ts` | Fetch `GET /api/projects/:id/tasks` or `GET /api/teams/:id/backlog`, live-patch on SSE `task_status_change`/`task_claimed` |
| D4 | Add Kanban store slice | `apps/gamma-ui/store/useGammaStore.ts` | `kanbanFilters`, `setKanbanFilters` |
| D5 | Build KanbanColumn | `apps/gamma-ui/components/KanbanBoard/KanbanColumn.tsx` | Column header with count badge, scrollable task card list |
| D6 | Build KanbanCard | `apps/gamma-ui/components/KanbanBoard/KanbanCard.tsx` | Task card: title, kind badge, priority dot, assignee emoji, elapsed time |
| D7 | Build KanbanFilters | `apps/gamma-ui/components/KanbanBoard/KanbanFilters.tsx` | Team dropdown, project dropdown, kind chips — bound to Zustand |
| D8 | Build KanbanBoard container | `apps/gamma-ui/components/KanbanBoard/index.tsx` | Compose columns + filters, wire hooks, handle empty states |
| D9 | Style Kanban | `apps/gamma-ui/components/KanbanBoard/KanbanBoard.css` | CSS using existing design tokens (CSS custom properties from the theme) |
| D10 | Register Kanban window | Launchpad / app registry | Add Kanban as a launchable app in the desktop environment |
| D11 | Update SyndicateMap | `apps/gamma-ui/components/SyndicateMap/AgentNode.tsx` | Show team badge on agent nodes |
| D12 | Update activity event handlers | `apps/gamma-ui/hooks/useActivityStream.ts` | Handle new event kinds for proper feed display |

**Deliverable:** Fully functional Kanban board with live updates, filterable by team and project.

---

### Phase E: CEO Dashboard & Project Decomposition (Day 6-7)

| # | Task | Files | Details |
|---|------|-------|---------|
| E1 | Create ProjectsModule | `apps/gamma-core/src/projects/projects.module.ts` | NestJS module |
| E2 | Create ProjectsController | `apps/gamma-core/src/projects/projects.controller.ts` | CRUD endpoints for projects |
| E3 | Create ProjectsService | `apps/gamma-core/src/projects/projects.service.ts` | Business logic, status transitions |
| E4 | Create ProjectDecomposerService | `apps/gamma-core/src/projects/project-decomposer.service.ts` | On project creation → delegate decomposition to System Architect via IPC |
| E5 | Register ProjectsModule | `apps/gamma-core/src/app.module.ts` | Import `ProjectsModule` |
| E6 | Add project activity events | Various | Emit `project_created`, `project_status_change` |
| E7 | Build GoalInput | `apps/gamma-ui/components/CeoDashboard/GoalInput.tsx` | Natural language input + type selector + team dropdown + submit |
| E8 | Build ProjectCreator | `apps/gamma-ui/components/CeoDashboard/ProjectCreator.tsx` | Full project creation form (wraps GoalInput with more fields) |
| E9 | Build ProjectCard | `apps/gamma-ui/components/CeoDashboard/ProjectCard.tsx` | Project card with task status donut chart (using CSS conic-gradient, no charting library) |
| E10 | Build ProjectList | `apps/gamma-ui/components/CeoDashboard/ProjectList.tsx` | Scrollable list of ProjectCards, filtered by status tabs |
| E11 | Build TeamCard | `apps/gamma-ui/components/CeoDashboard/TeamCard.tsx` | Team card with member avatars, backlog depth |
| E12 | Build TeamOverview | `apps/gamma-ui/components/CeoDashboard/TeamOverview.tsx` | Grid of TeamCards |
| E13 | Build BlueprintSpawner | `apps/gamma-ui/components/CeoDashboard/BlueprintSpawner.tsx` | Blueprint picker + spawn button with loading state |
| E14 | Build CeoDashboard container | `apps/gamma-ui/components/CeoDashboard/index.tsx` | Compose all sub-components, wire hooks, layout |
| E15 | Style CEO Dashboard | `apps/gamma-ui/components/CeoDashboard/CeoDashboard.css` | Consistent with existing Gamma OS design language |
| E16 | Register CEO Dashboard window | Launchpad / app registry | Add as launchable app |
| E17 | End-to-end test | Manual | CEO creates project → Architect decomposes → Tasks appear in Kanban → Agents pull and complete |

**Deliverable:** Full CEO → Architect → Team → Kanban pipeline operational.

---

## 6. Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Race condition in task claiming (multiple agents grab same task) | **No Redis lock needed.** Atomic `UPDATE ... WHERE id = (SELECT ...) AND target_agent_id IS NULL RETURNING *` in a single synchronous `better-sqlite3` call. Node.js single-threaded execution guarantees no interleaving. Only one agent's claim succeeds; others get no rows. See §3.5 for full analysis. |
| Agent goes offline mid-task, task stuck in `in_progress` | `TaskClaimService` listens for `agent.offline` events via EventEmitter2 → requeues orphaned tasks to `backlog` → emits `backlog.task.created` so another idle agent claims immediately |
| System Architect overwhelmed with decomposition requests | Queue decomposition requests, process one at a time per architect. Multiple architects can parallelize. |
| V3 migration breaks existing V2 data | Rename-copy-drop within `db.transaction()` + `PRAGMA foreign_key_check` assertion post-rebuild. Status mapping: `completed` → `done`. FK enforcement temporarily disabled during rebuild, re-enabled with integrity check. |
| Blueprint spawning many agents simultaneously | Sequential agent creation with delay, activity events let UI show progress |
| Kanban UI memory bloat from historical tasks | Tiered fetching: active columns fully loaded, Done column paginated (initial 20, load-more). SSE events patch local state optimistically — no full refetch. See §4.3. |

---

## 7. Future Extensions (Out of Scope for Phase 8)

- **Inter-team task routing** — Tasks that span multiple teams (e.g., design → dev handoff)
- **Agent performance metrics** — Track completion rate, average time per task kind
- **Automated team scaling** — Spawn additional agents when backlog depth exceeds threshold
- **Task dependencies** — DAG of tasks with blocked/unblocked states
- **Sprint / Iteration model** — Time-boxed work periods for epic projects
- **CEO natural language → auto team + project** — LLM-powered goal parsing that also selects/creates the right team
