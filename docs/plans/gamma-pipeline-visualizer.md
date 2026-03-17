# Gamma Pipeline Visualizer + Task Store — Mini-RFC

**Status:** Planned
**Author:** System Architect
**Date:** 2026-03-17
**Priority:** High
**Phase:** 6 — Agent Orchestration Layer

---

## Problem

Gamma Agent Runtime has agents and IPC, but no concept of **Tasks**. Today:

- There is no way to assign a structured unit of work to an agent
- There is no visibility into *what* each agent is doing or *which stage* it's at
- System Architect cannot autonomously spawn and route agents to parallelised work
- Serhii has no real-time visual overview of who owns what, and what's happening

This blocks the "give a task → agents build it → deploy" workflow.

---

## Goal

Build a **Task Store** (backend) and a **Pipeline Visualizer** (frontend app) that together enable:

1. System Architect to autonomously decompose work, spawn agents, and route tasks
2. Dev/QA agents to claim tasks, update status, and report completion
3. Serhii to see the full pipeline in real-time: Kanban board + live activity feed
4. Human-in-the-loop approval gates at RFC and pre-deploy stages

---

## Architecture Overview

```
Serhii
  │  gives high-level task
  ▼
System Architect
  │  writes Mini-RFC → waits for Serhii approval
  │  decomposes into atomic tasks → writes to Task Store
  │  spawns dev-agents via spawn_sub_agent
  │  sends TASK_ASSIGNED via send_message
  │
  ├── dev-agent-1   (reads task, implements, marks done)
  ├── dev-agent-2   (parallel module)
  └── qa-agent      (reviews diff, runs tsc --noEmit, marks reviewed)
        │
        └── deploy-agent  (builds, hot-reloads, reports)
                │
                └── ⛔ DEPLOY GATE: Serhii approval required

                          ↕ SSE stream
               ┌──────────────────────────┐
               │  Pipeline Visualizer App  │
               │  (Kanban + Activity Feed) │
               └──────────────────────────┘
```

---

## Section 1: Task Store (Backend)

### 1.1 Redis Schema

```
gamma:task:{taskId}
  id:           string (uuid)
  title:        string
  spec:         string (markdown — full implementation spec)
  status:       "backlog" | "assigned" | "in_progress" | "review" | "done" | "failed"
  assignedTo:   agentId | null
  parentTaskId: taskId | null   (for subtasks)
  createdBy:    agentId | "serhii"
  createdAt:    ISO timestamp
  updatedAt:    ISO timestamp
  completedAt:  ISO timestamp | null
  output:       string | null   (agent's completion summary / diff)

gamma:tasks:index  → sorted set (score = createdAt) of all taskIds
```

### 1.2 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/system/tasks` | List all tasks (with filters: status, assignedTo) |
| `POST` | `/api/system/tasks` | Create task |
| `GET` | `/api/system/tasks/:id` | Get single task |
| `PATCH` | `/api/system/tasks/:id` | Update status / assignee / output |
| `DELETE` | `/api/system/tasks/:id` | Delete task |
| `GET` | `/api/system/tasks/stream` | **SSE** — real-time task state changes |

### 1.3 SSE Event Types

```ts
type TaskEvent =
  | { type: 'task_created';  task: Task }
  | { type: 'task_updated';  taskId: string; patch: Partial<Task> }
  | { type: 'task_deleted';  taskId: string }
```

---

## Section 2: Agent Task Protocol

All agents operating in the pipeline MUST follow this protocol.
It will be embedded in their SOUL.md / system prompts.

### 2.1 System Architect (this agent)

```
ON task received from Serhii:
  1. Read relevant architecture files
  2. Generate Mini-RFC → send to Serhii, STOP
  3. ON approval:
     a. POST /api/system/tasks for each atomic subtask
     b. spawn_sub_agent(role="dev-agent", goal=taskId) for each
     c. send_message(agentId, "TASK_ASSIGNED", { taskId, spec })
  4. Monitor task SSE stream
  5. ON all tasks status="review": aggregate → send summary to Serhii
  6. ON Serhii approval: send_message("deploy-agent", "DEPLOY", { taskIds })
```

### 2.2 Dev Agent (spawned per task)

```
ON TASK_ASSIGNED message received:
  1. GET /api/system/tasks/:id → read spec
  2. PATCH task { status: "in_progress" }
  3. Implement according to spec (fs_write, shell_exec)
  4. PATCH task { status: "review", output: "<summary of changes>" }
  5. send_message("qa-agent", "REVIEW_REQUESTED", { taskId })
```

### 2.3 QA Agent (persistent, reviews all tasks)

```
ON REVIEW_REQUESTED:
  1. GET /api/system/tasks/:id → read output/diff
  2. Run: shell_exec("tsc --noEmit") → check 0 errors
  3. Review: types, imports, arch compliance, SOUL.md rules
  4. IF pass:  PATCH task { status: "done" }
              send_message("system-architect", "QA_PASSED", { taskId })
  5. IF fail:  PATCH task { status: "in_progress", output: "<issues>" }
              send_message(task.assignedTo, "QA_FAILED", { taskId, issues })
```

### 2.4 Deploy Agent

```
ON DEPLOY message received:
  1. shell_exec("npm run build") in gamma-ui root
  2. IF errors: report to System Architect, STOP
  3. IF success:
     - Vite hot-reload (if dev server running)
     - OR: notify Serhii to restart
  4. PATCH all tasks { status: "deployed" }
  5. send_message("system-architect", "DEPLOY_DONE", { summary })
```

---

## Section 3: Pipeline Visualizer App

### 3.1 App ID & Location

```
appId:    pipeline
path:     apps/gamma-ui/apps/system/pipeline/
entry:    PipelineApp.tsx
icon:     🔀
name:     Pipeline
```

### 3.2 Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  🔀 PIPELINE                        [LIVE ●]    [+ NEW TASK]    │
├──────────┬──────────────┬───────────┬──────────┬────────────────┤
│ BACKLOG  │  IN PROGRESS │  REVIEW   │  DONE    │  FAILED        │
├──────────┼──────────────┼───────────┼──────────┼────────────────┤
│          │              │           │          │                │
│ [Task A] │ [Task B]     │ [Task D]  │ [Task E] │                │
│          │  dev-agent-1 │  qa-agent │  ✅      │                │
│ [Task C] │  ██████░░░░  │  👁 ...   │          │                │
│          │              │           │          │                │
│          │ [Task C]     │           │          │                │
│          │  dev-agent-2 │           │          │                │
│          │  ████░░░░░░  │           │          │                │
└──────────┴──────────────┴───────────┴──────────┴────────────────┘

── Live Activity Feed ─────────────────────────────────────────────
  12:21  dev-agent-1 → wrote ActivityTab.tsx (142 lines)
  12:22  dev-agent-2 → wrote AgentsTab.tsx (89 lines)
  12:22  qa-agent    → tsc --noEmit: 0 errors ✅
  12:23  System Architect → awaiting Serhii approval for deploy ⛔
──────────────────────────────────────────────────────────────────
│ Tasks: 5 total  │  Agents: 3 active  │  Phase 6               │
└──────────────────────────────────────────────────────────────────
```

### 3.3 Task Card Component

```tsx
interface TaskCardProps {
  task: Task;
  agent?: AgentRegistryEntry;  // matched by task.assignedTo
}

// Displays:
//  - Task title
//  - Assigned agent (name + status dot)
//  - Progress bar (if agent reports %)
//  - Last update timestamp
//  - [Click] → opens TaskDetail drawer:
//       full spec, full output, timeline of status changes
```

### 3.4 File Structure

```
apps/gamma-ui/apps/system/pipeline/
├── PipelineApp.tsx          # Root: header + kanban board + feed
├── components/
│   ├── KanbanBoard.tsx      # 5-column kanban layout
│   ├── TaskCard.tsx         # Task card with agent badge + progress
│   ├── TaskDetail.tsx       # Drawer: full spec, output, timeline
│   ├── ActivityFeed.tsx     # Live SSE feed of task events
│   └── NewTaskModal.tsx     # Create task (title + spec)
├── hooks/
│   └── usePipelineData.ts   # Single hook: SSE stream + REST backfill
└── context.md               # Self-documentation for agents
```

### 3.5 Data Flow

```
usePipelineData()
  ├── SSE /api/system/tasks/stream   → real-time task updates
  ├── GET /api/system/tasks          → initial load (on mount)
  └── GET /api/system/agents         → for agent name/status matching
```

---

## Section 4: Registration

### constants/apps.ts

```diff
+ { id: 'pipeline', name: 'Pipeline', icon: '🔀' },
```

### registry/systemApps.ts

```diff
+ registerSystemApp('pipeline', lazy(() => import('../apps/system/pipeline/PipelineApp')));
```

---

## Section 5: Migration / Implementation Plan

### Phase A — Backend: Task Store
- [ ] A.1 Redis schema + `gamma:tasks` key design
- [ ] A.2 REST CRUD endpoints (`/api/system/tasks`)
- [ ] A.3 SSE stream for task changes (`/api/system/tasks/stream`)
- [ ] A.4 Integration tests: create → update status → SSE receives event

### Phase B — Frontend: Pipeline App
- [ ] B.1 Scaffold `pipeline` app, register in `apps.ts`
- [ ] B.2 `usePipelineData` hook (SSE + REST)
- [ ] B.3 `KanbanBoard` + `TaskCard` components
- [ ] B.4 `TaskDetail` drawer
- [ ] B.5 `ActivityFeed` (live SSE events)
- [ ] B.6 `NewTaskModal` (Serhii can create tasks manually)

### Phase C — Agent Protocol
- [ ] C.1 Update System Architect SOUL.md with Task Protocol
- [ ] C.2 Update app-owner-director SOUL.md with QA protocol
- [ ] C.3 Define spawn_sub_agent convention for dev-agents
- [ ] C.4 End-to-end test: Architect creates tasks → dev-agents claim → QA reviews → deploy gate fires

### Phase D — Polish
- [ ] D.1 Task progress % reporting from agents
- [ ] D.2 Deploy approval gate UI (button in Pipeline app)
- [ ] D.3 Task history / archive view
- [ ] D.4 Write `pipeline/context.md` for agent self-documentation

---

## Section 6: Human-in-the-Loop Gates

```
GATE 1: After Mini-RFC              ← Serhii approves plan
GATE 2: Before deploy               ← Serhii approves in Pipeline UI
GATE 3: Manual override anytime     ← Serhii can kill any agent via Director/Nexus
```

No autonomous deployment without explicit approval at Gate 2.

---

## Section 7: Estimated Scope

| Area | Files | Complexity |
|------|-------|-----------|
| Backend: Task Store API | ~3 new files | Medium |
| Backend: SSE stream | ~1 new file | Small |
| Frontend: Pipeline App | ~7 new files | Medium |
| Agent Protocol updates | SOUL.md × 2 | Small |
| Registration | 2 file edits | Trivial |

**Backend changes:** Yes (Task Store is new)
**Frontend changes:** 1 new system app
**Agent changes:** SOUL.md protocol additions only

---

## Section 8: What This Unlocks

| Before | After |
|--------|-------|
| Serhii manually assigns tasks in chat | Serhii gives high-level goal; Architect decomposes |
| No visibility into agent work | Full Kanban board, live feed |
| Single-agent sequential work | Parallel dev-agents per task |
| Deploy by hand | Deploy-agent with approval gate |
| "Is it done?" requires asking | Real-time status in Pipeline app |
