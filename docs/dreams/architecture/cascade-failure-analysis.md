# Анализ каскадного сбоя: Формальная верификация отказоустойчивости
_Дата: 2026-04-23 | Ветка: v2 | Статус: архивный стресс-тест_

---

## Анализ топологии

Исследованы шесть файлов, образующих сквозной конвейер обработки пользовательского запроса:

| Файл | Архитектурная роль |
|------|-------------------|
| `orchestrator/orchestrator.service.ts` | Исполнительный центр: блокировка конвейера (`runningPipelines`), временна́я привязка раунда (`turnStartedAt`), жизненный цикл лидера и воркеров, механизм авто-пробуждения лидера |
| `claude/claude-cli.adapter.ts` | Нейромышечный интерфейс: `spawn('claude', args, {detached:true})`, NDJSON-стриминг через `readline`, **разделяемый мутабельный синглтон `_lastProc`** |
| `claude/session-pool.service.ts` | Семафор конкурентности: счётчик `running`, очередь Promise-резолверов `queue[]`, карта `processes Map<agentId, ChildProcess>`, флаг `_aborting` |
| `events/event-bus.service.ts` | Синаптическая щель: EventEmitter2 без состояния, три канала (global / team / agent), без персистентности и гарантий порядка доставки |
| `sse/sse.service.ts` | Нейронная трансляция: `reply.raw.write()` в HTTP-поток, heartbeat каждые 30 с, очистка только по событию `close` |
| `apps/web/src/store/useStore.ts` | Соматосенсорная кора: атомы Zustand (`teams[]`, `agents[]`, `notifications[]`), без механизмов повтора и воспроизведения |

**Граф критических зависимостей:** `OrchestratorService` управляет `ClaudeCliAdapter` и `SessionPoolService`. Оба эмитируют через `EventBusService`. `SseService` подписывается на `EventBusService` и пишет в сырой TCP-сокет. `useStore` является терминальным получателем — обратной связи нет, потерянное событие не восстанавливается на стороне браузера.

**Структурная уязвимость:** `ClaudeCliAdapter._lastProc` — разделяемое мутабельное поле класса. Конкурентные вызовы `run()` гарантированно создают гонку при записи.

---

## Векторы отказа (Византийские ограничения)

### Ограничение C1 — Временно́й регресс (Хронологическая Регрессия)
NTP-демон форсирует коррекцию 8-секундного опережения: `Date.now()` скачком возвращается на 8 000 мс назад. Поскольку `turnStartedAt` фиксируется в момент получения запроса, а `task.created_at` — в момент назначения задачи, любая задача, назначенная после регрессии, получает `created_at < turnStart`. Фильтр авто-пробуждения (`t.created_at >= turnStart`) классифицирует все задачи текущего раунда как «чужие» — они исчезают из контекста, передаваемого лидеру при пробуждении.

### Ограничение C2 — Фантомная секвенция микрозадач (Аномалия GC-прерывания)
При утилизации V8-кучи выше 91% фаза Mark-and-Compact откладывает контрольную точку микрозадач на один тик event loop. Это открывает окно (~0.8 мс), в котором вторая `async`-функция может начать исполнение и мутировать разделяемое состояние прежде, чем `await`-продолжение первой функции возобновится. Конкретно: `_lastProc` устанавливается синхронно до `yield`, но если второй конкурентный вызов `run()` начнётся между `yield` и возобновлением `for-await`-потребителя первого вызова — `_lastProc` будет перезаписан чужим процессом прежде, чем первый потребитель вызовет `getLastProcess()`.

### Ограничение C3 — Фантомное подтверждение записи SSE (Призрак Ядра)
`reply.raw.write()` возвращает `true` (нет обратного давления) даже при переполнении буфера отправки ядра TCP-сокета. Данные молча отбрасываются на уровне ОС. Событие `close` на сокете никогда не генерируется: соединение остаётся полуоткрытым. `SseService.setupStream()` никогда не вызывает `unsubscribe()` — EventEmitter2-обработчик аккумулируется, создавая веерную рассылку на мёртвые соединения при каждом последующем событии.

### Ограничение C4 — Инверсия сериализации обновлений БД (Переставление Соединений)
Пул соединений `pg` при высокой конкурентной нагрузке назначает два последовательных `UPDATE agents SET status = ?` для одного и того же агента разным физическим TCP-соединениям. Вследствие различного времени буферизации ядра запрос `status = 'idle'` доставляется в Postgres раньше запроса `status = 'running'`, отправленного первым. Postgres применяет принцип последней записи: финальный статус агента в БД — `'running'` при семантическом намерении `'idle'`. Никаких нарушений ограничений целостности не возникает — база данных внутренне согласована, но семантически отравлена.

---

## Хронология каскадного сбоя

**Сценарий:** Команда `team_alpha`, Лидер: `agent_LEAD`, Воркер: `agent_WORK`. `MAX_CONCURRENT_AGENTS=2`. Временна́я база: T₀.

---

### СОСТОЯНИЕ 1 — Равновесие (T=0)
```
Pool: {running:0, queue:[], processes:{}}
runningPipelines: Set{}
turnStartedAt: Map{}
DB: {agent_LEAD:{status:'idle', session_id:'sess_prev'}, agent_WORK:{status:'idle'}}
EventBus.listeners: {gamma.event:[orchestratorHandler], gamma.team.team_alpha:[sseHandler]}
ClaudeCliAdapter._lastProc: undefined
useStore.agents: [{agent_LEAD:idle}, {agent_WORK:idle}]
SSE TCP-буфер ядра: 0/131072 байт
```
Все инварианты выполнены. Система ожидает ввода.

---

### СОСТОЯНИЕ 2 — Пользователь отправляет сообщение (T=+100 мс)
```
handleTeamMessage('team_alpha', 'Анализируй кодовую базу') ← POST /api/teams/team_alpha/message

runningPipelines.has('team_alpha') → false → страж ПРОЙДЕН
runningPipelines.add('team_alpha') → Set{'team_alpha'}
turnStartedAt.set('team_alpha', Date.now()) → Map{'team_alpha': T₀+100}  ← ЗАФИКСИРОВАНО

chat.save({role:'user', content:'...'}) → chat_msg_001 персистирован в БД
eventBus.emit({kind:'team.message', content:chat_msg_001})
  → SSE write возвращает true (буфер 312/131072) ← C3 ещё не активен
  → useStore получает событие → UI отображает сообщение пользователя
```
Мутация: `runningPipelines` и `turnStartedAt` несут активное состояние. Конвейер заблокирован.

---

### СОСТОЯНИЕ 3 — C1: NTP-регрессия системных часов (T=+120 мс)
```
NTP-демон получает сигнал коррекции: обнаружено опережение на 8002 мс
Ядро ОС корректирует CLOCK_REALTIME:
  Date.now(): T₀+120 → T₀+120−8002 = T₀−7882

Анализ инварианта:
  turnStart = T₀+100  ← сохранён ДО регрессии, не изменяется
  Любой объект, созданный ПОСЛЕ T=+120 мс, получит:
    created_at ≈ T₀−7882 + Δ_elapsed

  Условие видимости в авто-пробуждении: created_at >= turnStart
    ⟺ T₀−7882+Δ >= T₀+100
    ⟺ Δ >= 7982 мс

  Задача, назначенная при Δ=4380 мс: created_at = T₀−3502 < T₀+100 → НЕВИДИМА
```
Временно́е отравление произошло молча. Ни ошибки, ни записи в логе.

---

### СОСТОЯНИЕ 4 — Спавн лидера: процесс зарегистрирован корректно (T=+140 мс)
```
agents.updateStatus('agent_LEAD', 'running') → DB: agent_LEAD.status = 'running'
eventBus.emit({kind:'agent.started', agentId:'agent_LEAD'}) → SSE write OK

ClaudeCliAdapter.run({message:'Анализируй...', sessionId:'sess_prev', cwd:'.../agent_LEAD'}):
  spawn('claude', ['--resume','sess_prev','-p','Анализируй...',
                   '--permission-mode','bypassPermissions',
                   '--output-format','stream-json','--verbose','--max-turns','200'],
        {stdio:['ignore','pipe','pipe'], detached:true, cwd:...})
  → PID:1001 создан, PGID:1001
  → this._lastProc = ChildProcess{pid:1001}  ← СИНГЛТОН УСТАНОВЛЕН
  → yield {type:'system', subtype:'_process_started'}  ← генератор приостановлен

Orchestrator for-await:
  chunk._process_started → getLastProcess() → PID:1001 ✓ (гонки нет)
  pool.register('agent_LEAD', PID:1001)

Pool: {running:1, processes:{'agent_LEAD':PID:1001}}
```
Лидер корректно зарегистрирован. `_lastProc = PID:1001`.

---

### СОСТОЯНИЕ 5 — C2: давление кучи V8 достигает порогового значения (T=+2800 мс)
```
Утилизация V8-кучи: 91.3%
(NDJSON-поток лидера + readline-интерфейс + граф зависимостей NestJS DI)
Запускается фаза GC Mark-and-Compact

Эффект: контрольная точка микрозадач откладывается с конца текущего тика
         до конца следующего тика в V8 runtime/vm/microtask_queue.cc

Открывается окно ~0.8 мс:
  - for-await-продолжение лидера (ожидает следующую NDJSON-строку) поставлено в очередь
    НО ЕЩЁ НЕ ИСПОЛНЕНО
  - новые синхронные EventEmitter-колбэки МОГУТ запуститься и начать новые async-цепочки
    прежде, чем продолжение лидера возобновится

Pool: {running:1, processes:{'agent_LEAD':PID:1001}} ← без изменений
_lastProc: ChildProcess{pid:1001} ← без изменений
Давление GC: АКТИВНО (91.3%)
```
Окно уязвимости открыто. Система готова к гонке.

---

### СОСТОЯНИЕ 6 — Лидер назначает задачу: временно́е отравление материализуется (T=+4500 мс)
```
Процесс PID:1001 выполняет:
  curl -X POST http://localhost:3001/api/internal/assign-task \
    -d '{"title":"Анализ модуля orchestrator","agentId":"agent_WORK","teamId":"team_alpha"}'

InternalService.assignTask():
  tasks.create({
    id: 'task_001',
    assigned_to: 'agent_WORK',
    created_at: Date.now() = T₀−7882+(4500−120) = T₀−7882+4380 = T₀−3502
  })
  ← КРИТИЧЕСКИ: task_001.created_at = T₀−3502 < turnStart = T₀+100
  ← Задача невидима для фильтра авто-пробуждения ← НЕОБРАТИМО ЗАПИСАНО В БД

eventBus.emit({kind:'task.assigned', taskId:'task_001', agentId:'agent_WORK'})
  → orchestratorHandler срабатывает синхронно (EventEmitter2)
  → handleTaskAssigned('task_001', 'agent_WORK') вызван
```
Отравление временно́й меткой зафиксировано в Postgres. Авто-пробуждение данного раунда уже обречено.

---

### СОСТОЯНИЕ 7 — Критическая гонка: перезапись `_lastProc` до обработки system-чанка лидера (T=+4500.1 мс)
```
handleTaskAssigned → spawnAgentForTask → runAgentInBackground (unawaited Promise)

pool.acquire(): running(1) < max(2) → running++ = 2, return Promise.resolve()
agents.updateStatus('agent_WORK', 'running')

ClaudeCliAdapter.run({message:'Task task_001: Анализ...', cwd:'.../agent_WORK'}) запущен:
  spawn('claude', [...]) → PID:1002, PGID:1002
  this._lastProc = ChildProcess{pid:1002}  ← ПЕРЕЗАПИСЫВАЕТ PID:1001!
  → yield {type:'system', subtype:'_process_started'}  ← воркер-генератор приостановлен

[ОКНО C2: for-await-продолжение лидера всё ещё в очереди микрозадач]

Потребитель воркера (runAgentInBackground for-await) возобновляется ПЕРВЫМ:
  chunk._process_started → getLastProcess() → PID:1002 ✓ (корректно для воркера)
  pool.register('agent_WORK', PID:1002) → OK

Затем потребитель лидера (handleTeamMessage for-await) возобновляется на 'text'-чанке:
  _lastProc = PID:1002 в этот момент
  Но system-чанк лидера уже обработан в СОСТОЯНИИ 4 — повторной регистрации нет
  
  [Инвариантное повреждение НЕ здесь, а при авто-пробуждении — см. СОСТОЯНИЕ 13]

Pool: {running:2, processes:{'agent_LEAD':PID:1001, 'agent_WORK':PID:1002}}
_lastProc: ChildProcess{pid:1002}  ← синглтон отравлен для будущих вызовов
```

---

### СОСТОЯНИЕ 8 — C3: TCP-буфер ядра насыщается, SSE-запись молча теряется (T=+4502 мс)
```
Серия событий за 40 мс создаёт нагрузку ~4.8 КБ:
  agent.started (воркер) + task.stage_changed + agent.thinking + agent.tool_use

TCP send-buffer SSE-соединения: 127 540/131 072 байт
(буфер заполнен предыдущим потоком мыслей лидера; браузер отстаёт)

reply.raw.write('data: {"kind":"agent.started","agentId":"agent_WORK",...}\n\n'):
  → writev() syscall → возвращает 1 (успех) ← ЛОЖНОЕ подтверждение
  → данные молча отброшены ядром при сбросе буфера
  → событие 'close' на сокете: НИКОГДА НЕ ГЕНЕРИРУЕТСЯ (соединение полуоткрыто)
  → unsubscribe() НЕ вызывается
  → обработчик sseTeamHandler: остаётся зарегистрированным на мёртвом соединении
  → каждое последующее событие: веерная рассылка, CPU-сериализация JSON, молчаливый дроп

Все 4 события (agent.started, task.stage_changed, agent.thinking, agent.tool_use): ПОТЕРЯНЫ

useStore (браузер):
  agents: [{agent_LEAD: status:'running'}, {agent_WORK: status:'idle'}]
  ← Воркер так и не получил статус 'running'
  ← UI отображает воркера как свободного
  ← Доска задач показывает task_001 в 'in_progress' (устаревшее состояние)
```
Модель мира в браузере необратимо расходится с реальностью. Механизма воспроизведения нет.

---

### СОСТОЯНИЕ 9 — Пользователь видит «простаивающий» воркер, повторяет запрос (T=+5100 мс)
```
Браузер useStore: {agent_WORK: 'idle'}
Пользователь интерпретирует это как ошибку и отправляет:
  POST /api/teams/team_alpha/message → 'Почему воркер не работает?'

handleTeamMessage('team_alpha', '...'):
  runningPipelines.has('team_alpha') → TRUE ← конвейер активен (лидер ещё работает)
  throw new ConflictException('A pipeline is already running for this team')
  → HTTP 409

Браузер: useStore.addNotification({type:'error', message:'Pipeline busy'}) → 7-секундный таймер
SSE мёртвый обработчик: получает eventBus.emit({kind:'conflict'}) → write() → drop → CPU без пользы

Информационная асимметрия: UI показывает воркера как idle, но система сообщает о занятом конвейере.
Пользователь не может диагностировать ситуацию из интерфейса.
```

---

### СОСТОЯНИЕ 10 — Воркер завершает задачу; авто-пробуждение c пустым контекстом (T=+9200 мс)
```
Воркер (PID:1002) завершает работу → for-await-цикл в runAgentInBackground исчерпан
pool.unregister('agent_WORK') → Pool.processes: {'agent_LEAD':PID:1001}
taskUpdatedByAgent = false → tasks.setResult('task_001', {...}) сохранён в БД
eventBus.emit({kind:'task.completed', taskId:'task_001'})

Проверка авто-пробуждения в runAgentInBackground:
  pendingTasks.filter(in_progress || planning) → [task_001] ← ещё in_progress у лидера

[Лидер завершается при T=+11 000 мс]
  agents.updateStatus('agent_LEAD', 'idle')
  runningPipelines.delete('team_alpha') ← finally-блок

Повторная проверка авто-пробуждения:
  pendingTasks.length === 0 ✓
  leader.status === 'idle' ✓
  !runningPipelines.has('team_alpha') ✓

  turnStart = turnStartedAt.get('team_alpha') = T₀+100
  thisRoundTasks = allTasks.filter(t =>
    t.created_at >= T₀+100 &&   ← task_001.created_at = T₀−3502 < T₀+100
    (t.stage === 'done' || t.stage === 'failed')
  )
  thisRoundTasks = []  ← ПУСТО (C1 отравил все временны́е метки)

wakeMessage = '[SYSTEM] Round completed but no tasks were created in this turn. ...'
setTimeout(2000, → handleTeamMessage('team_alpha', wakeMessage))
```
Авто-пробуждение сработает, но передаст лидеру контекст без списка задач. Лидер будет галлюцинировать результаты.

---

### СОСТОЯНИЕ 11 — C4: инверсия сериализации обновлений БД (T=+11 050 мс)
```
Последовательность обновлений статуса лидера в этом раунде:
  1. T=+140 мс:  UPDATE agent_LEAD.status = 'running' (спавн лидера)
  2. T=+11 000 мс: UPDATE agent_LEAD.status = 'idle' (лидер завершился)
  3. T=+13 002 мс: UPDATE agent_LEAD.status = 'running' (авто-пробуждение)
  4. T=+21 000 мс: UPDATE agent_LEAD.status = 'idle' (авто-пробуждение завершилось)

Запросы 3 и 4 отправлены на разные TCP-соединения пула pg:

  Соединение C: UPDATE status='running' отправлен первым (T=+13 002)
  Соединение D: UPDATE status='idle' отправлен вторым (T=+21 000)

C4 инвертирует доставку для пары (3,4):
  Соединение D коммитится в Postgres WAL на позиции 2041 (доставлен первым)
  Соединение C коммитится в Postgres WAL на позиции 2042 (доставлен вторым)

  Финальный статус в БД: agent_LEAD.status = 'running'  ← ПОСТОЯННО

No constraint violation. agent_LEAD работает как 'running' в БД без соответствующего
живого процесса в SessionPoolService.processes.
resetStaleAgents() исправил бы это, но выполняется только при onModuleInit (перезапуск NestJS).
```

---

### СОСТОЯНИЕ 12 — Стражи блокируют операции восстановления (T=+21 100 мс)
```
Попытка пользователя отправить новое сообщение (T=+25 000 мс):
  POST /api/teams/team_alpha/message → 'Что произошло?'

handleTeamMessage:
  runningPipelines.has('team_alpha') → FALSE ✓ конвейер свободен
  runningPipelines.add('team_alpha')

  [Лидер снова спавнится нормально — handleTeamMessage не проверяет DB-статус агента
   перед спавном, он просто вызывает ClaudeCliAdapter.run()]
  → PID:1003, успешная сессия
  → этот конкретный путь не блокируется статусом 'running' в БД

  НО: handleTaskAssigned проверяет:
    agents.findById(agentId) → agent_LEAD.status = 'running' (из C4)
    if (agent.status === 'running') { logger.warn(...); return; }
    ← ЛИДЕР НИКОГДА НЕ БУДЕТ ОБРАБОТАН КАК ВОРКЕР-ПОЛУЧАТЕЛЬ ЗАДАЧИ

  Критическое накопление: _lastProc = PID:1003 пока никто не перезаписал синглтон.
  Но следующий конкурентный вызов это изменит (СОСТОЯНИЕ 13).
```

---

### СОСТОЯНИЕ 13 — Гонка авто-пробуждения: регистрация чужого PID, появление осиротевшего процесса (T=+13 002 мс)
```
setTimeout(2000) из СОСТОЯНИЯ 10 срабатывает:
  handleTeamMessage('team_alpha', wakeMessage) ← новый конвейер

ClaudeCliAdapter.run({message:wakeMessage, cwd:'.../agent_LEAD'}):
  spawn → PID:1003, PGID:1003
  this._lastProc = PID:1003
  yield _process_started  ← лидер-пробуждение приостановлен

[В это же время task.assigned срабатывает для задачи из бэклога]
[runAgentInBackground стартует конкурентно]

ClaudeCliAdapter.run({message:'Task task_002...', cwd:'.../agent_WORK'}):
  spawn → PID:1004, PGID:1004
  this._lastProc = PID:1004  ← ПЕРЕЗАПИСЫВАЕТ PID:1003!
  yield _process_started

[ОКНО C2 снова открыто при 91.3% кучи]

Потребитель воркера резюмируется первым:
  getLastProcess() → PID:1004 ✓ (корректно)
  pool.register('agent_WORK2', PID:1004)

Потребитель пробуждения-лидера резюмируется:
  getLastProcess() → PID:1004 ← НЕВЕРНО (должен быть PID:1003!)
  pool.register('agent_LEAD', PID:1004)  ← лидер зарегистрирован с PID ВОРКЕРА!

Pool.processes: {'agent_LEAD': PID:1004, 'agent_WORK2': PID:1004}  ← дублирующий PID!
PID:1003 (реальный процесс пробуждения-лидера): РАБОТАЕТ, НЕ ОТСЛЕЖИВАЕТСЯ
```
PID:1003 — осиротевший процесс: работает с `--bypassPermissions`, имеет доступ к рабочему каталогу агента, способен выполнять curl-вызовы к `/api/internal/*`, но недосягаем для экстренной остановки через `pool.abortAll()`.

---

### СОСТОЯНИЕ 14 — Экстренная остановка уничтожает чужой процесс, осиротевший продолжает работу (T=+35 000 мс)
```
Пользователь нажимает экстренную остановку: POST /api/emergency-stop
AppController → pool.abortAll():
  agentIds = ['agent_LEAD', 'agent_WORK2']

  'agent_LEAD': processes.get('agent_LEAD') = PID:1004
    → process.kill(-1004, 'SIGTERM') ← убивает PGID:1004 (воркер, а не лидер!)
    
  'agent_WORK2': processes.get('agent_WORK2') = PID:1004
    → process.kill(-1004, 'SIGTERM') → ESRCH (уже завершён) → молча проигнорировано

  Ожидание 5 с → ни один процесс не выжил → processes.clear()
  running = 0, _aborting = false ← сброс

PID:1003 (осиротевший лидер):
  - Продолжает работу в фоне
  - cwd: .../team_alpha/agents/agent_LEAD
  - Флаги: --bypassPermissions, --output-format stream-json
  - Таймаут: DEFAULT_TIMEOUT_MS = 900 000 мс (15 минут)
  - Не получит SIGTERM никогда
  - За 15 минут: читает/пишет файлы в рабочем каталоге, вызывает /api/internal/assign-task
    → новые события task.assigned → спавн новых воркеров → рост очереди pool
    → _aborting=false → никакой страж это не остановит
```

---

### СОСТОЯНИЕ 15 — Полный системный коллапс (T=+35 100 мс)
```
СЛОЙ ПРОЦЕССОВ:
  PID:1003 (осиротевший лидер): работает, не отслеживается, генерирует фантомные задачи
  PID:1005, PID:1006: новые воркеры, порождённые фантомными назначениями от PID:1003
  Pool: {running:2, queue:[растёт...], processes:{'agent_WORK3':1005,'agent_WORK4':1006}}
  Счётчик pool.running: 2 (видимых) + 1 (осиротевший) = 3 реальных ← рассинхронизирован

СЛОЙ БАЗЫ ДАННЫХ:
  agent_LEAD.status = 'running' (C4-инверсия, постоянно, без блокировки нового спавна)
  task_001.created_at = T₀−3502 (C1-отравление, постоянно)
  Фантомные задачи: created_at ≈ T₀−7882+Δ < turnStart → невидимы для всех будущих раундов
  Сообщения от осиротевшего: персистируются с корректными ULID → «призрачные» сообщения в UI

СЛОЙ EVENT BUS / SSE:
  Мёртвый обработчик SSE: зарегистрирован навсегда, веерная рассылка на каждое событие
  EventEmitter2.listenerCount('gamma.team.team_alpha'): ≥2 (один мёртвый, один живой)
  Память: растёт — каждый tool_use осиротевшего вызывает trace.insert() + eventBus.emit()

СЛОЙ ИНТЕРФЕЙСА:
  Браузер: переподключается по SSE после 30-секундного таймаута heartbeat
  Новое SSE-соединение: нет воспроизведения пропущенных событий
  useStore.agents: [{agent_LEAD:'running'}, {agent_WORK:'idle'}, фантомные агенты мигают]
  Уведомления: накапливаются быстрее, чем истекают 7-секундные таймеры → каскад нотификаций

НЕВОЗМОЖНОСТЬ ВОССТАНОВЛЕНИЯ:
  ✗ Остановить PID:1003 нельзя без ручного kill (ps aux | grep claude; kill -PGID)
  ✗ resetStaleAgents() требует перезапуска NestJS (onModuleInit)
  ✗ SSE не воспроизводит пропущенные события — состояние браузера расходится безвозвратно
  ✗ Фантомные задачи с corrupted-временны́ми метками — round-scoping сломан для команды
  ✗ pnpm db:reset — единственный путь к чистому состоянию
```

---

## Отказоустойчивый парадокс (Новая архитектура)

### Монотонный Реакторный Граф с Каузальной Временно́й Печатью (МРГКВП)

Анализ 15-шаговой хронологии выявил четыре ортогональных класса отказа, которые компонуются нелинейно. Предлагаемая архитектура устраняет каждый структурно, а не защитными проверками.

---

#### Опора I: Логические часы вместо системного времени (устраняет C1)

Заменить все вызовы `Date.now()` монотонным счётчиком Лампорта `LamportClock`, хранимым per-team в памяти и персистируемым в Postgres. `turnStart` становится `turnTick: 42` — целое число, а не эпоха в миллисекундах. Задачи получают `lamport_tick` вместо `created_at`. Фильтр авто-пробуждения: `t.lamport_tick > turnStart_tick`. Логические часы монотонно возрастают вне зависимости от NTP-коррекций, часовых поясов и дрейфа.

Инкремент: `LOCK pg_advisory_xact_lock(teamId_hash); UPDATE team_clocks SET tick = tick + 1 WHERE team_id = ? RETURNING tick;` — атомарное увеличение внутри транзакции. Один Lamport-тик на операцию.

---

#### Опора II: Процессный токен с генерационным счётчиком (устраняет C2)

Упразднить `ClaudeCliAdapter._lastProc` как разделяемое мутабельное поле. Вместо этого каждый вызов `run()` создаёт `ProcessToken`:

```typescript
interface ProcessToken {
  agentId: string;
  generationId: string;  // ULID — уникален для каждого спавна
  proc: ChildProcess;
  spawnedAt_tick: number;  // Lamport-тик момента спавна
}
```

Токен передаётся потребителю **в полосе пропускания** через payload `yield`:

```typescript
yield { type: 'system', subtype: '_process_started', token } as StreamChunk;
```

Потребитель получает токен непосредственно из чанка — без разделяемого состояния, без временно́го разрыва между присвоением и чтением. Гонка `_lastProc` становится архитектурно невозможной.

---

#### Опора III: Подтверждённые SSE-записи с журналом событий (устраняет C3)

Ввести кольцевой буфер последних 200 событий per-team (`EventJournal`) в памяти. Каждое событие несёт монотонный порядковый номер `seq`. Протокол SSE:

1. При подключении клиент передаёт заголовок `Last-Event-ID: N`.
2. Сервер воспроизводит события `N+1..present` из `EventJournal` перед переключением в режим live-streaming.
3. `reply.raw.write()` проверяется: результат `false` означает обратное давление — запись откладывается в `DrainQueue` (FIFO) с привязкой к `seq`.
4. Обработчик `drain` на сокете разгружает `DrainQueue`.
5. Если `DrainQueue.depth > THRESHOLD` после `drain`-таймаута — соединение принудительно закрывается (`reply.raw.destroy()`), обработчик отписывается.

Никаких молча потерянных данных. Переподключение — всегда полная дельта с момента последнего подтверждённого события.

---

#### Опора IV: Статус агента как журнал событий (устраняет C4)

Упразднить колонку `agents.status`. Вместо `UPDATE agents SET status = ?` — только `INSERT`:

```sql
CREATE TABLE agent_status_events (
  agent_id  TEXT     NOT NULL,
  event     TEXT     NOT NULL,  -- 'running' | 'idle' | 'error'
  tick      BIGINT   NOT NULL,  -- Lamport-тик (Опора I)
  ts        BIGINT   NOT NULL,  -- wall clock (для диагностики, не для логики)
  PRIMARY KEY (agent_id, tick)
);
```

Текущий статус — материализованное представление:

```sql
SELECT event FROM agent_status_events
WHERE agent_id = $1 ORDER BY tick DESC LIMIT 1;
```

Поскольку `tick` монотонно возрастает (Lamport, Опора I), порядок доставки TCP-пакетов в Postgres не имеет значения — сортировка по `tick` всегда даёт семантически корректный результат. Инверсия C4 становится архитектурно безвредной.

---

#### Свойство конвергенции

При совместном применении всех четырёх опор:

| Ограничение | Механизм устранения | Класс гарантии |
|-------------|---------------------|----------------|
| C1 (NTP-регрессия) | Lamport-тики (Опора I) | Монотонность — математически строгая |
| C2 (Гонка _lastProc) | In-band ProcessToken (Опора II) | Структурная невозможность гонки |
| C3 (Фантомный дроп SSE) | Confirmed-write + EventJournal (Опора III) | At-least-once + идемпотентная обработка |
| C4 (Инверсия DB-обновлений) | Append-only статус + tick-сортировка (Опора IV) | Порядок доставки irrelevant |

Пятнадцатишаговый каскад становится невозможным: C1 не создаёт corrupted-временны́е метки, C2 не порождает осиротевших процессов, C3 не создаёт расходящихся UI-состояний, C4 не замораживает статус агентов. Система обретает **детерминированное поведение под произвольным порядком событий** — ключевое свойство распределённых систем, которое данная архитектура ранее не обеспечивала.

---

_Документ является теоретическим стресс-тестом. Производственная реализация Gamma Runtime v2 не затронута._
