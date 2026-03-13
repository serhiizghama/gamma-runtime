## Gamma Agent Runtime Kernel Monitor (system app)

**Purpose**
- Introspect and debug the Gamma kernel from within the desktop.
- Visualize window↔session mappings, session lifecycles, and SSE event streams.

**Current behavior**
- Talks directly to the kernel API (default `http://localhost:3001`):
  - `GET /api/sessions` — list active window sessions.
  - `POST /api/sessions` — spawn a mock debug session.
  - `DELETE /api/sessions/:windowId` — kill a session.
  - `GET /api/stream/:windowId` — subscribe to SSE events for a window.
- UI has three main regions:
  - Header: app title and "Spawn Mock Session" button.
  - Sessions table: current sessions with status, agent ID, created time, and a Kill action.
  - SSE panel: connect/disconnect to a specific window's SSE stream and tail structured events.

**Architecture notes**
- Implemented as a pure React client component with `fetch` and `EventSource`.
- Keeps lightweight in-memory state:
  - `sessions: WindowSession[]` — live list of sessions, auto-refreshed every 5s.
  - `logs: SSELogEntry[]` — ring buffer of the last ~200 SSE events.
  - `windowId: string` — target window for SSE subscription.
- Does not integrate with the main OS store; it is an independent diagnostics tool.

**Extension ideas for the AI agent**
- Add filtering/grouping by app ID, status, and age.
- Visualize end-to-end lifecycles (window opened → agent run → SSE timeline).
- Surface GC and watchdog information pulled from Redis or dedicated diagnostics endpoints.

