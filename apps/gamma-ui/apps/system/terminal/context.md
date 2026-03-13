## Gamma Agent Runtime Terminal (system app)

**Purpose**
- Lightweight, in-browser demo terminal for Gamma Agent Runtime.
- Showcases the long-running "process" pattern and cleanup contract.
- Safe sandbox: does not execute real shell commands.

**Current behavior**
- Renders a scrolling text console with a prompt at the bottom.
- Appends a heartbeat line every 2 seconds while the window is open.
- Echoes any user-entered text and responds with `command not found: <input>`.
- Automatically scrolls to the latest output.

**Architecture notes**
- Implemented as a pure React component with local `useState` and `useEffect`.
- Uses a `setInterval` heartbeat that is cleared on unmount to avoid leaks.
- No backend calls, no filesystem or process access, and no persistence.

**Extension ideas for the AI agent**
- Replace the fake command handler with a real command router backed by APIs.
- Add commands for inspecting Gamma Agent Runtime state (windows, sessions, registry).
- Implement simple scripting or macros that operate over the desktop environment.

