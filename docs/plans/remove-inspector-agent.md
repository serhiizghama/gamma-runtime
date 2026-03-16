# Plan: Remove Inspector Agent

> **Status:** Complete (Phases 1–7 executed, Phase 8 pending deploy)
> **Created:** 2026-03-16
> **Goal:** Полностью удалить агента Inspector и всю связанную с ним инфраструктуру (file watcher → consumer → review dispatch → tool scoping → audit logging).

---

## Обзор

Inspector — автоматический code-review daemon (Phase 4.2). При изменении файлов в jail-директориях FileWatcherService → Redis Stream → FileChangeConsumerService → создаёт/находит сессию Inspector → отправляет review-промпт → Inspector читает файлы и шлёт feedback через IPC.

Удаление затрагивает **10+ файлов** в backend, **2 файла** в UI и **2 документа**.

---

## Порядок удаления (по шагам)

### Phase 1: Удаление core-сервисов file-watching pipeline

Эти сервисы существуют **только** для Inspector. Удаляем целиком.

| # | Файл | Действие |
|---|------|----------|
| 1.1 | `apps/gamma-core/src/messaging/file-watcher.service.ts` | **Удалить файл** целиком |
| 1.2 | `apps/gamma-core/src/messaging/file-change-consumer.service.ts` | **Удалить файл** целиком |
| 1.3 | `apps/gamma-core/src/messaging/messaging.module.ts` | Убрать импорты и регистрацию `FileWatcherService`, `FileChangeConsumerService` из providers/exports |

### Phase 2: Удаление Inspector-логики из Sessions

| # | Файл | Действие |
|---|------|----------|
| 2.1 | `apps/gamma-core/src/sessions/sessions.service.ts` | Удалить: `GLOBAL_SESSION_IDENTITY.inspector`, метод `initializeAppInspectorSession()`, метод `ensureAppInspectorSession()`, ветку `'inspector'` в `resolveAgentRole()` |
| 2.2 | `apps/gamma-core/src/sessions/sessions.module.ts` | Удалить: role resolution `if (sessionKey === 'inspector')`, file-change consumer dispatcher registration block (строки ~104-131), back-fill inspector в agent registry sync |

> **⚠️ Внимание (шаг 2.2):** В `sessions.module.ts` есть логика, где inspector автоматически получает `supervisor: 'system-architect'` при back-fill agent registry sync. При удалении этого блока убедиться, что:
> - Не остаётся «битая» ссылка на `'inspector'` в supervisor-chain логике
> - `system-architect` не пытается опрашивать/ждать статус от inspector (проверить agent-registry на наличие обратных ссылок supervisor → supervised agents)
> - Если есть generic код типа `registry.getBySupervior('system-architect')` — он не упадёт из-за отсутствия inspector

### Phase 3: Удаление Inspector-логики из Gateway

| # | Файл | Действие |
|---|------|----------|
| 3.1 | `apps/gamma-core/src/gateway/gateway-ws.service.ts` | Удалить: константу `APP_INSPECTOR_TOOLS`, ветку inspector в `resolveAllowedTools()`, метод `appendQualityAuditLog()`, вызов appendQualityAuditLog на session end, маппинг `'inspector'` → `'agent:inspector:main'` в session key translation |
| 3.2 | `apps/gamma-core/src/gateway/tool-jail-guard.service.ts` | Удалить: ветку `if (sessionKey === 'inspector')` и весь метод `validateInspectorAccess()` |

### Phase 4: Удаление из Agent Registry и IPC

| # | Файл | Действие |
|---|------|----------|
| 4.1 | `apps/gamma-core/src/messaging/agent-registry.service.ts` | Убрать регистрацию inspector (agentId: `'inspector'`, role: `'daemon'`, capabilities: `['code_review', 'ipc']`) если она hardcoded; проверить нет ли daemon role зависимостей |
| 4.2 | `apps/gamma-core/src/messaging/message-bus.service.ts` | Проверить — если нет специфичной inspector-логики, оставить как есть (IPC используется и другими агентами) |

### Phase 5: Удаление типов и констант

| # | Файл | Действие |
|---|------|----------|
| 5.1 | `packages/gamma-types/index.ts` | Удалить `FILE_CHANGED_STREAM` из `REDIS_KEYS` если он используется только Inspector pipeline. Проверить `AgentRole` на наличие `'daemon'` — удалить если Inspector единственный daemon |

### Phase 6: Удаление из UI и обновление промптов агентов

| # | Файл | Действие |
|---|------|----------|
| 6.1 | `apps/gamma-ui/apps/system/agent-monitor/AgentMonitorApp.tsx` | Убрать Inspector pane/секцию (строки ~164-215), убрать упоминания inspector из компонента |
| 6.2 | `apps/gamma-ui/apps/system/agent-monitor/context.md` | Убрать описание inspector pane из контекста |
| 6.3 | `apps/gamma-ui/apps/system/director/DirectorApp.tsx` | Проверить — если Inspector визуализируется как node в agent tree, убрать |
| 6.4 | `apps/gamma-ui/apps/system/director/agent-prompt.md` | Проверить на упоминания inspector в промпте director'а |
| 6.5 | `docs/agents/system-architect.md` | **Обновить промпт Архитектора.** Убрать все упоминания Inspector / code review delegation. Добавить явное указание: _«Ты — единственное звено, принимающее решение о качестве кода. Инспектор удалён из системы. Ответственность за review лежит на тебе.»_ |

> **⚠️ Промпт Архитектора:** В системных инструкциях `system-architect.md` может быть прописано, что код должен пройти проверку Инспектора, или что Архитектор делегирует review Инспектору. Все такие упоминания нужно заменить, иначе Архитектор будет ожидать feedback от несуществующего агента и зависать/ошибаться.

### Phase 7: Удаление документации и логов

| # | Файл | Действие |
|---|------|----------|
| 7.1 | `docs/agents/app-inspector.md` | **Удалить файл** — персона Inspector |
| 7.2 | `docs/plans/2026-03-phase4-autonomy-part2.md` | Добавить пометку `[REMOVED]` в начало или **переместить в `docs/archive/`** |
| 7.3 | `docs/plans/2026-03-phase5-director-mission-control.md` | Убрать упоминания Inspector из иерархии и визуализации |
| 7.4 | `logs/quality-audit.log` | Удалить файл (или добавить в `.gitignore` если уже там) |

### Phase 8: Очистка Redis

| # | Действие |
|---|----------|
| 8.1 | Удалить Redis Stream `gamma:system:file_changed` (через `DEL gamma:system:file_changed`) |
| 8.2 | Удалить inspector-related ключи из Redis agent registry если они персистятся |
| 8.3 | Удалить consumer group, привязанный к стриму (если создавался через `XGROUP CREATE`) |

> **⚠️ Очистка Redis — делать ПЕРВОЙ при деплое, ДО запуска приложения.**
> В стриме `gamma:system:file_changed` могут висеть необработанные события. Если новый код уже не содержит `FileChangeConsumerService`, но стрим остался — это не вызовет краш (некому читать), однако:
> - Стрим будет занимать память бессрочно (MAXLEN ~500, но без consumer'а TTL не сработает)
> - Если в будущем кто-то создаст consumer с тем же group name — он получит старые события
> - Consumer group (если был) останется в `XINFO GROUPS` и будет путать при диагностике
>
> **Рекомендация:** Добавить cleanup-скрипт или one-shot команду в deploy pipeline:
> ```bash
> redis-cli DEL gamma:system:file_changed
> ```

---

## Граф зависимостей (порядок важен)

```
┌─ Разработка (локально) ─────────────────────────────────────┐
│                                                              │
│  Phase 1 (file-watcher pipeline)                             │
│    ↓                                                         │
│  Phase 2 (sessions) — зависит от Phase 1                     │
│    ↓                                                         │
│  Phase 3 (gateway) — независимо от Phase 2, но после         │
│    ↓                                                         │
│  Phase 4 (registry/IPC) — после Phase 2-3                    │
│    ↓                                                         │
│  Phase 5 (types) — после Phase 1-4                           │
│                                                              │
│  Phase 6 (UI + промпты агентов) — параллельно с Phase 1-5    │
│                                                              │
│  Phase 7 (docs) — в конце                                    │
│                                                              │
└──────────────────────────────────────────────────────────────┘

┌─ Деплой ────────────────────────────────────────────────────┐
│                                                              │
│  Phase 8 (Redis cleanup) — ПЕРВЫМ, ДО запуска нового кода    │
│    ↓                                                         │
│  Запуск приложения                                           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Чеклист перед мержем

- [ ] `npm run build` проходит без ошибок
- [ ] `npm run lint` чистый
- [ ] Grep по `inspector` (case-insensitive) в `apps/` и `packages/` возвращает 0 результатов
- [ ] Grep по `file_changed` и `FILE_CHANGED` — 0 результатов
- [ ] Grep по `file-watcher` и `FileWatcher` — 0 результатов
- [ ] Grep по `quality-audit` — 0 результатов
- [ ] Grep по `appendQualityAudit` — 0 результатов
- [ ] Agent Monitor UI рендерится без ошибок
- [ ] Director UI рендерится без ошибок
- [ ] Существующие агенты (app-owner, system-architect) работают корректно
- [ ] Redis не содержит orphaned streams/keys

---

## Риски

1. **`send_message` tool** — используется Inspector, но также может использоваться другими агентами. Не удалять `handleSendMessageTool()` из gateway-ws.service.ts, только убрать inspector-специфичную логику.
2. **`daemon` role в AgentRole type** — проверить, не используется ли где-то ещё кроме Inspector.
3. **MessagingModule exports** — после удаления FileWatcher/FileChangeConsumer убедиться что модуль всё ещё корректно экспортирует оставшиеся сервисы (AgentRegistryService, MessageBusService).
4. **Director agent prompt** — может ссылаться на Inspector как на supervised agent. Убрать, иначе Director будет пытаться взаимодействовать с несуществующим агентом.
5. **System-Architect prompt** — если в `system-architect.md` прописано «код должен пройти проверку Инспектора» или аналогичная делегация review — Архитектор будет ждать ответа от несуществующего агента. Критично обновить промпт (шаг 6.5).
6. **Supervisor back-reference** — `sessions.module.ts` при back-fill устанавливает `supervisor: 'system-architect'` для inspector. Если agent-registry хранит обратный индекс (supervisor → список подчинённых), после удаления inspector из кода, но до очистки Redis, architect может видеть «призрачного» подчинённого. Решение: Phase 8 (Redis cleanup) выполнять ДО первого запуска нового кода.
7. **Redis stream orphan** — стрим `gamma:system:file_changed` без consumer'а не самоудаляется. Занимает память, может сбить с толку при диагностике. Удалять явно при деплое (шаг 8.1).
