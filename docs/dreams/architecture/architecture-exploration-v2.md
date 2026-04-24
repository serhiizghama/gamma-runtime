# Архитектурное исследование Gamma Runtime v2

> Документ исследует текущую топологию системы, анализирует пять радикально нестандартных архитектурных парадигм и синтезирует единый концепт для экстремального масштабирования.

---

## Анализ текущей топологии

Для получения структурного среза были изучены пять файлов из разных слоёв системы.

### 1. `orchestrator/orchestrator.service.ts` — Центральный координатор

Сервис выступает единственным субъектом, управляющим жизненным циклом агентов. Логика реализована в императивном стиле: один метод `handleTeamMessage` последовательно запускает лидера, итерирует по потоку чанков (`for await`), обновляет базу данных и испускает события. `spawnAgentForTask` запускает рабочих агентов как «fire-and-forget» горутины через `Promise.catch`. Пробуждение лидера при завершении всех задач — синхронный `setTimeout` на 2 секунды. Всё состояние о живых пайплайнах хранится в двух `Map`-ах в памяти процесса (`runningPipelines`, `turnStartedAt`), что делает систему нетолерантной к перезапускам.

**Архитектурная роль:** Stateful God-object, в котором сосредоточена вся бизнес-логика координации. Единственная точка отказа для любой команды.

### 2. `claude/claude-cli.adapter.ts` — Граница процесса

Адаптер открывает дочерний процесс `claude` через `child_process.spawn` с флагами `--output-format stream-json --verbose`. Стандартный вывод разбирается построчно через `readline`, каждая строка превращается в типизированный `StreamChunk` через `parseLine`. Адаптер реализует AsyncGenerator — единственный интерфейс потребления. Управление временем жизни процесса: `setTimeout`-таймаут на убийство группы процессов через `process.kill(-pid, SIGTERM)`.

**Архитектурная роль:** Тонкая обёртка над OS-процессом. Не хранит состояния между вызовами, но содержит мутабельное поле `_lastProc` для передачи ссылки на процесс в `SessionPool`.

### 3. `events/event-bus.service.ts` — Внутренняя шина событий

Обёртка над `EventEmitter2` с тремя уровнями маршрутизации: глобальный канал `gamma.event`, командный `gamma.team.<id>`, агентский `gamma.agent.<id>`. Каждое событие получает ULID-идентификатор и миллисекундный timestamp. Подписка возвращает функцию отписки.

**Архитектурная роль:** Синхронный in-process pub-sub. Не персистентен, не распределён, не буферизован — семантика «испустил-и-забыл» без каких-либо гарантий доставки.

### 4. `internal/internal.service.ts` — API агентов

REST-контракт, через который запущенные Claude-процессы модифицируют состояние системы. Включает `assignTask` (создаёт задачу и испускает `task.assigned`, что запускает спавн нового агента), `updateTask`, `sendMessage`, `broadcast`, `readMessages`, `markDone`. Каждый вызов делает несколько синхронных обращений к Postgres и испускает события в шину.

**Архитектурная роль:** Синхронный транзакционный фасад над репозиториями. Агенты взаимодействуют с системой исключительно через этот слой — это единственный «публичный API» для Claude-процессов.

### 5. `repositories/tasks.repository.ts` — Слой персистентности

Простые параметризованные SQL-запросы через `pg`. Нет ORM, нет кэширования, нет транзакций. `setResult` атомарно переводит задачу в стадию `done`. Полное отсутствие оптимистичных блокировок или версионирования строк.

**Архитектурная роль:** Тонкий Data Access Object над таблицей `tasks` в Postgres. State-of-record для всего, что касается задач.

---

## Обзор альтернативных парадигм

### Парадигма 1: Чисто функциональный Event Sourcing с CQRS

#### Теоретическая механика

В классическом Event Sourcing текущее состояние системы — это не хранимый снимок, а функция над упорядоченным журналом неизменяемых событий:

```
State(t) = fold(initialState, events[0..t])
```

Для Gamma Runtime это означает радикальный отказ от мутирующих UPDATE-запросов. Вместо:
```sql
UPDATE tasks SET stage = 'done', updated_at = NOW() WHERE id = $1
```
система записывает только:
```
{ eventId: "evt_01...", kind: "task.stage_changed", payload: { taskId, from: "in_progress", to: "done" }, at: 1714000000000 }
```

Текущее состояние любой задачи восстанавливается путём воспроизведения (replay) всех событий с `task.created` до последнего `task.stage_changed`. Хранилище событий (Event Store) — append-only, никогда не обновляется и не удаляется.

**CQRS** (Command Query Responsibility Segregation) разделяет систему на две асимметричные стороны:

- **Command side** принимает команды (`AssignTask`, `UpdateTaskStage`, `SendMessage`), валидирует их против текущего агрегатного состояния, и при успехе записывает одно или несколько доменных событий в Event Store.
- **Query side** подписывается на события и поддерживает денормализованные read-модели (projection) — например, таблицу `task_current_state`, оптимизированную для отображения на фронтенде без join-ов.

#### Структурные изменения для Gamma Runtime

Весь `TasksRepository` исчезает в нынешнем виде. Вместо него появляются:

1. **`EventStore`** — append-only таблица `domain_events(id, stream_id, stream_position, kind, payload JSONB, created_at)` с уникальным индексом по `(stream_id, stream_position)` для optimistic concurrency.
2. **`TaskAggregate`** — класс, чьи методы (`assignTask()`, `markDone()`) принимают команду, проверяют инварианты над текущим состоянием агрегата и возвращают список новых событий (не мутируют БД сами).
3. **`TaskProjectionWorker`** — фоновый процесс, подписанный на Event Store, перестраивающий read-model `task_read_view` при каждом новом событии.
4. **`OrchestratorService`** перестаёт читать напрямую из `tasks` таблицы — вместо этого он воспроизводит агрегат из Event Store перед каждой командой.

**Управление состоянием оркестратора:** `runningPipelines` и `turnStartedAt` превращаются в проекцию событий `pipeline.started` / `pipeline.completed`, хранимую в Redis или той же Postgres, восстанавливаемую при рестарте.

**Latency-трейдоф:** Запись события — O(1), append в конец индекса. Но восстановление агрегата через replay — O(n) по количеству событий в стриме. При длинных командах (тысячи задач) это деградирует. Решение — снэпшоты (snapshot): периодически сохранять сериализованное состояние агрегата и воспроизводить только события после снэпшота.

**Преимущество для Gamma Runtime:** Полный audit trail всей активности агентов. Возможность воспроизвести любую сессию с точностью до события. Debug становится детерминированным — можно «перемотать» состояние команды к любому моменту времени.

---

### Парадигма 2: Модель Акторов (Actor Model) по Hewitt-Agha

#### Теоретическая механика

В Actor Model единица вычисления — это актор: изолированный объект с тремя примитивами:
1. Отправить сообщение другому актору (`send`)
2. Создать новых акторов (`spawn`)
3. Определить поведение для обработки следующего сообщения (`become`)

Каждый актор владеет личным mailbox (очередью сообщений) и обрабатывает по одному сообщению за раз — никакой разделяемой памяти, никаких мьютексов. Единственная форма коммуникации — асинхронная передача сообщений.

В Erlang/OTP эта модель реализуется через примитивы `GenServer`, `Supervisor` и `Registry`. В TypeScript ближайший аналог — библиотека `nact` или самописный Actor Runtime.

#### Структурные изменения для Gamma Runtime

Каждая сущность становится актором:

```
ActorSystem
├── TeamActor(team_01...)          # per-team supervisor
│   ├── OrchestratorActor          # управляет pipeline
│   ├── LeaderAgentActor           # one per leader
│   │   └── ClaudeProcessActor     # wraps child_process
│   ├── WorkerAgentActor(agent_01) 
│   │   └── ClaudeProcessActor
│   └── TaskBoardActor             # in-memory task state machine
└── EventStoreActor                # global append-only log
```

**`OrchestratorService`** превращается в `OrchestratorActor`, который не вызывает методы синхронно, а отправляет сообщения:

```typescript
// Вместо: await this.agents.updateStatus(leader.id, 'running')
// Актор отправляет:
send(leaderAgentActor, { type: 'START', taskId, message })
```

**`LeaderAgentActor`** сам управляет своим `ClaudeProcessActor`, получает чанки как сообщения (`{ type: 'CHUNK', chunk }`) и отправляет результаты обратно оркестратору.

**Supervisors** — деревья надзора автоматически перезапускают упавшие акторы. `ClaudeProcessActor` упал из-за SIGKILL? Supervisor создаёт новый, не затрагивая остальных акторов в системе.

**Location transparency:** акторы не знают, находятся ли они в том же процессе, на том же сервере или на другом узле кластера. Это делает горизонтальное масштабирование тривиальным — достаточно добавить транспортный слой (TCP, NATS) и `RemoteActorRef`.

**Latency и управление потоком:** Mailbox каждого актора может применять back-pressure — `TeamActor` не создаёт новых `WorkerAgentActor`-ов, пока его очередь не опустеет ниже порога. Это заменяет текущий `SessionPool.acquire()` на семантически более богатую систему.

**Ключевое отличие от текущей архитектуры:** Отсутствие `runningPipelines: Set<string>` в глобальном синглтоне. Каждый `TeamActor` знает свой собственный статус пайплайна — локальное состояние, доступное только через сообщения. Race conditions становятся физически невозможными для конкурентных обновлений одной команды.

---

### Парадигма 3: Децентрализованная P2P-топология с Gossip Protocol

#### Теоретическая механика

В децентрализованных системах нет центрального координатора. Каждый узел владеет частичным знанием о состоянии системы и распространяет его через эпидемический Gossip Protocol:

1. Периодически узел выбирает k случайных соседей
2. Обменивается с ними своим вектором состояния (state digest)
3. Мержит входящее состояние с локальным через CRDT-операции

CRDT (Conflict-free Replicated Data Types) — математически доказуемые структуры данных, гарантирующие eventual consistency без координации: G-Counter, OR-Set, LWW-Register.

**Виртуальные часы (Vector Clock):** Для установления частичного порядка событий в распределённой системе без единого источника времени используется вектор `{agentId → lamportTimestamp}`. Событие A causally предшествует B, если `A.clock ≤ B.clock` покомпонентно.

#### Структурные изменения для Gamma Runtime

Текущий центральный `OrchestratorService` устраняется. Каждый Claude-процесс (агент) становится полноправным узлом P2P-сети:

```
claude-agent-01 ←→ claude-agent-02
        ↕               ↕
claude-agent-03 ←→ claude-leader-01
```

**TaskBoard как CRDT OR-Set:** Список задач — это OR-Set (Observed-Remove Set). Каждый агент добавляет задачи локально, удаления невозможны (только смена стадии через LWW-Register). Gossip разносит изменения. Через O(log N) раундов Gossip все узлы сходятся к одному состоянию.

**Leader Election через Raft:** Вместо явно назначенного лидера система использует Raft Consensus: агенты голосуют, один получает мандат на период (term), координирует задачи. При падении — автоматические перевыборы.

**Проблема для Gamma Runtime:** Claude CLI-процессы — эфемерны, живут минуты. P2P-топология требует устойчивых долгоживущих участников. Решение: Gossip ведут не сами CLI-процессы, а постоянные агентские «хосты» (Node.js daemon на каждый агент), которые прокси-ируют коммуникацию.

**Latency трейдоф:** Gossip — O(log N) раундов для сходимости, каждый раунд ~100ms. При 10 агентах — сходимость за ~300ms. При 100 агентах — ~700ms. Это приемлемо для long-running агентов, но неприемлемо для синхронных операций (например, `assignTask` должен быть немедленно виден всем).

---

### Парадигма 4: Биологически-вдохновлённые вычисления — Стигмергия и Химические Градиенты

#### Теоретическая механика

Стигмергия (от греч. «стимул» + «работа») — механизм координации через следы в среде. Муравей не сообщает другим муравьям, куда идти — он оставляет феромон на пути к еде. Другие муравьи следуют градиенту феромона. Оптимальный маршрут «кристаллизуется» без центрального планировщика.

В компьютерных системах это транслируется в **паттерн Blackboard**: есть общая доска состояния (blackboard), на которой агенты оставляют «следы» (записи) и реагируют на следы других, изменяя своё поведение. Координация возникает как emergent property.

**Химические градиенты как приоритизация:** Задача с высоким приоритетом испускает «аттрактантный феромон» с высокой начальной концентрацией. Концентрация убывает экспоненциально (`C(t) = C0 * e^(-λt)`). Свободные агенты «двигаются» в сторону максимальной концентрации — то есть берут наиболее срочные задачи.

#### Структурные изменения для Gamma Runtime

**Blackboard Service** заменяет `TasksRepository` + `EventBus`:

```typescript
interface PheromoneTrail {
  taskId: string;
  kind: 'attract' | 'repel';
  concentration: number;       // 0.0 - 1.0
  decayRate: number;           // λ, per-second
  depositedBy: string;         // agentId
  depositedAt: number;         // epoch ms
}
```

Агент, завершивший задачу, оставляет «репеллент» — снижает вероятность повторного назначения на ту же задачу. Агент, заблокированный на задаче, оставляет «дистресс-феромон», привлекая лидера или других специализированных агентов.

**Алгоритм выбора задачи (Ant Colony Optimization):** Каждый свободный агент выбирает следующую задачу вероятностно:

```
P(task_i) = (concentration_i^α * heuristic_i^β) / Σ(concentration_j^α * heuristic_j^β)
```

где `heuristic_i` — статический приоритет задачи, α и β — параметры баланса.

**Специализация через подкрепление:** Агент, успешно завершивший задачи типа `code-review`, получает более высокий `heuristic`-множитель для таких задач в будущем — аналог «обучения» без центрального координатора.

**Смерть лидера как антипаттерн:** В биологических системах нет единого «лидера» — существует роль координатора, которую может взять любой агент с достаточной «химической сигнатурой» (накопленным опытом + статусом в Blackboard).

**Latency:** Исключительно асинхронная система без блокировок. Задержка присвоения задачи = время следующего «нюхания» свободного агента (~100ms). Сходимость к оптимальному распределению — итеративная, а не мгновенная.

---

### Парадигма 5: Реактивное потоковое программирование — Dataflow / FRP с топологией DAG

#### Теоретическая механика

В Functional Reactive Programming (FRP) вся система описывается как направленный ациклический граф (DAG) трансформаций потоков данных. Состояние — это не переменная, а функция от времени: `Behavior<A> = Time → A`. Событие — это дискретный поток значений: `Event<A> = [time → a]`.

Принципиальное отличие от EventEmitter: в FRP граф зависимостей статически известен и верифицируем. Компилятор (или runtime) может автоматически распараллеливать независимые ветви графа и применять back-pressure.

**RxJS** — наиболее зрелая реализация для TypeScript. **Highland.js** или **Most.js** — альтернативы с более строгой семантикой. Для истинного FRP с темпоральной логикой — **Bacon.js** с семантикой Continuous Behavior.

#### Структурные изменения для Gamma Runtime

Весь `OrchestratorService` превращается в объявление графа потоков:

```typescript
// Декларативное описание оркестрации
const teamMessages$ = fromEvent(httpServer, 'team.message');  // Stream<TeamMessage>

const leaderSessions$ = teamMessages$.pipe(
  groupBy(msg => msg.teamId),           // Stream<GroupedStream<TeamId, TeamMessage>>
  mergeMap(group => group.pipe(
    concatMap(msg => runLeaderCLI(msg)),  // Sequential per team, parallel across teams
  ))
);

const taskAssigned$ = eventBus.ofKind('task.assigned');

const workerSessions$ = taskAssigned$.pipe(
  mergeMap(event => runWorkerCLI(event), MAX_CONCURRENT_AGENTS), // back-pressure built-in
);

const allCompletions$ = merge(leaderSessions$, workerSessions$).pipe(
  filter(c => c.kind === 'agent.completed'),
);

// Auto-wake leader: все задачи выполнены → сигнал лидеру
const roundCompleted$ = allCompletions$.pipe(
  groupBy(c => c.teamId),
  mergeMap(group => group.pipe(
    bufferWhen(() => noActiveTasks$(group.key)),  // собрать все completions до момента тишины
    map(completions => buildWakeMessage(completions))
  ))
);

roundCompleted$.subscribe(wake => runLeaderCLI(wake));
```

**Топология DAG:**
```
teamMessages$ ──→ leaderSessions$ ──→ allCompletions$ ──→ roundCompleted$ ──┐
                                                                              ↓
taskAssigned$ ──→ workerSessions$ ──→ allCompletions$ ───────────────────────┘
                                                                              ↓
                                                                    leaderWake$
```

**Marble testing:** Граф полностью тестируем через marble-диаграммы RxJS. Временные зависимости («лидер просыпается через 2 секунды после завершения всех задач») описываются как `delay(2000)` в графе и верифицируются детерминированно.

**Back-pressure:** `mergeMap(_, MAX_CONCURRENT_AGENTS)` заменяет весь `SessionPoolService`. Upstream автоматически throttled, если downstream не успевает.

**Проблема:** Граф живёт в памяти одного процесса. Hot Observable — сложная семантика при реконнекте. При перезапуске сервера весь граф пересоздаётся с нуля — потеря in-flight событий.

---

## Финальный архитектурный концепт

### Выбор: Акторная Модель с Event Sourcing как Журналом Событий

Из пяти парадигм наиболее математически строгой, практически реализуемой и максимально радикально отличающейся от текущей архитектуры является **гибрид Actor Model + Event Sourcing**.

Обоснование выбора:
- **P2P Gossip** — несовместим с эфемерностью CLI-процессов
- **Stigmergy** — probabilistic scheduling не подходит для детерминированного управления CLI-сессиями
- **Pure FRP** — решает concurrency, но не persistence и не fault tolerance
- **Pure Event Sourcing без акторов** — даёт audit trail, но оставляет `OrchestratorService` монолитным
- **Actor Model + ES** — даёт изоляцию отказов, устранение гонок, восстанавливаемость состояния, горизонтальное масштабирование

### Архитектурная Схема

```
┌──────────────────────────────────────────────────────────┐
│                     ActorSystem                          │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │            TeamSupervisor(team_01...)            │    │
│  │                                                  │    │
│  │  ┌─────────────────┐  ┌─────────────────────┐  │    │
│  │  │  OrchestratorA  │  │   TaskBoardActor     │  │    │
│  │  │  (state machine)│  │  (CRDT state in mem) │  │    │
│  │  └────────┬────────┘  └──────────┬──────────┘  │    │
│  │           │ spawn                 │ read/write   │    │
│  │  ┌────────▼──────────────────────▼──────────┐  │    │
│  │  │           AgentSupervisor                 │  │    │
│  │  │  ┌──────────────┐  ┌──────────────────┐  │  │    │
│  │  │  │ LeaderAgent  │  │ WorkerAgent(n)   │  │  │    │
│  │  │  │   Actor      │  │   Actor          │  │  │    │
│  │  │  └──────┬───────┘  └───────┬──────────┘  │  │    │
│  │  │         │ messages          │              │  │    │
│  │  │  ┌──────▼───────┐  ┌───────▼──────────┐  │  │    │
│  │  │  │ ClaudeProc   │  │ ClaudeProc       │  │  │    │
│  │  │  │ Actor        │  │ Actor            │  │  │    │
│  │  │  └──────────────┘  └──────────────────┘  │  │    │
│  │  └───────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │              EventStoreActor (global)            │    │
│  │  append-only log → Postgres event_store table   │    │
│  └─────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────┘
```

### Потоки Событий

#### Поток 1: Пользователь отправляет сообщение команде

```
HTTP POST /api/teams/:id/message
         ↓
  TeamSupervisor.tell({ type: 'TEAM_MESSAGE', message, teamId })
         ↓
  OrchestratorActor (state: IDLE → PIPELINE_RUNNING)
    1. Записывает в EventStore: { kind: 'pipeline.started', teamId, at }
    2. Tells LeaderAgentActor: { type: 'RUN', message }
         ↓
  LeaderAgentActor
    1. Spawns ClaudeProcessActor
    2. Переходит в состояние RUNNING
    3. Получает CHUNK сообщения от ClaudeProcessActor
    4. Forwards CHUNK → OrchestratorActor (для SSE fan-out)
         ↓
  ClaudeProcessActor (wraps child_process)
    - Читает stdout, парсит NDJSON
    - Отправляет { type: 'CHUNK', chunk } родителю
    - При exit: { type: 'PROCESS_EXITED', exitCode }
```

#### Поток 2: Лидер назначает задачу

```
LeaderAgentActor получает CHUNK типа tool_use { tool: 'Bash', command: 'assign-task ...' }
         ↓
  Лидер делает HTTP POST /api/internal/assign-task
         ↓
  InternalController → TaskBoardActor.tell({ type: 'ASSIGN', ... })
         ↓
  TaskBoardActor:
    1. Валидирует (агент существует, не занят)
    2. Записывает в EventStore: { kind: 'task.assigned', taskId, agentId }
    3. Отвечает { success: true, taskId }
    4. Tells OrchestratorActor: { type: 'TASK_ASSIGNED', taskId, agentId }
         ↓
  OrchestratorActor → AgentSupervisor.tell({ type: 'SPAWN_WORKER', taskId, agentId })
         ↓
  AgentSupervisor создаёт WorkerAgentActor (если не существует)
  WorkerAgentActor создаёт ClaudeProcessActor
```

#### Поток 3: Воркер завершает задачу — авто-пробуждение лидера

```
WorkerAgentActor получает { type: 'PROCESS_EXITED' }
         ↓
  WorkerAgentActor.tell(TaskBoardActor, { type: 'TASK_COMPLETED', taskId, result })
         ↓
  TaskBoardActor:
    1. Записывает в EventStore: { kind: 'task.completed', taskId }
    2. Проверяет: есть ли активные задачи?
       Если нет → tells OrchestratorActor: { type: 'ALL_TASKS_DONE' }
         ↓
  OrchestratorActor:
    if (state === PIPELINE_RUNNING && !leaderIsRunning):
      Записывает: { kind: 'leader.wake_scheduled', teamId }
      after(2000ms) → tells LeaderAgentActor: { type: 'WAKE', wakeMessage }
```

### Управление Задержками (Latency Management)

| Операция | Текущая архитектура | Actor + ES |
|----------|---------------------|------------|
| Запись события | UPDATE + EventEmitter.emit (sync) | append to EventStore (~1ms) + async mailbox |
| Чтение состояния | SELECT (sync) | Actor mailbox reply (~0.1ms in-process) |
| Воркер видит новую задачу | setTimeout(2000ms) hardcoded | Configurable after(delay) per-actor |
| Перезапуск после краша | Теряет `runningPipelines` Map | Replay EventStore → восстанавливает состояние |
| Конкурентные обновления одной задачи | Race condition возможен | Физически невозможен (один акт. обрабатывает per task) |

**Снэпшоты для ускорения восстановления:** `TaskBoardActor` каждые N событий сохраняет снэпшот своего состояния. При перезапуске: читает последний снэпшот + только события после него.

### Мутация Состояния

В Actor + ES система различает два вида состояния:

**Ephemeral actor state** — существует только пока актор жив. Теряется при крэше. Примеры: буфер текущего текста ответа лидера, кэш имён агентов. Восстанавливается replay EventStore.

**Durable domain state** — persisted в EventStore. Никогда не теряется. Примеры: все события задач, сессии агентов, сообщения.

**Projections** — деривативное состояние, вычисляемое из EventStore асинхронно. Примеры: `task_current_view` (текущий stage каждой задачи), `agent_status_view`. Не являются источником истины — при рассинхронизации всегда могут быть перестроены из EventStore.

```
EventStore (immutable) → ProjectionWorker → read_models (mutable, reconstructible)
                    ↑
              Command handlers
              (via Actor messages)
```

---

## Вектор Миграции

Миграция выполняется итеративно, не требуя полного переписывания системы. Принцип: Strangler Fig Pattern — новые компоненты обёртывают старые, постепенно вытесняя их.

### Фаза 0: Подготовка инфраструктуры (1-2 недели)

**0.1 Event Store:**
```sql
CREATE TABLE domain_events (
  id          TEXT PRIMARY KEY,         -- ULID
  stream_id   TEXT NOT NULL,            -- e.g. "task_01...", "team_01..."
  stream_pos  BIGINT NOT NULL,          -- monotonic per stream
  kind        TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE(stream_id, stream_pos)
);
CREATE INDEX ON domain_events(stream_id, stream_pos);
CREATE INDEX ON domain_events(created_at);
```

**0.2 Минимальный ActorRuntime** — простая TypeScript-реализация без внешних зависимостей: очередь сообщений (массив), обработчик (async function), supervisor tree (Map<actorId, Actor>). Позже — миграция на `nact` или Akka-style фреймворк.

**0.3 Снэпшотная таблица:**
```sql
CREATE TABLE actor_snapshots (
  actor_id    TEXT PRIMARY KEY,
  snapshot    JSONB NOT NULL,
  at_event_id TEXT NOT NULL,
  created_at  BIGINT NOT NULL
);
```

---

### Фаза 1: EventStore как дублирующий журнал (2-3 недели)

Цель: ни одна существующая функция не ломается. Начинаем писать события параллельно с текущими UPDATE-запросами.

**1.1** Добавить `EventStoreService.append(streamId, kind, payload)` рядом с существующими репозиториями.

**1.2** В `InternalService.assignTask()` добавить вызов:
```typescript
await this.eventStore.append(`task_${task.id}`, 'task.created', { title, assignedTo });
await this.eventStore.append(`task_${task.id}`, 'task.assigned', { agentId });
```
Параллельно с существующим INSERT в `tasks`.

**1.3** Аналогично для `updateTask`, `sendMessage`, `markDone`.

**1.4** Верификация: периодический job сравнивает проекцию из EventStore с текущим состоянием в `tasks` таблице. Расхождения — в лог.

---

### Фаза 2: TaskBoardActor заменяет TasksRepository (3-4 недели)

**2.1** Реализовать `TaskBoardActor` как актор с in-memory состоянием, восстанавливаемым из EventStore при старте.

**2.2** `InternalService` начинает отправлять сообщения `TaskBoardActor` вместо прямых SQL-запросов. `TaskBoardActor` пишет в EventStore и обновляет `tasks` таблицу (всё ещё как projection для backward compatibility).

**2.3** Фронтенд и читающие части системы переходят на read-model, поддерживаемую `TaskBoardActor`.

**2.4** После стабилизации — убрать прямые UPDATE из `TasksRepository`. Таблица `tasks` становится чисто read-model, перестраиваемой из EventStore.

---

### Фаза 3: OrchestratorActor как конечный автомат (4-5 недель)

**3.1** Определить FSM состояния для каждой команды:
```
TeamPipelineState = IDLE | PIPELINE_RUNNING | EMERGENCY_STOP
```

**3.2** Перенести логику `handleTeamMessage` и `runAgentInBackground` в `OrchestratorActor` как обработчики сообщений.

**3.3** `runningPipelines: Set<string>` → состояние в `OrchestratorActor`. Восстанавливается из EventStore (`pipeline.started` events без соответствующего `pipeline.completed`).

**3.4** `turnStartedAt: Map<string, number>` → поле `pipelineStartedAt` в состоянии актора, персистируется в EventStore.

---

### Фаза 4: ClaudeProcessActor и AgentSupervisor (3-4 недели)

**4.1** Обернуть `ClaudeCliAdapter.run()` в `ClaudeProcessActor`. Каждый чанк из AsyncGenerator — сообщение `{ type: 'CHUNK', chunk }` в mailbox родительского `AgentActor`.

**4.2** Реализовать `AgentSupervisor` с политикой перезапуска: при `PROCESS_EXITED` с non-zero кодом — повторить до N раз перед переводом задачи в `failed`.

**4.3** `SessionPoolService` становится стратегией `AgentSupervisor` — `maxConcurrent` параллельных дочерних акторов.

---

### Фаза 5: Горизонтальное масштабирование (6+ недель)

**5.1** Заменить in-process EventEmitter2 на NATS JetStream как транспорт между акторами. Акторы становятся location-transparent.

**5.2** Каждая команда (Team) может быть обслужена отдельным Node.js-процессом или контейнером. `TeamSupervisor` — отдельный pod в Kubernetes.

**5.3** EventStore — PostgreSQL с логической репликацией или замена на EventStoreDB / Apache Kafka.

**5.4** Projections запускаются как отдельные stateless workers, масштабируемые независимо от акторов.

---

### Риски и Ограничения

| Риск | Вероятность | Митигация |
|------|------------|-----------|
| Сложность отладки акторных потоков | Высокая | Обязательное структурное логирование каждого сообщения (OpenTelemetry traces) |
| Разрастание EventStore без компакции | Средняя | Log compaction: сохранять снэпшоты, архивировать события старше 30 дней |
| Back-pressure deadlock (актор A ждёт B, B ждёт A) | Низкая | Таймауты на все ask()-запросы, детектор циклов в Supervisor |
| Eventual consistency читающих проекций | Средняя | Для критичных операций (assign-task) использовать strong read через `TaskBoardActor.ask()`, не через read-model |
| Overhead акторного рантайма для малых команд | Высокая | Прозрачно: при N < 5 агентов разница незначительна; выгода проявляется при N > 20 |

---

*Документ составлен по результатам архитектурного анализа кодовой базы Gamma Runtime v2, ветка `v2`. Дата: 2026-04-23.*
