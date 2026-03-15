# Phase 4: Platform Autonomy — Implementation Plan (Part 1)

**Workstreams:** Agent Discovery & Visualization (P1) + Cross-Agent Message Bus (P1)
**Date:** 2026-03-15
**Status:** Ready for execution

---

## 1. Agent Registry (Redis Schema)

### Текущее состояние

Сессии уже хранятся в двух местах:
- `gamma:sessions` — hash: `windowId → JSON(WindowSession)` (CRUD-маппинг окон)
- `gamma:session-registry:<sessionKey>` — hash: телеметрия (status, tokens, runCount)

Этого **недостаточно** для Agent Discovery: нет описания capabilities, роли, доступности для IPC. Нужен выделенный Agent Registry.

### Новая схема: `gamma:agent-registry:<agentId>`

Redis Hash с TTL 24h (обновляется при каждом heartbeat/upsert):

| Field              | Type     | Описание                                                    |
|--------------------|----------|-------------------------------------------------------------|
| `agentId`          | string   | Уникальный идентификатор (`system-architect`, `app-owner-notes`) |
| `role`             | string   | `architect` \| `app-owner` \| `daemon`                       |
| `sessionKey`       | string   | Ключ активной сессии                                         |
| `windowId`         | string   | Привязанное окно (пусто для daemon)                          |
| `appId`            | string   | Связанное приложение (пусто для architect)                   |
| `status`           | string   | `idle` \| `running` \| `error` \| `aborted` \| `offline`     |
| `capabilities`     | JSON     | `["scaffold","shell_exec","fs_read"]` — доступные инструменты |
| `lastHeartbeat`    | number   | Unix timestamp последнего признака активности                 |
| `lastActivity`     | string   | Краткое описание последнего действия (`"tool_call: scaffold"`) |
| `acceptsMessages`  | boolean  | Готов ли агент принимать IPC-сообщения                        |
| `createdAt`        | number   | Unix timestamp создания                                       |

**Ключ для перечисления:** `gamma:agent-registry:index` — Redis Set с `agentId` всех зарегистрированных агентов.

### Связь с существующими структурами

- `SessionRegistryService` остаётся для телеметрии (токены, runCount).
- `AgentRegistryService` (новый) — для discovery, capabilities, IPC-readiness.
- При создании сессии: `SessionsService.create()` вызывает `AgentRegistryService.register()`.
- При завершении: `SessionsService.remove()` → `AgentRegistryService.unregister()`.

---

## 2. API Endpoint: `GET /api/system/agents`

### Контроллер

Добавить в `SystemController` (`apps/gamma-core/src/system/system.controller.ts`):

```typescript
@Get('agents')
@UseGuards(SystemAppGuard)
async getAgents(): Promise<AgentRegistryEntry[]> {
  return this.agentRegistryService.getAll();
}
```

### Response Schema (`AgentRegistryEntry`)

Добавить в `packages/gamma-types/index.ts`:

```typescript
export interface AgentRegistryEntry {
  agentId: string;
  role: 'architect' | 'app-owner' | 'daemon';
  sessionKey: string;
  windowId: string;
  appId: string;
  status: AgentStatus | 'offline';
  capabilities: string[];
  lastHeartbeat: number;
  lastActivity: string;
  acceptsMessages: boolean;
  createdAt: number;
}
```

### SSE Broadcast

При любом изменении в Agent Registry — публикация `agent_registry_update` в `gamma:sse:broadcast`. Frontend получает обновления через SSE (аналогично `session_registry_update`).

---

## 3. Sentinel UI: вкладка "Agents"

### Расположение

Файл: `apps/gamma-ui/apps/system/sentinel/SentinelApp.tsx`

### Дизайн

Новая **четвёртая вкладка** «Agents» в Sentinel (после Session Snapshots, File Backups, System Activity).

#### Компоненты вкладки

1. **Agent Grid** — таблица со столбцами:
   - `Agent` (agentId, с иконкой роли)
   - `Role` (architect / app-owner / daemon)
   - `Status` (цветной badge: green=idle/running, yellow=error, red=offline)
   - `Heartbeat` (relative time: "3s ago", "1m ago"; красный если >30s)
   - `Last Activity` (truncated string)
   - `IPC` (green dot если `acceptsMessages=true`)

2. **Agent Detail Panel** (при клике на строку):
   - Полный список capabilities
   - Связанная сессия (sessionKey, windowId)
   - Текущие токен-метрики (подтянуть из SessionRegistry)
   - Кнопка "Send Test Message" (для Phase 4 Message Bus)

#### Frontend Hook

Новый хук `useAgentRegistry()` в `apps/gamma-ui/hooks/useAgentRegistry.ts`:

```typescript
export function useAgentRegistry() {
  // 1. Fetch GET /api/system/agents
  // 2. Subscribe to SSE broadcast for agent_registry_update
  // 3. Return { agents, loading, error, refresh }
}
```

Паттерн идентичен существующему `useSessionRegistry()`.

---

## 4. Cross-Agent Message Bus

### Redis Channel Structure

| Channel                          | Тип          | Назначение                                   |
|----------------------------------|--------------|----------------------------------------------|
| `gamma:agent:broadcast`          | Redis Stream | Широковещательные сообщения для всех агентов  |
| `gamma:agent:<agentId>:inbox`    | Redis Stream | Персональный почтовый ящик конкретного агента |

**Формат сообщения (IPC Envelope):**

```typescript
export interface AgentMessage {
  id: string;           // ULID
  from: string;         // agentId отправителя
  to: string;           // agentId получателя | '*' для broadcast
  type: 'task_request' | 'task_response' | 'notification' | 'query';
  subject: string;      // Краткое описание ("review bundle notes")
  payload: string;      // JSON-encoded тело сообщения
  ts: number;           // Unix timestamp
  replyTo?: string;     // id сообщения, на которое это ответ
  ttl?: number;         // Время жизни в секундах (default: 3600)
}
```

Добавить в `REDIS_KEYS` (`packages/gamma-types/index.ts`):

```typescript
AGENT_BROADCAST: 'gamma:agent:broadcast',
AGENT_INBOX: (agentId: string) => `gamma:agent:${agentId}:inbox`,
AGENT_REGISTRY: (agentId: string) => `gamma:agent-registry:${agentId}`,
AGENT_REGISTRY_INDEX: 'gamma:agent-registry:index',
```

### Retention Policy

- `gamma:agent:<agentId>:inbox` — MAXLEN ~100 (последние 100 сообщений).
- `gamma:agent:broadcast` — MAXLEN ~200.
- TTL на отдельных сообщениях не нужен — MAXLEN достаточно для ротации.

---

## 5. MessageBusService

### Расположение

Новый сервис: `apps/gamma-core/src/messaging/message-bus.service.ts`
Новый модуль: `apps/gamma-core/src/messaging/messaging.module.ts`

### Основные методы

```typescript
@Injectable()
export class MessageBusService {
  // Отправить сообщение конкретному агенту
  async send(from: string, to: string, type: string, subject: string, payload: object): Promise<string>;

  // Широковещательное сообщение
  async broadcast(from: string, subject: string, payload: object): Promise<string>;

  // Получить непрочитанные сообщения из inbox
  async readInbox(agentId: string, since?: string): Promise<AgentMessage[]>;

  // Получить broadcast-сообщения
  async readBroadcast(since?: string): Promise<AgentMessage[]>;

  // Подписаться на новые сообщения (для real-time доставки)
  async subscribe(agentId: string, handler: (msg: AgentMessage) => void): void;
}
```

### Валидация

- `send()` проверяет через `AgentRegistryService`, что целевой агент существует и `acceptsMessages=true`.
- Если агент offline — сообщение всё равно сохраняется в inbox (доставка при следующем подключении).

---

## 6. Message Tool (Agent Syscall)

### Определение

Новый инструмент `send_message`, доступный агентам через Gateway:

```typescript
{
  name: 'send_message',
  description: 'Send a message to another active agent in the system',
  input_schema: {
    type: 'object',
    properties: {
      to:      { type: 'string', description: 'Target agentId' },
      type:    { type: 'string', enum: ['task_request', 'notification', 'query'] },
      subject: { type: 'string', description: 'Brief subject line' },
      payload: { type: 'object', description: 'Message body (JSON)' }
    },
    required: ['to', 'type', 'subject', 'payload']
  }
}
```

### Обработка в Gateway

В `GatewayWsService`, добавить обработчик `send_message` в секцию tool_call:

1. Вызвать `MessageBusService.send(sessionKey, to, type, subject, payload)`.
2. Вернуть `tool_result` с confirmation (`{ delivered: true, messageId: "..." }`).
3. Если целевой агент не найден — вернуть ошибку в `tool_result`.

### Allowlist

- Добавить `send_message` в allowlist для **System Architect**.
- Для **App Owner** — добавить позже, после валидации паттернов использования.

---

## 7. Live Context Injection: Available Agents

### Обновление `ContextInjectorService`

Файл: `apps/gamma-core/src/scaffold/context-injector.service.ts`

Метод `getLiveContext()` уже собирает блок `[LIVE SYSTEM STATE]`. Добавить новую секцию **Available Agents**:

```
── Available Agents ──
| agent                | role        | status  | accepts_ipc |
| system-architect     | architect   | idle    | yes         |
| app-owner-notes      | app-owner   | running | yes         |
| app-owner-browser    | app-owner   | idle    | yes         |

To communicate, use the send_message tool with the target agentId.
```

### Реализация

1. `ContextInjectorService` получает инъекцию `AgentRegistryService`.
2. В `getLiveContext()`, после секции активных сессий, добавить вызов `agentRegistryService.getAll()`.
3. Отфильтровать текущего агента (не показывать себя в списке).
4. Форматировать как компактную таблицу.

---

## Execution Loops

### Loop 1: Agent Registry & API (Backend Foundation)

**Цель:** Создать `AgentRegistryService`, тип `AgentRegistryEntry`, endpoint `GET /api/system/agents`, интеграция с жизненным циклом сессий.

**Файлы:**

| Действие    | Файл                                                                |
|-------------|---------------------------------------------------------------------|
| **Create**  | `apps/gamma-core/src/messaging/agent-registry.service.ts`           |
| **Create**  | `apps/gamma-core/src/messaging/messaging.module.ts`                 |
| **Modify**  | `packages/gamma-types/index.ts` — добавить `AgentRegistryEntry`, новые REDIS_KEYS |
| **Modify**  | `apps/gamma-core/src/system/system.controller.ts` — endpoint `/agents` |
| **Modify**  | `apps/gamma-core/src/system/system.module.ts` — импорт MessagingModule |
| **Modify**  | `apps/gamma-core/src/sessions/sessions.service.ts` — register/unregister при create/remove |
| **Modify**  | `apps/gamma-core/src/sessions/sessions.module.ts` — импорт MessagingModule |

**Success Criteria:**
- `GET /api/system/agents` возвращает список агентов с полными метаданными.
- При создании/удалении сессии запись в Agent Registry создаётся/удаляется автоматически.
- SSE broadcast `agent_registry_update` отправляется при каждом изменении.
- Redis TTL 24h корректно обновляется.

---

### Loop 2: Sentinel UI — Agents Tab

**Цель:** Добавить вкладку "Agents" в Sentinel с live-обновлением.

**Файлы:**

| Действие    | Файл                                                        |
|-------------|--------------------------------------------------------------|
| **Create**  | `apps/gamma-ui/hooks/useAgentRegistry.ts`                    |
| **Modify**  | `apps/gamma-ui/apps/system/sentinel/SentinelApp.tsx` — новая вкладка |

**Success Criteria:**
- Вкладка "Agents" отображает таблицу всех зарегистрированных агентов.
- Статус и heartbeat обновляются в реальном времени через SSE.
- При клике на строку — detail panel с capabilities и метриками.
- Auto-refresh каждые 10 секунд (аналогично другим вкладкам).

---

### Loop 3: Message Bus & IPC Tool

**Цель:** `MessageBusService`, Redis Streams для inbox/broadcast, инструмент `send_message`.

**Файлы:**

| Действие    | Файл                                                                |
|-------------|---------------------------------------------------------------------|
| **Create**  | `apps/gamma-core/src/messaging/message-bus.service.ts`              |
| **Modify**  | `apps/gamma-core/src/messaging/messaging.module.ts` — добавить MessageBusService |
| **Modify**  | `packages/gamma-types/index.ts` — добавить `AgentMessage` interface |
| **Modify**  | `apps/gamma-core/src/gateway/gateway-ws.service.ts` — обработчик `send_message` tool |

**Success Criteria:**
- System Architect может вызвать `send_message` и доставить сообщение в inbox целевого агента.
- Сообщения персистятся в Redis Streams с MAXLEN ротацией.
- Broadcast-сообщения доступны всем агентам.
- Ошибка при отправке offline/несуществующему агенту возвращается корректно в tool_result.

---

### Loop 4: Context Injection + Integration Testing

**Цель:** Обновить Live Context Injector, end-to-end интеграция всех компонентов.

**Файлы:**

| Действие    | Файл                                                                |
|-------------|---------------------------------------------------------------------|
| **Modify**  | `apps/gamma-core/src/scaffold/context-injector.service.ts` — секция Available Agents |
| **Modify**  | `apps/gamma-core/src/scaffold/scaffold.module.ts` — импорт MessagingModule |

**Success Criteria:**
- Каждый агент видит в своём контексте таблицу "Available Agents" (без себя).
- System Architect может обнаружить app-owner агента через контекст и отправить ему сообщение.
- Sentinel показывает обоих агентов, их статусы и IPC-активность.
- Полный цикл: Agent A видит Agent B в контексте → отправляет `send_message` → сообщение появляется в inbox Agent B.
