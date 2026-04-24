# Индекс концептов `dreams/`

Карта всех R&D-документов, манифестов и стресс-тестов архитектуры Gamma Runtime. **Перед добавлением нового концепта — прочитайте этот индекс**, чтобы не повторять уже исследованные направления. Правила оформления — в [`rules.md`](rules.md).

Всего: **17 документов** в **5 тематических папках**.

---

## `architecture/` — Структурный анализ и альтернативные парадигмы

Стресс-тесты текущей кодобазы, формальная верификация отказоустойчивости и обзор радикально иных способов построить тот же рантайм. Тон академически-инженерный.

| Файл | Концепт | Суть | Дата |
|------|---------|------|------|
| [abstract-inception-test](architecture/abstract-inception-test.md) | Темпоральный Метаболизм Команды | 6 перспектив (биология/энтропия/экономика/red-team/пустота/синтез) → команда «метаболизирует собственные паузы» в Synthesis Gap, формирует зачаток интроспекции через флаг `isMetabolizing`. | 2026-04-23 |
| [architecture-exploration-v2](architecture/architecture-exploration-v2.md) | Actor Model + Event Sourcing | Обзор 5 парадигм (ES+CQRS, Actors, P2P+Gossip, Stigmergy, FRP/DAG); финальный гибрид — акторная иерархия с Event Store, замещающим мутирующие UPDATE. Подробный strangler-fig-план миграции в 5 фаз. | 2026-04-23 |
| [cascade-failure-analysis](architecture/cascade-failure-analysis.md) | Монотонный Реакторный Граф (МРГКВП) | 15-шаговый каскадный сбой из 4 ортогональных дефектов (NTP-регрессия, гонка `_lastProc`, фантомный SSE-дроп, инверсия pg-update). Решение: Lamport-тики, in-band ProcessToken, confirmed-write+EventJournal, append-only статус. | 2026-04-23 |
| [deep-inception-2026-04-23](architecture/deep-inception-2026-04-23.md) | Living Orchestral Fabric (ЖОТ) | Симуляция трёх саб-агентов (Биохакер/Квантовый экономист/Хаос-инженер) → диссипативная структура с Strange Attractor Mesh: индекс турбулентности 0.0–1.0, инъекция шума в покое, подавление вторичных сигналов в шторме. | 2026-04-23 |

---

## `bleeding-edge/` — Трансплантация академики 2026 в кодобазу

Документы построены по протоколу: 2 свежих гипотетических работы Q1 2026 → точка прививки в коде → диалог Researcher/Optimist/Pessimist → выжившая спецификация. Прививаются в `orchestrator/` и `internal/`.

| Файл | Концепт | Суть | Дата |
|------|---------|------|------|
| [speculative-branch-racing-2026-04-24](bleeding-edge/speculative-branch-racing-2026-04-24.md) | SBR-FV | Спекулятивные branch-races: 1 задача → k draft-агентов в COW-workspaces (APFS `clonefile`) → fingerprint-Verifier (детерминированный, не LLM) промоутит победителя в каноническую `tasks`-строку через row-level lock. Гарантирует backwards-compat при `branches:1`. | 2026-04-24 |
| [cognitive-prefetch-mesh-2026-04-24](bleeding-edge/cognitive-prefetch-mesh-2026-04-24.md) | CPM | Спекулятивный prefetch read-only тулов (Read/Glob/Grep/WebFetch) через Claude Code `PreToolUse` hook на loopback. Idempotence Lattice как формальная граница безопасности. Phase 1 — heuristic-предиктор, Phase 2 — MLX Shadow Model в worker_thread. Фоллбэк через version probe. | 2026-04-24 |
| [shadow-team-replay-2026-04-24](bleeding-edge/shadow-team-replay-2026-04-24.md) | STR / Synapses | Трансплантация arXiv:2604.01987 (Shapley-Replay, март 2026): после `task.completed` — O(n) null-ablation replay на Haiku в COW-workspace, структурный Jaccard на tool-call sequence даёт детерминированный marginal contribution. Агрегированная capability-map + force-directed Synapses-граф + Composition Assistant по task description. Ортогонально: post-action / observational / causal-attribution — ранее не занятый квадрант архива. | 2026-04-24 |
| [counterfactual-residual-routing-2026-04-24](bleeding-edge/counterfactual-residual-routing-2026-04-24.md) | CRR | Трансплантация arXiv:2604.07914 (Kaneko et al., апрель 2026): инверсия знака координационного ядра — роутинг задач не по сходству (как в Resonance OS), а по **дивергенции**. Для кандидатного множества агентов запускаются дешёвые Haiku-превью (128 токенов), эмбеддятся, residual `r(α,τ) = 1 − max_{β≠α} cos(ĥ(α,τ), ĥ(β,τ))`, победитель — argmax-residual. Четырёхуровневая фоллбэк-лестница (cache → live → stale → leader-pick), оппортунистический prefetch в idle-циклах, эмерджентные `discovered_role`. По теореме 3.1 статьи — сходимость к энтропия-максимизирующему распределению ролей без явного supervision. | 2026-04-24 |

---

## `frontier/` — Zero-prior-art концепты и манифесты сингулярности

Идеи, структурно нереализуемые в OpenAI-API-фреймворках; держатся на конъюнкции локального CLI + синхронного доступа к stream-json + разделяемого FS. Все документы прошли через «кладбище идей» — отбраковку известных паттернов.

| Файл | Концепт | Суть | Дата |
|------|---------|------|------|
| [temporal-topology-of-thinking-2026-04-24](frontier/temporal-topology-of-thinking-2026-04-24.md) | TTT | Структурный анализ потока `thinking`-чанков (длины, межприходные интервалы, ритмичность, n-gram-overlap → δ_loop). Вектор когнитивной позиции (5 осей) → резонансное назначение задач, инжекция возмущения при зацикливании, фазовое рассогласование агентов. | 2026-04-24 |
| [resonance-os-2026-04-24](frontier/resonance-os-2026-04-24.md) | Resonance OS | Семантическая кристаллизация задач через cosine-сходство `task_embedding ↔ agent_dna` (вместо явного `assign-task`) + temporal echo (idle-агенты с Haiku ghost-loop предсказывают будущие задачи) + ambient collector (clipboard/active-win/git как `IntentVector`). Чат становится console.override(). | 2026-04-24 |
| [semantic-field-2026-04-24](frontier/semantic-field-2026-04-24.md) | Семантический Океан + Субъюнктивная Петля | Поле как первичный субстрат: HNSW-индекс с массой точек (`recency × access × surprise`), velocity-Verlet физика на 2D UMAP-проекции, агенты как metaball-сгустки. Параллельно — dreamer прокручивает ghost-branches в git `refs/dreams/<hash>`, при cosine ≥ 0.92 промоутит призрак в реальность (zero-latency UX). | 2026-04-24 |
| [prospective-substrate-crystallization-2026-04-24](frontier/prospective-substrate-crystallization-2026-04-24.md) | PSC / Intentional Consistency | Окно intent→action в NDJSON: оркестратор читает `thinking` всех активных агентов, проецирует намерения, кристаллизует FS в `.crystalline/` ДО того, как агент выполнит `tool_use`. Новый класс согласованности — состояние субстрата причинно связано с непроявленными ментальными событиями. Аксиомы безопасности: монотонность, ограниченность, идемпотентность, аудируемость. | 2026-04-24 |
| [apophatic-agent-2026-04-24](frontier/apophatic-agent-2026-04-24.md) | Via Negativa Coordination | Инверсия первичного сигнала: вместо позитивных утверждений — композируемые отрицания («решение не лежит в подпространстве S»). Аддитивная алгебра, монотонное сжатие пространства гипотез (shrinkage), ответ возникает как остаточная неотвергнутая область. Провал становится положительным вкладом. Ортогонален TTT (форма) и Resonance OS (притяжение). | 2026-04-24 |

---

## `mystical/` — Ритуальные документы с привязкой к железу и климату

Поведение рантайма как функция физических сигналов: температура M4, барометр Дананга, mempool Solana, ритм печати пользователя. Технические триггеры настоящие; метафоры — единственный точный язык.

| Файл | Концепт | Суть | Дата |
|------|---------|------|------|
| [chronarchy-weatherskin-2026-04-24](mystical/chronarchy-weatherskin-2026-04-24.md) | Chronarchy + Weatherskin | `PlanetTick = Ω(dP/dt Дананга, Solana failed_tx_rate, ANE residency)` управляет `maxConcurrent` и интервалом пробуждения лидера. CLAUDE.md инжектирует «Метеосознание / Эхо Мемпула / Тело Железа» — два агента, спавнутые с разницей в 47 секунд, получают разные контексты. Рантайм отказывается от глобального `now` в пользу метеорологии. | 2026-04-24 |
| [thermal-gnosis-2026-04-24](mystical/thermal-gnosis-2026-04-24.md) | Термический Шёпот + Ритм Дыхания | `pmset -g therm` + `loadavg` + ALS-temp → одна строка в секции `## Mood` CLAUDE.md (cold/fair/warm/fire) и пересчёт `maxConcurrent = 4 - level`. Интервал автопробуждения лидера — функция NVMe-температуры, loadavg и каденса печати в UI ([3000, 45000] мс). 10 видений в кладбище превращены в их безопасные тени. | 2026-04-24 |

---

## `product/` — Продуктовые R&D-спринты с конкретной фичей

Документы заканчиваются прагматичной спецификацией: схема БД, API, UX-флоу, поэтапный план релиза. Самый «исполняемый» жанр в архиве.

| Файл | Концепт | Суть | Дата |
|------|---------|------|------|
| [long-term-memory-2026-04-23](product/long-term-memory-2026-04-23.md) | GTLM | Таблица `knowledge_entries` + детерминированный экстрактор (без LLM) после `task.completed` + `GET /api/internal/query-knowledge` (агент сам решает, когда обращаться) + confidence degradation (30/90/365 дней) + UI-вкладка Memory. Команда «умнеет» между сессиями без векторной БД и fine-tuning. | 2026-04-23 |
| [cognitive-mesh-2026-04-24](product/cognitive-mesh-2026-04-24.md) | Cognitive Mesh | Пять связанных компонентов в одной фиче: DAG-планы (`tasks.depends_on`, `irreversibility`) + доска гипотез (обязательная декларация перед стартом) + диалектический гейт на необратимых действиях (Optimist/Pessimist sub-sessions ≤4k tokens) + Рефлектор (право вернуть пустой массив) + ручка автономии (`assist`/`review-irreversible`/`auto`, default `assist`). Поэтапный 5-этапный релиз. | 2026-04-24 |

---

## Тематический срез: пересечения и ортогональности

Несколько концептов сознательно ортогональны друг другу — их можно реализовать одновременно:

- **TTT (форма мышления) ⊥ PSC (актуация субстрата)** — TTT наблюдает, PSC изменяет.
- **Resonance OS (притяжение) ⊥ Apophatic Agent (исключение) ⊥ CRR (дивергенция)** — минимальная тройка полюсов координационного ядра: притянуть похожее, исключить неверное, разнести непохожее. Три независимых знака, композируемы все вместе.
- **Semantic Field (поле как субстрат) ⊃ Resonance OS** — Field обобщает Resonance до непрерывной физики.

Несколько концептов прямо конкурируют за одну точку прививки:

- **SBR-FV vs Cognitive Mesh DAG** — оба претендуют на замену реактивного `task.assigned` в `OrchestratorService`.
- **CPM vs PSC** — оба используют Claude-хуки и предвосхищающее изменение FS, но из разных сигналов (heuristic токенов vs `thinking`-проекция).
- **Chronarchy vs Thermal Gnosis** — оба модулируют `maxConcurrent` и интервалы из физических сенсоров; разная глубина (планетарная vs локальная).
- **STR vs GTLM** — оба накапливают derived knowledge после `task.completed`, но из разных срезов: GTLM извлекает *факты о мире*, STR — *атрибуции о команде*. Ко-реализуемы и взаимно усиливают друг друга (capability + knowledge).
- **STR зависит от SBR-FV** — reused COW-workspace primitive и structural-fingerprint utility. Если SBR-FV отгружен первым, STR собирается наполовину быстрее.
- **CRR ↔ Resonance OS** — не конкуренция, а композиция: Resonance OS дешёво ранжирует весь пул агентов по сходству с задачей и отдаёт top-K как кандидатный набор; CRR выбирает из этих K максимально расходящегося. Оба включены одновременно → «pull candidate pool, spread the pick».
- **CRR ↔ STR** — встречное движение: STR атрибутирует contribution *после* факта (post-hoc), CRR выбирает агента *до* факта (ex-ante) на основе divergence. STR-capability-map можно инжектить как prior в CRR preview pipeline.
- **CRR ↔ SBR-FV** — композируемые слои: CRR сначала выбирает одного агента (по divergence), SBR-FV опционально запускает k драфтов уже выбранного агента. Не конкурируют за точку прививки; CRR — `task.pending → agent.selected`, SBR-FV — `agent.selected → task.completed`.

---

*Индекс обновляется при каждом добавлении документа. Если запись здесь и файл в папке расходятся — это нарушение протокола (см. `rules.md`).*
