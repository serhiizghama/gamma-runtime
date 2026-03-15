# Gamma Runtime — Remaining Backlog
**Status:** ACTIVE
**Last audit:** 2026-03-15
**Source:** Extracted from archived Phase 3, Stage 4, and Watchdog plans.

---

## ~~1. App Owner Tool Scoping (from Phase 3, Task 9.4)~~ [DONE — HARDENED]

Implemented in `gateway-ws.service.ts`: role-based `allowedTools` arrays passed on `sessions.create`. App Owners restricted to `shell_exec`, `fs_read`, `fs_write`, `fs_list`, `update_app`, `read_context`, `list_assets`, `add_asset`. System Architect gets full toolset.

**Hardening (§9.5):** Backend path validation now enforced via `ToolJailGuardService`. All filesystem tool calls (`fs_read`, `fs_write`, `fs_list`) are validated against the app's jail directory before execution. `shell_exec` commands are scanned for escape patterns (traversal, absolute paths, command substitution, pipe-to-shell). System Architect is exempt. Violations are blocked, logged as critical events, and rejected back to the Gateway. `AppStorageService.validateJailPath(appId, targetPath)` provides reusable per-app jail validation.

---

## ~~2. OpenClaw System Prompt Ingestion (from Backlog)~~ [DONE]

Fixed via dual-path injection: system prompt is now passed both on `sessions.create` (for Gateways that support it) AND as a `system` field on every `chat.send` call. This ensures the agent always receives its persona/context regardless of Gateway version. TODO markers removed from `sessions.service.ts` and `WindowNode.tsx`. System Architect session now also persists its persona prompt for dual-path injection.

---

## ~~3. Watchdog — Process Manager & Agent Feedback (from Watchdog Steps 5-6)~~ [DONE]

**Process Manager** (`process-manager.ts`): Spawns supervised children with `detached: true` for process-group kill. Tracks PIDs, detects fatal exits, restarts with exponential backoff (1s–15s). Circuit breaker trips after 3 crashes in 60s. `killService()` sends `SIGTERM` to entire process group (`-pid`), preventing zombies during SESSION_ABORT.

**Agent Feedback** (`healing-loop.ts → sendAgentFeedback`): After rollback, publishes `WATCHDOG_FEEDBACK` to `gamma:watchdog:feedback` Pub/Sub with structured post-mortem: reason code (`TOOL_TIMEOUT`, `BUILD_FAILURE`, `RUNTIME_CRASH`, `HARD_CRASH`), error log excerpt, and remediation instruction. `SystemEventLog` now accepts and stores `meta` field from watchdog events.

---

## ~~4. Watchdog — Observability Hardening (from Watchdog Step 7)~~ [DONE]

**Heartbeat** (`heartbeat.ts`): Writes `gamma:watchdog:heartbeat` every 10s with 60s TTL auto-expire. Cleans up key on graceful shutdown.

**Health integration** (`system-health.service.ts`): Checks heartbeat key freshness. If stale (>30s), sets `status: 'degraded'` with `statusNote: 'WARNING: Watchdog Offline'` and `watchdog: { online: false }` in `SystemHealthReport`.

**Remaining (deferred to post-MVP):**
- HTTP health endpoint (`GET :9000/health`) — not critical while heartbeat-via-Redis covers liveness.
- VFS exclusion for `gamma-watchdog/` — already covered by jail guard (watchdog is outside `apps/gamma-ui/apps/private/`).
- Self-protection test — watchdog only processes `CRASH_REPORT` for `gamma-core`/`gamma-ui`/`gamma-proxy` services; its own files are outside those service paths.

---

## 5. Integration Smoke Test (from Phase 3 Verification Checklist)

**Priority:** P1
**Area:** End-to-end

Pending verification:
- [ ] Create app via Architect → modify via App Owner → data persists → delete → all resources cleaned
- [ ] jailPath enforced on all reads/writes, no path traversal, no cross-app data access
- [ ] Watchdog heartbeat visible in SystemHealthReport
- [ ] Agent feedback delivered after rollback event
