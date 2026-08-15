# Chronos Engine — Архитектура

Канонический документ. При расхождении с диалогами/памятью агентов побеждает он.
История рассмотренных и отклонённых вариантов — в `DECISIONS.log`.

## Что это

Форк llama.cpp: свежий апстрим + KV-cache квантование из beellama.cpp + MoE-offload
оптимизации из codacus. Спекулятивное декодирование — только нативное апстримное
(DFlash, EAGLE3, MTP), собственные форки спекуляции не тащим.

## Базы

| Роль | Репо/ветка | Коммит | Дата |
|---|---|---|---|
| База | ggml-org/llama.cpp master | `e920c523e` | 2026-07-13 |
| Донор KV-стека | Anbeeld/beellama.cpp `v0.3.2` | `fe67745d` | 2026-07-10 |
| — его merge base с апстримом | | `d73cd076` | 2026-06-09 |
| Донор MoE-оптимизаций | thecodacus/llama.cpp `fable5/prefetch-experts` | `5e7f6271` | 2026-07-08 |
| Эталон turbo-цепочки | TheTom/llama-cpp-turboquant `feature/turboquant-kv-cache` | `471fb4ec8` | 2026-07-18 |

TheTom — первоисточник turbo-типов (beellama — его производная), ~300 коммитов
впереди апстрима, полный CUDA/Metal/ROCm-путь. Найден в ходе research H-10.
При расхождении turbo-поведения beellama vs TheTom эталоном считается TheTom.

Рабочая ветка: `chronos-main`. `master` — чистый трекер апстрима, не трогать.
Доноры лежат в `donors/` (отдельные клоны, не сабмодули).

## Скоуп порта

**Берём из beellama:**
- TurboQuant KV-cache: `turbo2/3/4` (WHT-ротация + PolarQuant/QJL)
- TCQ KV-cache: `turbo2/3/4_tcq` (trellis-coded, 256-1024 состояний)
- KVarN KV-cache: псевдотипы `kvarn2..8` (это НЕ GGML-типы; реализованы через
  оператор `GGML_OP_KVARN_VIEW` + собственные FA-кернели)
- Веса `TQ3_1S`/`TQ4_1S` (WHT-rotated Lloyd-Max, llama-quantize)
- Кеш-типы `q2_1/q3_0/q3_1/q6_0/q6_1` (bee-шные; bee-`q2_0` НЕ берём — см. D-009)
- Условно (Фаза 6): CopySpec (model-free спекуляция, suffix-tree),
  reasoning-loop protection (server-loop-guard)

**Скоуп бэкендов (D-008):** CPU + CUDA. Metal (+8.8k строк) и Vulkan (+420)
отложены — нетестируемы/вторичны на целевом железе; файлы перечислены в port-map.

**Берём из codacus (оба opt-in через env):**
- `GGML_CUDA_REGISTER_HOST=1` — pin mmap-страниц весов для DMA H2D
- `GGML_SCHED_PREFETCH_EXPERTS=1` — префетч экспертов вторым CUDA-стримом

**НЕ берём из beellama (см. DECISIONS.log D-001/D-002):**
- Собственный DFlash (в апстриме есть нативный, чище)
- DDTree branch verification, adaptive draft-max (profit/fringe),
  sampled verification — надстройки над выкинутым DFlash
- server-context DFlash-инфраструктура (~4.4k строк, из них по делу для нас ~52)

## Карта GGML type ID (D-005: вариант B, high-range)

Все форк-приватные типы живут в ID 200+ — апстрим туда не дотянется, обновления
базы никогда не конфликтуют. Совместимостью с bee-GGUF пожертвовали (реквант).

Порядок внутри 200+ — по битности (фактический маппинг Фазы 1; bee-порядок
не сохраняем, он был исторической случайностью):

| Тип | bee ID | Chronos ID |
|---|---|---|
| TURBO2_0 | 44 | 200 |
| TURBO3_0 | 42 | 201 |
| TURBO4_0 | 43 | 202 |
| TURBO2_TCQ | 46 | 203 |
| TURBO3_TCQ | 45 | 204 |
| TURBO4_TCQ | 55 | 205 |
| TQ3_1S | 47 | 206 |
| TQ4_1S | 48 | 207 |
| Q2_1 | 54 | 208 |
| Q3_0 | 51 | 209 |
| Q3_1 | 52 | 210 |
| Q6_0 | 49 | 211 |
| Q6_1 | 50 | 212 |
| Q2_0 | 53 | **ДРОП** — байт-сверка Фазы 1 показала несовместимость с апстримным Q2_0=42 (QK 64 vs 32, signed vs unsigned scale, interleaved vs sequential packing). Bee-версию не портируем (D-009) |

GGML_TYPE_COUNT при этом НЕ равен количеству типов — проверить, что апстримный
код нигде не итерирует 0..COUNT по плотному массиву без учёта дыр (ggml.c
type_traits — массив [GGML_TYPE_COUNT]; при high-range массив станет разреженным
на 200+ элементов, это дешёво, но проверить все места индексации обязательно).

KVarN ремапа не требует (псевдотипы CLI, нет enum-записей). Оператор
`GGML_OP_KVARN_VIEW` добавлять строго в КОНЕЦ enum ops.

## Принятые решения раунда 4 (2026-07-18)

### Turbo-цепочка: WHT-оператор, не rotation-matmul (G-1/G-2)
FWHT-ротация фьюзится в CUDA quantize-ядро (set_rows), обратный WHT — явный
`ggml_turbo_wht(..., 1)` в графе после flash-attn (как у TheTom). Тензоры
`turbo_rotation`/`turbo_rotation_inv` в KV-кеше — legacy для CUDA-пути,
оставлены для совместимости. CPU-путь: реальный `TURBO_WHT` (не no-op) +
полноценные quantize turbo2/3 (порт TheTom). Residual: auto-asymmetric K
(GQA≥6 → K=q8_0), тюнинг turbo4, Q pre-rotate для non-CUDA бэкендов.

### KVarN: seq_rm = FULL (O-6/O-8)
KVarN-контексты классифицируются `COMMON_CONTEXT_SEQ_RM_TYPE_FULL` — частичное
удаление диапазона невозможно по формату (группы по 128, compressed records).
Все call-site'ы частичного seq_rm в server-context гейтятся этой проверкой.

### Fit и kvarn (Z-1)
Fit-оценка KVarN-буфера точна (до долей MiB). Но: (1) kvarn требует полный
GPU-offload — ngl-редукция запрещена гардом; (2) fit не редуцирует явно
заданный `-c`; (3) дефолтный margin 1024 MiB на 8GB-карте с 6GB весов
отклоняет любой kvarn-конфиг. Решение: kvarn-запуски идут с `-fit off`,
`-c` подбирается вручную; тихую подмену пользовательского `-c` НЕ делаем.
Замеренный потолок (Qwythos, фон ~1.9GB): kvarn4 `-c 65536`, kvarn2 `-c 63488`
(65536 упирается в 64k-порог tail-групп).

### Grammar-порог под агентные tool-схемы
`MAX_REPETITION_THRESHOLD` 2000 → 200000: большие tool-схемы (Zed editor,
десятки инструментов) срабатывали на guard размером схемы, не патологией.

### Главный трек к 262K: tiered hot/cold KV-offload (H-10 + O-10)
Замеры и research сошлись: квантизацией KV 262K на 8GB не достигается —
бюджет съедают веса (5.9GB) + фон десктопа (1.3–1.9GB), на KV остаётся
0.2–0.8GB при потребности ~1.3GB (kvarn2@262K). Решение: hot-tier в VRAM
(kvarn F16 stage) + cold-tier в RAM (host-pinned kvarn-рекорды) с префетчем
по codacus-инфраструктуре (`prefetch_backend`/`prefetch_slots`/events).
Дизайн: `docs/design/tiered-kv-offload.md`. Phase 1 (hot-only attend) —
инфраструктура; цель «без явной потери качества» закрывают Phase 2 (H2O
heavy-hitters) / Phase 3 (periodic full attend). Alternatives (MLA,
cross-layer sharing) отклонены — требуют переобучения модели.

## Фазы (статус)

0. Развязка, карта дифа, type ID ремап — **готово** (2026-07-13)
1. Типы + CPU-путь (quants, ops, KVARN_VIEW) + байт-сверка q2_0 — **готово**
2. CUDA-кернели — **готово** (fwht, kvarn, TCQ, FA-семейства)
3. llama-уровень — **готово** (kvarn end-to-end живой: kvarn4@65536 смоки,
   seq_rm-гейтинг; turbo end-to-end живой после G-1/G-2: turbo3 ≈ f16 по t/s)
4. Scheduler + CLI — **готово** (turbo-типы в CLI-вайтлисте с 0f70a2d30)
5. codacus-патчи — **готово** (host-pin + expert-prefetch смержены)
6. CopySpec + loop-guard (условная) — не начата
7. Интеграционная валидация — **частично**: живые смоки kvarn2/4 и turbo3/4/tcq,
   стресс через chronos-host и Zed editor agent; НЕ сделано: test-backend-ops
   parity (эталон 13994/13994), формальный бенч vs baseline (pp512=2298/tg64=61),
   PPL/NIAH на длинном контексте
8. **Tiered hot/cold KV-offload** (новая, главный трек к 262K) — дизайн принят,
   реализация не начата. Фазы внутри трека — см. docs/design/tiered-kv-offload.md

Полная пофайловая разметка дифа: `docs/chronos-port-map.md`.

## Валидация

- Фаза 1: quant/dequant round-trip, MSE vs uniform, PPL-дельта на CPU
- Фаза 2+: numerical parity CPU vs CUDA, NIAH на удержание контекста
- Фаза 5: бенч связки pin+prefetch+kvarn на MoE (эта комбинация нигде не тестировалась)
- Железо: RTX 3070 8GB (sm_86), i5 12400F, 64GB DDR4

### Эталонная модель: models/main/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf (5.5G)

v3 той же линии (v2 — предыдущий чекпоинт, датасеты fable+mythos5),
архитектура и характеристики ниже не меняются между v2/v3.
- arch `qwen35` — ровно та, куда bee проводил KVarN wiring (Фаза 3: qwen35.cpp)
- гибрид SSM+attention: `full_attention_interval=4`, 33 слоя -> ~8 attention-слоёв
  с KV-кэшем, остальное SSM-state. Задействует llama-memory-hybrid* из порта.
  KVarN/turbo жмут только attention-слои; SSM-state не трогают
- K/V head dim 256, GQA 4 kv-головы — покрыто bee-кернелями (dkq256-инстансы)
- MTP (`nextn_predict_layers=1`) — апстримный spec-type mtp из коробки
- контекст до 1M (yarn x4 от 262k родных) — длинный контекст на 8GB VRAM и есть
  главный сценарий выгоды KV-сжатия; 5.5G весов + KV в 8GB впритык
- рядом mmproj (BF16, 880M) — мультимодалка через апстримный mtmd
- ограничение железа: 1M ctx = ~32GB KV в f16 (~8 attn-слоёв), с kvarn2 ~4GB;
  целиком в 8GB VRAM с весами не влезает — валидация 1M через частичный offload,
  чистый VRAM-тест на ~256-512k

### Эталон MoE (Фаза 5, prefetch-experts): InternScience/Agents-A1-Q4_K_M-GGUF
- arch `qwen35moe` — покрыта bee-wiring'ом Фазы 3, доп. проводки не требует
- 35B MoE (A3B-класс), Q4_K_M 21.2GB, ctx 262k
- сценарий: эксперты в RAM (64GB), активная часть на GPU; связка
  GGML_CUDA_REGISTER_HOST + GGML_SCHED_PREFETCH_EXPERTS + kvarn
- Qwythos (dense) prefetch-experts не задействует — MoE-трек только здесь

## Правила

- Апстримный AGENTS.md действует в части стиля кода (ASCII, лаконичные комменты).
  Запреты на PR в ggml-org нас не касаются, пока не контрибьютим обратно
  ("Private forks are exempt"). В апстрим ничего не пушим.
- Перенос — патч-серией на chronos-main, НЕ git-merge истории beellama.
