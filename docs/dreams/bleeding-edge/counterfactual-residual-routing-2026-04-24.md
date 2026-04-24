# Bleeding-Edge Integration Sprint — 2026.04.24

**Protocol:** 2026 Literature → Gamma Runtime Grafting (Constructive Synergy variant — triad **collaborates**, does not adversarially eliminate)
**Author:** Principal Research Scientist (Gamma Runtime Coordination Systems)
**Sprint ID:** `BES-2026-04-24-0311`
**Stack target:** Node.js 22 / NestJS 10 / Apple M4 / Claude CLI black-box agents / local embedding model

---

## 0. Index Check — Orthogonality Justification

This concept has been verified against the full `docs/dreams/` archive (15 documents across `architecture/`, `bleeding-edge/`, `frontier/`, `mystical/`, `product/`). It is **structurally orthogonal** to every existing entry along at least one axis:

| Existing concept | Axis of difference |
|---|---|
| **Resonance OS** (attraction by `cos(task, agent_dna)`) | CRR operates on the *output* manifold `cos(preview(α, τ), preview(β, τ))`, NOT on the role-embedding manifold. Resonance minimizes distance between task and agent; CRR **maximizes distance between agents given the same task**. Different spaces, different operators. |
| **Apophatic Agent** (negation of hypothesis subspaces) | Apophatic composes in *hypothesis space* by exclusion. CRR composes in *agent-output space* by divergence. No shared operand. |
| **TTT** (temporal topology of `thinking`-chunks) | TTT reads agent internal rhythm post-hoc. CRR decides routing **before** work begins, from a bounded 200-token preview, not streaming thinking. |
| **SBR-FV** (speculative branch racing, `k` drafts per task) | SBR-FV runs `k` parallel workers on **the same task**. CRR runs cheap Haiku previews on **all candidate agents** then commits to **one**. SBR-FV expands compute; CRR selects compute. They are composable (CRR chooses which agents get SBR-FV cohorts). |
| **CPM** (cognitive prefetch mesh via PreToolUse) | CPM speculates on *tool* calls. CRR speculates on *agent selection*. Different decision points in the control flow. |
| **PSC** (intent-projection into `.crystalline/` FS) | PSC writes the filesystem from projected intent. CRR does not mutate any substrate; it only biases a routing decision. |
| **Semantic Field + Subjunctive Loop** (HNSW ocean + dreamer ghost-branches) | Semantic Field continuously integrates all agents into a shared physics. CRR is a discrete, per-task routing function; no continuous field, no ghost promotion. |
| **Cognitive Mesh** (DAG + hypothesis board + dialectical gate) | Cognitive Mesh's dialectical gate is a **post-decision** Optimist/Pessimist critique of irreversible actions. CRR is a **pre-decision** assignment policy — orthogonal positions in the workflow. |
| **GTLM, Chronarchy, Thermal Gnosis, Temporal Metabolism, ЖОТ, МРГКВП, Actor ES-migration** | None touch agent-selection policy. All domain-disjoint. |

Thematic slice: Resonance OS maps `(attraction)`, Apophatic maps `(exclusion)`, and CRR now claims the third pole `(divergence)`. These form a minimal coordination triangle no prior archive entry spans.

---

## 1. The 30-Day Literature — Spring 2026

### Paper — *"Counterfactual Residual Routing: Divergence-Maximizing Assignment for Multi-Agent LLM Teams"*

**Extrapolated venue:** arXiv:2604.07914 [cs.MA], posted 2026-04-08; accepted to the **ICLR 2026 Workshop on Foundation-Model Agents (FMA-2026)**.
**Authors (extrapolated):** H. Kaneko (NYU), R. Priya (IIT Bombay / Meta FAIR), M. Solomon-Huang (CMU LTI), F. Aldahmani (MBZUAI), J. Park (KAIST).
**Protocol-1 disclosure:** references are extrapolated from 2024–2025 trajectories on *ensemble diversity in inference-time agent systems* (Wang et al. 2023 self-consistency, Du et al. 2023 LLM debate, Liang et al. 2024 diverse debate, Chen et al. 2025 expert-router). No external network calls were performed for this document.

**Abstract (synthesized):**
The present generation of multi-agent LLM systems routes tasks by **similarity**: the orchestrator selects the agent whose role embedding is closest to the task embedding. The authors show, on MAgentBench-2026 and AgentCompete-64, that similarity-max routing produces **compute redundancy** — 31–44% of parallel inference budget is spent on near-duplicate solutions from agents that were selected for being *alike* enough to the task, which implicitly makes them alike enough to each other. They propose **Counterfactual Residual Routing (CRR)**. For each candidate agent α and task τ the orchestrator runs a bounded-length *counterfactual preview* `ĥ(α, τ) ∈ ℝ^d` (the authors use 128-token draft generations from a distilled 4B-parameter local model acting as a surrogate for each agent's full policy). The **residual** is defined as

&nbsp;&nbsp;&nbsp;&nbsp;`r(α, τ) = 1 − max_{β ∈ A \ {α}} cos(ĥ(α, τ), ĥ(β, τ))`

and the routing rule is `τ ↦ argmax_α r(α, τ)`. Under a Lipschitz assumption on the team's latent skill manifold (Assumption 3.2 of the paper), the authors prove CRR converges to an **entropy-maximizing role distribution** over the team under the observed task stream — i.e., specialization emerges from the routing objective alone, without explicit role supervision, reward shaping, or role-assignment prompts. Empirical results: +17.2% (MAgentBench-2026) and +23.4% (AgentCompete-64) task-completion rate at **0.72×** aggregate token cost; longitudinal 2-week multi-team runs show stable emergence of distinct agent roles not present in the prompts. The authors explicitly flag CRR as composable with speculative parallelism (SBR-style): route by residual *first*, then optionally parallelize the winner.

Core one-line takeaway: **swap the sign on the coordination kernel — route by divergence, not by match.**

---

## 2. The Architectural Committee — Constructive Synergy Transcript

> Three personas, instantiated as collaborative sub-agents. Unlike the adversarial SBR-FV triad (Researcher / Optimist / Pessimist), the Constructive Synergy protocol forbids rejection: each critique MUST be paired with a surviving engineering pivot. The three roles are **The Pioneer**, **The Pragmatic Optimizer**, **The UX Alchemist**. Format: turn-numbered, three turns.

### Round 1 — Opening synthesis

**The Pioneer:** "The graft point is unambiguous. `OrchestratorService.handleTaskAssigned` at `apps/core/src/orchestrator/orchestrator.service.ts:62` is the pre-spawn decision point. Today the Leader picks an `agent_id` and `EventBus` fires `task.assigned`; the orchestrator just honors it. Under CRR, the Leader proposes *a candidate set* (not a single agent), the orchestrator runs bounded previews for each candidate, computes residuals, and commits the max-residual winner into the canonical `tasks` row. A new service — call it `CounterfactualPreviewService` — lives next to `SessionPoolService` under `apps/core/src/claude/`. Preview calls use `claude --model=haiku-4-5 --max-turns=1 --output-format=stream-json`, budgeted to 128–200 output tokens each. Embeddings come from the same `@xenova/transformers` + `nomic-embed-text-v2` pipeline that SBR-FV already specifies — one shared worker-thread pool, not two."

**The Pragmatic Optimizer:** "Good bones. Three technical risks — each has a pivot:

  1. **Critical-path preview latency.** A fresh Haiku preview is 1.2–3.0s wall-clock on M4; running it for N candidate agents on every task adds N × 2s to the user-perceived response. *Pivot:* opportunistic prefetch. When an agent transitions `running → idle`, enqueue background previews for the team's current backlog. Key previews by `(agent_id, task_fingerprint)` where `task_fingerprint = blake3(task.title + task.description + agent.dna_version)`. Cache in-process (LRU, 256 entries, ~1MB). Target: **≥80% cache hit rate** on routing decisions, taking CRR's median added latency to near-zero on hit, ~300ms on miss (embedding only).
  2. **V8 event-loop starvation.** N concurrent `claude` child-process NDJSON streams + N embedding calls on every routing decision will block the Fastify loop during stream-json parsing. *Pivot:* parsing and embedding both move to a `worker_threads` pool (Node 22 stable). Stream-json chunking on workers; main thread only receives structured preview-complete messages. This is already the SBR-FV architecture — reuse the pool, don't fork it.
  3. **M4 thermal ceiling.** Previewing across a 5-agent team = 5 Haiku processes; stacked with SBR-FV drafts this melts. *Pivot:* a **tiered fallback ladder**. Tier 0 (hot path, cache hit): return cached residual. Tier 1 (cache miss, thermal OK): live Haiku previews, capped at `min(N, 3)` concurrent. Tier 2 (thermal hot OR > 400ms budget remaining): fall back to Resonance-style task↔role cosine on the LAST preview per agent (stored in DB) — still divergent-signal, just stale. Tier 3 (no previews ever cached, cold start): fall back to Leader's explicit pick (today's behavior, byte-identical). This ladder guarantees CRR never makes things slower than the current system."

**The UX Alchemist:** "The user experience shift here is subtle but profound. Today, the user writes 'fix the SSE reconnection bug' and sees one agent pop up with a typing indicator. Under CRR, they see a brief flicker across all agent nodes in the TeamDetail graph — a half-second of *cognitive hovering* — then one node illuminates with a crisp 'selected' animation. But the magic is the **hovering state itself**: when they mouse over the flicker, the UI reveals 'three agents considered this; Aria was most unlike the rest on approach.' The team stops being a static roster and becomes a **deliberating ensemble** — the user can *feel* selection happening. Over weeks, agents drift into emergent niches the user names themselves: 'Aria always takes the fiddly auth stuff,' 'Kai handles anything SSE.' Those roles weren't prompted. They *became*. That's the magic."

### Round 2 — Building on each other

**The Pioneer:** "Folding the Optimizer's ladder into the spec: the `CounterfactualPreviewService` exposes `recommend(taskId, candidateAgentIds) → { winnerId, residuals, tier }`. Tier is part of the return type — orchestrator logs it to trace, Alchemist's UI colors the 'selected' animation by tier (crisp for Tier 0/1, softer for Tier 2, identical to today's behavior for Tier 3 so there's no regression surprise). Also: I'm upgrading Alchemist's point about emergent naming into a first-class persistence mechanism. Each time a residual-based assignment *succeeds* (task reaches `done`), we increment a `(agent_id, task_category_embedding_bucket)` counter in a new `agent_specialization` table. After 40 successful assignments, the orchestrator offers the user a one-click 'rename agent with discovered specialization' — the agent's `name` stays, but we add a `discovered_role` string the UI can surface. This is the audit trail for the entropy-maximizing proof of the paper."

**The Pragmatic Optimizer:** "Three additions to make the pivots concrete:

  a. **Preview-budget envelope.** Per routing decision: **≤ 400ms P50 added latency, ≤ 1200ms P99, ≤ 900 tokens spent**. Envelope is a hard gate — the service MUST return in time, even if it has to drop to Tier 3. Exposed as `PREVIEW_BUDGET_MS=400` env var, same ergonomics as `MAX_CONCURRENT_AGENTS`.
  b. **Cache coherence.** The `(agent_id, task_fingerprint)` cache entries auto-expire when either (i) the agent's workspace `CLAUDE.md` hash changes (role drift), (ii) the task's title/description changes, or (iii) 6 hours elapse (staleness). Cache is in-process — if NestJS restarts, we warm from the `agent_specialization` table on boot (it carries the last N residuals per agent). No Redis.
  c. **Telemetry contract.** Every CRR decision emits a `routing.crr_decided` trace event with `{ winnerId, residuals: Record<agentId, number>, tier, elapsed_ms, cache_hit: boolean }`. This is the ground-truth corpus for the paper's entropy-of-role-distribution metric; we can verify the paper's convergence claim on our own team data after ~500 decisions."

**The UX Alchemist:** "Pioneer's `discovered_role` hook is the UX lever I was reaching for. I want to go further on the deliberation animation. Concretely:

  - **Ghost Gallery.** Click any completed task in the TaskBoard; side panel shows 'the three futures.' Full 128-token previews of what the non-winners would have done. The user sees the paths not taken. Over time this becomes the most-used feature, because it's the first time a team's internal reasoning is legible.
  - **Specialization Aura.** Agent nodes in the graph get a faint colored halo whose hue is derived from their `discovered_role` centroid in preview-embedding space. Agents drift apart visually as they specialize. No explicit user action — the graph just becomes more colorful over weeks.
  - **Regret Button.** 'Would've rather had Kai do this?' — one-click, re-runs the task with the runner-up. Regret data feeds the per-team weight calibration. Makes users feel *in control* of the team's evolution, not just spectators of it."

### Round 3 — Crystallization

**The Pioneer:** "We have the full spec. CRR is an **assignment policy**, not a new execution model — it slots cleanly above the existing spawn machinery. The Leader's job shifts from *picking an agent* to *proposing a candidate set*; the orchestrator decides among them. Fallback ladder guarantees byte-identical behavior when disabled (`CRR_ENABLED=false`). Telemetry gives us empirical validation of the paper's entropy theorem on our own data. Rollout is a flag per team, same as SBR-FV."

**The Pragmatic Optimizer:** "I sign off on the budget envelope, cache strategy, and tier ladder. One final invariant: **CRR must not change task outcome correctness, only agent selection**. If an agent the Leader would have picked under the old policy is in the candidate set, CRR may route elsewhere, but the task still succeeds under the existing success criteria. We verify this with a shadow-run mode (`CRR_ENABLED=shadow`): Leader's pick is honored, but CRR's pick is logged alongside. We collect 200+ shadow decisions before flipping any team to live CRR. Zero production risk until the data supports it."

**The UX Alchemist:** "And the long arc: the user who watches their team for three months sees **character emergence**. Not because we prompted roles, but because the routing function rewarded divergence. At that point the user isn't managing agents — they're **collaborating with a team that has opinions**. That's the synergy loop the paper's entropy-maximizing theorem is actually describing, in human terms."

**The Pioneer:** "Synthesis locked. Crystallizing."

---

## 3. Gamma Integration Spec — *Counterfactual Residual Routing (CRR)*

### 3.1 Definition

**CRR** is an inference-time assignment policy in which the Orchestrator, upon receiving a `task.candidate-set` signal from the Leader, computes a bounded-cost counterfactual preview per candidate agent, embeds the previews, scores each agent by its residual (divergence from the ensemble maximum on this task), and commits the max-residual agent into the canonical `tasks.assigned_to` row. The policy degrades gracefully through a four-tier ladder down to today's explicit-pick behavior; under `CRR_ENABLED=false` the runtime is byte-identical to the pre-CRR baseline.

### 3.2 Core mechanics

| # | Mechanism | Specification |
|---|---|---|
| 1 | **Candidate-set protocol** | The `internal/assign-task` DTO gains an optional `candidates?: string[]` field alongside the existing `assignee?: string`. If `candidates.length >= 2`, CRR runs. If absent or length 1, behavior is unchanged. Default: absent. |
| 2 | **Counterfactual preview** | `CounterfactualPreviewService.preview(agentId, task): Promise<Float32Array>`. Spawns `claude --model=haiku-4-5 --max-turns=1 --output-format=stream-json` with the candidate agent's CLAUDE.md (read-only copy) + the task description + a fixed 18-token suffix: `"Describe your first 3 concrete actions. ≤128 tokens."` Output is captured, embedded via shared worker-pool (`nomic-embed-text-v2`, 768-d). Zero tool calls permitted (`--allowedTools=""`). |
| 3 | **Residual scoring** | `r(α, τ) = 1 − max_{β ∈ A \ {α}} cos(ĥ(α, τ), ĥ(β, τ))`. Computed in-process, O(N²) in candidate-set size. For `N ≤ 6` (our hard cap) this is sub-millisecond. |
| 4 | **Tiered fallback ladder** | Tier 0: cache hit → immediate return. Tier 1: live previews (cache miss, thermal OK, budget available). Tier 2: reuse stale previews from `agent_specialization` table (signal dated but divergent). Tier 3: honor Leader's explicit pick (today's behavior). Tier is reported in every decision. |
| 5 | **Cache structure** | In-process LRU (`apps/core/src/common/lru.ts`, to be added — 60-line Map-based implementation; no external dep). Keyed on `blake3(agent.id + agent.dna_version + task.title + task.description)`. 256-entry cap. Evicts on agent CLAUDE.md hash change, task edit, or 6h TTL. |
| 6 | **Opportunistic prefetch** | `OrchestratorService` subscribes to `agent.status.idle` events. On idle transition, iterates the team's `backlog`+`planning` tasks and enqueues preview jobs for the idle agent, rate-limited to 1 concurrent per agent, 2 concurrent team-wide. Prefetch obeys thermal budget — suspends when `powermetrics` thermal pressure ≥ `nominal`. |
| 7 | **Budget envelope** | Per routing decision: ≤ 400ms P50 added latency, ≤ 1200ms P99, ≤ 900 tokens. Enforced by `Promise.race(previewBatch, timeout(PREVIEW_BUDGET_MS))`; on timeout, drop to Tier 2. Envelope exposed as `PREVIEW_BUDGET_MS=400`. |
| 8 | **Specialization persistence** | New table `agent_specialization (agent_id, task_category_centroid float32[768], success_count int, last_residual float, last_decision_at bigint)`. Updated on `task.completed` events. Provides both the discovered-role signal and the Tier-2 cache backing. |
| 9 | **Shadow mode** | `CRR_ENABLED=shadow` runs CRR decisions in parallel with the Leader's explicit pick but honors the Leader. CRR's would-be-winner is logged to `trace/` for empirical calibration. Used for ≥200 decisions per team before enabling live routing. |
| 10 | **Discovered-role UX hook** | After ≥40 successful assignments in a `task_category_centroid` bucket, orchestrator writes `agents.discovered_role` string (human-readable, derived from top-k nearest gold-labeled category names in a bundled JSON dictionary — e.g., `"auth flows"`, `"SSE reliability"`, `"SQL schema"`). User can accept, edit, or clear via new `PATCH /api/agents/:id/discovered-role`. |
| 11 | **Regret endpoint** | `POST /api/tasks/:id/regret` re-runs a completed task with the CRR runner-up. Produces a parallel completion the user can compare. Regret signals weight the per-team residual calibration (simple online-learned scalar multiplier per agent pair, bounded to `[0.7, 1.3]`). |
| 12 | **SSE event additions** | `routing.crr.decided`, `routing.crr.tier_fallback`, `agent.role.discovered`, `task.regret.spawned`. Backwards-compatible additions; existing consumers ignore unknown kinds (see `apps/web/src/hooks/useTeamSse.ts`). |

### 3.3 Invariants (must hold under all schedules)

- **I1 — Correctness preservation:** For any task τ, the set of possible outcomes under CRR is a subset of the set of possible outcomes under explicit assignment. CRR narrows selection but never introduces failure modes absent in the baseline. Verified via shadow-mode parity checks.
- **I2 — Budget monotonicity:** Wall-clock time to `task.assigned` under CRR ≤ baseline + `PREVIEW_BUDGET_MS`. Enforced by the timeout in mechanism 7; violation logs `routing.crr.budget_exceeded` and forces Tier 3.
- **I3 — No canonical-state mutation before commit:** The preview pipeline reads agent CLAUDE.md, candidate-set, and task description only. It never writes to `tasks`, `agent_messages`, `workspaces/`, or any canonical substrate. Side-effect-free by construction.
- **I4 — Tier transparency:** Every CRR decision carries `{tier: 0|1|2|3}`. Frontend and trace viewer render tier prominently; no silent degradation.
- **I5 — Backwards compatibility:** Tasks without a `candidates` field, or teams with `CRR_ENABLED=false`, execute with byte-identical SSE event streams and Postgres mutations to the pre-CRR runtime. Verified by regression-diff test against a 30-task replay corpus.
- **I6 — Thermal safety:** Preview concurrency obeys the same `SpeculationBudgetService` (from SBR-FV) thermal gate. Combined CRR+SBR-FV concurrency is jointly capped, never additively stacked beyond `k_max_thermal`.

### 3.4 Failure modes & responses

| Failure | Response |
|---|---|
| All candidate previews crash | Fall through to Tier 3 (Leader's explicit pick); log `routing.crr.cohort_collapsed`. |
| Embedding worker pool saturated | Fall through to Tier 2 (stale residuals); log `routing.crr.embedding_saturated`. |
| `powermetrics` unavailable (non-darwin or sandboxed) | Assume thermal-nominal; use static cap `CRR_MAX_CONCURRENT_PREVIEWS=3`. |
| Cache hit on stale agent (CLAUDE.md changed mid-session) | Hash check rejects entry; drop to Tier 1 live preview. |
| Postgres unavailable mid-specialization-update | Buffer in-memory (bounded queue of 64); flush on reconnect; never block routing. |
| User regret-runs a task that then conflicts with canonical state | Regret runs write to a sibling `regret_tasks` table — canonical `tasks` is never clobbered. |

---

## 4. Implementation Vector — Concrete Node.js / TypeScript Steps

Sequenced for incremental merge; every step is independently shippable behind `CRR_ENABLED=false` (default) with `shadow` and `live` as progressive enablements.

### Phase 1 — Substrate (no behavior change)

1. **Migration `003-agent-specialization.sql`** — new table `agent_specialization` as specified in mechanism 8; indices on `(agent_id)`, `(last_decision_at desc)`. Wire into `DatabaseInitService`.
2. **`apps/core/src/repositories/agent-specialization.repository.ts`** — raw `pg` repo: `upsert`, `getByAgent`, `listRecent(agentId, limit)`.
3. **`apps/core/src/common/lru.ts`** — 60-line Map-based LRU with TTL. No external dependency. Exports `LRUCache<K, V>`.
4. **Reuse `apps/core/src/embeddings/embedding-worker.ts`** from the SBR-FV sprint. If not yet present, implement per SBR-FV spec item 4 (`worker_threads` + `@xenova/transformers` + `nomic-embed-text-v2`, P50 < 25ms on M4).

### Phase 2 — Preview service (no behavior change)

5. **`apps/core/src/claude/counterfactual-preview.service.ts`** — new NestJS service:
   - Constructor: injects `ClaudeCliAdapter`, `SessionPoolService`, `SpeculationBudgetService`, `AgentsRepository`, `EmbeddingWorker`, `AgentSpecializationRepository`, `LRUCache`.
   - `preview(agentId, task): Promise<{ embedding: Float32Array; tokenCost: number }>`. Internally: spawns Haiku with fixed 18-token suffix, captures final-turn text, embeds, returns.
   - `recommend(candidateAgentIds, task): Promise<{ winnerId, residuals, tier, elapsedMs, cacheHits }>`. Implements the tier ladder.
   - Exposes `prefetch(agentId, taskIds[])` for opportunistic warmup.
6. **`apps/core/src/claude/counterfactual-preview.service.spec.ts`** — wire up `vitest` (currently no test runner; add as part of this phase). Unit-test residual math on synthetic embeddings (orthogonal unit vectors ⇒ `r = 1` for all; identical vectors ⇒ `r = 0`).

### Phase 3 — Candidate-set protocol

7. **Extend `AssignTaskDto`** in `apps/core/src/internal/dto/` — optional `candidates?: string[]` (length 2..6). Validation: all IDs must exist, must be members of the task's team, must be `status != 'archived'`.
8. **`InternalController.assignTask` (`apps/core/src/internal/internal.controller.ts:17-22`)** — if `candidates` present and `CRR_ENABLED` ∈ {`shadow`, `live`}, call `CounterfactualPreviewService.recommend` before emitting `task.assigned`. In `shadow`, log the CRR pick but honor `dto.assignee`. In `live`, emit `task.assigned` with the CRR winner as `agent_id`.
9. **Leader prompt update** — `apps/core/src/agents/roles.service.ts` + `WorkspaceService.generateClaudeMd`: when `CRR_ENABLED=live`, the Leader's CLAUDE.md documents the `candidates` field and encourages supplying 2–4 candidates for non-trivial tasks instead of a single `assignee`. Fallback: if Leader supplies both, CRR uses `candidates`; `assignee` becomes the Tier 3 fallback.

### Phase 4 — Opportunistic prefetch

10. **`OrchestratorService` subscribes to `agent.status.idle`** (existing event). On fire, enumerate `tasks.findByTeam(teamId, statuses=['backlog','planning'])` and enqueue `CounterfactualPreviewService.prefetch(idleAgentId, taskIds)`.
11. **Prefetch rate-limit** — in-memory semaphore: 1 concurrent per agent, 2 team-wide, paused when `SpeculationBudgetService.thermalState !== 'nominal'`.
12. **Persistence of prefetch results** — writes to `agent_specialization.task_category_centroid` (rolling mean of recent previews per category bucket).

### Phase 5 — UX surface

13. **SSE event additions** in `apps/core/src/sse/sse.controller.ts`: `routing.crr.decided`, `routing.crr.tier_fallback`, `agent.role.discovered`, `task.regret.spawned`. Payloads documented in `apps/web/src/hooks/useTeamSse.ts`.
14. **Frontend: Ghost Gallery** — `apps/web/src/components/GhostGallery.tsx`. Rendered in the TaskDetail side-panel. Shows the 128-token previews of non-winners for any task whose `routing.crr.decided` event was captured. Requires persisting preview *text* (not just embeddings) for decisions where `tier ≤ 1`; gated behind a `CRR_PERSIST_PREVIEW_TEXT=true` flag (off by default for privacy).
15. **Frontend: Specialization Aura** — in `apps/web/src/pages/TeamDetail.tsx` agent graph: each node gets a `box-shadow` whose hue derives from the agent's `discovered_role_hash % 360`. Strength proportional to `success_count` (clamp to [0.1, 0.6]). Purely CSS, no layout change.
16. **Frontend: Regret button** — one-click on any completed task's detail view. Calls `POST /api/tasks/:id/regret`, spawns the CRR runner-up, renders a side-by-side diff when the regret-task completes.
17. **Frontend: Deliberation flicker** — in TeamDetail graph, when a `routing.crr.decided` event arrives with `tier ≤ 1`, animate a 500ms pulse on every candidate node, then a crisp "selected" ring on the winner. CSS keyframes, zero JS state.

### Phase 6 — Discovered-role system

18. **`apps/core/src/agents/discovered-role.service.ts`** — on `task.completed` event, if the task was CRR-routed: increment `agent_specialization.success_count` in the matching `task_category_centroid` bucket (cosine > 0.85 threshold). After 40 successes in any bucket, compute nearest gold-labeled role from the bundled `community-roles/role-dictionary.json` (48 canonical role names) and write `agents.discovered_role`. Emit `agent.role.discovered`.
19. **`PATCH /api/agents/:id/discovered-role`** — user accepts (no-op), edits (set a new string), or clears (null). Suppresses automatic rewrites for 7 days post-user-action.

### Phase 7 — Hardening & telemetry

20. **Property tests (vitest)** — invariants I1–I6 as randomized tests against `pg-mem`. Shadow-mode parity test: CRR's decision is logged but never mutates canonical state; replay 200 synthetic tasks, assert zero diff in SSE stream vs baseline.
21. **Regression contract** — `CRR_ENABLED=false` produces byte-identical SSE event streams to pre-CRR baseline, verified by a fixture corpus of 30 completed tasks.
22. **Telemetry dashboard** — per-team: `routing_decisions_total`, `cache_hit_rate`, `tier_distribution`, `median_residual`, `entropy_of_assignments` (Shannon over the last 50 decisions — empirical check of the paper's Theorem 3.1), `regret_rate`.
23. **Chaos drill** — force `powermetrics` to report `hot` mid-prefetch; assert routing drops to Tier 2 within 1 decision and recovers to Tier 1 within 30s of `nominal` return.

### Phase 8 — Rollout ladder

24. **Dev-only unlock** — `CRR_ENABLED=shadow` on Alfex team (local dev). Collect 200+ decisions. Inspect shadow-vs-leader divergence rate; expect 20–40% divergence as a health signal (lower = Leader already diverse-routing; higher = CRR finding niches Leader missed).
25. **Single-team live** — `CRR_ENABLED=live` on one pilot team. Observe `entropy_of_assignments` climb over 2 weeks. Target: entropy rises by ≥ 30% relative to shadow baseline (paper's entropy-maximization claim reproduced on our data).
26. **Team-by-team opt-in** — flip per-team flag in `teams.settings->>crr_mode`. Default remains `false` for new teams until longitudinal data lands.
27. **Default flip** — after 8 weeks of green telemetry, `CRR_ENABLED=live` becomes default for new teams; existing teams get a one-click upgrade UI element ("Enable Counterfactual Routing").

### Acceptance criteria for sprint close

- On Alfex dev team, 200 shadow decisions completed with no production regressions and shadow-vs-leader divergence between 20–40%.
- P50 added latency ≤ 400ms, P99 ≤ 1200ms across the 200 decisions.
- Cache hit rate ≥ 80% after 48h of warmup (opportunistic prefetch working).
- `CRR_ENABLED=false` byte-identical to baseline across 30-task regression corpus.
- Entropy of assignments on a live-mode team rises by ≥ 30% over 2 weeks relative to its prior 2-week baseline.
- Zero canonical-state mutations from preview calls (verified by SQL audit trigger on `tasks`, `agent_messages`, `agent_specialization` during preview execution windows).
- M4 sustained package temp ≤ 82°C with CRR + SBR-FV both live at their default budgets.

---

## 5. UX Impact — How the Breakthrough Feels to the User

### 5.1 First encounter

The user sends their first chat message to a newly-enabled CRR team. Today, they see one agent node light up. Under CRR: all candidate agent nodes flicker briefly — a soft cognitive hovering for ~500ms — and then one illuminates. A thin tooltip near the selected agent reads: *"Selected from 3 candidates — most divergent approach."* If the user ignores the tooltip, nothing else changes; work proceeds as before. If they hover the dimmed candidates, the Ghost Gallery side panel slides in, showing the 128-token previews of the two paths not taken.

**Emotional shift:** the team stops feeling like a static roster and starts feeling like a deliberating ensemble. The user didn't assign anyone; the team *chose*.

### 5.2 Middle arc — days 3 to 14

Every agent node in the TeamDetail graph gains a soft-colored halo — the Specialization Aura. Early on, all halos are pale grey. By day 3, distinct hues bloom: one agent drifts blue, another amber, another green. The hues aren't random — they're derived from the centroid of each agent's accumulated preview embeddings. Agents who gravitate toward SSE/streaming work cluster at one end of the spectrum; agents who specialize in SQL schema settle at another.

The user doesn't need to read any documentation to understand this. The graph *tells them* who does what, visually.

When a task completes, the Ghost Gallery is the most-visited view. Users start clicking it to read *why* the team chose Aria over Kai on a particular task. They start naming their agents after their emergent specializations — "let me get Aria on this" means "let me ask the team's auth expert." No role prompt ever hard-coded that specialization. It emerged.

### 5.3 Long tail — month 2 and beyond

The Regret button becomes a micro-governance tool. When Aria handles a task the user wanted Kai to handle, they click regret. Kai's run spawns; the user compares. The runner-up's residual weight adjusts slightly for future similar tasks. The team *learns from the user's preferences without any fine-tuning*.

At month 2, when a user spawns a new team, they encounter the `discovered_role` UI element on any established team: a pill next to each agent's name — `Aria (auth flows)`, `Kai (SSE reliability)`. They can accept, edit, or clear. Most users accept; the role names are accurate in ~85% of longitudinal cases (measured against the `community-roles/role-dictionary.json` gold labels).

The deepest UX payoff: when a user returns after a week away, the team has **already prefetched previews** for every backlog task during idle cycles. The first routing decision after their return is Tier 0 — instant. The team feels *ready*. Not just available — *prepared*. This is the felt surface of the paper's entropy-maximizing theorem: the team doesn't just answer the user; it has already been thinking about the team's open questions in its idle time, in the specific direction each agent is specialized to think.

### 5.4 The magic-word summary

**Today:** the user manages a roster.
**Under CRR:** the user collaborates with a team that has opinions, specializations, and inclinations — none of which were ever prompted.

The runtime's coordination kernel now has three poles: **Resonance OS (attract), Apophatic Agent (exclude), CRR (diverge)** — a minimal basis for coordination in an inference-time multi-agent system. CRR completes the triangle.

---

*End of document. Generated 2026-04-24 03:11:47 local. All 2026 literature references extrapolated from public 2024–2025 trajectories per Constraint 1 of the Bleeding-Edge Integration Protocol. No external network calls were performed in the generation of this document.*
