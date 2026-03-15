# [DONE] Architect Chat Bi-Directional Communication Lifecycle

**Version:** 1.0  
**Status:** COMPLETE
**Completion Date:** 2026-03-15
**Archived from:** `docs/plans/architect-chat-lifecycle.md`  
**Audience:** Backend Developer

---

## 1. Lifecycle Trace: Message Flow

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  CLIENT (ArchitectWindow / useAgentStream)                                           │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  POST /api/sessions/:windowId/send { message }
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  SessionsController.send()                                                            │
│  → SessionsService.sendMessage(windowId, message)                                     │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  1. Echo user_message → gamma:sse:{windowId}  (instant UI feedback)
    │  2. Write to gamma:memory:bus (decision tree)
    │  3. GatewayWsService.sendMessage(sessionKey, message, windowId)
    │  4. Update lastEventAt
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  GatewayWsService.sendMessage()                                                       │
│  → type: 'req', method: 'chat.send', params: { sessionKey, message, idempotencyKey }  │
│  → Track inflight: frameId → { windowId, sessionKey }                                │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  WebSocket send (fire-and-forget ack wait)
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  OpenClaw Gateway                                                                    │
│  → Ack: type 'res', ok: true (quick, <2s)                                             │
│  → Agent loop: lifecycle_start → thinking → assistant → tool → lifecycle_end          │
│  → Stream events: type 'event', event 'agent', payload: GWAgentEventPayload          │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  Events (stream: lifecycle | thinking | assistant | tool)
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  GatewayWsService.handleFrame()                                                      │
│  → kind === 'runtime-agent' → enqueueAgentEvent(payload)                             │
│  → handleAgentEvent: sessionToWindow.get(sessionKey) → windowId                      │
│  → pushSSE(gamma:sse:{windowId}, { type, windowId, runId, ... })                       │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  Redis XADD gamma:sse:{windowId}
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  SseController / StreamBatcher                                                        │
│  → XREAD BLOCK on gamma:sse:{windowId} + gamma:sse:broadcast                          │
│  → Batcher: thinking/assistant_delta debounced 50ms; rest pass through               │
└─────────────────────────────────────────────────────────────────────────────────────┘
    │
    │  EventSource SSE
    ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  useAgentStream(windowId)                                                             │
│  → lifecycle_start, thinking, assistant_delta, tool_call, tool_result, lifecycle_end  │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Paths

| Path | Component | Responsibility |
|------|-----------|----------------|
| **Request** | SessionsService | Echo user_message → SSE; write memory bus; forward to Gateway |
| **Dispatch** | GatewayWsService | Send chat.send frame; track inflight for error routing |
| **Ack** | OpenClaw | Respond with `res` (ok: true) quickly to keep connection alive |
| **Response** | handleAgentEvent | sessionKey → windowId via sessionToWindow; push to gamma:sse:{windowId} |
| **Delivery** | SseController | XREAD → StreamBatcher → EventSource |

---

## 3. Session Key Normalization

OpenClaw may send `sessionKey` as `agent:main:system-architect`. The Gateway normalizes:

```typescript
if (sessionKey.startsWith('agent:main:'))
  sessionKey = sessionKey.replace('agent:main:', '');
else if (sessionKey.startsWith('agent:'))
  sessionKey = sessionKey.replace(/^agent:[^:]+:/, '');
```

Registration: `registerWindowSession('system-architect', 'system-architect')` on session create.

---

## 4. Timeout Management

- **chat.send ack**: OpenClaw SHOULD respond with `res` within ~2s. Gamma uses 10s timeout as safety.
- **Non-blocking**: HTTP returns 202 immediately after dispatch; ack is handled asynchronously.
- **Error propagation**: If `res.ok === false`, push `lifecycle_error` to `gamma:sse:{windowId}`.

---

## 5. Resilience

- **Gateway disconnected**: Push `lifecycle_error` to SSE, return 503 from send endpoint.
- **No session mapping**: Log warning; event dropped (sessionKey not in sessionToWindow).
- **StreamBatcher**: 50ms debounce for thinking/assistant_update to prevent React render storms.
