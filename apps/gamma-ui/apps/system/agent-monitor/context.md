## Gamma Agent Runtime Agent Monitor (system app)

**Purpose**
- Observe and control all active AI agent sessions from within the desktop.
- Visualize token usage, run counts, and session status in real-time.
- Inspect session system prompts and force-terminate runaway agents.

**Current behavior**
- Talks to the kernel API via the Vite proxy:
  - `GET /api/sessions/active` — fetches the full session registry (requires `X-Gamma-System-Token`).
  - `GET /api/sessions/:sessionKey/context` — lazy-fetches the full system prompt for a session.
  - `POST /api/sessions/:sessionKey/kill` — force-kills a session (abort + registry cleanup).
- Subscribes to `GET /api/stream/agent-monitor` (SSE) to receive `session_registry_update` broadcast events for live registry updates.

**Authorization**
- All privileged endpoints require the `X-Gamma-System-Token` header.
- Set `VITE_GAMMA_SYSTEM_TOKEN` in `apps/gamma-ui/.env.local` to match the kernel's `GAMMA_SYSTEM_TOKEN` env var.

**UI structure**
- Header: app title and live session count.
- Left pane (60%): data grid — columns: Window, App, Status, Runs, In Tok, Out Tok, Last Active.
  - Clicking a row selects it for inspection.
- Right pane (40%): inspector — shows session metadata, context prompt (on demand), and kill button.

**Architecture notes**
- `useSessionRegistry` hook (web/hooks/useSessionRegistry.ts) handles all data fetching and SSE wiring.
- The SSE controller muxes both per-window and broadcast streams on the same endpoint, so any
  connected client receives `session_registry_update` events automatically.
- `systemAuthHeaders()` is exported from the hook for reuse in fetch calls inside the component.
