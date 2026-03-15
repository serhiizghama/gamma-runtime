# [DONE] Monorepo Migration & Rebranding Plan

**Status:** COMPLETE
**Completion Date:** 2026-03-15
**Archived from:** `docs/plans/monorepo-migration.md`
**Goal:** Safely migrate the flat `web/` + `kernel/` structure into a proper `apps/` monorepo layout and replace all "Gamma OS" references with "Gamma Agent Runtime" (or just "Gamma").

> **Rule:** Do NOT skip milestones. Each milestone must pass its verification step before proceeding to the next. This prevents broken intermediate states.

---

## Milestone 1 — Workspace Setup

**Goal:** Rename directories and configure the root pnpm workspace without touching any source code.

### 1.1 Create the `apps/` directory

```bash
mkdir -p apps
```

### 1.2 Move service directories

```bash
mv web apps/gamma-ui
mv kernel apps/gamma-core
```

> The `packages/` directory stays at the root — it is already correctly placed as a shared workspace package.

### 1.3 Create `pnpm-workspace.yaml`

Since the project uses pnpm, workspace membership is declared in a dedicated file at the repo root — **not** in the `package.json` `"workspaces"` array (that is an npm/yarn convention).

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

pnpm will now treat every directory under `apps/` and `packages/` as a workspace package, linking them via `node_modules/.pnpm` and `node_modules/@gamma/`.

### 1.4 Update root `package.json`

Replace the contents of the root `package.json`. Remove any `"workspaces"` array (that is handled by `pnpm-workspace.yaml`) and update all script commands to use `pnpm --filter`:

```json
{
  "name": "gamma-runtime",
  "private": true,
  "version": "0.1.0",
  "scripts": {
    "dev": "pnpm --filter @gamma/ui dev",
    "dev:core": "pnpm --filter @gamma/core start:dev",
    "build": "pnpm --filter @gamma/ui build",
    "build:core": "pnpm --filter @gamma/core build",
    "start:core": "pnpm --filter @gamma/core start:prod",
    "typecheck": "pnpm --filter @gamma/ui typecheck && pnpm --filter @gamma/core typecheck"
  }
}
```

**Key changes from the old root `package.json`:**
- `name`: `gamma-os-monorepo` → `gamma-runtime`
- No `"workspaces"` array — pnpm reads `pnpm-workspace.yaml` instead
- All `--prefix web/kernel` flags replaced with `pnpm --filter @gamma/<package>`

### 1.5 Verification

```bash
# Confirm directory structure
ls apps/         # should show: gamma-ui  gamma-core
ls packages/     # should show: gamma-types

# Confirm pnpm-workspace.yaml exists at root
cat pnpm-workspace.yaml
```

---

## Milestone 2 — Dependency & Import Fixes

**Goal:** Update `name` fields in sub-packages, fix path depths in TypeScript and Vite configs, and reinstall dependencies.

### 2.1 Update `apps/gamma-ui/package.json`

Change the `name` field:
```diff
- "name": "gamma-os",
+ "name": "@gamma/ui",
```

### 2.2 Update `apps/gamma-core/package.json`

Change `name` and `description`:
```diff
- "name": "gamma-kernel",
- "description": "Gamma OS Phase 2 — Backend Integration Server",
+ "name": "@gamma/core",
+ "description": "Gamma Agent Runtime — Backend Integration Server",
```

Also update the `start:prod` script which hardcodes the old path:
```diff
- "start:prod": "node dist/kernel/src/main.js",
+ "start:prod": "node dist/main.js",
```

> **Note:** Verify the actual NestJS dist output path after a build (`nest build`) — the path may have changed due to the directory rename. Check `nest-cli.json` for the `sourceRoot` setting and update if it references `kernel/src`.

### 2.3 Update `packages/gamma-types/package.json`

The description still references "Gamma OS":
```diff
- "description": "Shared TypeScript types for Gamma OS frontend and backend",
+ "description": "Shared TypeScript types for Gamma Agent Runtime",
```

The `name` field (`@gamma/types`) is already correct — no change needed.

### 2.4 Update path aliases in `apps/gamma-ui/tsconfig.json` and `vite.config.ts`

**This is the most common cause of broken builds after a directory move.** Both files use relative paths to reference `packages/gamma-types`. Moving `web/` → `apps/gamma-ui/` adds one extra level of depth, so every `../` that crossed the old repo root must become `../../`.

#### `apps/gamma-ui/tsconfig.json`

The current `paths` and `include` entries use `../packages/gamma-types` (one level up from `web/`). After the move they must go two levels up:

```diff
  "compilerOptions": {
    "paths": {
-     "@gamma/types": ["../packages/gamma-types/index.ts"],
+     "@gamma/types": ["../../packages/gamma-types/index.ts"],
      "@gamma/os": ["./hooks/os-api.ts"]
    }
  },
  "include": [
    "src", "components", "store", "types", "styles", "apps", "hooks", "constants",
-   "../packages/gamma-types"
+   "../../packages/gamma-types"
  ]
```

> `@gamma/os` maps to `./hooks/os-api.ts` which is relative within the package — no change needed there.

#### `apps/gamma-ui/vite.config.ts`

The Vite alias for `@gamma/types` uses `__dirname` + a relative path that also crossed the old repo root:

```diff
  resolve: {
    alias: {
-     "@gamma/types": path.resolve(__dirname, "../packages/gamma-types/index.ts"),
+     "@gamma/types": path.resolve(__dirname, "../../packages/gamma-types/index.ts"),
      "@gamma/os": path.resolve(__dirname, "hooks/os-api.ts"),
    },
  },
```

> Both the `tsconfig.json` and `vite.config.ts` must be updated together. TypeScript uses the `paths` for type-checking; Vite uses the alias for bundling. A mismatch causes "types work but runtime import fails" or vice versa.

### 2.5 Update path aliases in `apps/gamma-core/tsconfig.json`

The NestJS backend has the same depth change. Its `paths` and `include` must be updated:

```diff
  "compilerOptions": {
    "paths": {
-     "@gamma/types": ["../packages/gamma-types"]
+     "@gamma/types": ["../../packages/gamma-types"]
    }
  },
  "include": [
-   "src/**/*", "../packages/gamma-types/**/*"
+   "src/**/*", "../../packages/gamma-types/**/*"
  ],
```

### 2.6 Reinstall dependencies from root

Delete any nested lock files to avoid conflicts, then reinstall from the root:

```bash
# From repo root
rm -f apps/gamma-ui/package-lock.json apps/gamma-core/package-lock.json
pnpm install
```

pnpm will generate a single root `node_modules/` with workspace symlinks for `@gamma/ui`, `@gamma/core`, and `@gamma/types`.

### 2.7 Check NestJS build configuration

Open `apps/gamma-core/nest-cli.json` and verify `sourceRoot` still points correctly:

```json
{
  "sourceRoot": "src"
}
```

If it previously referenced `kernel/src`, correct it to just `src`.

### 2.8 Verification

```bash
# Confirm workspace packages are linked by pnpm
ls node_modules/@gamma/    # should show: ui  core  types

# TypeScript should resolve cleanly in both packages
cd apps/gamma-core && pnpm typecheck
cd ../gamma-ui && pnpm typecheck
```

---

## Milestone 3 — Codebase Rebranding

**Goal:** Replace all user-facing and internal "Gamma OS" strings. Split into UI, backend, and docs sub-steps to make review easier.

### 3.1 UI Components

The following files contain "Gamma OS" or "gamma-os" strings:

| File | Type of reference |
|------|------------------|
| `apps/gamma-ui/components/GammaOS.tsx` | Component name + strings |
| `apps/gamma-ui/components/Desktop.tsx` | Likely display string |
| `apps/gamma-ui/components/BootScreen.tsx` | Boot screen label |
| `apps/gamma-ui/components/MenuBar.tsx` | Menu bar title |
| `apps/gamma-ui/components/Portal.tsx` | Likely window title |
| `apps/gamma-ui/components/WindowNode.tsx` | Likely title string |
| `apps/gamma-ui/apps/system/terminal/TerminalApp.tsx` | Terminal prompt or title |
| `apps/gamma-ui/apps/system/browser/BrowserApp.tsx` | Browser title |
| `apps/gamma-ui/store/useOSStore.ts` | Store name / log messages |

**For each file**, search and replace:
- `"Gamma OS"` → `"Gamma"` for short display labels (menu bar, window titles)
- `"Gamma OS"` → `"Gamma Agent Runtime"` for descriptive/about text

**Rename the root component file:**
```bash
mv apps/gamma-ui/components/GammaOS.tsx apps/gamma-ui/components/Gamma.tsx
```

Find and update all import sites:
```bash
grep -r "GammaOS" apps/gamma-ui --include="*.tsx" --include="*.ts" -l
```

Update the import path and component name in each file found.

### 3.2 Backend (`gamma-core`)

Files with "Gamma OS" log/label strings:

| File | Reference |
|------|-----------|
| `apps/gamma-core/src/redis/redis.module.ts` | Connection log or module name |
| `apps/gamma-core/src/sessions/sessions.service.ts` | Session log message |
| `apps/gamma-core/src/gateway/gateway-ws.service.ts` | WebSocket log message |

Replace `"Gamma OS"` with `"Gamma"` in all `Logger` / `console` output strings.

Also update `kernel/.env.example` (now `apps/gamma-core/.env.example`):

```diff
- GAMMA_DEVICE_ID=gamma-os-bridge-001
+ GAMMA_DEVICE_ID=gamma-runtime-bridge-001

- # ── Gamma OS Repo ────────────────────────────────────────
- GAMMA_OS_REPO=/path/to/gamma-os
+ # ── Gamma Runtime Repo ───────────────────────────────────
+ GAMMA_RUNTIME_REPO=/path/to/gamma-runtime
```

### 3.3 Documentation

```bash
# Find all docs containing "Gamma OS"
grep -r "Gamma OS" docs/ README.md --include="*.md" -l
```

Update each file:
- `Gamma OS` → `Gamma Agent Runtime` in conceptual/descriptive prose
- `Gamma OS` → `Gamma` in short-form references

### 3.4 Verification

```bash
# No "Gamma OS" strings remaining in source code
grep -r "Gamma OS" apps/ packages/ --include="*.ts" --include="*.tsx"
# Expected: zero results

# No "gamma-os" package name references remaining
grep -r "gamma-os" apps/ packages/ --include="*.json" --include="*.ts"
# Expected: zero results
```

---

## Milestone 4 — Build & Verification

**Goal:** Confirm both services start, the WebSocket connection works, and Vite HMR is not broken.

### 4.1 Build `gamma-core` (NestJS)

```bash
pnpm --filter @gamma/core build
# Confirm dist/main.js exists
ls apps/gamma-core/dist/main.js
```

If `dist/main.js` is not found, check `nest-cli.json` and `tsconfig.build.json` for output path configuration.

### 4.2 Start `gamma-core` in dev mode

```bash
# From repo root
pnpm dev:core
```

Expected: NestJS bootstrap logs, Redis connection confirmed, WebSocket server listening.

### 4.3 Start `gamma-ui` in dev mode

In a second terminal:

```bash
# From repo root
pnpm dev
```

Expected: Vite dev server starts on `http://localhost:5173`. Confirm HMR is active — Vite prints "ready in Xms" and subsequent `.tsx` file saves show HMR updates in the terminal rather than full-page reloads.

### 4.4 WebSocket smoke test

1. Open `http://localhost:5173` in a browser.
2. Open DevTools → Network → WS tab.
3. Confirm a WebSocket connection is established to the `gamma-core` backend.
4. Send a test message through the UI and confirm round-trip works.

### 4.5 Full verification checklist

- [ ] `ls apps/` shows `gamma-ui` and `gamma-core`
- [ ] `cat pnpm-workspace.yaml` shows both `apps/*` and `packages/*`
- [ ] `ls node_modules/@gamma/` shows `ui`, `core`, `types`
- [ ] `grep -r "Gamma OS" apps/ packages/` returns zero results
- [ ] `grep -r "gamma-os" apps/ --include="*.json"` returns zero results
- [ ] `pnpm dev:core` starts without errors
- [ ] `pnpm dev` starts Vite on port 5173 without errors
- [ ] HMR works (edit a `.tsx` file, confirm hot reload in browser, no full-page refresh)
- [ ] WebSocket connection is established in DevTools
- [ ] UI renders correctly with updated "Gamma" branding

---

## Rollback Plan

If any milestone fails catastrophically:

```bash
# Git is your safety net — all moves are tracked
git status          # shows moved files as rename diffs
git checkout .      # restores all modified files
git clean -fd       # removes untracked files (use with caution)
```

Since `git mv` tracks renames, the directory moves in Milestone 1 are fully reversible via `git checkout`.
