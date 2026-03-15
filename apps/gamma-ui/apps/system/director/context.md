## Gamma Agent Runtime — Director App (system app)

**Purpose**
Mission Control for the Gamma Agent Runtime. The Director provides a real-time
view of all agent activity, system events, and emergency controls.

**Current behavior**
- Subscribes to `GET /api/system/activity/stream` (SSE) for live `ActivityEvent` objects.
- Displays a scrollable Activity Feed with event coloring by type:
  - Messages (`message_sent`) → Blue (#5fd7ff)
  - Tool calls (`tool_call_start`, `tool_call_end`) → Yellow (#ffd787)
  - Security / Errors (`lifecycle_error`, `emergency_stop`, severity=error) → Red (#ff5f5f)
  - Lifecycle / Agent registration → Gray (#888)
  - File changes → Cyan (#87ffd7)
  - System events → Purple (#d787ff)
- Polls `GET /api/system/agents` every 5s for the live Agent Registry panel.
- Exposes a PANIC button: `POST /api/system/panic` — kills all active sessions.
- Uses Zustand store `useActivityStore` (max 500 events in memory, newest-first).

**Authorization**
- All privileged endpoints require the `X-Gamma-System-Token` header.
- `systemAuthHeaders()` from `hooks/useSessionRegistry` is used for all fetches.
- SSE stream passes the token as a query param (EventSource doesn't support custom headers).

**UI structure**
- Header: app title, LIVE/RECONNECTING status badge, PANIC button.
- Left pane (flex): Activity Feed — scrollable event list with PAUSE and CLEAR controls.
- Right pane (220px): Agent Monitor — live list of all registered agents with status dots.

**Activity Feed card fields**
  [HH:MM:SS] [agentId] [KIND] [payload snippet]

**Architecture notes**
- SSE reconnects automatically after 3s on connection loss.
- `useActivityStore` (Zustand) is module-level — survives React re-renders.
- Agent Monitor refresh is independent of SSE stream (poll-based, 5s interval).
- Component is split: `ActivityFeed`, `AgentMonitor`, `PanicButton` — each self-contained.
