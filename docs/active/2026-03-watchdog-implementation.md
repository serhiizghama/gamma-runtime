# Gamma Watchdog — Implementation Plan
**Service:** `gamma-watchdog`
**Status:** IN PROGRESS — Steps 1-4 implemented (bootstrap, redis listener, healing loop, rollback). Steps 5-7 pending.
**Last audit:** 2026-03-15
**Execution model:** Loop-by-loop, task-by-task. Verify each task before proceeding to the next.

---

## Overview

`gamma-watchdog` is a completely isolated, out-of-band Node.js daemon that monitors the health of all platform services (`gamma-core`, `gamma-ui`, `gamma-proxy`). It is the last line of defense against AI-generated faulty code — catching crashes, rolling back corruption, and forcing the offending agent to self-correct.

**The Healing Loop:**
```
DETECT → FREEZE → ROLLBACK → RESTART → FEEDBACK
```

---

## Architecture & Boundaries

### Process Isolation
- `gamma-watchdog` runs as a **completely separate Node.js process** (or Docker container), never as a module inside `gamma-core` or `gamma-ui`.
- It is the **process supervisor** for all other services. It spawns `gamma-core` and `gamma-proxy` as child processes, giving it direct access to their `stdout`/`stderr` and exit codes.
- `gamma-ui` (Vite) is spawned similarly; a thin error-parsing plugin inside Vite forwards HMR/build errors to Redis.

### Permission Model
| Actor | Access to `gamma-watchdog/src` |
|---|---|
| `gamma-watchdog` | Read/Write (self) |
| Agent VFS | **None** (directory hidden or mounted read-only) |
| `gamma-core` | None |

This ensures that a runaway agent cannot modify or disable the watchdog — the healer is always available.

### File Layout
```
apps/watchdog/               ← monorepo location (peer to apps/core, apps/ui)
├── src/
│   ├── main.ts                  ← Entry point, bootstraps all monitors
│   ├── process-manager.ts       ← Spawns & supervises child processes
│   ├── redis-listener.ts        ← Subscribes to gamma:memory:bus stream
│   ├── healing-loop.ts          ← Orchestrates the 5-step healing sequence
│   ├── rollback.ts              ← .bak file rollback strategy
│   ├── agent-feedback.ts        ← Publishes structured feedback to Redis
│   └── types.ts                 ← Shared TypeScript interfaces (incl. CrashReport)
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Data Contracts

### `CrashReport` Event (published to `gamma:memory:bus`)

All platform services must publish this exact shape when they detect an error. Watchdog subscribes and acts on it.

```typescript
// gamma-watchdog/src/types.ts

export type ServiceName = 'gamma-core' | 'gamma-ui' | 'gamma-proxy';

export type CrashType =
  | 'HARD_CRASH'   // Process exited with non-zero code
  | 'SOFT_CRASH'   // Logical error caught at runtime (HMR, unhandled rejection)
  | 'BUILD_ERROR'; // Vite/tsc compilation failure

export interface CrashReport {
  /** Discriminant for the Redis stream consumer */
  type: 'CRASH_REPORT';

  /** Which service crashed */
  service: ServiceName;

  /** Nature of the crash */
  crashType: CrashType;

  /** ISO-8601 timestamp */
  timestamp: string;

  /** The agent session ID responsible for the last file change, if known */
  agentSessionId: string | null;

  /** Absolute path of the file last modified before the crash, if known */
  affectedFile: string | null;

  /** Raw error text: stderr tail, HMR error message, or stack trace */
  errorLog: string;

  /** Process exit code for HARD_CRASH; null otherwise */
  exitCode: number | null;
}

export interface AgentFeedback {
  type: 'WATCHDOG_FEEDBACK';
  targetAgentSessionId: string;
  timestamp: string;
  affectedFile: string | null;
  errorLog: string;
  /** Human-readable instruction injected as a system message for the agent */
  instruction: string;
}

export interface SessionAbort {
  type: 'SESSION_ABORT';
  targetAgentSessionId: string;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** Human-readable reason logged by the gateway before terminating the SSE connection */
  reason: string;
}

export interface SessionUnfreeze {
  type: 'SESSION_UNFREEZE';
  targetAgentSessionId: string;
  timestamp: string;
}
```

### Redis Keys & Channels
| Key / Stream | Direction | Purpose |
|---|---|---|
| `gamma:memory:bus` | SUBSCRIBE | Watchdog reads `CRASH_REPORT` events from all services |
| `gamma:watchdog:commands` | PUBLISH | Watchdog sends `SESSION_ABORT` / `SESSION_UNFREEZE` to `gamma-core` Gateway |
| `gamma:agent:{sessionId}:inbox` | PUBLISH | Watchdog sends `WATCHDOG_FEEDBACK` directly to agent session |

---

## Step-by-Step Milestones

### Step 1 — Bootstrap the Isolated Service

**Goal:** A standalone Node.js process starts, reads config, and logs a heartbeat.

**Tasks:**
1. Scaffold the service at `apps/watchdog/` in the monorepo (peer to `apps/core/`, `apps/ui/`). Register it in `pnpm-workspace.yaml` as `apps/*`.
2. Initialize `package.json` with TypeScript, `tsx` for dev, `tsup` for build.
3. Create `.env.example`:
   ```
   REDIS_URL=redis://localhost:6379
   GAMMA_CORE_CMD=pnpm --filter gamma-core start:dev
   GAMMA_PROXY_CMD=pnpm --filter gamma-proxy start
   GAMMA_UI_CMD=pnpm --filter gamma-ui dev
   ```
4. `main.ts`: load env, establish Redis connection, log `[watchdog] online`.

**Acceptance criteria:**
- `node dist/main.js` starts without errors.
- Redis connection confirmed in logs.
- No other services are required to be running.

---

### Step 2 — Process Manager (Hard Crash Detection) + Freeze Mechanism

**Goal:** Watchdog spawns `gamma-core` and `gamma-proxy` as supervised children, detects fatal exits, and can instantly quarantine the offending agent session.

**Tasks:**
1. Implement `process-manager.ts`:
   - Use `child_process.spawn()` to start each service defined in env.
   - Pipe `stdout` and `stderr` to watchdog's own logger (prefix with `[gamma-core]`).
   - On `close` event with non-zero `code`: construct a `CrashReport` with `crashType: 'HARD_CRASH'` and forward to `healing-loop.ts`.
2. Keep a registry: `Map<ServiceName, ChildProcess>` so the healer knows which handle to restart.
3. Implement graceful shutdown: on `SIGINT`/`SIGTERM`, kill all children before exiting.
4. **Implement the Freeze step** inside `healing-loop.ts`. Immediately upon receiving a `CrashReport` with a non-null `agentSessionId`, before any rollback or restart:
   - Publish a `SESSION_ABORT` event to the `gamma:watchdog:commands` Redis channel:
     ```typescript
     const abort: SessionAbort = {
       type: 'SESSION_ABORT',
       targetAgentSessionId: report.agentSessionId,
       timestamp: new Date().toISOString(),
       reason: `Watchdog: ${report.crashType} in ${report.service} — quarantining agent`,
     };
     await redis.publish('gamma:watchdog:commands', JSON.stringify(abort));
     ```
   - **Gateway contract (`gamma-core`):** The gateway must subscribe to `gamma:watchdog:commands` and, upon receiving `SESSION_ABORT`, immediately:
     1. Close the active SSE connection for that `sessionId` (forcing the OpenClaw stream to terminate).
     2. Set a `FROZEN` flag on the session record (in-memory or Redis key `gamma:session:{id}:state`).
     3. Reject any further tool-execution requests for that session until a `SESSION_UNFREEZE` event is received.
   - This ensures the agent cannot issue additional `fs_write` calls while rollback and restart are in progress.

**Acceptance criteria:**
- Watchdog starts `gamma-core`; its logs appear prefixed.
- Manually kill `gamma-core` (`kill -9 <pid>`): watchdog logs `[watchdog] HARD_CRASH detected: gamma-core (exit 137)` within 1 second.
- A `SESSION_ABORT` message appears on `gamma:watchdog:commands` within 100 ms of crash detection.
- `gamma-core` logs confirm the SSE connection for the frozen session was closed.

---

### Step 3 — Redis Listener (Soft Crash & Build Error Detection)

**Goal:** Watchdog subscribes to `gamma:memory:bus` and processes `CRASH_REPORT` events from services that can't be supervised as direct children (e.g., Vite in a browser tab).

**Tasks:**
1. Implement `redis-listener.ts`:
   - Use `ioredis` to create a dedicated subscriber client.
   - Subscribe to `gamma:memory:bus` stream (`XREAD` with `BLOCK` or Pub/Sub depending on existing bus implementation).
   - Parse incoming messages; filter for `type === 'CRASH_REPORT'`.
   - Forward valid `CrashReport` objects to `healing-loop.ts`.
2. Add a **Vite HMR error bridge** inside `gamma-ui`:
   - A small Vite plugin (`vite-plugin-watchdog-bridge.ts`) that catches `error` events from Vite's dev server and publishes a `CrashReport` with `crashType: 'SOFT_CRASH'` to Redis.
   - This plugin must be loaded via `vite.config.ts` in `gamma-ui`.

**Acceptance criteria:**
- Introduce a deliberate syntax error in a React component in `gamma-ui`.
- Within 3 seconds, watchdog logs `[watchdog] SOFT_CRASH detected: gamma-ui`.

---

### Step 4 — Rollback Mechanism

**Goal:** Atomically revert the corrupted file to its last known-good state using `.bak` files.

**Architectural decision:** Git is for human commits, not for micro-edits by agents. Git rollback is too coarse — it reverts to the last human-authored commit, potentially discarding other valid agent changes. The `.bak` strategy is instantaneous, scoped to exactly one file write, and works in any environment.

**The `.bak` contract (enforced in `gamma-core`):**
> Before `gamma-core` executes any agent `fs_write` syscall, it **must synchronously** create a `.bak` copy of the target file if it exists:
> ```typescript
> await fs.copyFile(targetPath, `${targetPath}.bak`);
> await fs.writeFile(targetPath, agentContent);
> ```
> This is a non-negotiable pre-condition. An `fs_write` without a preceding `.bak` creation is a gateway violation.

**Tasks:**
1. Implement `rollback.ts`:
   - Accept `affectedFile: string`.
   - Verify `${affectedFile}.bak` exists; if not, log CRITICAL (gateway contract was violated) and skip to Restart.
   - Atomically replace the corrupted file:
     ```typescript
     await fs.copyFile(`${affectedFile}.bak`, affectedFile);
     await fs.unlink(`${affectedFile}.bak`); // clean up after successful restore
     ```
   - If `affectedFile` is null (crash with no file attribution), skip rollback and go straight to Restart.
2. Wrap in a try/catch; on any failure log CRITICAL and proceed to Restart — partial healing is always better than a stuck loop.

**Acceptance criteria:**
- A `.bak` file exists for `kernel/src/users/users.service.ts` after an agent write.
- Watchdog receives a `CrashReport` pointing to that file; rollback completes in < 50 ms.
- The `.bak` file is removed after successful restore.
- Service restarts and returns to a healthy state.

---

### Step 5 — Service Restart

**Goal:** After rollback, bring the crashed service back online.

**Tasks:**
1. In `healing-loop.ts`, after successful rollback, call `processManager.restart(service)`:
   - Kill the existing child process handle if still alive.
   - Spawn a fresh child process using the same command from the registry.
   - Wait for a "ready" signal (e.g., `stdout` contains `"Application is running"` or a health check `GET /health` returns 200).
2. Implement a **restart backoff**: if the same service crashes 3 times within 60 seconds, do NOT restart — instead escalate (log CRITICAL, send an alert to a dedicated `gamma:watchdog:alerts` Redis channel).

**Acceptance criteria:**
- After a hard crash, `gamma-core` is back online within 5 seconds.
- After 3 rapid crashes, watchdog enters "circuit breaker" mode and stops retrying.

---

### Step 6 — Agent Feedback Loop

**Goal:** The offending agent receives a structured error report and a mandatory instruction to fix its own code.

**Tasks:**
1. Implement `agent-feedback.ts`:
   - If `agentSessionId` is present on the `CrashReport`, publish an `AgentFeedback` event to `gamma:agent:{sessionId}:inbox`.
   - The `instruction` field must follow this template:
     ```
     [WATCHDOG INTERVENTION]
     Your last patch to `{affectedFile}` caused a {crashType} in {service}.

     Error log:
     {errorLog}

     Your changes have been rolled back automatically. The service is back online.
     Analyze the error above, identify the root cause, and provide a corrected
     version of the affected code. Do NOT repeat the same mistake.
     ```
2. `gamma-core`'s agent session manager must subscribe to `gamma:agent:{sessionId}:inbox` and inject the message as a high-priority system prompt at the start of the agent's next generation cycle.

**Acceptance criteria:**
- After a crash attributed to agent session `abc-123`, the message appears in `gamma-core` logs as `[agent:abc-123] WATCHDOG_FEEDBACK received`.
- The agent's next completion request contains the watchdog error context as a system message.

---

### Step 7 — Observability & Hardening

**Goal:** Make the watchdog production-ready with structured logging, metrics, and security hardening.

**Tasks:**
1. **Structured logging:** Replace `console.log` with `pino` — emit JSON logs with `level`, `service`, `timestamp`, `agentSessionId` fields.
2. **Health endpoint:** Expose a minimal HTTP endpoint `GET /health` on a separate port (e.g., 9000) that returns watchdog status and the state of all supervised children.
3. **VFS enforcement:** Document (and implement if OpenClaw Gateway supports it) that the `gamma-watchdog/` directory is excluded from the agent's virtual file system mount.
4. **Process isolation test:** Write a test that verifies an agent cannot publish a `type: 'CRASH_REPORT'` event that points to watchdog's own source files as the `affectedFile` (watchdog must ignore self-targeted reports).
5. **pnpm workspace integration:** Add `gamma-watchdog` to `pnpm-workspace.yaml` and add a root-level `start:watchdog` script.

**Acceptance criteria:**
- `GET localhost:9000/health` returns `{ status: 'ok', services: { 'gamma-core': 'running', 'gamma-proxy': 'running' } }`.
- All watchdog logs are valid JSON parseable by a log aggregator.

---

## Dependency Summary

| Dependency | Purpose |
|---|---|
| `ioredis` | Redis Pub/Sub and Stream consumption |
| `pino` | Structured JSON logging |
| `tsx` | TypeScript execution in development |
| `tsup` | Build for production |

---

## Integration Touchpoints in Existing Services

| Service | Change Required |
|---|---|
| `gamma-ui` | Add `vite-plugin-watchdog-bridge.ts`; publish `CRASH_REPORT` on HMR errors |
| `gamma-core` | (1) Synchronously create `.bak` before every agent `fs_write` syscall. (2) Subscribe to `gamma:watchdog:commands`; on `SESSION_ABORT` close the SSE connection and set `FROZEN` state; on `SESSION_UNFREEZE` resume. (3) Subscribe to `gamma:agent:{id}:inbox`; inject watchdog feedback as system message. |
| `gamma-proxy` (OpenClaw) | Forward `SESSION_ABORT` signal from `gamma-core` to terminate active LLM stream for the frozen session. |

---

## Rollout Order

```
Step 1 (Bootstrap) → Step 2 (Hard Crash) → Step 3 (Soft Crash + Vite Bridge)
→ Step 4 (Rollback) → Step 5 (Restart) → Step 6 (Feedback) → Step 7 (Hardening)
```

Each step is independently testable. Steps 1–3 establish detection. Steps 4–6 are the healing core. Step 7 makes it production-grade.
