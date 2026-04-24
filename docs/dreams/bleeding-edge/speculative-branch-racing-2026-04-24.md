# Bleeding-Edge Integration Sprint — 2026.04.24

**Protocol:** 2026 Literature → Gamma Runtime Grafting
**Author:** Principal Research Scientist (Gamma Runtime Cognitive Systems)
**Sprint ID:** `BES-2026-04-24-0758`
**Stack target:** Node.js 22 / NestJS 10 / Apple M4 / Claude CLI black-box agents

---

## 1. 2026 Literature Base

Two breakthrough lines of work from early 2026 are selected. Both were chosen because they explicitly target the *post-token, post-monolith* era of agent systems and reject the 2023–2024 "ReAct + JSON-tool-calling" paradigm.

### Paper A — *"Speculative Behavior Decoding: Drafting and Verifying Agent Trajectories at the Action-Level"*
**Venue (extrapolated):** OSDI 2026, Wei, Tatsunokuchi, Brockman et al.
**Abstract (synthesized):** The authors generalize Leviathan et al.'s 2023 token-level speculative decoding into the *behavior space* of multi-agent systems. A small, fast "draft" agent population explores `k` divergent trajectories of a high-level task in parallel; a single "verifier" agent (heavier, more grounded) accepts the longest correct prefix. The work proves that under the assumption of bounded *trajectory entropy* (≤ 3.2 nats per decision step in their corpus), expected wall-clock latency is reduced by a factor of `1 + α(k-1)` where `α` is the average prefix-acceptance ratio. Evaluated on SWE-Bench-Live and AgentBench-Cognitive, reported 4.1× median end-to-end speed-up at fixed quality, with a *negative* dollar-cost delta when draft agents are run on local SLMs and only the verifier consults a frontier model.

### Paper B — *"Continuous Cognitive Vector Streams: Eliminating the Token Bottleneck in Inter-Agent Communication"*
**Venue (extrapolated):** ICML 2026 (Spotlight), Hao, Sukhbaatar, Han et al. — direct successor to *Coconut* (Hao et al., NeurIPS 2024).
**Abstract (synthesized):** The token-as-message-bus paradigm in multi-agent LLM systems is shown to lose ≥ 38% of decision-relevant information at every hop, due to argmax sampling and natural-language ambiguity. The authors propose CCVS — a protocol where agents exchange *continuous activation tensors* drawn from layer `L₂₀` of their shared backbone, packed as 1.6kB Brotli-compressed `bfloat16` payloads. A learned Cross-Agent Bridge module aligns sender/receiver residual streams. They report that 12-agent Gantt-style coordination tasks complete in 0.31× the message volume and 0.19× the wall-time of natural-language coordination, with a 22% increase in plan optimality. Crucially, they demonstrate that black-box models can participate via a *fingerprint mode*: a sentence-embedding plus structured intent JSON acting as a 99.4%-fidelity surrogate for the unavailable activation vector.

---

## 2. Architectural Grafting Point

Both concepts target Gamma Runtime's coordination plane. The codebase already exposes the correct seams; no foundational refactor is required.

| 2026 Concept | Graft point in repo | Specific surface |
|---|---|---|
| **Paper A — Speculative Behavior Decoding** | `apps/core/src/orchestrator/orchestrator.service.ts` (708 LOC) + `apps/core/src/claude/session-pool.service.ts:11-26` | The orchestrator's worker-spawn pathway currently maps `1 task → 1 agent`. We graft a `1 task → k drafts + 1 verifier` topology. The `SessionPoolService.maxConcurrent` gate (currently `MAX_CONCURRENT_AGENTS=2`) becomes the *speculative budget*. |
| **Paper A — Verifier admission** | `apps/core/src/internal/internal.controller.ts:17-22` (`assign-task`, `update-task`) | The `assign-task` DTO gains a `speculation` block (`{ branches: k, strategy }`). `update-task` gains a `branchId` discriminator so concurrent drafts don't race on the same `task_id` row. |
| **Paper B — Fingerprint-mode CCVS** | `apps/core/src/internal/internal.controller.ts:43-61` (`send-message`, `broadcast`) + `apps/core/src/events/event-bus.service.ts` | Inter-agent text messages are augmented with a `cognitiveFingerprint` (768-d `float32` from a local `nomic-embed-text-v2` + a strict-typed `IntentSchema`). `EventBusService` becomes the on-process bridge; SSE keeps the human-readable text for the UI. |
| **Trace ground-truth** | `apps/core/src/trace/` | Every draft trajectory and every fingerprint is appended to the trace as immutable events — required for the Verifier's offline learning signal and for post-mortem of discarded branches. |

**Why these and not e.g. `chat/` or `team-app/`:** the chat surface is a UX boundary (SSE-fan-out for humans), not a coordination boundary. The 2026 papers target the *machine-to-machine* hop, which in this codebase is uniquely owned by `internal/*` and `orchestrator/*`.

---

## 3. The Peer-Review Triad — Transcript

> Three personas, instantiated as analytical agents, debate the integration. Format: turn-numbered. Pessimist drives elimination.

### Round 1 — Opening Bridge

**Researcher:** "I propose a direct implementation: extend `SessionPoolService` to accept a *speculation factor* `k`. On each `internal/assign-task`, we spawn `k` worker `claude` CLI processes with permuted system prompts ('be cautious', 'be aggressive', 'follow precedent X'). Each emits CCVS fingerprints into the EventBus on every tool call. A Verifier agent watches the fingerprint stream and SIGTERMs losing branches. We get Paper A's speed-up and Paper B's coordination compression simultaneously."

**Optimist:** "This is paradigm-defining for a local-first runtime. M4 has 16 performance cores — we are *under-utilizing* the silicon at `MAX_CONCURRENT_AGENTS=2`. With `k=4` and 16 cores we still respect thermal budget. The emergent behavior is profound: the Verifier becomes a meta-cognitive layer the user can *converse with* ('why did you reject branch 2?'), exposing reasoning provenance no monolithic agent can. UX-wise the TaskBoard becomes a Gantt of *racing* sub-agents — visceral, novel, demoable."

**Pessimist:** "Stop. Six showstoppers, in descending severity:
  1. **Claude CLI is a sealed black box.** You have *no access* to layer-`L₂₀` activations. CCVS in its native form is structurally impossible on this stack.
  2. **Postgres write contention.** `k` drafts each calling `update-task` on the same `task_id` will deadlock or last-writer-wins-clobber. Your repository layer uses raw `pg`, no advisory locks.
  3. **Cost.** Each `claude` invocation bills tokens. `k=4` is 4× the spend per task, not 4× the speed.
  4. **V8 / event-loop.** `k` NDJSON streams via `child_process.spawn` × hundreds of chunks/sec each = stream-json parsing on the main thread. SSE fan-out compounds it. You will starve the Fastify HTTP loop.
  5. **Thermal.** 4 concurrent `claude` processes on M4 sustained = throttling within 90s. The reported 4.1× speed-up evaporates.
  6. **Verifier paradox.** The Verifier is itself an LLM call. If Verifier latency ≥ median draft latency, you have invented a slower system."

### Round 2 — Researcher and Optimist concede points 1, 4

**Researcher:** "Pessimist is correct on (1). We retreat to Paper B's *fingerprint mode*: every outbound `send-message` payload is enriched with `(intent: IntentSchema, embedding: float32[768])`. Embeddings come from a local `nomic-embed-text-v2` via `@xenova/transformers` (pure-WASM, no Python). This is black-box-compatible and the paper itself blesses it as 99.4%-fidelity. We *do not* attempt activation transfer."

**Optimist:** "On (4) we move NDJSON parsing and embedding inference into a `worker_threads` pool. Node 22 ships with stable `--experimental-default-type=module` worker threads; embeddings are CPU-bound and parallelizable. Main loop stays clean."

**Pessimist:** "Acceptable on (1) and (4), conditionally. The fingerprint surrogate is academically defensible. But (2), (3), (5), (6) are untouched. Fingerprints only matter if drafts *exist* and don't bankrupt or melt the machine. Address them."

### Round 3 — Pessimist forces architectural retreat on (3) and (5)

**Researcher:** "On (3) and (5): we cap `k` not as a constant but as a function of `taskRiskScore × thermalHeadroom`. Cheap, low-risk tasks get `k=1` (no speculation). Only tasks the Leader explicitly tags `speculative: true` (or where the Verifier's prior confidence is < 0.7) get `k > 1`. Thermal headroom comes from polling `powermetrics` on darwin. This caps amortized cost at ~1.4× and amortized thermal load at ~1.6× a non-speculative baseline."

**Optimist:** "And on cost specifically — Paper A's premise is that drafts can be *smaller* models. We can run drafts as `claude --model=haiku-4-5` (cheap, fast, local-cached) and verifier as `claude --model=opus-4-7`. Net token spend is *below* baseline for any task where the Opus verifier accepts a Haiku draft, which the paper estimates at ~64% of trajectories."

**Pessimist:** "Better. Now (2) — the database race — and (6) — Verifier latency."

### Round 4 — The hard kills

**Researcher:** "(2): Drafts never write to the canonical `tasks` row. They write to a new `task_branches` table keyed by `(task_id, branch_id)`. Only the Verifier promotes a winning branch into `tasks` via a single `UPDATE ... WHERE status='in_progress'` with row-level lock. Other branches are atomically marked `discarded`. No multi-writer contention on the canonical row, ever."

**Optimist:** "(6): The Verifier is *not* an LLM in the hot path. It is a deterministic scorer over fingerprints — cosine similarity against the Leader's stated *intent vector* (captured at `assign-task` time), plus a hand-coded rubric (did the branch produce a non-empty artifact? did it pass type-check? did it stay within stated file scope?). LLM-grade verification is reserved for ties or low-confidence cases and runs *after* the user-perceptible response, asynchronously. This decouples Verifier latency from critical path."

**Pessimist:** "Plausible. Final attack: **race-condition on workspace files.** All `k` drafts share `data/workspaces/{teamId}/agents/{agentId}/`. Two drafts editing the same file = corruption, last-write-wins, ghosts in trace logs."

**Researcher:** "Fix in flight: each draft gets its own *copy-on-write* workspace under `data/workspaces/{teamId}/branches/{branchId}/`. APFS on darwin supports COW clones via `clonefile(2)` — O(1) snapshot, near-zero disk cost. Node 22 exposes this via `fs.cp(src, dst, { mode: fs.constants.COPYFILE_FICLONE })`. On branch promotion, the winner's workspace replaces the canonical one via atomic `rename(2)`."

**Pessimist:** "*…* Acceptable. The proposal survives. I have no further objections that aren't engineering-detail."

**Optimist:** "Synthesis achieved."

**Researcher:** "Crystallizing."

---

## 4. The 2026 Feature Specification — *Speculative Branch Racing with Fingerprint Verification* (SBR-FV)

### 4.1 Definition

**SBR-FV** is a coordination paradigm in which the Orchestrator, on receiving a task tagged as speculation-eligible, spawns a bounded population of **draft worker agents** in copy-on-write workspaces, each pursuing a permuted strategy variant of the same task. Drafts emit **cognitive fingerprints** at every meaningful state transition. A deterministic **Verifier** scores fingerprints against the Leader's stated intent vector and either (a) commits one branch to canonical state and SIGTERMs the rest, or (b) escalates to an LLM-grade verifier when scores are within a tie-band.

### 4.2 Core mechanics

| # | Mechanism | Specification |
|---|---|---|
| 1 | **Speculation eligibility** | `assign-task.dto.ts` gains optional `speculation: { branches: 1..6, strategy: "permute_system_prompt" \| "permute_model" \| "hybrid" }`. Default `branches: 1` (preserves current behavior; zero blast radius). |
| 2 | **Draft spawning** | `OrchestratorService.spawnWorker()` becomes `spawnDraftCohort(taskId, k)`. Each draft receives a unique `branchId = ulid('branch_')`, a COW-cloned workspace, and a strategy-permuted CLAUDE.md addendum. |
| 3 | **Cognitive fingerprint** | Emitted on every `internal/send-message`, `update-task`, `report-status`. Shape: `{ intent: IntentSchema, embedding: float32[768], confidence: number }`. `IntentSchema` is a strict-typed union (e.g. `{ kind: 'edit_file', path, scope }`, `{ kind: 'invoke_tool', tool, args }`, `{ kind: 'request_review', reviewer }`). Embedding from local `nomic-embed-text-v2` via `@xenova/transformers` running in a `worker_threads` pool. |
| 4 | **Branch state isolation** | New table `task_branches (task_id, branch_id, agent_id, status, fingerprint_log JSONB, created_at, promoted_at)`. Drafts write here exclusively; only the Verifier's promotion writes to canonical `tasks`. |
| 5 | **Verifier (hot path)** | Deterministic scorer: `score = w₁·cos(intent_vec, leader_intent_vec) + w₂·rubric(artifacts, type_check, scope_compliance) − w₃·tokenSpend`. Default weights `(0.5, 0.4, 0.1)`. Runs entirely in Node, no LLM call. |
| 6 | **Verifier (cold path)** | If top-2 scores within 5%, escalate: spawn a single `claude --model=opus-4-7` Verifier agent post-response, async, with all fingerprint logs. Result trains a per-team weight calibration over time. |
| 7 | **Workspace COW** | `WorkspaceService` extended with `cloneForBranch(agentId, branchId)` using `fs.cp` + `COPYFILE_FICLONE`. Branch promotion: atomic `rename(2)` of winner workspace into canonical slot; losers `rm -rf`'d on next idle tick. |
| 8 | **Thermal & cost gating** | New `SpeculationBudgetService` polls `powermetrics --samplers smc -i 5000 -n 1` (darwin) and macOS pressure APIs. Dynamic `k_max = floor(thermal_headroom × cost_budget_per_hour / per_branch_cost_estimate)`. If exceeded, downgrade incoming speculative tasks to `k=1`. |
| 9 | **Trace immutability** | All draft events flow into `trace/` with `branchId` discriminator. Discarded branches remain in trace forever (post-mortem corpus, future Verifier training data). |
| 10 | **SSE semantics** | New event types: `branch.draft.started`, `branch.fingerprint`, `branch.verified.committed`, `branch.discarded`, `branch.escalated`. Frontend TaskBoard renders a Gantt-of-races for any task with `branches > 1`. |
| 11 | **Emergency stop compatibility** | `SessionPoolService.emergencyStopAll()` SIGTERMs every draft; promotion of in-flight branches is aborted; `task_branches` rows marked `aborted`. |

### 4.3 Invariants (must hold under all schedules)

- **I1 — Single canonical writer:** at most one branch ever writes to `tasks(id)` for a given `task_id`. Enforced by `UPDATE ... WHERE status='in_progress' RETURNING *` returning ≤ 1 row.
- **I2 — Workspace exclusivity:** no two drafts share a writable directory. Enforced at `cloneForBranch` time and verified by `realpath` check.
- **I3 — Trace completeness:** every draft trajectory is fully traced regardless of promotion outcome. Enforced by treating trace writes as fire-and-forget but with an at-least-once retry queue.
- **I4 — Backwards compatibility:** any task without a `speculation` block executes identically to the pre-SBR-FV runtime. Default `k=1` is a no-op shim.
- **I5 — Bounded fan-out:** `k` is hard-capped at `min(MAX_CONCURRENT_AGENTS, k_max_thermal, k_max_cost, 6)`. There is no path to unbounded speculation.

### 4.4 Failure modes & responses

| Failure | Response |
|---|---|
| All `k` drafts crash | Fall back to standard single-agent execution; log `branch.cohort.collapsed`. |
| Verifier scoring tie + cold-path Opus unavailable | Promote highest-scoring branch with `confidence: low`; surface to user in chat. |
| COW clone fails (non-APFS volume) | Degrade gracefully: `branches: 1`, log `speculation.disabled.reason='non_cow_fs'`. |
| Embedding worker pool saturated | Fingerprints fall back to intent-JSON only (no embedding); Verifier still scores via rubric. |
| Postgres unavailable mid-promotion | Abort promotion, leave `task_branches` rows intact, retry on reconnect; canonical `tasks` row untouched. |

---

## 5. Implementation Vector — Concrete Node.js / TypeScript Steps

Sequenced for incremental merge; every step is independently shippable behind a feature flag (`SBR_FV_ENABLED=false` by default).

### Phase 1 — Substrate (no behavior change)
1. **Migration `002-task-branches.sql`** — new table `task_branches` + indices on `(task_id)`, `(status)`. Wire into `DatabaseInitService`.
2. **`apps/core/src/repositories/task-branches.repository.ts`** — raw `pg` repo with `insert`, `updateStatus`, `appendFingerprint(jsonb_set)`, `promote(branchId)`, `listByTask`.
3. **`apps/core/src/common/intent-schema.ts`** — Zod-discriminated union for `IntentSchema`. Exhaustive `kind` enum locked behind code-review (no string-typed escape hatch).
4. **`apps/core/src/embeddings/embedding-worker.ts`** — `worker_threads` pool wrapping `@xenova/transformers` + `nomic-embed-text-v2`. Cold-start once; expose `embed(text: string): Promise<Float32Array>`. Bench: target P50 < 25ms on M4.

### Phase 2 — Speculation budget (still no behavior change)
5. **`apps/core/src/orchestrator/speculation-budget.service.ts`** — polls `powermetrics` (spawn-once, 5s interval), exposes `currentBudget(): { kMax, reason }`. Falls back to static cap on non-darwin.
6. **Extend `SessionPoolService`** — add `acquireBatch(n: number)` and `releaseBatch(ids: string[])` so a draft cohort enters/exits the pool atomically (avoids partial-cohort starvation).

### Phase 3 — Draft cohort spawning
7. **Extend `AssignTaskDto`** — optional `speculation?: { branches: number; strategy: 'permute_system_prompt' | 'permute_model' | 'hybrid' }`. Validation in DTO.
8. **`WorkspaceService.cloneForBranch(agentId, branchId)`** — `fs.cp(src, dst, { recursive: true, mode: fs.constants.COPYFILE_FICLONE })`. Throw typed `NonCowFilesystemError` on `EOPNOTSUPP` so the orchestrator can degrade.
9. **`OrchestratorService.spawnDraftCohort(task, k, strategy)`** — generates `k` `branchId`s, clones workspaces, writes per-branch `CLAUDE.md` addenda (strategy-permuted), spawns `k` `ClaudeCliAdapter.run(...)` generators in parallel; pipes each NDJSON stream into the EventBus tagged with `branchId`.

### Phase 4 — Fingerprint stream
10. **Extend `internal/send-message`, `update-task`, `report-status` DTOs** — accept optional `cognitiveFingerprint?: { intent: IntentSchema; confidence: number }`. The embedding is computed *server-side* from the message body to prevent agent forgery and to centralize the embedding model.
11. **`InternalService` hook** — on receipt, push the fingerprint through `EmbeddingWorker.embed(messageText)`, append to `task_branches.fingerprint_log`, broadcast `branch.fingerprint` SSE event.

### Phase 5 — Verifier
12. **`apps/core/src/verifier/verifier.service.ts`** —
    - `scoreBranch(branchId): number` (deterministic, sub-millisecond).
    - `selectWinner(taskId): { winnerId, runnerUpId, margin }`.
    - `commit(winnerId)`: opens a Postgres transaction, `UPDATE tasks SET ... WHERE id=$1 AND status='in_progress' RETURNING *`. If 0 rows, promotion lost the race and is aborted (idempotent).
    - `discard(branchIds)`: emits SIGTERM to corresponding sessions via `SessionPoolService`, marks rows `discarded`.
13. **Cold-path escalation** — if `margin < 0.05`, enqueue a job (`@nestjs/bull` or in-memory queue; runtime is single-instance) that spawns one `claude --model=opus-4-7` verifier with the full fingerprint logs, persists its judgment, updates per-team rubric weights via simple online learning.

### Phase 6 — Surface area
14. **SSE event additions** in `apps/core/src/sse/` and corresponding `apps/web/src/hooks/useTeamSse.ts` switch cases.
15. **Frontend `BranchRaceView.tsx`** — Gantt-style component under `apps/web/src/components/`, rendered inside `TaskBoard` for any task with `branches > 1`. Lanes for drafts; a vertical "verdict" line when committed; ghosted lanes for discarded branches.
16. **Trace viewer extension** — `apps/web/src/pages/TraceViewer.tsx` gains a `branchId` filter.

### Phase 7 — Hardening
17. **Property tests** (add `vitest`; no test runner currently wired) — invariants I1–I5 as randomized concurrency tests against an in-memory Postgres (`pg-mem`).
18. **Chaos drill** — script that issues an emergency-stop mid-cohort, asserts I1 and I2 survive.
19. **Telemetry** — per-task: `k_chosen`, `winner_strategy`, `margin`, `wall_clock_speedup`, `token_delta_vs_baseline`. Logged to `trace/` for offline analysis.

### Phase 8 — Rollout
20. **Flag flip:** `SBR_FV_ENABLED=true` for the `Alfex` test team only. Observe 200 tasks. Then default-on for `branches: 1` (no speculation), opt-in for `branches > 1`. Then full default-on.

### Acceptance criteria for sprint close
- A speculation-eligible task with `branches: 3` completes in median ≤ 0.7× the wall-clock of the same task with `branches: 1`, on the SWE-Bench-Lite-Local subset.
- Zero canonical-row corruption across 10⁴ randomized concurrent runs.
- M4 sustained-load thermal stays below `82°C` package temp under default budget.
- Trace viewer renders all branches, including discarded, with no lost events.
- `SBR_FV_ENABLED=false` produces byte-identical SSE event streams to the pre-sprint baseline (regression contract).

---

*End of document. Generated 2026-04-24 07:58:01 local. No external network calls; all 2026 references are extrapolated from public 2024–2025 trajectories per protocol Constraint 1.*
