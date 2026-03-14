# Mini-RFC: Pre-flight Directory Snapshots

**Status:** Draft
**Date:** 2026-03-14
**Author:** System Architect

---

## Problem

The current `.bak` mechanism is **per-file**: each `writeFile()` backs up only the single file about to be overwritten. If an agent run touches multiple files (component + context + prompt), or creates new files (no `.bak` for new files), the rollback is incomplete. We need an **atomic, directory-level snapshot** taken once before the agent starts processing.

---

## 1. Snapshot Logic — `snapshotApp()` in `AppStorageService`

**File:** `apps/gamma-core/src/scaffold/app-storage.service.ts`

Add a new method:

```typescript
async snapshotApp(appId: string): Promise<string> {
  const appDir = this.jailPath(appId);          // e.g. .../apps/private/weather
  const bakDir = `${appDir}.bak_session`;

  // Remove stale snapshot if one exists
  await fs.rm(bakDir, { recursive: true, force: true });

  // Atomic recursive copy (Node 16.7+)
  await fs.cp(appDir, bakDir, { recursive: true });

  this.logger.log(`[SNAPSHOT] ${appId} → ${bakDir}`);
  return bakDir;
}
```

**Design notes:**

- Uses `fs.promises.cp()` (recursive, available since Node 16.7).
- Naming convention `.bak_session` distinguishes from per-file `.bak` files.
- `jailPath()` already validates the appId, so traversal is blocked.
- The existing per-file `.bak` mechanism in `writeFile()` can remain as defense-in-depth — no changes needed there.

---

## 2. Trigger Point — Inject Before OpenClaw Processing

**File:** `apps/gamma-core/src/gateway/gateway-ws.service.ts`

**Method:** `sendMessage()` (lines ~1037-1082)

This is the exact entry point where the user's chat message is dispatched to OpenClaw. The injection should happen **after** session key resolution but **before** the `chat.send` RPC is fired:

```
sendMessage(sessionKey, message, windowId)
  │
  ├─ resolve session type (app-owner-{appId}?)
  ├─ ✅ NEW: if session is app-owner-*, call snapshotApp(appId)
  ├─ inject system context (first-run)
  └─ send chat.send RPC to Gateway  ← agent starts here
```

**Injection logic:**

```typescript
// Before the chat.send dispatch:
if (sessionKey.startsWith('app-owner-')) {
  const appId = sessionKey.replace('app-owner-', '');
  await this.appStorageService.snapshotApp(appId);
}
```

**Why here and not in a tool handler?** Because we need the snapshot taken **once** before the entire agent run, not before each individual file write. The `sendMessage()` boundary is the last point where we have control before OpenClaw begins its multi-step tool calling sequence.

**Dependency:** `AppStorageService` needs to be injected into `GatewayWsService` (or accessed via an intermediary service if circular deps are a concern).

---

## 3. Watchdog Rollback — Directory-Level Restore

**File:** `apps/gamma-watchdog/src/healing-loop.ts`

**Current `rollback()` method** (lines 84-110): looks for `{affectedFile}.bak`, copies it back with `copyFileSync`.

**New approach:** Instead of restoring a single file, restore the entire app directory from `.bak_session`:

```typescript
private rollback(affectedFile: string): void {
  // Derive the app directory from the affected file path
  // affectedFile: .../apps/private/weather/WeatherApp.tsx
  // appDir:       .../apps/private/weather
  const appDir = this.resolveAppDir(affectedFile);
  const bakDir = `${appDir}.bak_session`;

  if (!existsSync(bakDir)) {
    // Fallback: try legacy per-file .bak
    this.rollbackSingleFile(affectedFile);
    return;
  }

  try {
    // 1. Remove corrupted directory
    rmSync(appDir, { recursive: true, force: true });
    // 2. Restore from snapshot
    cpSync(bakDir, appDir, { recursive: true });
    this.logger.warn(`[ROLLBACK] Directory restored: ${appDir} ← ${bakDir}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    this.logger.error(`[ROLLBACK] CRITICAL: directory restore failed — ${msg}`);
  }
}

private resolveAppDir(affectedFile: string): string {
  // Walk up from affected file to the app root (child of apps/private/)
  const privateAppsRoot = path.join(/* ... */, 'apps/gamma-ui/apps/private');
  const relative = path.relative(privateAppsRoot, affectedFile);
  const appId = relative.split(path.sep)[0];
  return path.join(privateAppsRoot, appId);
}
```

**Key changes:**

- `resolveAppDir()` extracts the app directory from any file path within it.
- Falls back to legacy single-file `.bak` if no `.bak_session` exists (backwards compat during rollout).
- Uses `rmSync` + `cpSync` (synchronous, matching the existing sync style in the healing loop).

---

## 4. Cleanup — Snapshot Lifecycle

The `.bak_session` directory should be cleaned up after a successful run. Two options:

| Strategy | Where | Trigger |
|----------|-------|---------|
| **A. On lifecycle end** | `handleAgentEvent()` in `gateway-ws.service.ts` | When `lifecycle.phase === 'end'` and Vite reports no errors |
| **B. On next snapshot** | `snapshotApp()` itself | The `fs.rm(bakDir)` at the top already handles this |

**Recommendation:** Strategy B (self-cleaning on next snapshot) is simpler and already built into the proposed `snapshotApp()`. No additional cleanup code needed. The only cost is ~1 extra copy of an app directory on disk between runs, which is negligible.

---

## 5. Files to Touch

| File | Change |
|------|--------|
| `apps/gamma-core/src/scaffold/app-storage.service.ts` | Add `snapshotApp(appId)` method |
| `apps/gamma-core/src/gateway/gateway-ws.service.ts` | Inject `snapshotApp()` call in `sendMessage()` |
| `apps/gamma-watchdog/src/healing-loop.ts` | Rewrite `rollback()` for directory-level restore, add `resolveAppDir()` |
| `apps/gamma-watchdog/src/types.ts` | No changes expected (`CrashReport` already carries `affectedFile`) |
