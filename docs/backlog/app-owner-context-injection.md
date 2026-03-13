## Stage 4 Backlog — App Owner Context Injection

**Status**: Paused  
**Owner**: Gamma OS Architect / Backend  
**Area**: Kernel `SessionsService`, Web `WindowNode`, OpenClaw Gateway

### Problem

Context Injection for specific apps (App Owners) is currently **bypassed**.  
The kernel successfully reads each app's `context.md` and related source, but the OpenClaw session initialization flow does not yet reliably ingest a custom `system_prompt` for `app-owner-{appId}` sessions. As a result, embedded app assistants fall back to the default **Gamma OS Assistant** persona instead of a per‑app maintainer.

Key signals:
- Frontend passes `sessionKey = app-owner-{appId}` from `WindowNode` into the embedded `AgentChat`.
- Backend `SessionsService` can resolve both system and generated app bundles and read `context.md` plus the main `*App.tsx`.
- OpenClaw Gateway today is driven primarily via `chat.send`; the `sessions.create` / `systemPrompt` lifecycle is not yet wired in a robust, phase‑aware way for App Owners.

### Current Implementation Notes

- `WindowNode.tsx`
  - Embedded chat uses `sessionKey = app-owner-{appId}` for app‑local agents.
  - Contains a `// TODO (Stage 4)` comment documenting that the app‑specific context is not yet honored by the Gateway and that we currently fall back to the default assistant persona.

- `SessionsService` (kernel)
  - Intercepts `app-owner-{appId}` sessions in `initializeAppOwnerSession(...)`.
  - Resolves app context from:
    - System apps (current layout),
    - Generated apps jail (via `ScaffoldService`).
  - Successfully reads:
    - `agent-prompt.md` (optional),
    - `context.md`,
    - main `*App.tsx` module.
  - Contains a `// TODO (Stage 4)` comment describing that although the context is available, **OpenClaw session initialization still needs a refactor** to ingest a dedicated `system_prompt`.

### Desired Behavior (Stage 4)

For each `app-owner-{appId}` session:

- On first session creation:
  - Build a rich `system_prompt` from:
    - App persona (`agent-prompt.md` or default),
    - App context (`context.md`),
    - Primary source file (`*App.tsx`).
  - Call the appropriate OpenClaw session lifecycle method (e.g. `sessions.create` or equivalent) with this `system_prompt` **before** any `chat.send`.
  - Persist a flag in `gamma:state:{windowId}` to avoid re‑initializing on every message.

- On subsequent messages:
  - Use `chat.send` only, assuming the session already carries the per‑app system prompt and context.

### Constraints & Considerations

- Must not break the existing **Gamma OS Assistant** default persona for non‑app‑owner sessions.
- Gateway protocol:
  - Confirm the latest OpenClaw schema for `sessions.create` / `systemPrompt` vs. any newer connect‑time or run‑time configuration channels.
  - Ensure compatibility with current `gateway-ws.service.ts` handshake and event routing.
- Observability:
  - Preserve and/or extend logging so that:
    - Session creation and system prompt payloads are traceable in `kernel.log`.
    - Failures in session initialization degrade gracefully to the default assistant, without crashing the kernel or Gateway.
- Watch out for context window limits: Injecting the entire *App.tsx and context.md might exceed the LLM's max token limit if the application grows large. Stage 4 implementation should consider basic code minification or token-counting before sending the payload to OpenClaw.

### Acceptance Criteria

- For a system app like `browser`:
  - Opening the app and toggling the embedded assistant creates a session with key `app-owner-browser`.
  - Kernel logs show a successful App Owner session initialization including context + source.
  - The assistant demonstrably reasons over `web/apps/system/browser/context.md` and its `BrowserApp.tsx`, not just the global Gamma OS context.

- For a generated app:
  - Same behavior using the generated app bundle directory and its jail context.

- Failure modes:
  - If context files are missing or unreadable, the system:
    - Logs a clear warning,
    - Falls back to the default Gamma OS Assistant persona,
    - Does **not** break regular chat or crash the Gateway.

