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

## 3. Watchdog — Process Manager & Service Restart (from Watchdog Steps 5-6)

**Priority:** P2
**Area:** `apps/gamma-watchdog/`

Not yet implemented:
- **`process-manager.ts`**: Spawn `gamma-core`/`gamma-proxy` as supervised children, detect fatal exits, restart with backoff (3 crashes in 60s → circuit breaker).
- **`agent-feedback.ts`**: After rollback, publish `WATCHDOG_FEEDBACK` to `gamma:agent:{sessionId}:inbox` with structured error context for the offending agent.

**Acceptance criteria:**
- After a hard crash, service is back online within 5 seconds.
- After 3 rapid crashes, watchdog enters circuit breaker mode.
- Offending agent receives feedback with error log and rollback notification.

---

## 4. Watchdog — Observability Hardening (from Watchdog Step 7)

**Priority:** P3
**Area:** `apps/gamma-watchdog/`

Not yet implemented:
- **Health endpoint**: `GET :9000/health` returning watchdog status and supervised children state.
- **VFS enforcement**: Exclude `gamma-watchdog/` from agent virtual filesystem.
- **Self-protection test**: Watchdog ignores `CRASH_REPORT` events targeting its own source files.

---

## 5. Integration Smoke Test (from Phase 3 Verification Checklist)

**Priority:** P1
**Area:** End-to-end

Pending verification:
- [ ] Create app via Architect → modify via App Owner → data persists → delete → all resources cleaned
- [ ] jailPath enforced on all reads/writes, no path traversal, no cross-app data access
