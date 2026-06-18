# Contributing to Gamma Runtime

Thanks for your interest in the project! Contributions, bug reports, and ideas
are welcome.

## Development setup

```bash
pnpm install      # install dependencies
cp .env.example .env
pnpm db:up        # start Postgres
pnpm dev          # backend + frontend
```

You'll need **Node ≥ 22**, **pnpm 9**, **Docker**, and an authenticated
[Claude Code CLI](https://claude.com/claude-code) on your `PATH`.

## Before opening a pull request

Run the same checks CI runs — all four must pass:

```bash
pnpm format:check   # Prettier
pnpm lint           # ESLint (0 errors)
pnpm typecheck      # tsc, both apps
pnpm build          # build both apps
```

`pnpm format` and `pnpm lint:fix` will auto-fix most style issues.

## Guidelines

- **One change per PR.** Keep pull requests focused and easy to review.
- **Match the existing style.** Conventions live in
  [`CLAUDE.md`](./CLAUDE.md) — ULID-prefixed IDs, epoch-millisecond timestamps,
  parameterized SQL, the `/api/` prefix, and the task-stage state machine.
- **Write clear commit messages** in the conventional style
  (`fix:`, `feat:`, `refactor:`, `docs:`, `chore:`).
- **No new heavy infrastructure.** The runtime is deliberately single-instance
  with an in-memory event bus — please keep it that way unless there's a strong
  reason.

## Reporting bugs

Open an issue with reproduction steps, expected vs. actual behavior, and your
environment (OS, Node version, Claude Code CLI version). A minimal repro helps
enormously.
