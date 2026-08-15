# T003a — H2O: поля + `--kv-h2o-groups` (БЕЗ кернела/графа) — ОТЧЁТ

**Статус:** выполнено, проверено live (Qwythos-9B, build/bin, GPU).
**Ветка:** H2O Phase 2, срез полей и CLI. T010 закрыт ранее — гейт снят.

## Diffstat

```
 common/arg.cpp               | 12 ++++
 common/common.cpp            |  1 +
 common/common.h              |  7 ++
 include/llama.h              |  9 +++
 src/llama-context.cpp        |  5 ++
 src/llama-cparams.h          |  5 ++
 src/llama-kv-cache-iswa.cpp  |  2 +-
 src/llama-kv-cache-kvarn.cpp | 33 +++++
 src/llama-kv-cache-kvarn.h   | 35 +++++
 src/llama-memory-hybrid.cpp  |  4 +-
 src/llama-memory-hybrid.h    |  5 +-
 src/llama-model.cpp          |  4 +-
 12 files changed, 118 insertions(+), 4 deletions(-)
```

Плюс один файл вне списка тикета: `src/llama-kv-cache-iswa.cpp` (см. ниже).

## Где живут новые поля и флаг (файл:строка, HEAD после правок)

**Поля в `llama_kv_cache_kvarn`** (`src/llama-kv-cache-kvarn.h`):
- `h2o_group_flags` — `std::vector<uint32_t>` внутри `struct layer`, строка 236.
  Упакованный per-layer bitmask: слово g, бит g = группа g, размер
  `ceil(max_groups / 32)` слов.
- `h2o_group_scores` — `std::vector<float>` внутри `struct layer`, строка 237.
  Плоский `[n_head_kv][max_groups]` на слой, занулённый.
- `h2o_groups` (эффективное число пинов после клампа), `const`, строка 268.
- `h2o_enabled` (производный гейт, по образцу `cold_offload`), `const`, строка 269.
- Аксессоры: `has_h2o()` / `get_h2o_groups()`, строки 167-168.
- Параметр ctor `uint32_t kv_h2o_groups = 0` — строка 115 (рядом с
  `kv_hot_size`, как и требует SPEC §5.6 «alongside kv_hot_size»).

**Ctor** (`src/llama-kv-cache-kvarn.cpp`):
- Константа потолка `KVAR_H2O_RING_FRACTION_DIVISOR = 4` (пин <= 1/4
  ёмкости кольца на поток) — строка 29.
- Кламп в init-листе — строки 536-538: `min(requested, max(1, n_groups_per_stream / 4))`;
  ненулевой запрос никогда не становится молчаливым нулём.
- Предупреждение о клампе — строки 588-590 (`LLAMA_LOG_WARN`).
- Аллокация буферов в цикле слоёв — строки 795-797; только при
  `h2o_enabled`. `max_groups = ceil(kv_size / 128)` — строка 634.
- Итоговая сводка `LLAMA_LOG_INFO` — строка 805.

**CLI-проводка** (по образцу `kv_hot_size`, один в один):
- `common/arg.cpp:2307` — флаг `--kv-h2o-groups N`. Единицы ГРУППЫ (128
  токенов), БЕЗ округления к 128; help-текст прямо называет отличие от
  `--kv-hot-size` (токены + округление). `value <= 0` -> 0.
  Env: `LLAMA_ARG_KV_H2O_GROUPS`.
- `common/common.h:617` — `uint32_t kv_h2o_groups = 0;`
- `common/common.cpp:1640` — `cparams.kv_h2o_groups = params.kv_h2o_groups;`
- `include/llama.h:491` — поле `llama_context_params::kv_h2o_groups`
  (в конце структуры; все инициализаторы идут через
  `llama_context_default_params()` — ни один позиционный init не ломается).
- `src/llama-cparams.h:76` — `uint32_t kv_h2o_groups = 0;`
- `src/llama-context.cpp:125` — копия в cparams; лог строки 295-296;
  дефолт `/*.kv_h2o_groups =*/ 0` строка 3485.
- `src/llama-model.cpp:2182` (hybrid-путь) и `:2303` (прямой kvarn-путь) —
  `params.kvarn.type != LLAMA_KVARN_TYPE_DISABLED ? cparams.kv_h2o_groups : 0`.
- `src/llama-memory-hybrid.h:51` / `.cpp:36,69` — сквозной параметр в ctor
  `llama_memory_hybrid` -> ctor `llama_kv_cache_kvarn`.
- `src/llama-kv-cache-iswa.cpp:125` — `/*kv_h2o_groups=*/0`.

## Проверка форм (как требует тикет)

- `h2o_group_flags` — форма `[max_groups][n_layers]`: да, реализована как
  per-layer упакованный bitmask (слово/бит на группу, `ceil(max_groups/32)`
  слов на слой). Организация выбрана в стиле класса: per-layer структуры
  (`layer.k_records`, `v_stage`, `host_cold_*` и соседи) — единственный
  прецедент хранения в этом классе; плоского глобального вектора нет.
- `h2o_group_scores` — форма `[n_kv_heads][max_groups][n_layers]`: да,
  реализована как per-layer `[n_head_kv][max_groups]` float (индекс
  `head * max_groups + group`), размерность слоёв несёт вектор `layers`.
  Для Qwythos: 8 слоёв x (4 головы x 64 группы x 4 Б) = 8192 Б скоры +
  флаги 8 x (2 слова x 4 Б) = 64 Б. В логе: 8256 байт суммарно.
- `h2o_key_scores` — ОТСУТСТВУЕТ (мёртвое имя из старой редакции, не заведено).
- `h2o_groups` / `h2o_enabled` — по образцу `kv_hot_size`/`cold_offload`.
- Слота `cparams.kvarn.h2o_groups` НЕТ — флаг живёт рядом с kvarn, как
  `kv_hot_size`.

## Потолок пина

`h2o_groups <= max(1, n_groups_per_stream / 4)`, кламп в ctor с
`LLAMA_LOG_WARN`, не молча. Конкретное значение делителя (1/4) в SPEC
не задано числом («fraction», «Default kept conservative») — выбрана
консервативная 1/4 и задокументирована в коде (строка 29). Если Архитектор
хочет другое значение — одна строка в `llama-kv-cache-kvarn.cpp`.

## Верификация (live, Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf, -c 8192)

| Конфиг | Результат |
|---|---|
| Без флага (default 0) | `KVarN cache: stage_groups=7 tail_groups=6`; 0 строк `KVarN H2O`; буферы не аллоцируются (`h2o_enabled=false`) |
| `--kv-hot-size 512 --kv-h2o-groups 16` | Кламп: `W KVarN H2O: --kv-h2o-groups 16 exceeds the pin cap (1 groups = 1/4 of ring capacity 4 groups/stream); clamped to 1`; сводка `pinning up to 1 groups per layer across 8 layers` |
| `--kv-hot-size 4096 --kv-h2o-groups 4` | Без клампа: `pinning up to 4 groups per layer across 8 layers (32 groups/stream ring, cap 1/4), 8256 bytes`; сервер поднялся, генерация идёт (finish=length на 64 токенах — штатное поведение reasoning-модели) |
| `--help` | Флаг виден; help называет единицы (группы, не токены) и отсутствие округления |

**«Без флага — 0 изменений в поведении»:** подтверждаю. Путь кода при
`kv_h2o_groups == 0` идентичен прошлому: ctor не клампит (ветка не
заходит), `h2o_enabled=false`, цикл слоёв не аллоцирует (две строки под
`if (h2o_enabled)`), ни одна существующая ветка store/view/flush не
тронута. Единственное отличие в бинарнике без флага — два const-члена,
инициализированные константами, и неактивные ветки. Сравнение логов
запуска с флагом и без: отличается только добавленными строками `KVarN H2O`.

## Сознательно не вошедшее

- Накопление скоров в attention-пути (T003c).
- Любой выбор top-K и запись битов `h2o_group_flags` (T003c).
- Пин против перезаписи в кольце, правки `store()`/`view()`/live-set,
  prefetch-слоты (T003c/T003b).
- `ggml-cuda/`, `llama-graph.*`, `llama-kvarn.*` — не тронуты.
- `docs/design/h2o-heavy-hitters-PHASE2-SPEC.md` — не правился (канон в
  порядке после T003d).
- Флаг `--kv-h2o-prefill-only` — не заводился (удалён из SPEC в T003d).

## Примечания для приёмки

1. `src/llama-kv-cache-iswa.cpp` — единственный файл вне списка тикета.
   Правка механическая (передача `/*kv_h2o_groups=*/0` в ctor), вызвана
   размещением нового параметра сразу после `kv_hot_size` — ровно как
   сам `kv_hot_size` когда-то потребовал той же правки на этом вызове.
   Без неё сборка падает (позиционный аргумент `layer_filter` попадает в
   `kv_h2o_groups`).
2. Дефолт флага — 0 (opt-in, как `kv_hot_size`), хотя SPEC §3.3 пишет
   «Default: 16 H2O groups». Это конфигурационная рекомендация таблицы
   бюджетов, а не дефолт CLI; критерий приёмки тикета («без флага —
   h2o_enabled=false, поля не аллоцируются») требует именно 0.
3. Пример SPEC «512 hot + 16 h2o» физически за пределами потолка (кольцо
   при 512-токенном окне ~4-6 групп -> cap 1). Кламп честно предупреждает;
   сам SPEC-табличный конфиг не достижим на маленьком окне — вопрос к
   Архитектору, не к этому срезу.
