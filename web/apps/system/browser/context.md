## Gamma OS Browser (system app)

**Purpose**
- Simple in-window web shell for viewing external documentation and tools.
- Acts as a starting point for a richer, AI-extendable browser experience.

**Current behavior**
- Renders a single-page browser with:
  - An address bar (URL text input + "Go" button).
  - A content area that embeds the requested URL in an `<iframe>`.
- Accepts either full URLs (`https://example.com`) or bare hostnames (`example.com`), which are normalized to `https://`.
- No tabs, history, devtools, or bookmarking are implemented yet.

**Architecture notes**
- Implemented as a standalone React component with local `useState`.
- Does not talk directly to the Gamma OS store or backend APIs.
- Uses a very small styling surface focused on a clean, glassy address bar and full-window content pane.

**Extension ideas for the AI agent**
- Add tab management and basic history.
- Persist a list of "pinned" internal resources (Gamma docs, dashboards, kernel tools).
- Integrate with the Agent so it can open URLs in-context or annotate pages.

