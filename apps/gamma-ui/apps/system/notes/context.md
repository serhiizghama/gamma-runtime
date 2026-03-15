## Gamma Agent Runtime Notes (system app)

**Purpose**
- Lightweight scratchpad for quick notes inside Gamma Agent Runtime.
- Demonstrates a simple, self-contained CRUD experience that can be evolved by the AI.

**Current behavior**
- Renders a two-pane layout:
  - Left sidebar: list of notes with title + created-at timestamp, plus a "+" button to create a new note.
  - Right pane: editor for the active note (title input + multiline text area).
- Notes live only in React component state:
  - No persistence across reloads.
  - No synchronization between windows or devices.

**Architecture notes**
- Each note is represented by `{ id, title, body, createdAt }`.
- New notes are created with a timestamp-based ID and default title `"Untitled note"`.
- The component keeps:
  - `notes: Note[]` — all notes currently in memory.
  - `activeId: string` — the ID of the note currently being edited.
- There are no external dependencies (no OS store usage, no backend calls).

**How to modify code (MANDATORY)**
- To change any file, you MUST call `fs_write` with the complete updated file content.
- Never describe code changes in text only — the change must be executed via the `fs_write` tool or it has no effect.
- Workflow: use `fs_read` to read the current file → make your changes → call `fs_write` with the full new content.
- Do not confirm changes in text unless you have already written them via `fs_write`.

**Extension ideas for the AI agent**
- Persist notes to a backend or to Gamma Agent Runtime's global store.
- Add tagging, search, and pinning.
- Implement markdown support and rich text formatting.
- Expose a small "notes API" the agent can use to store and retrieve structured facts.

