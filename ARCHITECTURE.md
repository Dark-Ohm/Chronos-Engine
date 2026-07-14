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

## Фазы (статус)

0. Развязка, карта дифа, type ID ремап — **готово** (2026-07-13)
1. Типы + CPU-путь (quants, ops, KVARN_VIEW) + байт-сверка q2_0
2. CUDA-кернели (fwht, cross-ring-interleave, kvarn, argmax/TCQ, FA-семейства,
   перегенерация template-instances через generate_cu_files.py)
3. llama-уровень (llama-kvarn.cpp, llama-kv-cache-kvarn.cpp/h, kv-cache/iswa,
   graph, model wiring: qwen35/qwen35moe/gemma4)
4. Scheduler + CLI (ggml-backend KVARN_VIEW split-логика, arg.cpp, loader)
5. codacus-патчи (независимый трек; финальная сборка ggml-backend.cpp после Ф.4)
6. CopySpec + loop-guard (условная)
7. Интеграционная валидация (RTX 3070 8GB — модели подбирать соразмерно)

Полная пофайловая разметка дифа: `docs/chronos-port-map.md`.

## Валидация

- Фаза 1: quant/dequant round-trip, MSE vs uniform, PPL-дельта на CPU
- Фаза 2+: numerical parity CPU vs CUDA, NIAH на удержание контекста
- Фаза 5: бенч связки pin+prefetch+kvarn на MoE (эта комбинация нигде не тестировалась)
- Железо: RTX 3070 8GB (sm_86), i5 12400F, 64GB DDR4

### Эталонная модель: models/main/Qwythos-9B-v2-MTP-Q4_K_M.gguf (5.5G)
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
