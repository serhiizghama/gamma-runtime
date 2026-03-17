# Gamma Agent OS — Teams, Corporations & Pipeline Visualizer

**Status:** Planned
**Author:** System Architect
**Date:** 2026-03-17 (revised)
**Priority:** High
**Phase:** 6 — Agent Orchestration Layer
**Vision:** Universal Agent Operating System

---

## Executive Summary

Gamma Agent Runtime is evolving beyond a developer tool into a **Universal Agent Operating System** — a platform where Serhii can assemble any team of AI agents for any purpose, organize teams into corporations, and delegate entire domains of work with minimal manual involvement.

> You should never need to hire a real employee for a task that an agent team can handle.

The Pipeline Visualizer is the **control center** for this system — the place where you see every team, every agent, every task, and every inter-team interaction in real time.

---

## The Core Idea

```
Traditional company:          Gamma Agent OS:
──────────────────            ───────────────────────────────
CEO                           Serhii (you)
  └── Departments               └── Corporations
        └── Teams                     └── Teams
              └── Employees                 └── Agents (roles)
                    └── Tasks                     └── Tasks
```

Every **Agent** has:
- A **Role** (defined in a Role Template)
- **Instructions** (SOUL.md — personality, behaviour, rules)
- **Tools** (shell, browser, API access, messaging, etc.)
- **Goals** (current task or standing directive)
- **A Supervisor** (team lead or system architect)

Every **Team** has:
- A **name** and **domain** (dev, media, personal, business, etc.)
- A set of **Roles** filled by agents
- A **protocol** (how agents communicate within the team)
- A **Team Lead** agent (manages internal task routing)
- An **inbox** (receives tasks from outside the team)

Every **Corporation** has:
- Multiple **Teams**
- A **Corp Director** agent (routes tasks between teams)
- Shared **resources** (knowledge base, file store, memory)
- **Cross-team protocols** (how teams hand off work to each other)

---

## Example Corporations

### Corp A: Product Company
```
Corp Director (routes between teams)
  ├── Dev Team
  │     ├── Tech Lead
  │     ├── Senior Developer × 2
  │     └── QA Engineer
  ├── Design Team
  │     ├── UI/UX Designer
  │     └── Brand Strategist
  ├── Marketing Team
  │     ├── Content Writer
  │     ├── SEO Analyst
  │     └── Social Media Manager
  └── DevOps Team
        ├── Infrastructure Agent
        └── Monitoring Agent
```

**Example flow:**
```
Serhii → "Build and launch a landing page for my new app"
  Corp Director → assigns to Dev Team: "Build the page"
  Dev Team → builds → notifies Corp Director: "Done, ready for design"
  Corp Director → assigns to Design Team: "Polish the UI"
  Design Team → polishes → notifies Corp Director: "Done, ready for launch"
  Corp Director → assigns to Marketing Team: "Write launch copy + socials"
  Marketing Team → creates content → notifies Serhii: "Ready for approval"
  Serhii approves → Corp Director → DevOps Team: "Deploy"
  ✅ Done
```

---

### Corp B: Media Company
```
Corp Director
  ├── Research Team
  │     ├── Topic Researcher (trending topics, competitor analysis)
  │     └── Audience Analyst
  ├── Content Team
  │     ├── Script Writer
  │     ├── Video Editor Agent (ffmpeg, tools)
  │     └── Thumbnail Designer
  └── Distribution Team
        ├── YouTube Publisher
        ├── Instagram Manager
        └── Telegram Channel Manager
```

---

### Corp C: Personal Advisory Board (private)
```
Corp Director (Personal Assistant)
  ├── Health Advisor (doctor + physiologist)
  ├── Mental Health Coach (psychologist)
  ├── Financial Advisor (budgets, investments, taxes)
  ├── Legal Advisor (contracts, compliance)
  └── Astrologer / Life Coach
```

> This corporation has **elevated privacy**: all data is local-only, no external APIs, encrypted context.

---

### Corp D: Business Operations
```
Corp Director
  ├── Customer Support Team
  │     ├── Support Agent × N (handles tickets)
  │     └── Escalation Manager
  ├── Sales Team
  │     ├── Lead Qualifier
  │     └── Proposal Writer
  └── Finance Team
        ├── Invoice Processor
        └── Expense Tracker
```

---

## Architecture

### Layer 1: Role Library

A library of reusable Role Templates. Each template defines:

```
/roles/
  dev/
    senior-developer.md       ← instructions, tools, behaviour
    qa-engineer.md
    tech-lead.md
  media/
    content-researcher.md
    script-writer.md
    social-media-manager.md
  personal/
    financial-advisor.md
    health-advisor.md
    psychologist.md
  business/
    customer-support.md
    sales-agent.md
```

A Role Template contains:
```markdown
# Role: Senior Developer

## Identity
You are a Senior Developer agent in the Gamma Agent OS...

## Tools Available
- fs_read, fs_write (scoped to team workspace)
- shell_exec (sandboxed)
- send_message (to team members only)

## Behaviour Rules
1. Always read the task spec before writing code
2. Write TypeScript only (Gamma architectural compliance)
3. Report completion with a summary diff
...

## Task Protocol
ON TASK_ASSIGNED → read spec → PATCH status: in_progress → implement → PATCH status: review
```

---

### Layer 2: Team Store (Redis)

```
# Team record
gamma:team:{teamId}
  id, name, domain, corpId
  agentIds[]        → list of agents in this team
  leadAgentId       → team lead agent
  status            → active | idle | disbanded
  inbox             → gamma:team:{teamId}:inbox (message queue)
  createdAt, updatedAt

# Corporation record  
gamma:corp:{corpId}
  id, name
  teamIds[]         → list of teams
  directorAgentId   → corp director agent
  sharedMemoryKey   → shared knowledge base reference
  privacy           → "standard" | "private" | "local-only"
  createdAt

# Indexes
gamma:corps:index              → sorted set of all corps
gamma:teams:index              → sorted set of all teams
gamma:teams:corp:{corpId}      → set of teamIds in a corp
```

---

### Layer 3: Task Store (Redis)

```
gamma:task:{taskId}
  id, title, spec (markdown)
  status: backlog | assigned | in_progress | review | done | failed
  assignedTo:   agentId | teamId | corpId
  level:        "agent" | "team" | "corp"   ← routing level
  parentTaskId, corpId, teamId
  createdBy, createdAt, updatedAt, completedAt
  output        → completion summary / artifacts
  approvalRequired: boolean
  approvedBy, approvedAt
```

---

### Layer 4: Inter-Team Communication Protocol

```
Team A (Dev) completes work:
  → POST /api/system/tasks  { title: "Hand off to Marketing", assignedTo: "team:marketing", ... }
  → send_message("corp-director", "HANDOFF", { from: "dev-team", artifact: "...", nextTeam: "marketing" })

Corp Director receives:
  → Routes task to Marketing Team lead
  → PATCH task { assignedTo: "team:marketing", status: "assigned" }
  → send_message("team:marketing:lead", "TASK_ASSIGNED", { taskId })

Marketing Team Lead:
  → Decomposes into subtasks for team members
  → Spawns agents if needed
  → Reports back to Corp Director on completion
```

---

### Layer 5: Pipeline Visualizer App

The single real-time control center for the entire ecosystem.

#### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  🔀 GAMMA PIPELINE              [LIVE ●]    Corps: 3   [+ NEW]      │
├────────────┬──────────────────────────────────────────────────────── ┤
│ CORPS      │                  PIPELINE VIEW                          │
│            │                                                         │
│ ▼ Product  │  BACKLOG    IN PROGRESS    REVIEW    DONE    FAILED     │
│   Dev      │  ────────   ────────────   ──────    ────    ──────     │
│   Design   │  [Task A]   [Task B]       [Task D]  [✅E]             │
│   Marketing│             dev-agent-1    qa-agent                     │
│            │  [Task C]   ██████░░░░                                  │
│ ▼ Media    │             [Task C]                                    │
│   Research │             dev-agent-2                                 │
│   Content  │             ████░░░░░░                                  │
│   Distrib. │                                                         │
│            ├─────────────────────────────────────────────────────── ┤
│ ▼ Personal │  AGENT MAP (selected corp/team)                        │
│   Health   │                                                         │
│   Finance  │  [Corp Director] ──→ [Dev Team Lead] ──→ [dev-agent-1] │
│            │                  ──→ [Marketing Lead] ──→ [writer-1]   │
│ + New Corp │                                                         │
├────────────┴──────────────────────────────────────────────────────── ┤
│  Live Feed: 12:45 dev-agent-1 → wrote LandingPage.tsx (204 lines)   │
│             12:46 qa-agent → tsc --noEmit: 0 errors ✅              │
│             12:46 Corp Director → handoff to Marketing Team         │
├──────────────────────────────────────────────────────────────────────┤
│  Corps: 3  │  Teams: 8  │  Agents: 14 active  │  Tasks: 23 total   │
└──────────────────────────────────────────────────────────────────────┘
```

#### Views

| View | Description |
|------|-------------|
| **Kanban** | Tasks by status across selected team/corp |
| **Agent Map** | Visual hierarchy: Corp → Teams → Agents |
| **Live Feed** | Real-time event stream from all agents |
| **Task Detail** | Full spec, output, timeline, approval button |
| **Team Builder** | Create/edit teams and assign roles |
| **Corp Builder** | Create corps, add teams, set director |
| **Role Hub** | Browse and edit Role Templates |

---

### Layer 6: Team Builder UI

A dedicated interface within Pipeline for assembling teams:

```
[+ New Team]
  → Pick domain: Dev / Media / Personal / Business / Custom
  → Pick roles from Role Library (drag & drop)
  → Name the team
  → Assign to corp (or standalone)
  → [Launch] → system spawns all agents, wires up IPC
```

```
[+ New Corporation]
  → Name the corp
  → Add existing teams
  → Auto-spawn Corp Director agent
  → Set privacy level
  → [Create]
```

---

## Human-in-the-Loop Gates

```
GATE 1: RFC Approval          ← Serhii approves plan before execution
GATE 2: Task Approval         ← optional per-task (set approvalRequired: true)
GATE 3: Inter-team Handoff    ← optional: Serhii reviews before handoff
GATE 4: Deploy / Publish      ← always requires Serhii approval
GATE 5: Sensitive Actions     ← financial, legal, personal data ops
```

No autonomous deploys, publishes, or financial actions without Gate 4/5 approval.

---

## Implementation Phases

### Phase A — Foundation (Task Store + Basic Pipeline UI)
- [ ] A.1 Task Store Redis schema + CRUD API
- [ ] A.2 SSE stream for task events
- [ ] A.3 Basic Pipeline app: Kanban board (single team view)
- [ ] A.4 Task Protocol in System Architect + app-owner SOUL.md

### Phase B — Teams
- [ ] B.1 Team Store Redis schema + CRUD API
- [ ] B.2 Role Library: first 10 role templates
- [ ] B.3 Team Builder UI in Pipeline app
- [ ] B.4 Team-level task routing (team inbox + lead agent)
- [ ] B.5 Agent Map view (hierarchy visualization)

### Phase C — Corporations
- [ ] C.1 Corp Store Redis schema + CRUD API
- [ ] C.2 Corp Director agent role template
- [ ] C.3 Inter-team handoff protocol
- [ ] C.4 Corp Builder UI
- [ ] C.5 Cross-corp communication (message bus between corps)

### Phase D — Role Hub & Templates
- [ ] D.1 Role Hub UI (browse, create, edit roles)
- [ ] D.2 Role Template library: Dev, Media, Personal, Business sets
- [ ] D.3 Team Templates (one-click: "Dev Team" spawns 4 agents)
- [ ] D.4 Privacy tiers for Personal corps (local-only, encrypted context)

### Phase E — Polish & Power Features
- [ ] E.1 Approval gate UI (buttons in Pipeline for Gate 2–5)
- [ ] E.2 Task history, archive, analytics
- [ ] E.3 Agent performance metrics (tasks completed, avg time, error rate)
- [ ] E.4 Corp/Team memory (shared knowledge base per team)
- [ ] E.5 Pipeline app `context.md` for agent self-documentation

---

## API Surface (new endpoints)

| Method | Path | Description |
|--------|------|-------------|
| `GET/POST` | `/api/system/tasks` | Task CRUD |
| `PATCH/DELETE` | `/api/system/tasks/:id` | Update / delete task |
| `GET` | `/api/system/tasks/stream` | SSE: task events |
| `GET/POST` | `/api/system/teams` | Team CRUD |
| `GET/PATCH` | `/api/system/teams/:id` | Get / update team |
| `POST` | `/api/system/teams/:id/spawn` | Spawn all agents for a team |
| `GET/POST` | `/api/system/corps` | Corporation CRUD |
| `GET/PATCH` | `/api/system/corps/:id` | Get / update corp |
| `POST` | `/api/system/corps/:id/handoff` | Inter-team task handoff |
| `GET/POST` | `/api/system/roles` | Role Template CRUD |
| `GET` | `/api/system/pipeline/stream` | SSE: unified pipeline events |

---

## What This Unlocks

| Capability | Today | After Gamma Agent OS |
|-----------|-------|----------------------|
| Task visibility | ❌ | ✅ Kanban, real-time |
| Parallel agents | ❌ | ✅ N agents per team |
| Team assembly | Manual | One-click Team Builder |
| Inter-team handoff | ❌ | ✅ Automated protocol |
| Reusable roles | ❌ | ✅ Role Library |
| Multiple domains | Dev only | Any domain |
| Privacy tiers | ❌ | ✅ Personal corps |
| Human approval | Ad-hoc | ✅ Structured gates |
| Hiring real employees | Required | Optional |

---

## North Star

> Gamma Agent OS is the operating system for your personal empire of AI agents.
> You set the vision. You approve the milestones. Agents execute everything in between.
> Any team. Any domain. Any scale.
