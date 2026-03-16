# Chat History Persistence — Implementation Plan

**Status:** Proposed  
**Author:** System Architect  
**Date:** 2026-03-16  
**Priority:** High

---

## Problem

Every time the user refreshes the browser (F5), all chat message history in every open agent window disappears. The `useAgentStream` hook stores messages in React `useState`, which is pure in-memory state — no persistence layer exists.

---

## Goal

When a user opens or refreshes a chat window, the last **N messages** (suggested: 30) are loaded automatically, so the conversation appears continuous.

---

## Chosen Approach: OpenClaw `sessions_history` API

### Why not `localStorage`

`localStorage` only stores what the current browser tab has seen. It misses messages from other sessions, other browsers, and anything that happened before the tab was opened. It also gets cleared when the user wipes browser data.

### Why OpenClaw history API

OpenClaw persists every message turn to a `.jsonl` transcript file on disk and keeps it indexed in Redis. It exposes a `sessions_history` endpoint (used internally by the `sessions_history` tool) that returns the full message log for any session key.

This is the single source of truth — same data the agent itself sees.

---

## Architecture Overview

```
Browser (F5 reload)
    │
    ▼
useAgentStream(windowId)
    │
    ├─► [1] GET /api/history/:windowId          ← new gamma-core proxy endpoint
    │         │
    │         ▼
    │    gamma-core ContextInjectorService
    │         │
    │         └─► OpenClaw Gateway WS
    │               method: "sessions.history"
    │               params: { sessionKey, limit: 30 }
    │               returns: { messages: [...] }
    │
    └─► [2] SSE /api/stream/:windowId           ← existing real-time stream
              (new messages arrive as before)
```

On mount: fetch history → populate `messages[]` → connect SSE for new messages.

---

## OpenClaw sessions_history API

### Session key format

OpenClaw session keys follow the pattern:

```
agent:{agentId}:{channel}
```

For gamma-ui webchat windows, the pattern is:

```
agent:{windowId}:main
```

Where `windowId` is the agent identifier used in gamma-ui (e.g. `app-owner-terminal`, `system-architect`).

### Gateway WebSocket call

OpenClaw exposes history via its internal WebSocket protocol. The gamma-core gateway client (`gateway-ws.service.ts`) already has an established WS connection to OpenClaw. The call:

```json
{
  "type": "req",
  "id": "<uuid>",
  "method": "session.history",
  "params": {
    "sessionKey": "agent:{windowId}:main",
    "limit": 30,
    "includeTools": false
  }
}
```

**Response shape:**

```typescript
interface OpenClawHistoryResponse {
  sessionKey: string;
  messages: OpenClawMessage[];
  truncated: boolean;
  droppedMessages: boolean;
  contentTruncated: boolean;
  bytes: number;
}

interface OpenClawMessage {
  role: "user" | "assistant";
  content: Array<{
    type: "text" | "toolCall" | "toolResult";
    text?: string;       // for type="text"
    name?: string;       // for type="toolCall"
    id?: string;
  }>;
  timestamp: number;     // Unix ms
  model?: string;
  stopReason?: string;
}
```

### Transcript JSONL fallback

If the WS method is unavailable, gamma-core can read the transcript file directly. The session list endpoint returns `transcriptPath` for each session:

```
GET /api/sessions/active   →  [{ sessionKey, transcriptPath, ... }]
```

Each JSONL line with `"type":"message"` contains `message.role` and `message.content`. This is a reliable fallback.

---

## Implementation Steps

### Step 1 — gamma-core: History Proxy Endpoint

**File:** `apps/gamma-core/src/sessions/sessions.controller.ts`

Add new route:

```typescript
@Get(':windowId/history')
async getHistory(
  @Param('windowId') windowId: string,
  @Query('limit') limit = 30,
): Promise<{ messages: ChatHistoryMessage[] }> {
  const messages = await this.sessions.getHistory(windowId, Number(limit));
  return { messages };
}
```

**File:** `apps/gamma-core/src/sessions/sessions.service.ts`

Add `getHistory(windowId, limit)`:

1. Resolve session key: `agent:${windowId}:main`
2. Call OpenClaw Gateway via existing WS client: `method: "session.history"`, params `{ sessionKey, limit, includeTools: false }`
3. **Fallback:** if WS call fails → read `transcriptPath` JSONL directly from disk, parse `type=message` lines
4. Map `OpenClawMessage[]` → `ChatHistoryMessage[]` (see mapping below)
5. Return last `limit` entries, oldest-first

**ChatHistoryMessage shape** (gamma-core internal):

```typescript
interface ChatHistoryMessage {
  id: string;          // derived from timestamp + index
  role: "user" | "assistant";
  kind: "answer" | "user";
  text: string;
  ts: number;
  fromHistory: true;   // flag so UI can style differently if needed
}
```

**Mapping rules:**

| OpenClaw field | ChatHistoryMessage field | Notes |
|---|---|---|
| `role` | `role` | direct |
| `content[].text` (first text block) | `text` | concatenate if multiple |
| `timestamp` | `ts` | |
| `"assistant"` role | `kind: "answer"` | |
| `"user"` role | `kind: "user"` | strip system injection prefix (e.g. `[LIVE SYSTEM STATE]` block) |
| generated | `id` | `"h-${ts}-${index}"` |

**Skip these messages:**
- `role: "assistant"` with no `type: "text"` content (tool-only turns)
- `role: "user"` messages that are pure system injections (starts with `System:` or `[LIVE SYSTEM STATE]`)

---

### Step 2 — gamma-ui: useAgentStream Hook Update

**File:** `apps/gamma-ui/hooks/useAgentStream.ts`

**Changes:**

```typescript
// On mount: fetch history before connecting SSE
useEffect(() => {
  let cancelled = false;

  async function loadHistory() {
    try {
      const res = await fetch(`${API_BASE}/api/sessions/${windowId}/history?limit=30`);
      if (!res.ok) return;
      const data = await res.json() as { messages: ChatHistoryMessage[] };
      if (!cancelled && data.messages.length > 0) {
        setMessages(data.messages);
      }
    } catch {
      // Best-effort — history load failure must never block chat
    }
  }

  loadHistory();
  return () => { cancelled = true; };
}, [windowId]);
```

**Deduplication on SSE:**

When the SSE stream starts and echoes a `user_message` event, check if a message with the same `ts` already exists in `messages[]` (from history load) and skip the duplicate.

```typescript
case "user_message": {
  setMessages((prev) => {
    // Deduplicate: skip if already loaded from history
    if (prev.some((m) => m.ts === event.ts && m.role === "user")) return prev;
    return [...prev, { id: `u-${event.ts}`, role: "user", text: event.text, ts: event.ts }];
  });
  break;
}
```

---

### Step 3 — gamma-types: Shared Types

**File:** `packages/gamma-types/index.ts`

Add:

```typescript
export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  kind: 'answer' | 'user';
  text: string;
  ts: number;
  fromHistory: true;
}

export interface SessionHistoryResponse {
  messages: ChatHistoryMessage[];
}
```

---

### Step 4 — Optional: Loading State in UI

**File:** `apps/gamma-ui/components/AgentChat.tsx` (or `MessageList.tsx`)

Show a subtle "Loading history..." skeleton while the initial fetch is in flight. This prevents the jarring "empty → populated" flash.

```typescript
const [historyLoading, setHistoryLoading] = useState(true);

// After history load completes:
setHistoryLoading(false);
```

Render a minimal placeholder when `historyLoading && messages.length === 0`.

---

## File Change Summary

| File | Change |
|---|---|
| `apps/gamma-core/src/sessions/sessions.controller.ts` | Add `GET :windowId/history` endpoint |
| `apps/gamma-core/src/sessions/sessions.service.ts` | Add `getHistory()` method with WS call + JSONL fallback |
| `apps/gamma-ui/hooks/useAgentStream.ts` | Load history on mount, deduplicate SSE echo |
| `packages/gamma-types/index.ts` | Add `ChatHistoryMessage`, `SessionHistoryResponse` types |
| `apps/gamma-ui/components/AgentChat.tsx` | Optional: history loading skeleton |

---

## Risk & Mitigations

| Risk | Mitigation |
|---|---|
| OpenClaw WS method `session.history` not publicly documented | JSONL fallback reads transcript file directly — always available |
| Large history loads slowing window open | Hard limit of 30 messages; increase only if needed |
| SSE duplicating messages already in history | `ts`-based deduplication in `user_message` handler |
| System injection text leaking into chat UI | Strip messages starting with `System:` or `[LIVE SYSTEM STATE]` in mapping layer |
| gamma-core can't reach OpenClaw Gateway | Graceful degradation — empty history, chat still works normally |

---

## Success Criteria

- [ ] Open any agent window → last 30 messages load instantly
- [ ] Press F5 → history is still there
- [ ] New messages appear via SSE with no duplicates
- [ ] If backend is unreachable → chat opens empty (no crash, no error shown)
- [ ] System injection messages are NOT visible in chat history

---

## Out of Scope

- Full conversation search
- History pagination / infinite scroll
- Cross-device sync (already handled by backend — same API on any browser)
- Message deletion / editing
