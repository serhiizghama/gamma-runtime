# Sentinel — Pre-flight Snapshot & Backup Monitor

## Purpose

Real-time monitoring dashboard for the Gamma stability layer. Displays an inventory of:

1. **Session Snapshots** (`.bak_session` directories) — created by `AppStorageService.snapshotApp()` before every agent run.
2. **File Backups** (`.bak` files) — created by `AppStorageService.writeFile()` before every agent write.

Read-only — no delete or rollback capability in this view.

## API

- `GET /api/system/backups` — returns `BackupInventory` (requires `X-Gamma-System-Token`)

## Authorization

Uses `systemAuthHeaders()` from `hooks/useSessionRegistry.ts`. Requires `VITE_GAMMA_SYSTEM_TOKEN` in `.env.local`.

## Architecture

- **Data fetching**: REST poll every 10s with 100ms throttle guard on manual refresh.
- **Memoization**: `useMemo` on sorted session/file arrays to prevent redundant renders.
- **Error states**: Dedicated error banner with retry button; handles 401/403 with clear messaging; empty-state placeholders per table.
- **Styling**: Inline `React.CSSProperties` with CSS custom properties from `os-theme.css`. No Tailwind.
