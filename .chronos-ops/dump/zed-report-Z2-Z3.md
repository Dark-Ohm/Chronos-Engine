# Z-3 — Диагностика segfault на `--kv-hot-size` (Z-2 не смокнулся)

## Статус: ГОТОВО К СБОРКЕ

Сегфолт устранён адресным фиксом. С `--kv-hot-size 4096` сервер поднимается
(`listening on http://127.0.0.1:8099`), декодит, качество на длинном контексте
деградирует по дизайну (Phase 1, hot-окно) — это ожидаемо, не баг. Без флага
поведение идентично до-Z-2 (гарантировано: весь новый путь под `if (kvarn->is_swa())`,
а `is_swa()` true только при `kv_hot_size > 0`).

---

## Точный кадр падения

```
#0  ggml_kvarn_view (ggml/src/ggml.c:6561)
#1  llama_kv_cache_kvarn::view (src/llama-kv-cache-kvarn.cpp:1406)
#2  llama_kv_cache_kvarn_context::get_k_native (src/llama-kv-cache-kvarn.cpp:271)
#3  llm_graph_context::build_attn (src/llama-graph.cpp:2932)
#4  llama_model_qwen35::graph::build_layer_attn
...
#8  llama_context::graph_reserve
#9  llama_context::resolve_fused_ops
#10 llama_context::sched_reserve
#11 llama_context::llama_context   ← падение на этапе создания контекста, ДО первого decode
```

`ggml_kvarn_view` (ggml.c:6561-6603) делает `GGML_ASSERT` на аргументах, затем
разыменовывает `indices->type` / `indices->ne[...]`. В Release-сборке ассерты
вырезаны, поэтому плохой/null `indices` сегфолтит вместо `abort()` с сообщением.

## Корневая причина

`llama_kv_cache_kvarn::view` (llama-kv-cache-kvarn.cpp:1404):

```cpp
ggml_tensor * indices = swa ? mat_idxs : stored->src[1];
```

Для SWA-кольца (`swa == true`) индексы берутся из `mat_idxs` — поля
`llama_kv_cache_kvarn_context::mat_idxs`, которое заполняется только в
`set_input`/`can_reuse` (из `set_input_kvarn_mat_idxs`). Но `get_k_native`/
`get_v_native` вызываются **во время построения графа** (`sched_reserve` →
`graph_reserve`), то есть ДО того, как `set_input` наполнит `mat_idxs`.

Асимметрия между двумя путями SWA-KVarN:

- **iswa-путь** (`llama_kv_cache_iswa` + `llama_kv_cache_kvarn` как SWA-часть):
  в `build_attn_inp_kv_iswa` (llama-graph.cpp:3395-3405) явно строит
  `self_kvarn_mat_idxs_swa` и сразу зовёт
  `const_cast<...>(kvarn_swa)->set_mat_idxs(...)` — то есть `mat_idxs`
  доступен УЖЕ на этапе build. Поэтому iswa-путь не падает.
- **основной kvarn-путь** (`llama_kv_cache_kvarn` как главный кеш, через
  `build_attn_inp_kv_impl`, llama-graph.cpp:2830-2858): строит только
  `self_kvarn_rot_*`, НЕ строит `mat_idxs` и НЕ зовёт `set_mat_idxs`.
  `mat_idxs` остаётся `nullptr` (инициализатор в .h:84).

`--kv-hot-size` включает `llama_kvarn_apply_hot_window` (llama-model.cpp:2037-2048),
который принудительно переключает главный kvarn-кеш в SWA-STANDARD. Именно поэтому
симптом проявляется ТОЛЬКО с флагом: без флага `swa == false`, и `view` берёт
`indices = stored->src[1]` (валидный тензор из `store`), а не `mat_idxs`.

Почему падает именно на `sched_reserve` (до первого decode): контекст при создании
резервирует граф (`sched_reserve` → `resolve_fused_ops` → `graph_reserve`), и
`build_attn` выполняет `get_k_native`/`get_v_native`, передавая `nullptr` как
`indices` в `ggml_kvarn_view`, который разыменовывает null.

## Две гипотезы из ZED.md — ПРОВЕРЕНЫ, ОТВЕРГНУТЫ

1. **Рассинхрон n_swa/swa_type main↔metadata** — ОТВЕРГНУТА. Вложенный
   `metadata` `llama_kv_cache` создаётся в кторе `llama_kv_cache_kvarn`
   (llama-kv-cache-kvarn.cpp:523-539) с теми же переопределёнными `n_swa`/
   `swa_type`, что и основной кеш (они приходят одним и тем же аргументом
   `swa_type` из `llama_kvarn_apply_hot_window`). Синхрон есть.
2. **Порядок инициализации полей ctor (UB)** — ОТВЕРГНУТА. Порядок объявления
   в `llama-kv-cache-kvarn.h:212-230` совпадает с порядком init-list
   (llama-kv-cache-kvarn.cpp:498-522). `cold_groups_per_stream` (объявлена :230)
   читает только `cold_offload` (:229) и `n_groups_per_stream` (:220), оба
   объявлены раньше. Рассинхрона нет, UB исключён.

## Фикс

Зеркалирует iswa-путь для основного kvarn-кеша. Весь новый код под
`if (kvarn->is_swa())`, то есть активируется только при `--kv-hot-size`
(`is_swa()` true ⇔ `kv_hot_size > 0`, см. ктор :507/:519). Без флага —
нулевое поведенческое изменение.

### `src/llama-graph.h`
- `llm_graph_input_attn_kv`: добавлено поле `ggml_tensor * self_kvarn_mat_idxs = nullptr;`
  (рядом с `self_kvarn_rot_*`, :344-352).

### `src/llama-graph.cpp`
- `build_attn_inp_kv_impl` (ок. :2866): при `kvarn->is_swa()` строит
  `self_kvarn_mat_idxs = kvarn->build_input_kvarn_mat_idxs(ctx0)` и сразу
  `const_cast<...>(kvarn)->set_mat_idxs(self_kvarn_mat_idxs)` — делает индексы
  доступными на этапе build (как iswa-путь в :3404).
- `llm_graph_input_attn_kv::set_input` (ок. :657): при наличии
  `self_kvarn_mat_idxs->buffer` зовёт `kvarn->set_input_kvarn_mat_idxs(...)`
  (наполняет per-cell абсолютные позиции из metadata cells, как iswa :773-777).
- `llm_graph_input_attn_kv::can_reuse` (ок. :666): при наличии
  `self_kvarn_mat_idxs->buffer` перевязывает `set_mat_idxs` на (возможно новый)
  kvarn-контекст (как iswa :815-820).

### `src/llama-kv-cache-kvarn.h` / `.cpp`
- Добавлен публичный аксессор `llama_kv_cache_kvarn_context::is_swa()`
  (делегирует в `cache->is_swa()`), т.к. `cache` приватен. Без него граф-код
  не мог бы проверить SWA-режим контекста.

## Живая проверка

Фон перед замером: **~1583–1615 MiB** (RTX 3070 8GB).

```
PORT=8099 KVARN_K=4 KVARN_V=4 ./run-server.sh qwythos-v3 \
    -c 65536 -ub 256 -fit off --kv-hot-size 4096
```

- Раньше: `Segmentation fault (core dumped)` сразу после
  "KVarN requires Flash Attention; enabling it".
- Теперь: `llama_server: listening on http://127.0.0.1:8099`, процесс живёт
  весь таймаут (90s), не падает.
- Completion-тест: prompt `"The capital of France is"` →
  `" Paris."` (32 токена сгенерировано, `stop:true`). Декод работает.
- VRAM после подъёма: ~7124 MiB (в рамках 8GB; фон + kvarn4@65536 + hot-window
  ring + cold host-буферы).

## Что НЕ входило / не трогалось

- `ggml-backend.cpp` не менялся (только добавления разрешены по границам Z-2 —
  здесь не понадобилось).
- Cold-offload store/выгрузка (`enqueue_cold_offloads` и т.п.) не трогалась —
  падение было в view-пути, не в offload-пути.
- turbo-код (ggml-turbo-quant.c, WHT) не трогался.
- Качество на длинном контексте в Phase 1 деградирует по дизайну (только
  hot-окно участвует в attend) — это не регрессия от фикса.

## План смока для Архитектора

Без флага (поведение идентично до-Z-2, регрессии нет — уже проверено живьём):
```
cd models/main && PORT=8099 KVARN_K=4 KVARN_V=4 ./run-server.sh qwythos-v3 -c 65536 -ub 256 -fit off
```

С флагом (фикс проверен выше):
```
cd models/main && PORT=8099 KVARN_K=4 KVARN_V=4 ./run-server.sh qwythos-v3 -c 65536 -ub 256 -fit off --kv-hot-size 4096
```
Ожидается: сервер слушает, декод идёт, качество на длинном контексте ниже
базового (hot-window SWA) — по дизайну Phase 1.
