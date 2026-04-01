# Gamma Runtime v2

## Project Structure
- **Monorepo** managed by pnpm workspaces
- `apps/core` — NestJS 10 backend with Fastify adapter (port 3001)
- `apps/web` — React 18 + Vite frontend (port 5173)
- `scripts/init-db.sql` — Postgres schema

## Tech Stack
- **Backend**: NestJS 10, Fastify, raw `pg` (no ORMs)
- **Database**: Postgres 16 (Docker Compose)
- **Frontend**: React 18, Vite, Tailwind CSS
- **Package Manager**: pnpm (workspace root at `v2/`)

## Commands
- `pnpm install` — install all dependencies
- `pnpm --filter @gamma/core dev` — start backend dev server
- `pnpm --filter @gamma/web dev` — start frontend dev server
- `docker compose up -d` — start Postgres
- `docker compose down` — stop Postgres

## Conventions
- All IDs use ULID format with entity prefix (e.g., `team_`, `agent_`, `task_`)
- Timestamps are stored as millisecond integers
- SQL uses parameterized queries only — never concatenate user input
- API prefix: `/api/`
- Health check: `GET /api/health`
