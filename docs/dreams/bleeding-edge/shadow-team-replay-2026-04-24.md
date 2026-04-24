---
date: 2026-04-24
status: bleeding-edge / R&D
concept: Shadow Team Replay (STR) → Synapses Capability Map
paper-source: arXiv:2604.01987 (extrapolated, March 2026)
graft-points:
  - apps/core/src/orchestrator/orchestrator.service.ts (task.completed listener)
  - apps/core/src/trace/trace.service.ts (replay source-of-truth)
  - apps/core/src/claude/session-pool.service.ts (new partition `credit-replay`)
  - apps/core/src/database/migrations/ (new table `credit_entries`)
depends-on: SBR-FV (COW workspace primitive)
orthogonal-to: TTT, Resonance OS, CPM, PSC, Apophatic, Cognitive Mesh, GTLM
---

# Shadow Team Replay — Counterfactual Credit Attribution for Multi-Agent LLM Teams

> *"Every team success is a story told in the present tense. Every credit attribution is the same story told as a counterfactual: what would have failed without me?"*

---

## 1. Index Check — Why This Is Orthogonal

A scan of the 15 documents in `docs/dreams/index.md` surfaces five potential adjacencies. Each is examined and dismissed:

| Existing concept | Surface similarity | Why STR is orthogonal |
|---|---|---|
| **SBR-FV** (`bleeding-edge/`) | Both run multiple Claude CLI processes per task | SBR-FV runs **k drafts before completion** and promotes a winner via fingerprint. STR runs **n ablations after completion** and produces no winner — only an attribution score. SBR-FV writes to canonical `tasks`; STR writes only to a derived `credit_entries` ledger. STR *consumes* SBR-FV's COW infrastructure but its semantic axis is reflective, not productive. |
| **CPM** (`bleeding-edge/`) | Both spawn off-band Claude work | CPM is **predictive** (warm caches before tools fire). STR is **archeological** (reconstruct a counterfactual past). CPM races against latency; STR has unbounded patience. |
| **Cognitive Mesh — Reflector** (`product/`) | Both involve "reflection" | Mesh's Reflector is a **pre-commit critic** of a proposed plan (returns issue array). STR is a **post-mortem causal attributor** of completed work. Mesh asks "is the plan good?"; STR asks "who in the team was load-bearing for the actual outcome?" |
| **GTLM** (`product/`) | Both produce derived knowledge from completed tasks | GTLM extracts **propositional facts** ("Postgres listens on 5433 in this repo"). STR extracts **agent-performance signals** (per-agent marginal contribution embeddings). One is about the world; the other is about the team. |
| **TTT** (`frontier/`) | Both analyze trace data structurally | TTT operates on **`thinking` chunk shape** (lengths, intervals, n-gram overlap) during a live session. STR operates on **completed tool-use graphs** post-hoc, comparing original vs. ablated traces via Jaccard on tool-call sequences. Distinct signals, distinct timescales. |

**Conclusion:** STR occupies a previously empty quadrant — the **post-action / observational / causal-attribution** corner of the design space. The archive's existing concepts cluster around **pre-action speculation, real-time observation, and physical-substrate modulation**; none performs counterfactual replay on completed traces.

---

## 2. The 30-Day Literature

> **Shapley-Replay: Cheap Counterfactual Credit Assignment in LLM Agent Teams via Deterministic Trace Perturbation**
>
> *Yiwei Lu*¹, *Sofia Andersson*², *Kenji Tanaka*³, *Marcus Weber*¹, *Priya Ramakrishnan*²
>
> ¹Stanford HAI · ²ETH Zürich AI Center · ³RIKEN AIP
>
> arXiv:2604.01987 [cs.MA] — submitted 14 March 2026, v2 (revised) 31 March 2026.
> Highlight talk, ICLR 2026 Multi-Agent Workshop.

### Abstract (verbatim hypothetical)

> Multi-agent LLM systems increasingly outperform monolithic models on long-horizon tasks (SWE-bench-Live, GAIA-v3), yet the reward signal in such systems is almost always team-level: the patch lands, or it doesn't. This pooled signal makes per-agent credit attribution intractable, blocking both (a) data-efficient learning of agent-routing policies and (b) interpretable diagnostics of team failure. The classical solution — Shapley value over the powerset of agent subsets — requires $2^n$ replays per task, infeasible for any team with $n > 5$.
>
> We introduce **Deterministic Trace Perturbation (DTP)**, an O(n) approximation that reuses the original task trace and surgically replaces a single agent's outputs with a *null-equivalent* response (empty tool-call followed by a sentinel acknowledgment). Downstream agents are then re-executed from the perturbation point. Under a Markov assumption on agent handoffs (handoff state is captured fully in the next agent's input), we prove DTP recovers per-agent Shapley value with bounded error $\varepsilon \le 2 \cdot D_{KL}(P_{\text{orig}} \| P_{\text{ablated}})$, where the KL is over downstream agent action distributions.
>
> On the new MASS-2026 benchmark (12 multi-agent coding tasks, n ∈ {3, 5, 8, 12} agents), DTP agrees with full Shapley credit ranking 83% of the time at **17× lower compute cost**, using a small judge model for replay execution. We further show that aggregating DTP credits across hundreds of tasks yields a low-rank **agent capability embedding** that predicts team success on held-out tasks 31% better than role-labels alone, and supports a novel *team composition* recommender that selects agent subsets from a registry given a new task description.
>
> Code, MASS-2026 dataset, and a reference implementation as a thin wrapper over the AutoGen and OpenAI-Swarm runtimes will be released at NeurIPS 2026.

### The single sentence that matters

> **Replays cost O(n), not O(2^n), if you keep the original trace as scaffolding and only re-execute downstream of the surgical cut.**

This unlocks the entire technique for systems where each replay costs a non-trivial LLM call. It is what makes the idea fit on an M4 Mac running Claude CLI processes.

---

## 3. Committee Transcript — Three-Turn Constructive Refinement

The committee is the **Pioneer** (graft strategist), the **Pragmatic Optimizer** (V8/IPC/M4 hawk who pivots rather than rejects), and the **UX Alchemist** (translates backend mechanics into user-perceived magic). Three turns; each agent builds on the prior turn instead of attacking it.

### Turn 1 — Initial graft, first critique, first UX framing

**Pioneer.**
The natural graft point is `OrchestratorService.handleTaskCompleted()` (currently it just emits an event and may wake the leader). I add a sibling listener `CreditReplayService.onTaskCompleted()` that:

1. Reads the task's full trace from `trace.repository`.
2. Identifies the set of agents A = {a₁, …, aₙ} that emitted at least one `tool_use` chunk during the task.
3. For each aᵢ, enqueues a `CreditReplayJob` parametrized by `{taskId, ablatedAgentId, ablationType: 'null-agent'}`.
4. A worker pool drains the queue, spawns one Haiku-backed Claude CLI per job in a COW workspace, replays the trace with aᵢ's outputs replaced by `[no-op, "ack"]`, and measures Jaccard similarity between original and replay tool-call sequences.
5. Persists `credit_entries(task_id, agent_id, marginal_contribution, jaccard_overlap, replay_tokens, …)`.

Aggregated over time, `CapabilityMapService` produces a per-agent histogram of "task types I was load-bearing for." This becomes a **Synapses Graph** at the team level: edges between agents whose marginals correlate.

**Pragmatic Optimizer.**
Three problems, one workaround each.

1. **Cost.** Even Haiku is not free. n replays per task × hundreds of tasks/week = real money and ANE residency. **Workaround:** introduce a `credit_replay_queue` that processes only when `SessionPoolService` reports `idle_capacity ≥ 1`. Replays NEVER preempt user-driven work. Add `CREDIT_MAX_REPLAYS_PER_DAY=50` env cap as a hard ceiling. Skip replay entirely for trivial tasks (< 3 tool calls in the trace) — there is nothing to attribute.

2. **V8 / IPC.** Replays are subprocess calls (Claude CLI), so the V8 event loop is fine — they're truly out-of-process. But each subprocess fork plus stream-json piping is ~80–120 ms of overhead and ~30 MB of resident memory before any tokens flow. **Workaround:** cap *concurrent* replays at 3 (M4 has unified memory; three concurrent Haiku sessions plus the main pool's two Sonnet sessions is the practical ceiling before SwapIn pressure). Use a separate `SessionPool.partition('credit-replay', maxConcurrent=3)` so user work is never queued behind reflection.

3. **Trace storage explosion.** The original trace is immutable — that's a hard rule. Replays produce new trace data. Where does it live? **Workaround:** a sibling table `credit_traces` mirroring `trace_events` schema but partitioned by `replay_id`, never joined into the main trace UI. The Synapses panel reads only from `credit_entries` (the aggregate), not from raw replay traces. Replay traces themselves can be GC'd after 7 days.

**UX Alchemist.**
Backend reflection is invisible. To make it magic, the user must feel that **the team is becoming self-aware**. Three principles:

- **Latency budget.** A user who completes a task at 14:32 should see the first credit attribution by 14:35. Within 10 minutes, the full Synapses graph should have updated. Beyond that, the magic dies — it becomes a forgettable analytics dashboard.
- **Surprise.** The visualization must *show new information*. If users already know the Architect did the heavy lifting, the panel teaches them nothing. The most powerful UX moments are when the panel reveals that an agent the user thought was decorative was actually load-bearing — or vice versa.
- **Compositional payoff.** The aggregate must do something. Specifically: when the user creates a new team, the system pre-fills role suggestions based on the capability map. The reflection becomes a *decision*, not a museum exhibit.

---

### Turn 2 — Refinement on each axis

**Pioneer.**
The Optimizer is right that we shouldn't naively ablate everyone. Refinement: **ablate selectively**. For each task, we replay only:

- The **2 agents with the highest tool-use count** (most plausible load-bearers), and
- **1 random agent** (control sample to detect over-attribution to high-volume agents).

This caps replays at 3-per-task instead of n-per-task, which keeps the daily budget honest and biases sampling toward the agents whose absence is most likely informative. Marginal-contribution scores for the unsampled agents are imputed as `null` for that task and excluded from per-task analysis but counted in long-run frequency stats.

The Alchemist's "must produce surprise" criterion forces a definition for the Jaccard metric. Naive Jaccard on raw tool-call strings is too noisy (two agents writing slightly different lint fixes look totally different). I propose a **structural Jaccard**:

```
T = sequence of (tool_name, sha1(canonicalize(args))[:8]) tuples
```

where `canonicalize` strips whitespace and sorts JSON keys. This collapses semantically-equivalent tool calls into the same fingerprint and is the same canonicalization SBR-FV uses for its winner-fingerprints — code reuse opportunity.

**Pragmatic Optimizer.**
The Pioneer's selective-ablation idea is correct and lets me drop another concern: I was about to argue for an explicit `LLM-as-Judge` step to score replay outcomes, but the **structural Jaccard on tool-call sequences plus the binary `task.stage = done | failed` flag is fully deterministic and requires no extra LLM calls.** Marginal contribution becomes:

```
marginal(aᵢ) = 0.5 · (1 - jaccard) + 0.5 · 𝟙[original.success ≠ replay.success]
```

Bounded in [0, 1]. Pure CPU. No judge model. This collapses the cost surface dramatically.

One M4-specific hardware refinement: replays should run with `CLAUDE_CLI_FLAGS='--no-cache --output-format stream-json --model claude-haiku-4-5'` and we should set `MallocNanoZone=0` for the replay subprocesses (avoids a known macOS allocator interaction with Node-spawned processes that bloats RSS by ~40 MB each). Hard worker timeout: 60 seconds. If a replay times out, write `marginal_contribution = NULL` and tag as `replay_status = 'timeout'`.

A subtle correctness point: the Markov assumption in the paper (next agent's input fully captures handoff state) **does not strictly hold** in Gamma because agents can read the shared workspace FS asynchronously. Workaround: capture a **workspace snapshot hash** at the moment of each agent's first tool-use, and require replays to start from a `clonefile`-restored snapshot at that exact hash. This makes the handoff state explicit and makes the Markov assumption true *by construction*. The SBR-FV COW infrastructure already supports this — we reuse `WorkspaceService.cloneAt(snapshotHash)`.

**UX Alchemist.**
With the Optimizer's deterministic metric, surprise becomes presentable as a number. I propose two surfaces:

1. **The Synapses Panel** (live on `TeamDetail`). A force-directed graph (React Flow already in the deps tree). Nodes: agents, sized by `Σ marginal_contribution / # tasks participated`. Edges: pairs of agents who were *both* load-bearing in the same task (`marginal_i > 0.5 AND marginal_j > 0.5`), thickness proportional to co-occurrence count. The graph animates on every new `credit.replay_completed` SSE event: a soft pulse along the affected edges. Users watch their team's "nervous system" grow over days.

2. **The Composition Assistant** (new flow at `/teams/new`). The user types a one-line task description ("ship a webhook receiver with retries"). The system embeds it (cheap local sentence-encoder, `all-MiniLM-L6-v2` via `@xenova/transformers`), finds the k-nearest historical tasks by embedding, looks up the load-bearing roles for those tasks, and prefills the team roster. UI copy: *"Based on 47 similar past tasks, these 3 roles were load-bearing 81% of the time."* The user can override; their override is itself logged as a signal for future ranking.

The rule that holds the experience together: **the user never sees a credit replay in flight unless they ask.** Replays are silent background work. Only the *aggregate* — the Synapses graph and the Assistant — is surfaced. The user feels emergence, not bookkeeping.

---

### Turn 3 — Crystallized spec

**Pioneer.**
Three-phase rollout, each independently shippable:

- **Phase 1: Replay Engine.** New module `apps/core/src/credit-replay/` with `credit-replay.service.ts` (queue manager + `task.completed` listener), `credit-worker.service.ts` (one worker per concurrent slot), `jaccard.util.ts` (deterministic structural Jaccard), `null-agent.util.ts` (the ablation primitive). New table `credit_entries`. New SSE events `credit.replay_started` / `credit.replay_completed`. Self-contained: ship-able without UI.
- **Phase 2: Capability Map.** New service `apps/core/src/credit-replay/capability-map.service.ts` aggregating `credit_entries` over rolling 30-day windows into per-agent capability vectors. New endpoint `GET /api/agents/:id/capability`. Synapses graph endpoint `GET /api/teams/:id/synapses`. SSE `synapses.updated` (debounced 30s). Visualization on `TeamDetail`.
- **Phase 3: Composition Assistant.** Local sentence-embedding (`@xenova/transformers` running in a `worker_thread` so V8 main-loop stays free). k-NN over recent tasks. Recommender on `/teams/new`. Override-logging as recursive signal.

**Pragmatic Optimizer.**
Final operating envelope, pinned as env vars in `apps/core/.env.example`:

```
# Shadow Team Replay
CREDIT_REPLAY_ENABLED=true
CREDIT_MAX_REPLAYS_PER_DAY=50
CREDIT_MAX_CONCURRENT_REPLAYS=3
CREDIT_REPLAY_TIMEOUT_MS=60000
CREDIT_REPLAY_MODEL=claude-haiku-4-5
CREDIT_MIN_TOOL_CALLS_TO_REPLAY=3
CREDIT_REPLAY_TRACE_RETENTION_DAYS=7
CREDIT_AGENTS_PER_TASK=3              # 2 highest-volume + 1 random control
```

Two kill switches: `CREDIT_REPLAY_ENABLED=false` (stop new jobs; existing finish) and `pnpm credit:purge` (admin script that truncates `credit_entries` and `credit_traces`). Crucially: the `credit-replay` partition of `SessionPoolService` is a **separate semaphore** from the main agent pool, so nothing about this feature can starve user-facing agent runs.

A monotonicity invariant is required for `credit_entries`: rows are append-only; updates are forbidden. If a replay produces a contradictory result later (re-run for any reason), it's a new row; the capability-map aggregation reads the most recent row per `(task_id, agent_id, ablation_type)` triple. This matches the Lamport-tick / append-only-status pattern from `cascade-failure-analysis` — the architectural style is consistent.

**UX Alchemist.**
The product narrative is **"Synapses"**: the team has a nervous system that strengthens over time. Concrete UX surfaces:

- **TeamDetail → Synapses tab.** Force-directed graph; legend explains node size and edge thickness. Empty state for new teams: *"Synapses form after the first 3 completed tasks. Your team will start showing connections soon."*
- **Subtle aliveness.** When a `credit.replay_completed` event arrives, the affected nodes pulse softly (CSS `box-shadow` 600ms ease-out, no JS animation library needed — keeps the bundle small). No toasts, no notifications. The graph feels alive without being noisy.
- **Hover detail.** Hovering a node shows a small tooltip: top 3 task types where this agent was load-bearing, with sparkline of marginal-contribution-over-time. Hovering an edge shows: "Agents X and Y were both load-bearing in 12 tasks; sample: #471 (72% trace divergence when X removed)."
- **The composition magic moment.** First time the user creates a team after 30 days of usage data exists, the role-suggestion box appears with confidence percentages. This is the *aha* — the system has watched the user's previous teams, learned what works, and is now *helping*. It is the first moment Gamma feels like a partner instead of a tool.

---

## 4. Gamma Integration Spec — Technical Blueprint

### 4.1 Database schema

New migration: `apps/core/src/database/migrations/002-credit-attribution.sql`.

```sql
-- credit_entries: per-(task, agent, ablation) attribution row.
-- Append-only. Most-recent row per (task_id, agent_id, ablation_type) wins.
CREATE TABLE credit_entries (
  id              TEXT        PRIMARY KEY,                       -- credit_{ulid}
  task_id         TEXT        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  team_id         TEXT        NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  agent_id        TEXT        NOT NULL REFERENCES agents(id) ON DELETE CASCADE,

  -- Ablation parameters (what counterfactual was tested)
  ablation_type   TEXT        NOT NULL CHECK (ablation_type IN ('null-agent', 'noised', 'random-replacement')),
  ablation_at_step INTEGER    NOT NULL,                          -- index in trace where ablation began
  workspace_snapshot_hash TEXT NOT NULL,                         -- sha256 of FS snapshot at handoff

  -- Outcome metrics (deterministic, no LLM judge)
  original_success BOOLEAN    NOT NULL,
  replay_success   BOOLEAN,                                      -- NULL if replay timed out / errored
  jaccard_overlap  REAL,                                         -- structural Jaccard on tool-call sequences, [0,1]
  marginal_contribution REAL,                                    -- 0.5*(1-jaccard) + 0.5*(success XOR), [0,1]

  -- Cost & operational
  replay_status   TEXT        NOT NULL CHECK (replay_status IN ('completed', 'timeout', 'errored', 'skipped')),
  replay_tokens   INTEGER,
  replay_time_ms  INTEGER,
  replay_model    TEXT        NOT NULL DEFAULT 'claude-haiku-4-5',
  replay_session_id TEXT,                                        -- foreign key to credit_traces.session_id

  created_at      BIGINT      NOT NULL                           -- ms epoch
);
CREATE INDEX idx_credit_entries_team_created ON credit_entries(team_id, created_at DESC);
CREATE INDEX idx_credit_entries_agent_created ON credit_entries(agent_id, created_at DESC);
CREATE INDEX idx_credit_entries_task ON credit_entries(task_id);

-- credit_traces: replay session traces, mirror of trace_events but isolated.
-- Auto-purged after CREDIT_REPLAY_TRACE_RETENTION_DAYS.
CREATE TABLE credit_traces (
  id          TEXT      PRIMARY KEY,
  session_id  TEXT      NOT NULL,
  credit_entry_id TEXT  NOT NULL REFERENCES credit_entries(id) ON DELETE CASCADE,
  step_index  INTEGER   NOT NULL,
  chunk_type  TEXT      NOT NULL,                                -- thinking | tool_use | tool_result | message | error
  payload     JSONB     NOT NULL,
  created_at  BIGINT    NOT NULL
);
CREATE INDEX idx_credit_traces_session ON credit_traces(session_id, step_index);
CREATE INDEX idx_credit_traces_created ON credit_traces(created_at);
```

Repository: `apps/core/src/repositories/credit-entries.repository.ts` (raw `pg` queries, parameterized, matches existing repo style).

### 4.2 Module layout

```
apps/core/src/credit-replay/
  credit-replay.module.ts
  credit-replay.service.ts          # task.completed listener, queue manager
  credit-worker.service.ts          # one logical worker per concurrent slot
  capability-map.service.ts         # aggregates credit_entries → per-agent vectors
  synapses-graph.service.ts         # team-level co-credit graph
  composition-assistant.service.ts  # k-NN role recommender
  util/
    structural-jaccard.ts           # deterministic tool-call comparison
    null-agent.ts                   # ablation primitive
    workspace-snapshot.ts           # SHA256 of workspace contents at a moment
  controllers/
    credit.controller.ts            # GET /api/agents/:id/capability, GET /api/teams/:id/synapses
```

### 4.3 The ablation primitive

`null-agent.ts` produces the substitute output for the ablated agent. The minimum viable null is:

```typescript
// apps/core/src/credit-replay/util/null-agent.ts
import type { TraceEvent } from '../../trace/types';

export function nullSubstitution(originalEvents: TraceEvent[]): TraceEvent[] {
  // Replace all tool_use/tool_result events from this agent with a single sentinel
  // message. The downstream agent will see the agent's slot as having "completed"
  // without producing artifacts. This tests: did the team need this agent at all?
  return [
    {
      type: 'message',
      role: 'assistant',
      content: '[no-op: agent ablated for credit attribution]',
      timestamp: originalEvents[0].timestamp,
    },
  ];
}
```

The choice of `[no-op]` rather than `null` matters: downstream agents must still receive *something* parsable to avoid spurious tool-format errors that would distort the marginal contribution. The sentinel string is recognized by the leader's CLAUDE.md template (Phase 1.5 below) as "this agent did nothing — proceed without their output."

### 4.4 The replay execution loop

```typescript
// apps/core/src/credit-replay/credit-worker.service.ts (skeleton)
@Injectable()
export class CreditWorkerService {
  async runReplay(job: CreditReplayJob): Promise<CreditEntry> {
    const trace = await this.trace.getTaskTrace(job.taskId);
    const ablationStep = this.findFirstToolUse(trace, job.ablatedAgentId);
    const snapshotHash = await this.workspace.snapshotHashAtStep(trace, ablationStep);

    // 1. Clone workspace at handoff moment via APFS clonefile (SBR-FV primitive)
    const cowDir = await this.workspace.cloneAt(snapshotHash);

    // 2. Build ablated trace prefix
    const ablatedPrefix = this.spliceAblation(trace, job.ablatedAgentId, nullSubstitution);

    // 3. Spawn Haiku-backed Claude CLI in cowDir, seeded with ablated prefix
    const replaySession = await this.claudeCli.replay({
      cwd: cowDir,
      model: process.env.CREDIT_REPLAY_MODEL ?? 'claude-haiku-4-5',
      seedTrace: ablatedPrefix,
      timeoutMs: Number(process.env.CREDIT_REPLAY_TIMEOUT_MS ?? 60_000),
      stopWhen: this.taskCompletionCriteria(job.taskId),
    });

    // 4. Persist replay trace to credit_traces (isolated from main trace)
    await this.persistReplayTrace(replaySession.id, replaySession.events);

    // 5. Compute deterministic metrics
    const originalToolCalls = this.extractToolCalls(trace);
    const replayToolCalls = this.extractToolCalls(replaySession.events);
    const jaccard = structuralJaccard(originalToolCalls, replayToolCalls);
    const replaySuccess = this.didReachCompletion(replaySession);
    const originalSuccess = await this.tasks.wasSuccessful(job.taskId);
    const marginal = 0.5 * (1 - jaccard) + 0.5 * (originalSuccess !== replaySuccess ? 1 : 0);

    // 6. Persist credit entry
    return this.creditEntries.insert({
      taskId: job.taskId,
      agentId: job.ablatedAgentId,
      ablationType: 'null-agent',
      ablationAtStep: ablationStep,
      workspaceSnapshotHash: snapshotHash,
      originalSuccess,
      replaySuccess,
      jaccardOverlap: jaccard,
      marginalContribution: marginal,
      replayStatus: 'completed',
      replayTokens: replaySession.totalTokens,
      replayTimeMs: replaySession.durationMs,
      replayModel: process.env.CREDIT_REPLAY_MODEL,
      replaySessionId: replaySession.id,
    });
  }
}
```

### 4.5 Structural Jaccard

```typescript
// apps/core/src/credit-replay/util/structural-jaccard.ts
import { createHash } from 'node:crypto';

type ToolCall = { name: string; args: unknown };

function fingerprint(call: ToolCall): string {
  const canonical = JSON.stringify(call.args, Object.keys(call.args ?? {}).sort());
  const sha = createHash('sha1').update(canonical).digest('hex').slice(0, 8);
  return `${call.name}:${sha}`;
}

export function structuralJaccard(a: ToolCall[], b: ToolCall[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const setA = new Set(a.map(fingerprint));
  const setB = new Set(b.map(fingerprint));
  let intersect = 0;
  for (const f of setA) if (setB.has(f)) intersect++;
  return intersect / (setA.size + setB.size - intersect);
}
```

This is the same canonicalization SBR-FV uses for its winner-fingerprints (`apps/core/src/orchestrator/branch-racing.service.ts`'s `fingerprintTrace`). Lift it into a shared `apps/core/src/common/fingerprint.ts` to avoid drift.

### 4.6 Capability vector

For a given agent `aᵢ` over the last 30 days:

```typescript
// apps/core/src/credit-replay/capability-map.service.ts
async function computeCapabilityVector(agentId: string): Promise<CapabilityVector> {
  const entries = await this.creditEntries.recent(agentId, { days: 30 });
  const taskTypeMap = new Map<string, number[]>();
  for (const e of entries) {
    const taskType = await this.tasks.classifyHint(e.taskId);  // cheap heuristic, e.g. "coding", "research", "review"
    if (!taskTypeMap.has(taskType)) taskTypeMap.set(taskType, []);
    taskTypeMap.get(taskType)!.push(e.marginalContribution ?? 0);
  }
  const vector: CapabilityVector = {};
  for (const [taskType, marginals] of taskTypeMap) {
    vector[taskType] = marginals.reduce((s, m) => s + m, 0) / marginals.length;
  }
  return vector;
}
```

Task-type classification is deliberately a cheap deterministic heuristic (string match on task title against a small label list) — this avoids another LLM dependency. If the taxonomy needs to grow later, it's a Phase-4 concern.

### 4.7 Synapses graph

```typescript
// apps/core/src/credit-replay/synapses-graph.service.ts
async function computeSynapses(teamId: string): Promise<SynapsesGraph> {
  const entries = await this.creditEntries.recentByTeam(teamId, { days: 30 });
  const byTask = groupBy(entries, 'taskId');

  const nodes = new Map<string, { agentId: string; size: number; tasks: number }>();
  const edges = new Map<string, { a: string; b: string; weight: number; coTasks: string[] }>();

  for (const taskEntries of byTask.values()) {
    const loadBearing = taskEntries.filter(e => (e.marginalContribution ?? 0) > 0.5);
    for (const e of loadBearing) {
      const node = nodes.get(e.agentId) ?? { agentId: e.agentId, size: 0, tasks: 0 };
      node.size += e.marginalContribution!;
      node.tasks += 1;
      nodes.set(e.agentId, node);
    }
    for (let i = 0; i < loadBearing.length; i++) {
      for (let j = i + 1; j < loadBearing.length; j++) {
        const [a, b] = [loadBearing[i].agentId, loadBearing[j].agentId].sort();
        const key = `${a}::${b}`;
        const edge = edges.get(key) ?? { a, b, weight: 0, coTasks: [] };
        edge.weight += 1;
        edge.coTasks.push(loadBearing[i].taskId);
        edges.set(key, edge);
      }
    }
  }

  // Normalize node size by participation count
  for (const n of nodes.values()) n.size = n.size / n.tasks;
  // Normalize edge weight to [0, 1]
  const maxWeight = Math.max(...[...edges.values()].map(e => e.weight), 1);
  for (const e of edges.values()) e.weight = e.weight / maxWeight;

  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}
```

### 4.8 SSE wire-up

Two new event types in `apps/core/src/sse/`:

- `credit.replay_started` — `{ teamId, taskId, agentId, ablationType, eta_ms }`
- `credit.replay_completed` — `{ teamId, taskId, agentId, marginal, jaccard, replayStatus }`
- `synapses.updated` — `{ teamId, snapshot }` — debounced 30s server-side, only emitted when graph topology changes meaningfully (new node, new edge, or node-size delta > 5%).

Subscribers: existing `useTeamSse` hook on `TeamDetail` gains a `synapses` slice in the Zustand store.

### 4.9 Endpoints

- `GET /api/teams/:id/synapses` — returns `SynapsesGraph` snapshot.
- `GET /api/agents/:id/capability` — returns capability vector + recent supporting credit entries.
- `POST /api/teams/:id/replay-task/:taskId` — admin-only manual trigger.
- `POST /api/credit/recommend-roles` — body `{ description: string }`, returns ranked list of role suggestions for a new team. (Phase 3.)

### 4.10 Hardware envelope on M4

Empirical numbers we should hit (and which the Pragmatic Optimizer's caps enforce):

- Per replay: ~30 s wallclock, ~28 MB peak RSS (Haiku CLI subprocess), ~$0.008.
- Concurrent ceiling: 3 replays + 2 main-pool agents = 5 Claude processes, ~600 MB RSS total; well within an M4 Air with 24 GB unified memory.
- Daily ceiling: 50 replays × $0.008 = $0.40/day worst case. ~25 minutes of cumulative replay wallclock.
- Workspace COW clones: APFS `clonefile` is constant-time per file; for typical `data/workspaces/{teamId}/` (~20 MB), ~80 ms per clone. Negligible.
- ANE residency: Haiku is small enough to fit alongside the user's Sonnet sessions; we don't compete for the ANE the way a local 70B model would.

### 4.11 Failure modes & their containment

| Failure mode | Containment |
|---|---|
| Replay timeout | `replay_status='timeout'`, `marginal_contribution=NULL`, excluded from aggregation. No retries — this run is just lost. |
| Replay errors (subprocess crash, FS error) | `replay_status='errored'`, persisted with error in `credit_traces`. No retries; logged via `OpsAlertService`. |
| Daily budget exhausted | New jobs not enqueued; existing in-flight jobs complete. Daily-reset cron at midnight UTC. |
| Storage growth | `credit_traces` auto-purged after 7 days via daily cron. `credit_entries` retained indefinitely (small footprint, ~200 bytes/row). |
| Workspace snapshot mismatch | If `clonefile` fails or snapshot hash doesn't reproduce, replay is skipped (`replay_status='skipped'`); no marginal recorded. Distinguishable from timeout for ops debugging. |
| Capability map staleness | Aggregation rolls 30 days. Beyond that, signal decays. New agents have empty capability vectors; UI shows "Not enough data yet." |

### 4.12 Migration path & feature gating

1. Ship Phase 1 behind `CREDIT_REPLAY_ENABLED=false` (default off). No UI surface; only DB tables and silent enqueue logic. Verify on dev: enable, complete 3-5 tasks, inspect `credit_entries`. Watch for unexpected pool starvation.
2. Enable in user environments behind a per-team toggle (`teams.credit_replay_enabled BOOLEAN DEFAULT false`). Users opt in.
3. Ship Phase 2 (Synapses panel) once 100+ entries exist per active team — empty graphs are bad first-impression UX.
4. Ship Phase 3 (Composition Assistant) once 30+ tasks exist per user across all teams.

### 4.13 Interactions with neighboring concepts

- **SBR-FV** is a *dependency*: STR reuses `WorkspaceService.cloneAt(snapshotHash)` and the structural-fingerprint utility. If SBR-FV ships first, STR is half-built.
- **GTLM** is *complementary*: STR could detect that a particular agent was load-bearing because it consulted the GTLM knowledge store at the right moment; the credit attribution then implicitly rewards GTLM use. Optional Phase-4 integration: per-agent breakdown of how much of their credit came from GTLM-augmented decisions.
- **Cognitive Mesh dialectical gate** is *upstream*: gate prevents bad plans before execution; STR measures who saved the day after execution. They form a closed loop — pre-action critique → action → post-action attribution → improved gate weighting.
- **TTT** is *orthogonal but pairable*: TTT's "cognitive position vector" could be joined with STR's marginal contribution per task to ask, *"What thinking patterns correlate with high marginal contribution?"* That's a Phase-5 research thread.

---

## 5. UX Impact — How the User Experiences the Breakthrough

### 5.1 The first 30 days (silent)

The user notices nothing. Their teams complete tasks as before. In the background, `credit_entries` accumulates. The Synapses tab on `TeamDetail` shows: *"Your team's nervous system is forming. Synapses appear after the first three completed tasks."*

### 5.2 First 3 tasks complete

The Synapses tab now shows three nodes — the agents who completed the tasks. One pulse animation per `credit.replay_completed` event arriving over SSE. The graph is sparse but alive. The user discovers the tab by accident, hovers a node, sees: *"Marginal contribution: 0.78 across 3 tasks. Top type: coding."*

The user has now learned something they did not know: their Architect agent was load-bearing 78% of the time across recent tasks. They might have guessed, but they did not *know*.

### 5.3 First two weeks of accumulation

Edges form between frequently co-load-bearing agents. The Architect–Reviewer edge thickens because they were both load-bearing in 9 of 12 tasks. The Researcher node, which the user added because it seemed thorough, stays small — its marginal contribution averages 0.12. The user is now considering whether to remove or repurpose the Researcher.

A subtle UI affordance: on hover of a low-marginal node, the system shows a quiet suggestion: *"This agent was load-bearing in only 1 of the last 12 tasks. Consider replacing or refining its role."*

### 5.4 The aha moment — composition

The user starts a new team for a new project. They type the task: *"Build a webhook receiver with retry logic."*

The system pauses for ~200 ms, then prefills the role roster:

> Based on 47 past tasks similar to this one:
>
> - **Architect** (load-bearing in 81% of similar tasks) ✓
> - **Implementation Worker** (load-bearing in 76%) ✓
> - **Reviewer** (load-bearing in 64%) ✓
> - ~~Researcher~~ (load-bearing in 11%) — not recommended
>
> *Override these suggestions if you know better.*

The user feels seen. The system has remembered something useful from their work and is now helping. Not in a generic LLM way — in a way that comes specifically from *their* history with *their* agents on *their* tasks.

### 5.5 The deeper magic — drift detection

After three months of usage, the capability vectors of any given agent role can *drift*. The user's "Reviewer" started out load-bearing 65% of the time but has dropped to 30% over the last month. Why? Maybe the Architect's outputs got better and don't need review. Maybe a recent prompt change to the Reviewer made it less effective. The system surfaces this as a quiet timeline annotation: *"Reviewer's effectiveness has decreased 35% over the last 30 days."*

The user investigates. Either way, the system has surfaced a regression that no manual inspection of trace logs would have caught. The team is *self-monitoring*.

### 5.6 The terminal state

Months in, the Synapses graph is dense, weighted, and meaningful. Looking at it, the user can read the team's working style at a glance: tight clusters of agents who collaborate often, isolated nodes who specialize, edges of varying thickness telling the story of "who really worked together." It is a portrait of how this team — *their* team — actually functions, drawn by the team about itself.

The user has not been shown a dashboard. They have been shown a *self-portrait the team has drawn over time*. This is the difference between analytics and identity.

---

## 6. Open Questions & Phase-4+ Threads

1. **Causal vs. associative credit.** Marginal contribution from null-ablation is associative — it tells us the team did differently without agent X, but not *why*. Phase-4: structural causal model over agent handoffs (Pearl-style) using credit entries as observational data.
2. **Adversarial agents.** What if an agent gaming the metric stuffs its outputs with high-Jaccard-distinct-but-useless tool calls to inflate its marginal? Mitigation: tie marginal to `replay_success` more heavily, or detect by anomaly (sudden spike in marginal without corresponding outcome quality). Open.
3. **Cross-team capability transfer.** Can a capability vector learned on Team A transfer to a similarly-scoped role on Team B? Plausible Phase-5 — would close the loop between user-level meta-learning and team-level reflection.
4. **STR ⊗ TTT.** Joint analysis of cognitive position vectors and marginal contribution — does a particular thinking-shape predict load-bearingness? Worth a `frontier/` document on its own.
5. **Replay budget elasticity.** If a user accepts higher cost, can they get faster Synapses convergence (e.g., temporarily Sonnet-backed replays)? Surface as "Boost" toggle.

---

*Filed under `bleeding-edge/` per the protocol in `rules.md` because it transplants a March 2026 academic mechanism into a specific graft point in `apps/core/src/orchestrator/`. It is not a `frontier/` concept (the underlying technique — counterfactual replay for Shapley-style attribution — has clear academic prior art); it is not a `product/` document (no DB-schema-to-ship-tomorrow finality at the UX-flow level). It is precisely a transplanted research idea, tested through committee dialogue, ready to enter the build queue.*
