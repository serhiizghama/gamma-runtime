# Gamma OS — Phase 3: Frontend & Multi-Agent Architecture
**Version:** 1.5  
**Status:** Draft — Ready for Review  
**Audience:** Senior Frontend Developer (React), Agent Architect  
**Depends on:** Phase 2 Backend Integration Specification v1.6  
**Changelog v1.5:** UI/UX hardening — truncated chat tool output to prevent DOM freezes on large results, and defined a graceful "tombstone" window state when an app is unscaffolded while its window is open (no more crashes on missing bundles).  
**Changelog v1.4:** Hardened App Storage API & hooks — added unmount-safe debounce cleanup and error reset semantics in `useAppStorage`, made `API_BASE` resolution SSR-/proxy-safe, synchronized `AppDataController` with 64KB/50-keys limits, documented `redis.keys` usage constraints in unscaffold cleanup, and updated docs file structure to point Phase 3 to `IMPLEMENTATION_PLAN_PHASE3.md`.  
**Changelog v1.3:** Resolved tool naming contradiction — App Owner uses `update_app` tool (translated to `POST /api/scaffold` by backend). Scaffold acts as PATCH/Merge — omitted fields preserve existing files. Fixed Vite dynamic import to use strongly-typed template literal for generated directory.  
**Changelog v1.2.1:** Security fix — context injection in §6.1 must use `scaffoldService.jailPath()` for all file reads, preventing path traversal when reading `agent-prompt.md`, `context.md`, and source code.  
**Changelog v1.2:** Fixed unscaffold memory leaks (app data + App Owner session cleanup on delete). Defined Vite alias for `@gamma/os` module resolution. Resolved Hot-Reload strategy: Full Remount with dynamic key (not Fast Refresh).  
**Changelog v1.1:** English-only token constraints for AI context files (`context.md`, `agent-prompt.md`). OS-level App Storage API (`useAppStorage` hook + Redis persistence) replacing blocked `localStorage`.  

---

## 1. Overview

Phase 2 built the backend pipeline: Gateway bridge, SSE streaming, scaffolding, session management. Phase 3 defines **how users interact with AI agents through the OS interface** and how generated applications become self-contained, agent-enabled units.

Two fundamental shifts:

1. **Generated apps become Bundles** — not just `.tsx` files, but self-contained packages with their own context, persona, and UI code.
2. **Agents form a hierarchy** — a global System Architect handles OS-level orchestration, while each app gets its own local App Owner agent scoped strictly to that app's domain.

```
┌──────────────────────────────────────────────────────────┐
│  Gamma OS Desktop                                        │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Menu Bar  [🔬 System Health] [💬 Architect Chat]  │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  ┌─────────────────────┐  ┌─────────────────────────┐   │
│  │ Weather App      ✨ │  │ Notes App            ✨ │   │
│  │                     │  │                         │   │
│  │  [App UI]           │  │  [App UI]               │   │
│  │                     │  │                         │   │
│  │  ┌───────────────┐  │  │                         │   │
│  │  │ App Owner Chat│  │  │                         │   │
│  │  │ "Make the     │  │  │                         │   │
│  │  │  icons bigger"│  │  │                         │   │
│  │  └───────────────┘  │  │                         │   │
│  └─────────────────────┘  └─────────────────────────┘   │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Dock: [Weather] [Notes] [Terminal] [Settings]     │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

---

## 2. The App Bundle

### 2.1 What Changed

In Phase 2, a generated app was a single file:

```
web/apps/generated/
├── WeatherApp.tsx
└── assets/weather/
```

This is insufficient. The agent that created the app has no memory of *why* it was built, what design decisions were made, or what the user's intent was. If the user asks "make the background darker," the agent has to re-read the entire source code and guess the context.

### 2.2 Bundle Structure

A **Bundle** is a directory containing everything an app needs to exist, be understood, and be modified:

```
web/apps/generated/
├── weather/                         ← App Bundle
│   ├── WeatherApp.tsx               ← React component (the UI)
│   ├── context.md                   ← App state, UI rules, business logic
│   ├── agent-prompt.md              ← App Owner persona and constraints
│   └── assets/                      ← Static assets (images, JSON, fonts)
│       ├── icons/
│       │   └── sun.png
│       └── data/
│           └── cities.json
├── notes/                           ← Another App Bundle
│   ├── NotesApp.tsx
│   ├── context.md
│   ├── agent-prompt.md
│   └── assets/
└── .git/                            ← Nested Git repo (from Phase 2)
```

### 2.3 context.md — The App's Memory

> **⚠️ Token Economics Constraint (v1.1):**  
> `context.md` MUST be written **exclusively in English**, regardless of the user's input language. Use bullet points, not paragraphs. Target **under 500 tokens** per file. Every token in this file is injected into the agent's context window on every user interaction — bloated context = slower responses + higher cost + context overflow risk.

This file is the single source of truth for the app's state. It's written by the System Architect on creation and updated by the App Owner on every modification.

```markdown
# Weather App — Context

## Purpose
Real-time weather display for the user's configured cities.

## UI Rules
- Dark theme with glassmorphism panels
- Temperature in Celsius by default (toggle available)
- Max 5 cities displayed simultaneously
- Responsive: 1 column below 400px width, 2 columns above

## Data Sources
- OpenWeatherMap API (key stored in OS settings, not in app code)
- Refresh interval: 15 minutes

## State Shape
- `cities: string[]` — user-selected city names
- `unit: "C" | "F"` — temperature unit
- `lastFetched: number | null` — timestamp of last API call

## Design Decisions
- 2024-03-10: User requested glassmorphism style over flat design
- 2024-03-10: Chose grid layout over list for density

## Known Limitations
- No offline mode — requires network
- No push notifications for weather alerts (future enhancement)
```

**Why it matters:** When the App Owner agent receives "add a humidity column," it reads `context.md` to understand the current layout (grid, glassmorphism, max 5 cities), modifies `WeatherApp.tsx` accordingly, and updates `context.md` with the new state. No guessing.

### 2.4 agent-prompt.md — The App Owner's Persona

> **⚠️ Token Economics Constraint (v1.1):**  
> `agent-prompt.md` MUST be written **exclusively in English**. Target **under 300 tokens**. Use terse bullet lists. The primary directive for every App Owner is: **"Help the user utilize and adapt this application."** Everything else is constraints and scope.

This file defines who the App Owner agent is for this specific app. It's scoped — the agent only sees this file, `context.md`, and the app's source code.

```markdown
# Weather App — Agent Prompt

You are the **Weather App Owner** for Gamma OS.

## Your Scope
- You own ONLY the Weather App: `WeatherApp.tsx`, its assets, and this context.
- You cannot create new apps. You cannot modify other apps.
- You cannot access system settings, the dock, or the desktop.

## Your Capabilities
- Modify `WeatherApp.tsx` to change UI, layout, behavior
- Add/remove/update assets in `assets/`
- Update `context.md` after every change you make

## Your Constraints
- All code must pass the security scan (no eval, no innerHTML, no external fetch)
- Preserve existing functionality unless the user explicitly asks to remove it
- Always update `context.md` after modifying the component
- Never add dependencies that aren't already in the project

## Your Voice
- Brief, direct, technical
- Confirm what you changed and why
- If the user's request is ambiguous, ask one clarifying question before acting
```

### 2.5 Bundle Registration

When an app is scaffolded, the `gamma:app:registry` Redis Hash entry is updated to reflect the bundle structure:

```typescript
interface AppRegistryEntry {
  appId: string;
  displayName: string;
  modulePath: string;           // "./web/apps/generated/weather/WeatherApp"
  bundlePath: string;           // "./web/apps/generated/weather/"
  hasAgent: boolean;            // true if agent-prompt.md exists
  createdAt: number;
  updatedAt: number;             // v1.2: used as React key for Full Remount
}
```

---

## 3. The Agent Hierarchy

### 3.1 Hierarchy Overview

```
┌─────────────────────────────────────────┐
│         System Architect (Global)        │
│  Scope: entire OS, all apps, system      │
│  Trigger: Menu Bar → 💬                  │
│  Session: persistent, one per OS         │
│                                          │
│  Can:                                    │
│  - Create new App Bundles                │
│  - Delete apps                           │
│  - Check system health                   │
│  - Manage system settings                │
│  - View/query the memory bus             │
│                                          │
│  Cannot:                                 │
│  - Modify an existing app's code         │
│    (delegates to the App Owner)          │
└──────────────┬──────────────────────────┘
               │ creates & manages
    ┌──────────┼──────────────┐
    ▼          ▼              ▼
┌────────┐ ┌────────┐  ┌────────┐
│Weather │ │ Notes  │  │ Music  │
│App     │ │ App    │  │ App    │
│Owner   │ │ Owner  │  │ Owner  │
└────────┘ └────────┘  └────────┘
  Scope:     Scope:      Scope:
  weather/   notes/      music/
  ONLY       ONLY        ONLY
```

### 3.2 System Architect Agent

**Identity:** The OS's global intelligence. Accessible from the menu bar at all times.

**Persona file:** `docs/system-architect.md` (checked into the main repo, not in `generated/`)

```markdown
# System Architect — Agent Persona

You are the **System Architect** of Gamma OS.

## Your Role
You are the builder and overseer of the operating system.
You create applications, monitor system health, and manage the OS lifecycle.

## Your Scope
- Create new App Bundles (WeatherApp, NotesApp, etc.)
- Delete existing apps
- Query system health (GET /api/system/health)
- View the memory bus for debugging
- Manage global OS settings

## Your Tools
- `scaffold` — create a new App Bundle (generates .tsx + context.md + agent-prompt.md)
- `unscaffold` — remove an App Bundle
- `system_health` — query CPU/RAM/Redis/Gateway metrics
- `list_apps` — enumerate all registered apps

## Your Constraints
- When creating an app, you MUST generate all three files: the React component, context.md, and agent-prompt.md
- You do NOT modify existing app code directly. If a user says "change the weather app," you delegate to the Weather App Owner
- You write clean, minimal React components using only: React, standard hooks, and Zustand
- All generated code must pass the security scan

## Delegation Protocol
When a user asks to modify an existing app:
1. Identify which app they're referring to
2. Respond: "That's a job for the [AppName] App Owner. Open [AppName] and click ✨ to chat with it directly."
3. Do NOT attempt to modify the app's code yourself
```

**Session lifecycle:**
- One persistent session for the System Architect, mapped to a special `windowId: "system-architect"`
- Created on first OS boot, never destroyed (survives F5)
- Uses the standard `POST /api/sessions/:windowId/send` endpoint

### 3.3 App Owner Agent

**Identity:** A per-app agent that lives inside the app's window. Activated by the user clicking ✨ on the window frame.

**Persona:** Read from `web/apps/generated/{appId}/agent-prompt.md`

**Context injection:** On each user message, the backend prepends:
1. The contents of `agent-prompt.md` (persona)
2. The contents of `context.md` (current state)
3. The current source code of `{AppName}.tsx`

This gives the agent full context without requiring long-term memory.

**Session lifecycle:**
- Created on-demand when the user clicks ✨ for the first time
- `windowId: "app-owner-{appId}"`, `sessionKey` from Gateway
- Survives within the browser session but is GC'd after 24h idle (Phase 2 GC)

**Modification flow:**
```
User clicks ✨ on Weather App window
  → Chat panel opens inside the window
  → User: "Add a humidity percentage to each city card"
  →
    Backend reads: agent-prompt.md + context.md + WeatherApp.tsx
    Prepends as system context to the user message
    Sends to Gateway → Agent generates updated WeatherApp.tsx
  →
    Agent calls POST /api/scaffold with updated code + updated context.md
    Agent: "Done. Added humidity to each card. Updated context.md with the new field."
  →
    SSE: component_ready → React hot-reloads the component
    User sees the change instantly, no page reload
```

### 3.4 Inter-Agent Boundaries

| Capability | System Architect | App Owner |
|---|:---:|:---:|
| Create new apps | ✅ | ❌ |
| Delete apps | ✅ | ❌ |
| Modify app code | ❌ (delegates) | ✅ (own app only) |
| Read system health | ✅ | ❌ |
| Read memory bus | ✅ | ❌ |
| Update context.md | ❌ | ✅ (own app only) |
| Access other app's files | ✅ (read-only) | ❌ |
| Manage OS settings | ✅ | ❌ |

---

## 4. UI/UX Architecture

### 4.1 Top Menu Bar

The menu bar is the OS-level control surface. Always visible, always accessible.

```
┌──────────────────────────────────────────────────────────────┐
│  Γ  Gamma OS    │  🟢 System OK  │  ☰ Apps  │  💬 Architect │
└──────────────────────────────────────────────────────────────┘
```

| Element | Behavior |
|---|---|
| **Γ Logo** | Click → About modal (version, uptime, agent count) |
| **System Status** | Polls `GET /api/system/health` every 30s. Shows 🟢 OK / 🟡 Degraded / 🔴 Error. Click → health detail popup |
| **☰ Apps** | Opens Launchpad overlay (existing behavior) |
| **💬 Architect** | Opens/focuses the System Architect chat window |

**React component:** `<MenuBar />`

```typescript
interface MenuBarProps {
  systemHealth: SystemHealthReport | null;
  onOpenArchitect: () => void;
  onOpenLaunchpad: () => void;
}
```

### 4.2 Window Manager Enhancements

Every window frame gets an **AI Assistant toggle** button in the title bar:

```
┌────────────────────────────────────────────────┐
│  ● ● ●   Weather App                    ✨  ─ □ ✕ │
├────────────────────────────────────────────────┤
│                                                │
│  [App Content]                                 │
│                                                │
│  ┌──────────────────────────────────────────┐  │
│  │  ✨ App Owner Chat (collapsible)         │  │
│  │                                          │  │
│  │  You: "Make the icons larger"            │  │
│  │  Agent: "Updated icon size from 24→36px" │  │
│  │                                          │  │
│  │  [Type a message...]            [Send]   │  │
│  └──────────────────────────────────────────┘  │
└────────────────────────────────────────────────┘
```

**Behavior:**
- ✨ button toggles the chat panel (slide-up from bottom of the window)
- Chat panel height: 40% of window height, resizable
- If the app has no `agent-prompt.md`, the ✨ button is grayed out with tooltip: "No agent configured for this app"
- First click creates the App Owner session (lazy initialization)
 - If the underlying app bundle is unscaffolded while the window is open (see §5.5), the window's content area MUST transition to a non-interactive "tombstone" state instead of crashing — e.g., a centered message: "This application was removed by the System Architect." The ✨ chat panel is disabled in this state.

**Updated `WindowNode` props:**

```typescript
interface WindowNodeProps {
  windowId: string;
  appId: string;
  title: string;
  hasAgent: boolean;          // from AppRegistryEntry
  // ... existing props
}
```

### 4.3 The Chat Component

A single, reusable `<AgentChat />` component serves both the System Architect and App Owner interfaces. The only difference is the props passed.

```typescript
interface AgentChatProps {
  /** Window ID for the agent session */
  windowId: string;

  /** Display title in the chat header */
  title: string;

  /** Visual mode */
  variant: 'fullWindow' | 'embedded';

  /** Color theme — architect uses system green, app owners inherit app theme */
  accentColor?: string;

  /** Placeholder text for the input */
  placeholder?: string;

  /** Callback when agent generates a component_ready event */
  onComponentReady?: (appId: string) => void;
}
```

**Usage — System Architect (full window):**
```tsx
<AgentChat
  windowId="system-architect"
  title="System Architect"
  variant="fullWindow"
  accentColor="#00ff41"
  placeholder="Ask me to build something..."
/>
```

**Usage — App Owner (embedded in window):**
```tsx
<AgentChat
  windowId={`app-owner-${appId}`}
  title={`${displayName} Assistant`}
  variant="embedded"
  placeholder={`Ask about ${displayName}...`}
  onComponentReady={handleHotReload}
/>
```

### 4.4 Chat Component Internals

The `<AgentChat />` component uses the existing Phase 2 infrastructure:

```typescript
function AgentChat({ windowId, title, variant, ... }: AgentChatProps) {
  // 1. Connect to SSE stream for this windowId
  const agentState = useAgentStream(windowId);

  // 2. Send messages via POST /api/sessions/:windowId/send
  const sendMessage = async (text: string) => {
    await fetch(`${API_BASE}/api/sessions/${windowId}/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
  };

  // 3. Render based on agentState
  return (
    <div className={variant === 'fullWindow' ? 'chat-full' : 'chat-embedded'}>
      <ChatHeader title={title} status={agentState.status} />
      <MessageList
        messages={agentState.outputLines}
        streamText={agentState.streamText}
        thinkingTrace={agentState.thinkingTrace}
        pendingToolLines={agentState.pendingToolLines}
      />
      <ChatInput
        onSend={sendMessage}
        disabled={agentState.status === 'running'}
        placeholder={placeholder}
      />
    </div>
  );
}
```

**SSE event handling in the chat:**

| Event Type | Chat Behavior |
|---|---|
| `user_message` | Append to message list as user bubble |
| `lifecycle_start` | Show typing indicator |
| `thinking` | Show collapsible "💭 Thinking..." block |
| `assistant_delta` | Stream text into assistant bubble |
| `tool_call` | Show "🔧 Using tool: {name}" inline |
| `tool_result` | Show "✅ {name} → {result}" inline |
| `lifecycle_end` | Hide typing indicator, finalize message |
| `component_ready` | Show "✅ App updated — reloading..." toast |

> **v1.5 — Tool output truncation:**  
> The underlying agent reducer logic for `tool_call`/`tool_result` events (see Phase 2 Backend Spec §8.2) **MUST truncate** stringified arguments and results before adding them to `pendingToolLines`. Clamp `JSON.stringify(...)` to a maximum of ~64 visible characters, and append an ellipsis marker such as `"… (truncated)"` when content is longer. The Chat UI **must not** attempt to render full multi‑KB payloads (e.g., entire source files returned by `read_file`) inline in bubbles — large payloads should only be summarized in `pendingToolLines` (name + small argument/result preview), with any richer inspection done via separate, dedicated UI if needed.

---

## 5. Scaffold Pipeline Update

### 5.1 Current Pipeline (Phase 2)

```
User: "Build me a weather app"
  → Architect generates WeatherApp.tsx
  → POST /api/scaffold { appId, sourceCode, files }
  → File written, git committed, SSE broadcast
```

### 5.2 Updated Pipeline (Phase 3)

```
User: "Build me a weather app"
  → Architect generates THREE artifacts:
    1. WeatherApp.tsx (React component)
    2. context.md (app state and design decisions)
    3. agent-prompt.md (App Owner persona)
  → POST /api/scaffold {
      appId: "weather",
      displayName: "Weather",
      sourceCode: "...",           // WeatherApp.tsx content
      contextDoc: "...",           // context.md content
      agentPrompt: "...",          // agent-prompt.md content
      files: [...]                 // optional assets
    }
  → ScaffoldService writes ALL files to the bundle directory
  → Git commit includes all three files
  → AppRegistryEntry updated with hasAgent: true
  → SSE broadcasts component_ready
```

### 5.3 ScaffoldRequest Update

```typescript
export interface ScaffoldRequest {
  appId: string;
  displayName: string;
  sourceCode: string;
  commit?: boolean;
  strictCheck?: boolean;
  files?: ScaffoldAsset[];

  // ── Phase 3 additions ───────────────────────────────
  /** App context document — written to {appId}/context.md */
  contextDoc?: string;
  /** App Owner agent persona — written to {appId}/agent-prompt.md */
  agentPrompt?: string;
}
```

### 5.4 Scaffold PATCH/Merge Semantics (v1.3)

`POST /api/scaffold` acts as a **PATCH/Merge** operation for existing bundles:

| Field | Provided | Behavior |
|---|---|---|
| `sourceCode` | ✅ present | Overwrite `{AppId}App.tsx` |
| `sourceCode` | ❌ omitted | **Error** — sourceCode is always required |
| `contextDoc` | ✅ present | Overwrite `context.md` |
| `contextDoc` | ❌ omitted/undefined | **Preserve** existing `context.md` on disk |
| `agentPrompt` | ✅ present | Overwrite `agent-prompt.md` |
| `agentPrompt` | ❌ omitted/undefined | **Preserve** existing `agent-prompt.md` on disk |
| `files` | ✅ present | Write/overwrite assets |
| `files` | ❌ omitted | **Preserve** existing assets |

**Implementation logic:**
```typescript
// In ScaffoldService.scaffold() — only write if provided
if (req.contextDoc !== undefined) {
  const contextPath = this.jailPath(`${safeId}/context.md`);
  await fs.writeFile(contextPath, req.contextDoc, 'utf8');
}

if (req.agentPrompt !== undefined) {
  const promptPath = this.jailPath(`${safeId}/agent-prompt.md`);
  await fs.writeFile(promptPath, req.agentPrompt, 'utf8');
}
```

This is critical for App Owner updates — the App Owner sends `sourceCode` + `contextDoc` but omits `agentPrompt`, preserving its own persona file.

### 5.5 Bundle Directory Layout After Scaffold

```
web/apps/generated/
├── weather/
│   ├── WeatherApp.tsx          ← sourceCode
│   ├── context.md              ← contextDoc
│   ├── agent-prompt.md         ← agentPrompt
│   └── assets/
│       └── weather/            ← files[]
│           └── icon.png
```

### 5.5 Unscaffold Cleanup (v1.2 — Phase 2 Override)

When the System Architect deletes an app via `DELETE /api/scaffold/:appId`, the backend must clean up **all** associated resources — not just the files and Git history from Phase 2.

**Updated `ScaffoldService.remove(appId)` must additionally:**

```typescript
// 1. Delete all app data from Redis (user-persisted state via useAppStorage)
const dataKeys = await this.redis.keys(`gamma:app-data:${safeId}:*`);
if (dataKeys.length > 0) {
  await this.redis.del(...dataKeys);
}

// 2. Kill the App Owner session immediately (don't wait for 24h GC)
const appOwnerWindowId = `app-owner-${safeId}`;
try {
  await this.sessionsService.remove(appOwnerWindowId);
} catch { /* session may not exist if user never clicked ✨ */ }
```

> **Note (v1.4):** Using the blocking `KEYS` command during unscaffold is acceptable here **only** because each app is strictly limited to at most 50 `gamma:app-data:<appId>:*` keys (see §8.3–§8.5 and Loop 6 Task 6.1). This keeps the key scan bounded and prevents Redis from being overwhelmed during deletion.

**Full unscaffold cleanup order:**
1. Delete `.tsx` + `context.md` + `agent-prompt.md` + `assets/` directory
2. Git commit removal in nested repo
3. Delete all `gamma:app-data:<appId>:*` Redis keys (user data)
4. Kill App Owner Gateway session (`app-owner-<appId>`) immediately
5. Remove from `gamma:app:registry`
6. Broadcast `component_removed` via SSE

This prevents two classes of resource leaks:
- **Data orphans:** App data keys lingering in Redis after the app is deleted
- **Session orphans:** App Owner LLM sessions consuming Gateway memory until the 24h GC fires

### 5.6 System Architect Prompt Engineering

The System Architect's tool call to `scaffold` must be structured to produce all three artifacts. The scaffold tool description provided to the agent:

```
Tool: scaffold
Description: Create a new App Bundle in Gamma OS.

Parameters:
- appId (string): kebab-case identifier (e.g., "weather", "note-taking")
- displayName (string): Human-readable name (e.g., "Weather", "Note Taking")
- sourceCode (string): Complete React component source (.tsx)
- contextDoc (string): Markdown document describing the app's purpose, UI rules, state shape, and design decisions
- agentPrompt (string): Markdown document defining the App Owner agent's persona, scope, capabilities, and constraints
- files (array, optional): Static assets [{path, content, encoding}]

Rules:
- sourceCode must be a valid React functional component with at least one export
- contextDoc must include: Purpose, UI Rules, State Shape, Design Decisions sections
- agentPrompt must include: Scope, Capabilities, Constraints sections
- All three documents are REQUIRED for every new app
- contextDoc and agentPrompt MUST be in English (regardless of user's language)
- contextDoc: max ~500 tokens, bullet points only, no prose
- agentPrompt: max ~300 tokens, primary directive = "help the user utilize and adapt this application"
```

---

## 6. App Owner Modification Flow (Detailed)

### 6.1 Context Injection

When a user sends a message to an App Owner, the backend constructs the full context before forwarding to the Gateway:

```typescript
// In sessions.service.ts — sendMessage() for app-owner-* windows
async sendAppOwnerMessage(appId: string, windowId: string, message: string): Promise<void> {
  // ⚠️ SECURITY: All file reads MUST go through jailPath() to prevent path traversal.
  // A malicious appId like "../../../etc" would escape the generated/ directory without this.
  const promptPath   = this.scaffoldService.jailPath(`${appId}/agent-prompt.md`);
  const contextPath  = this.scaffoldService.jailPath(`${appId}/context.md`);
  const sourcePath   = this.scaffoldService.jailPath(`${appId}/${pascal(appId)}App.tsx`);

  const agentPrompt = await fs.readFile(promptPath, 'utf8');
  const contextDoc  = await fs.readFile(contextPath, 'utf8');
  const sourceCode  = await fs.readFile(sourcePath, 'utf8');

  // Construct the full message with context prefix
  const fullMessage = [
    '--- AGENT PERSONA ---',
    agentPrompt,
    '',
    '--- APP CONTEXT ---',
    contextDoc,
    '',
    '--- CURRENT SOURCE CODE ---',
    '```tsx',
    sourceCode,
    '```',
    '',
    '--- USER REQUEST ---',
    message,
  ].join('\n');

  // Forward the enriched message to Gateway
  await this.gatewayWs.sendMessage(sessionKey, fullMessage);
}
```

### 6.2 App Owner Response Handling

When the App Owner agent responds with a code modification, it calls the `update_app` tool (v1.3: NOT `scaffold` — this prevents the App Owner from hallucinating the creation of new apps). The backend translates `update_app` to the same `POST /api/scaffold` endpoint.

**v1.3 — Partial Update (PATCH/Merge) Semantics:**  
When `POST /api/scaffold` is called for an **existing** app, omitted fields preserve existing files on disk. If `agentPrompt` is `undefined`, the existing `agent-prompt.md` is untouched. The App Owner typically sends `sourceCode` + `contextDoc` but NOT `agentPrompt` (it shouldn't overwrite its own persona).

```
App Owner agent receives enriched message
  → Reads current code + context
  → Generates modified WeatherApp.tsx
  → Generates updated context.md (adds design decision entry)
  → Calls update_app tool with { appId: "weather", sourceCode: "...", contextDoc: "..." }
  → Backend translates to POST /api/scaffold (PATCH/Merge — agentPrompt untouched)
  → Git commit: "refactor: updated Weather App — added humidity display"
  → SSE: component_ready
  → React hot-reloads the component in the user's window
  → Agent responds in chat: "Done. Added humidity percentage to each city card."
```

### 6.3 Hot-Reload Strategy: Full Remount (v1.2)

**Decision:** Full Remount via dynamic `key` prop. **Not** React Fast Refresh.

**Why Fast Refresh won't work:**
- Fast Refresh requires hook call order and count to remain stable between edits
- AI-generated code frequently changes the number, order, and types of hooks (adding `useState`, `useEffect`, `useAppStorage`, etc.)
- When hook order changes, Fast Refresh falls back to a full remount anyway — but with confusing error warnings
- Generated components may change their export structure (`default` ↔ `named`), which also breaks Fast Refresh

**Solution: Key-based Remount**

The dynamic component renderer uses the app registry's `updatedAt` timestamp as a React `key`. When `component_ready` fires, the registry entry is updated, the key changes, and React cleanly unmounts the old component and mounts the new one.

```typescript
// In the dynamic app renderer
function DynamicAppRenderer({ appId }: { appId: string }) {
  const registry = useAppRegistry();
  const entry = registry[appId];
  const [Component, setComponent] = useState<React.ComponentType | null>(null);

  // v1.3: Use strongly-typed template literal pointing to the generated directory.
  // Vite/Rollup cannot statically analyze fully dynamic import() paths.
  // By anchoring the path to `../../apps/generated/`, Vite knows which directory
  // to watch and serve. The `?t=` cache-bust param forces re-fetch on updates.
  const pascal = (id: string) =>
    id.replace(/[-_]+(.)/g, (_, c: string) => c.toUpperCase())
      .replace(/^(.)/, (_, c: string) => c.toUpperCase());

  useEffect(() => {
    if (!entry) {
      // App has been removed from the registry (e.g., unscaffolded) — see v1.5 tombstone behavior.
      setComponent(() => null);
      return;
    }
    const PascalId = pascal(appId);
    import(`../../apps/generated/${appId}/${PascalId}App.tsx?t=${entry.updatedAt}`)
      .then((mod) => setComponent(() => mod.default ?? mod[Object.keys(mod)[0]]))
      .catch(console.error);
  }, [appId, entry?.updatedAt]);

  // v1.5 — Tombstone state: if the app registry entry is missing (e.g., after unscaffold),
  // render a graceful placeholder instead of attempting to import a non-existent module.
  if (!entry) {
    return (
      <div className="app-tombstone">
        <h2>Application removed</h2>
        <p>This application was removed by the System Architect.</p>
      </div>
    );
  }

  if (!Component) return null;

  // key={updatedAt} forces React to unmount old + mount new on every update
  return <Component key={entry.updatedAt} />;
}
```

**Behavior on `component_ready` / `component_removed` SSE events:**
1. Frontend receives `{ type: "component_ready", appId, modulePath }`
2. Updates `AppRegistryEntry.updatedAt` in Zustand store
3. `DynamicAppRenderer` re-runs effect → `import()` fetches updated module
4. `key` changes → React unmounts old component (cleans up hooks, effects, subscriptions)
5. New component mounts fresh with clean state
6. `useAppStorage` hooks re-hydrate from Redis on mount → user data preserved

If a `component_removed` event is received and the app is removed from `useAppRegistry`, all open windows for that `appId` MUST move into the tombstone state described above — no further dynamic imports should run for that app, and the user should see a clear "App removed" placeholder instead of a crash or blank window.

**Trade-off:** Component state is lost on every AI update (e.g., scroll position, form input). This is acceptable because:
- Persistent user data lives in `useAppStorage` (survives remount)
- Ephemeral UI state (scroll, focus) is expected to reset after a code change
- This is far more reliable than attempting to preserve state across potentially incompatible component versions

### 6.4 Context.md Versioning

Every time `context.md` is updated, the change is captured in the nested Git history:

```
$ cd web/apps/generated && git log --oneline
a1b2c3d refactor: updated Weather App — added humidity display
e4f5g6h feat: generated Weather app
9i8j7k6 init: generated apps workspace
```

This gives full version history of every design decision for every app.

---

## 7. Session Mapping Strategy

### 7.1 Session Types

| Session | windowId | Lifecycle | Agent |
|---|---|---|---|
| System Architect | `system-architect` | Persistent (created on boot) | Global architect persona |
| App Owner | `app-owner-{appId}` | On-demand (created on ✨ click) | Per-app persona |
| Debug/Terminal | `win-{uuid}` | On-demand | Generic agent (if any) |

### 7.2 Gateway Session Management

Each agent session maps to a separate OpenClaw Gateway session. The Gateway manages context windows independently:

```
Gateway Sessions:
├── system-architect     → system-architect.md persona, full OS context
├── app-owner-weather    → weather/agent-prompt.md, weather/context.md, scoped tools
├── app-owner-notes      → notes/agent-prompt.md, notes/context.md, scoped tools
└── win-abc123           → terminal session (if agent-enabled)
```

### 7.3 Tool Scoping

Agents receive different tool sets based on their role:

**System Architect tools:**
- `scaffold` — create new App Bundle
- `unscaffold` — delete App Bundle
- `system_health` — query system metrics
- `list_apps` — enumerate registered apps
- `read_file` — read any file in the project (read-only)

**App Owner tools:**
- `update_app` — modify source code + context (scoped to own app). **v1.3:** This is intentionally NOT named `scaffold` — the App Owner must not believe it can create new apps. The backend translates `update_app` → `POST /api/scaffold` with PATCH/Merge semantics (omitted fields preserve existing files).
- `read_context` — read current context.md
- `list_assets` — list assets in own bundle
- `add_asset` — add asset to own bundle

---

## 8. App Data Persistence — OS Storage API (v1.1)

### 8.1 The Problem

In Phase 2, we blocked `localStorage` and `sessionStorage` access in generated apps (security deny pattern). This was correct — direct browser storage is a shared global namespace that generated apps could abuse to leak data or conflict with each other.

But generated apps need to persist user data: saved notes, selected cities, theme preferences, form drafts. Without a storage API, every app loses its state on page reload.

### 8.2 The Solution: `useAppStorage<T>()` Hook

Gamma OS provides a **system-level React hook** injected into the app runtime environment. Generated apps use it instead of `localStorage`:

```typescript
/**
 * OS-provided hook for app data persistence.
 * Syncs state to the backend Redis store via REST API.
 *
 * @param appId   — the app's identifier (e.g., "weather")
 * @param key     — storage key within the app's namespace (e.g., "selectedCities")
 * @param initial — default value if no stored data exists
 * @returns [value, setValue, { loading, error }]
 */
function useAppStorage<T>(
  appId: string,
  key: string,
  initial: T,
): [T, (val: T | ((prev: T) => T)) => void, { loading: boolean; error: string | null }];
```

**Usage in a generated app:**

```tsx
import { useAppStorage } from '@gamma/os';

export function WeatherApp() {
  const [cities, setCities] = useAppStorage<string[]>('weather', 'selectedCities', ['Hanoi']);
  const [unit, setUnit] = useAppStorage<'C' | 'F'>('weather', 'tempUnit', 'C');

  return (
    <div>
      {cities.map(city => <CityCard key={city} city={city} unit={unit} />)}
      <button onClick={() => setCities(prev => [...prev, 'Kyiv'])}>Add Kyiv</button>
    </div>
  );
}
```

### 8.3 Backend: Storage Endpoints

Two new endpoints in the kernel:

```
GET    /api/app-data/:appId/:key     → { value: T }
PUT    /api/app-data/:appId/:key     → { ok: true }  (body: { value: T })
```

**Redis key schema:**

```
gamma:app-data:<appId>:<key>   →   JSON string
```

| Key | Type | TTL | Description |
|---|---|---|---|
| `gamma:app-data:<appId>:<key>` | String | — | Per-app, per-key JSON-serialized value |

**Controller:**

```typescript
// kernel/src/app-data/app-data.controller.ts
@Controller('api/app-data')
export class AppDataController {

  @Get(':appId/:key')
  async get(
    @Param('appId') appId: string,
    @Param('key') key: string,
  ): Promise<{ value: unknown }> {
    const safeAppId = appId.replace(/[^a-z0-9-]/gi, '');
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '');
    const raw = await this.redis.get(`gamma:app-data:${safeAppId}:${safeKey}`);
    return { value: raw ? JSON.parse(raw) : null };
  }

  @Put(':appId/:key')
  async put(
    @Param('appId') appId: string,
    @Param('key') key: string,
    @Body() body: { value: unknown },
  ): Promise<{ ok: true }> {
    const safeAppId = appId.replace(/[^a-z0-9-]/gi, '');
    const safeKey = key.replace(/[^a-z0-9_-]/gi, '');

    // Enforce 64 KB max value size per key (v1.4).
    const json = JSON.stringify(body.value);
    if (json.length > 65536) {
      // In real code, use Nest's BadRequestException
      throw new Error('Value too large for app-data key (max 64 KB)');
    }

    // Enforce max 50 keys per app (v1.4).
    // Using KEYS is acceptable here because of the strict per-app key cap.
    const existingKeys = await this.redis.keys(`gamma:app-data:${safeAppId}:*`);
    const keyAlreadyExists = existingKeys.includes(`gamma:app-data:${safeAppId}:${safeKey}`);
    if (!keyAlreadyExists && existingKeys.length >= 50) {
      // In real code, use Nest's TooManyRequestsException
      throw new Error('Too many app-data keys for this app (max 50)');
    }

    await this.redis.set(
      `gamma:app-data:${safeAppId}:${safeKey}`,
      json,
    );
    return { ok: true };
  }
}
```

### 8.4 Hook Implementation

```typescript
// web/hooks/useAppStorage.ts
import { useState, useEffect, useCallback, useRef } from 'react';

// Resolve API base in a way that is safe for SSR/tests and proxy deployments (v1.4).
function resolveApiBase(): string {
  // Prefer explicit config first (Vite env or global), then sensible defaults.
  const envBase =
    (typeof window !== 'undefined' && (window as any).__GAMMA_API_BASE__) ??
    (typeof import.meta !== 'undefined' &&
      // @ts-expect-error Vite env at runtime
      import.meta.env?.VITE_API_BASE);

  if (envBase && typeof envBase === 'string' && envBase.length > 0) {
    return envBase.replace(/\/+$/, '');
  }

  // No window → probably SSR/test: fall back to localhost:3001.
  if (typeof window === 'undefined') {
    return 'http://localhost:3001';
  }

  // Local dev: kernel usually runs on :3001.
  if (window.location.hostname === 'localhost') {
    return 'http://localhost:3001';
  }

  // Default: rely on same-origin proxy, use relative /api paths.
  return '';
}

export function useAppStorage<T>(
  appId: string,
  key: string,
  initial: T,
): [T, (val: T | ((prev: T) => T)) => void, { loading: boolean; error: string | null }] {
  const [value, setLocal] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const apiBase = resolveApiBase();
  const apiPrefix = apiBase ? apiBase : '';

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${apiPrefix}/api/app-data/${appId}/${key}`);
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.value !== null) {
            setLocal(data.value as T);
          }
          if (!cancelled) {
            // Successful response should clear any previous error (v1.4).
            setError(null);
          }
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiPrefix, appId, key]);

  // Persist on change (debounced 500ms)
  const setValue = useCallback(
    (val: T | ((prev: T) => T)) => {
      setLocal((prev) => {
        const next = typeof val === 'function' ? (val as (p: T) => T)(prev) : val;

        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          fetch(`${apiPrefix}/api/app-data/${appId}/${key}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ value: next }),
          })
            .then(() => {
              // Successful persist clears previous error (v1.4).
              setError(null);
            })
            .catch((err) => setError(String(err)));
        }, 500);

        return next;
      });
    },
    [apiPrefix, appId, key],
  );

  // Clear any pending debounce timer on unmount to avoid setState on unmounted component (v1.4).
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  return [value, setValue, { loading, error }];
}
```

### 8.5 Security Constraints

| Rule | Enforcement |
|---|---|
| Apps can only access their own `appId` namespace | Backend validates `appId` matches the calling app's registered ID |
| Keys are alphanumeric + hyphens/underscores only | `safeKey = key.replace(/[^a-z0-9_-]/gi, '')` |
| Max value size: 64 KB per key | Backend rejects `PUT` if `JSON.stringify(value).length > 65536` |
| Max keys per app: 50 | Backend checks `KEYS gamma:app-data:<appId>:*` count before write |
| No cross-app reads | Endpoint only accepts the app's own `appId` |

### 8.6 Module Resolution: `@gamma/os` Alias (v1.2)

Generated apps import the storage hook as `import { useAppStorage } from '@gamma/os'`. This virtual module must be resolved by Vite at build time.

**Vite config (`web/vite.config.ts`):**

```typescript
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@gamma/os': path.resolve(__dirname, 'hooks/os-api.ts'),
    },
  },
});
```

**The barrel export (`web/hooks/os-api.ts`):**

```typescript
// @gamma/os — OS-level APIs for generated applications
export { useAppStorage } from './useAppStorage';
// Future exports: useAppTheme, useOSNotification, useWindowSize, etc.
```

This pattern allows us to expand the OS API surface over time without changing generated app imports.

### 8.7 Update to Security Deny Patterns

The `validateSource()` security scanner (Phase 2) already blocks `localStorage` and `sessionStorage`. No changes needed — generated apps must use `useAppStorage` instead.

Add to the System Architect's scaffold prompt:
```
- For data persistence, use `useAppStorage` from '@gamma/os' — NEVER use localStorage or sessionStorage
```

---

## 9. Implementation Order (Updated v1.1)

| Priority | Task | Estimated Effort |
|---|---|---|
| P0 | Bundle directory structure in ScaffoldService | 0.5 day |
| P0 | `<AgentChat />` reusable component | 1 day |
| P0 | Menu Bar with System Architect trigger | 0.5 day |
| P0 | Window frame ✨ button + embedded chat | 1 day |
| P1 | System Architect persona + session bootstrap | 0.5 day |
| P1 | App Owner context injection in sendMessage | 1 day |
| P1 | ScaffoldRequest update (contextDoc, agentPrompt) | 0.5 day |
| P1 | App registry update (bundlePath, hasAgent) | 0.25 day |
| P2 | Tool scoping per agent role | 1 day |
| P2 | context.md auto-update on App Owner modifications | 0.5 day |
| P2 | System health in menu bar (polling + indicator) | 0.5 day |
| P1 | **v1.1** App Storage API — backend endpoints + Redis | 0.5 day |
| P1 | **v1.1** `useAppStorage` hook implementation | 0.5 day |
| P1 | **v1.1** English-only + token budget enforcement in scaffold prompts | 0.25 day |

**Total Phase 3 estimate: ~8.5 developer-days**

---

## 10. File Structure (Phase 3 Additions)

```
gamma-os/
├── docs/
│   ├── PHASE2_BACKEND_SPEC.md
│   ├── PHASE3_FRONTEND_AND_AGENTS.md       ← this document
│   ├── system-architect.md                 ← System Architect persona
│   ├── IMPLEMENTATION_PLAN.md              ← Phase 2 implementation plan
│   └── IMPLEMENTATION_PLAN_PHASE3.md       ← Phase 3 implementation plan (executes this spec)
├── kernel/
│   └── src/
│       ├── sessions/
│       │   └── sessions.service.ts      ← context injection for App Owners
│       └── app-data/
│           ├── app-data.controller.ts   ← NEW v1.1: GET/PUT /api/app-data/:appId/:key
│           └── app-data.module.ts       ← NEW v1.1
├── web/
│   ├── hooks/
│   │   └── useAppStorage.ts             ← NEW v1.1: OS Storage API hook
│   ├── components/
│   │   ├── MenuBar.tsx                  ← NEW: top menu bar
│   │   ├── AgentChat.tsx                ← NEW: reusable chat component
│   │   ├── ChatHeader.tsx               ← NEW: status + title
│   │   ├── ChatInput.tsx                ← NEW: message input
│   │   ├── MessageList.tsx              ← NEW: scrollable message history
│   │   ├── WindowNode.tsx               ← UPDATED: ✨ button + embedded chat
│   │   └── TitleBar.tsx                 ← UPDATED: agent toggle button
│   └── apps/
│       └── generated/
│           ├── weather/                 ← App Bundle
│           │   ├── WeatherApp.tsx
│           │   ├── context.md
│           │   ├── agent-prompt.md
│           │   └── assets/
│           └── .git/
└── packages/
    └── gamma-types/
        └── index.ts                     ← updated with Phase 3 types
```

---

## 11. Open Questions

| # | Question | Impact |
|---|---|---|
| 1 | Should the App Owner agent be able to spawn sub-agents (e.g., a "data fetcher" agent)? | Agent complexity, Gateway session count |
| 2 | Should context.md have a max size limit to prevent context window overflow? | Token economics, summarization strategy |
| 3 | Should the System Architect be able to observe App Owner conversations for debugging? | Memory bus integration, privacy model |
| ~~4~~ | ~~Hot-reload strategy~~ → **Resolved v1.2:** Full Remount via `key={updatedAt}` (see §6.3) | — |
| 5 | Should we support multi-file components (e.g., `WeatherApp.tsx` + `WeatherCard.tsx`)? | Bundle complexity, import resolution |

---

## 12. Summary

Phase 3 transforms Gamma OS from a "browser OS with AI streaming" into a **self-evolving agentic operating system**:

- **App Bundles** give generated apps memory and identity
- **System Architect** builds and oversees the OS
- **App Owners** maintain and evolve individual apps
- **`<AgentChat />`** unifies all agent interactions into one reusable component
- The existing Phase 2 pipeline (SSE, sessions, scaffold, GC) requires minimal changes — Phase 3 is primarily a frontend and prompt engineering layer

**This specification is ready for implementation review.**
