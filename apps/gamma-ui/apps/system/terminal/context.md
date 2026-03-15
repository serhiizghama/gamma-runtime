## Gamma Agent Runtime Terminal (system app) — v2.0

**Purpose**
- Fully functional in-browser terminal for Gamma Agent Runtime.
- Supports real command dispatch, history navigation, and Tab autocomplete.
- Uses the kernel API for live system data (health, sessions).

**Current behavior**
- Dark theme (#0d1117 background, GitHub-style colors).
- No heartbeat / no spam — clean output only.
- Supports ↑/↓ for command history, Tab for autocomplete, Ctrl+C to cancel, Ctrl+L to clear.
- Color-coded output: cyan for keys, green for OK, red for errors, yellow for headers.
- Ghost autocomplete suggestion renders behind the cursor.

**Built-in commands**
- `help`     — list all available commands
- `clear`    — clear screen (also Ctrl+L)
- `echo`     — print arguments
- `date`     — current date and time
- `whoami`   — user + shell info
- `version`  — Gamma Runtime version string
- `env`      — NODE_ENV, API_BASE, user agent
- `uptime`   — page uptime (performance.now)
- `history`  — command history for this session
- `health`   — live CPU, RAM, Redis, Gateway from GET /api/system/health
- `sessions` — active sessions from GET /api/sessions

**Architecture notes**
- Pure React component with local useState/useCallback/useRef.
- No setInterval (heartbeat removed).
- Async commands (health, sessions) fetch directly from kernel API via API_BASE.
- Line model: each line is `{ id, segments: [{text, color?, bold?}] }` for ANSI-style coloring.
- Command history stored in component state; survives re-renders within the session.

**Extension ideas**
- Add `ls apps` / `open <app>` to control the window manager via useGammaStore.
- Add `agent <id> <message>` to send messages to sessions.
- Pipe support: `health | grep cpu`.
- Persist history across sessions with useAppStorage.
