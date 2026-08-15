# T010-report — root cause найден и починен (--kv-hot-size ломает retrieval)

**Вердикт:** ЗАКРЫТ. Баг воспроизведён на HEAD, root cause найден
инструментацией, фикс проверен живым A/B: с `--kv-hot-size 4096` игла
находится (3/3 прогона), non-SWA без флага — без регресса.

## Root cause (не гипотеза из брифа)

`--kv-hot-size` на гибридной модели (Qwythos = qwen35: SSM + attention)
создаёт kvarn-кэш в фейковом SWA-режиме (`llama_kvarn_apply_hot_window`).
Для SWA-режима native-вью (`GGML_OP_KVARN_VIEW`) требует тензор
`mat_idxs` — абсолютную позицию каждого cell'а — который заполняется в
`llama_kv_cache_kvarn_context::set_input_kvarn_mat_idxs()`.

Но эта функция вызывается ТОЛЬКО из `llm_graph_input_attn_kv::set_input`
(чистый attention-путь) и `llm_graph_input_attn_kv_iswa::set_input`.
Гибридный путь (`llama_memory_hybrid` → `llm_graph_input_mem_hybrid`,
которым пользуется Qwythos) строит тот же тензор через
`build_attn_inp_kv_impl` (там он создаётся и биндится в контекст через
`set_mat_idxs`), но **в собственном `set_input` его никогда не
заполняет** — там только k_idxs / v_idxs / mask / rot.

Итог: `mat_idxs` остаётся неинициализированным буфером. FA-кернелы
(`MMA_KVARN`, `KVARN_WINDOWED`, `KVARN_DECODE_SPLIT`) читают мусорные
индексы, маппят cell'ы в случайные stage/record-слоты — нет краха
(буфер выделен, значения мусорные), но attention читает не те K/V →
мусорный вывод. Ровно симптом G-4 §3a: «не падает, отвечает мусором».

Доказательство инструментацией (T010_DEBUG, снято на живом сервере):
- `set_input_kvarn_mat_idxs` — НИ ОДНОГО вызова за весь запрос;
- store `k_idxs` заполняются корректно (абсолютные позиции 0..1450);
- `llm_graph_input_attn_kv::set_input` — не вызывается вовсе (гибрид
  использует `llm_graph_input_mem_hybrid::set_input`).

## Гипотеза брифа — опровергнута

Бриф предполагал рассинхрон пространств индексов store/view
(slot-индекс кольца vs растущая позиция). Проверено по коду и
симуляцией (`t010-sim.py`, воспроизводит точную арифметику
store/read/live_group для конфига hot-window):

- `set_input_k_idxs` (SWA) пишет в store `ubatch->pos[i]` — абсолютные
  позиции; `set_input_kvarn_mat_idxs` пишет во view `cells.pos_get(cell)`
  — тоже абсолютные позиции. Пространства СОВПАДАЮТ.
- Для короткого A/B (1451 токен, окно 4096) маппинг cell→slot полностью
  консистентен: 0 ошибок в симуляции на всех 7 ubatch'ах.
- Кольцо (stage ping-pong `group % 2`, record-ring `group % 32`, flush
  при `pos==0 && group >= tail_groups`, гейтинг live_group) самосогласован
  и для короткого, и для обёрнутого (5600+) случаев.

То есть индексы не были причиной: причина — неинициализированный тензор
`mat_idxs` на гибридном пути.

## Фикс (минимальный, зеркалит существующие паттерны)

`src/llama-graph.cpp` — 4 добавления:

1. `llm_graph_input_mem_hybrid::set_input` — заполнить
   `self_kvarn_mat_idxs` через `kvarn->set_input_kvarn_mat_idxs(...)`,
   зеркалит `llm_graph_input_attn_kv::set_input`.
2. `llm_graph_input_mem_hybrid::can_reuse` — re-bind
   `set_mat_idxs(...)`, зеркалит `llm_graph_input_attn_kv::can_reuse`.
3. `llm_graph_input_mem_hybrid_iswa::set_input` — то же для
   `self_kvarn_mat_idxs_swa`, зеркалит `llm_graph_input_attn_kv_iswa`.
4. `llm_graph_input_mem_hybrid_iswa::can_reuse` — re-bind для SWA.

Все четыре завёрнуты в `if (inp_attn->self_kvarn_mat_idxs ... &&
->buffer)` — тензор создаётся только когда `kvarn->is_swa()`, поэтому
для non-SWA kvarn и для не-kvarn путей блок инертен (изменений
поведения нет). Формат ring-слотов и семантика store-индексов НЕ тронуты.

`src/llama-kv-cache-kvarn.*` — не изменён (diff пустой).

## Верификация (живая, Qwythos-9B, build/bin, -c 8192 -ub 256 -fa on)

| Конфиг | prompt_tokens | Результат | HAS_NEEDLE |
|---|---|---|---|
| kvarn4, без флага (до фикса) | 1451 | `BLUE-ORBIT-7749` | True |
| kvarn4, `--kv-hot-size 4096` (до фикса) | 1451 | «lazy lazy lazy...» | **False** |
| kvarn4, `--kv-hot-size 4096` (после фикса) | 1451 | `BLUE-ORBIT-7749` | **True** |
| то же, повтор 1 | 1451 | `BLUE-ORBIT-7749` | True |
| то же, повтор 2 | 1451 | `BLUE-ORBIT-7749` | True |
| hot 4096, игла в конце | 1451 | `BLUE-ORBIT-7749` | True |
| hot 4096, промпт 5602 (> окна, кольцо оборачивается), игла внутри окна | 5602 | `BLUE-ORBIT-7749` | True |
| kvarn4, без флага (после фикса, регресс) | 1451 | `BLUE-ORBIT-7749` | True |

Плюс проверка маршрутизации FA (`GGML_CUDA_FA_ROUTE_DEBUG`): до фикса
`mat_idxs` не заполнялся; после фикса все три пути prefill/decode
(`MMA_KVARN`, `KVARN_WINDOWED`, `KVARN_DECODE_SPLIT`) используют
правильные per-cell позиции.

Сценарий «игла за пределами окна → не находится» остаётся поведением
ПО ДИЗАЙНУ Phase 1 (SWA-mask вырезает позиции старше окна) — это не
регрессия и не часть этого тикета.

## Артефакты

- `.chronos-ops/active/t010-sim.py` — симуляция индексов store/view
  (подтверждает консистентность кольца; опровергает гипотезу брифа).
- `.chronos-ops/active/t010-gen-niah.py` — генератор NIAH-промптов
  (короткий A/B, игла в начале/конце).
- Логи/ответы: `.chronos-ops/active/t010-live/` (26 файлов, перенесены из
  `/tmp` при приёмке — tmpfs не является хранилищем доказательств).
  Ключевые: `t010-hot-resp.json` (до фикса, hot 4096, prompt_tokens=1451,
  иглы нет, «lazy lazy» ×234), `t010-fixed-resp.json` (после,
  `BLUE-ORBIT-7749`), `t010-6k-resp.json` (5602 токена, кольцо
  оборачивается, игла найдена), `t010-base-resp.json` (без флага, регресса
  нет).

## Примечание для приёмки

Серверы экосистемы (llama-swap) на момент фикса были остановлены для
прогона и перезапущены; они работают на пересобранном `build/bin`
(фикс инертен для их конфигурации — они не используют `--kv-hot-size`).
Разблокирует T003b-pre (лаг `tail_groups`) и T003b/T003c.
