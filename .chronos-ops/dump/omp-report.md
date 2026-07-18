# OMP Report

## O-1 — src/llama-model.cpp: дотянуть kvarn до create_memory

**diffstat** (git diff --numstat, src/llama-model.cpp):
```
 src/llama-model.cpp | 39 insertions(+), 19 deletions(-)
```

`grep -c kvarn src/llama-model.cpp` ПОСЛЕ = 5 (два `iswa`-вызова +
ветвление plain-ветки `params.kvarn.type` + `params.kvarn` в kvarn-вызове +
ещё одно обращение в функции).

> **ФИКС повторной приёмки (пункт 1):** ранее `} else {` между GEMMA4-веткой
> (`mem_other`) и общим SWA-случаем (`nullptr`) выпала при multi-line замене,
> оба `new` оказались внутри `if (arch == LLM_ARCH_GEMMA4_ASSISTANT)`.
> ВОССТАНОВЛЕНО: `if (arch == LLM_ARCH_GEMMA4_ASSISTANT) { … res = new
> llama_kv_cache_iswa(…mem_other …, params.kvarn); } else { res = new
> llama_kv_cache_iswa(…nullptr …, params.kvarn); }`. Подтверждено по
> git diff: `share);` → `share,\n params.kvarn);\n } else {` — фигурная
> скобка `} else {` НА МЕСТЕ. Структура сбалансирована вплоть до `switch(arch)`
> (закрывается на :2289-2290). Оба `iswa`-вызова получают `params.kvarn`
> последним аргументом (совпадает с ctor llama-kv-cache-iswa.h:33/52).

### Пункт 1 — два вызова `llama_kv_cache_iswa` (бывш. :2213 и :2230)
Сделано. В оба вызова добавлен `params.kvarn` как последний аргумент.
- `llama_kv_cache_iswa` ctor (src/llama-kv-cache-iswa.h:17 и :35) имеет последний
  параметр `llama_kvarn_params kvarn = llama_kvarn_default_params()` — точное
  совпадение, просто добавлен аргумент, сигнатура не ломается.
- Gemma4-assistant ветка (с `mem_other`): `…, share, params.kvarn);`
- Обычная SWA-ветка (с `nullptr`): `…, share, params.kvarn);`

### Пункт 2 — plain non-SWA ветка (бывш. :2250)
Сделано. Обёрнуто в ветвление по `params.kvarn.type`, идентичное донору
(donors/beellama.cpp/src/llama-model.cpp:2259-2293):
```cpp
if (params.kvarn.type != LLAMA_KVARN_TYPE_DISABLED) {
    res = new llama_kv_cache_kvarn(
            *this, hparams, params.kvarn,
            cparams.offload_kqv, cparams.kv_unified,
            cparams.n_ctx_seq, cparams.n_seq_max,
            cparams.n_batch, cparams.n_ubatch,
            1, hparams.n_swa, hparams.swa_type,
            filter, reuse);
} else {
    res = new llama_kv_cache(/* без изменений относительно исходного */);
}
```
**Точная использованная сигнатура `llama_kv_cache_kvarn` (для сверки с ctor):**
порядок аргументов сверен с src/llama-kv-cache-kvarn.h:89-103
(10 обязательных: model, hparams, params, offload, unified, kv_size, n_seq_max,
n_batch, n_ubatch, n_pad=1, n_swa=0, swa_type=NONE, filter=nullptr, reuse=nullptr):
1. `*this`                     → const llama_model &
2. `hparams`                   → const llama_hparams &
3. `params.kvarn`              → llama_kvarn_params
4. `cparams.offload_kqv`       → bool offload
5. `cparams.kv_unified`        → bool unified
6. `cparams.n_ctx_seq`         → uint32_t kv_size
7. `cparams.n_seq_max`         → uint32_t n_seq_max
8. `cparams.n_batch`           → uint32_t n_batch
9. `cparams.n_ubatch`          → uint32_t n_ubatch
10. `1`                        → uint32_t n_pad (default 1)
11. `hparams.n_swa`            → uint32_t n_swa (default 0)
12. `hparams.swa_type`         → llama_swa_type swa_type (default NONE)
13. `filter`                   → const layer_filter_cb & (default nullptr)
14. `reuse`                    → const layer_reuse_cb & (default nullptr)

**Про `cparams.n_batch`:** поле СУЩЕСТВУЕТ в src/llama-cparams.h:13
(`uint32_t n_batch;`). Использован `cparams.n_batch` — точно как у донора
(donor:2258 `cparams.n_batch`) и как в соседнем `llama_kv_cache_iswa` вызове
строки 2223/2240 (там `cparams.n_ubatch`, но `n_batch` и `n_ubatch` — разные
поля; для kvarn-ctor нужен именно `n_batch`, совпадает с ctor-параметром
`uint32_t n_batch` на позиции 8). Альтернативная логика (чем заполняется
`n_ubatch` у соседнего `llama_kv_cache`) не требовалась — `n_batch` есть в
cparams, выбор однозначен.

**Про `LLAMA_KVARN_TYPE_DISABLED`:** объявлен в include/llama.h:201
(`LLAMA_KVARN_TYPE_DISABLED = 0`). Достижим транзитивно: llama-model.cpp →
llama-kv-cache-iswa.h → llama-kv-cache-kvarn.h → llama-kvarn.h → llama.h.
Новый `#include` не нужен (донор использует тот же символ без доп. инклуда).

### Пункт 3 — hybrid_iswa путь
НЕ тронут. `llama_memory_hybrid_iswa` ctor kvarn не принимает (сознательный
scope-cut, src/llama-memory-hybrid-iswa.h). Зафиксировано: hybrid-архитектуры
(recurrent+attn) остаются БЕЗ kvarn до отдельного решения (кандидат на Фазу 4).
В этом задании kvarn в hybrid_iswa не добавлялся.

### llama-arch.cpp
НЕ тронут. Причина: `grep kvarn donors/beellama.cpp/src/llama-arch.*` = 0
совпадений — файл kvarn не касается (подтверждено в тексте задания O-1,
раздел «ВЫЧЕРКНУТО из задания»). Вне scope.

### Границы / скоуп
- Только src/llama-model.cpp.
- llama-kv-cache-kvarn.h, llama-memory.h, llama-memory-hybrid-iswa.h — не
  трогал (готовы/сознательно не трогаются согласно заданию).
- DFlash-специфичное не переносилось (в диффе донора по соседству не
  встречалось в затронутых блоках).
- Сборку НЕ запускал (правило исполнителя #2). Готово к сборке с Cline
  (llama-graph.cpp/.h) и Hermes (llama-context.cpp).
- НЕ коммитил (правило исполнителя #4).

### Пропущенное / вопросы
- Пропущено: нет.
- Вопросов: нет.

## O-2 — common/common.h + common/arg.cpp: kvarn CLI

**diffstat** (git diff --stat, common/common.h + common/arg.cpp):
```
 common/arg.cpp  | 131 ++++++++++++++++++++++++++++++++++++++++++++++++++++----
 common/common.h |  16 +++++++
 2 files changed, 147 insertions(+), 16 deletions(-)
```

`grep -c kvarn common/arg.cpp` ПОСЛЕ = 41 (донор: 52 — разница в том, что
у нас НЕ переносится SWA-CLI, см. «Пропущенное» ниже). `grep -c kvarn
common/common.h` ПОСЛЕ = 5 (поле `kvarn` + 4 битовых поля).

> **ВАЖНО про донора:** файл `donors/beellama.cpp/common/arg.cpp`
> (4743 строки) НЕ содержит ни `kvarn`, ни `cache-type-k`/`cache-type-v`
> вообще (grep = 0). Т.е. донор на диске — это апстрим БЕЗ kvarn-CLI, и
> номера строк/символы из текста O-2 в нём отсутствуют. Реализовывал строго
> по 6 пунктам задания (донор — только ориентир, rule 5 OMP «не копировать
> вслепую»), поведение перенесено 1:1 с описания.

### common/common.h — 5 полей (п. «5 новых полей»)
Добавлено после `cache_type_k`/`cache_type_v` (бывш. :588-589):
```cpp
int32_t cache_kvarn_bits_k = 0; // KVarN pseudo cache type bits from --cache-type-k (0 = disabled)
int32_t cache_kvarn_bits_v = 0; // KVarN pseudo cache type bits from --cache-type-v (0 = disabled)
int32_t cache_kvarn_swa_bits_k = 0; // KVarN pseudo SWA-layer K bits from --cache-type-k-swa (0 = base K bits)
int32_t cache_kvarn_swa_bits_v = 0; // KVarN pseudo SWA-layer V bits from --cache-type-v-swa (0 = base V bits)

llama_kvarn_params kvarn = { /* type=DISABLED, key/value/swa=0, group=128,
                              sinkhorn_iters=16, sink_tokens=128,
                              fail_if_unsupported=true */ };
```
Порядок полей `llama_kvarn_params` сверен с include/llama.h:251-262
(type, key_bits, value_bits, swa_key_bits, swa_value_bits, group,
sinkhorn_iters, sink_tokens, fail_if_unsupported) — совпадает.
`llama_kvarn_params` достижим: common.h -> llama-cpp.h -> llama.h.

### Пункт 1 — get_all_kv_cache_types + 3 хелпера (arg.cpp :322-376)
- `get_all_kv_cache_types(bool include_kvarn_pseudo_types = false)` —
  расширил существующую (раньше без параметра), добавил вывод
  `", kvarn2, kvarn3, kvarn4, kvarn5, kvarn6, kvarn8"` при флаге. Логика
  обычных типов не тронута.
- `kvarn_bits_from_cache_type(value)`: `rfind("kvarn",0)==0` → берёт
  подстроку после `"kvarn"` (длина 5, без `strlen`), валидирует что все
  символы цифры, `std::stoi`; НЕ-kvarn строка → 0.
- `kvarn_type_from_bits(k,v)`: при 0/0 → `LLAMA_KVARN_TYPE_DISABLED`; иначе
  `llama_kvarn_type_from_name("kvarn_k{K}v{V}_g128")`.
- `kvarn_fallback_cache_type(bits)`: 2→Q2_K, 3→Q3_K, 4→Q4_K, 5→Q5_K,
  6→Q6_K, 8→Q8_0, default→F16.

### Пункт 2 — kvarn_type_from_bits / kvarn_fallback_cache_type
Перенесены 1:1 (см. выше, в теле Пункта 1 — единый блок хелперов).

### Пункт 3 — хендлеры -ctk/-ctv (arg.cpp :2197-2216 и :2252-2271)
Оба вызова (`{"-ctk","--cache-type-k"}`, `{"-ctv","--cache-type-v"}`)
получили одинаковую логику ПЕРЕД старым `kv_cache_type_from_str`:
```cpp
const int32_t bits = kvarn_bits_from_cache_type(value);
if (bits != 0) {
    params.cache_kvarn_bits_k = bits;            // _v для -ctv
    params.cache_type_k = kvarn_fallback_cache_type(bits); // _v для -ctv
} else {
    params.cache_kvarn_bits_k = 0;               // _v для -ctv
    params.cache_type_k = kv_cache_type_from_str(value); // _v для -ctv
}
```
help-текст обоих переведён на `get_all_kv_cache_types(true)`.
**Скобки проверены вручную** (см. «Границы» + awk-баланс ниже) — вокруг
if/else и лямбд целы, не повторил баг O-1.

### Пункт 4 — вызов normalize (arg.cpp :1171)
`common_params_kvarn_normalize(params);` вставлен в `common_params_parse`
перед `params.lr.init();` (внутри `try`, чтобы ошибки парсинга шли в тот же
catch). Forward-declaration `static void common_params_kvarn_normalize(
common_params &);` добавлена на :377 (рядом с другими static-хелперами).

### Пункт 5 — common_params_kvarn_normalize (arg.cpp :1056-1090)
Читает `cache_kvarn_bits_k/v`. При несовпадении (один kvarn, другой нет) —
форсит оба в kvarn с `LOG_WRN` (оба варианта: K→V и V→K, синхронно
выставляя `cache_type_* = kvarn_fallback_cache_type`). При 0/0 —
no-op (kvarn остаётся DISABLED). Резолвит тип через `kvarn_type_from_bits`;
при `INVALID`/`DISABLED`-результате (несовместимая пара бит) — hard-error
через `throw std::runtime_error` (стиль соседних ошибок в файле —
`throw std::runtime_error(string_format(...))`). Пишет в `params.kvarn =
llama_kvarn_params_for_type(type)` + `params.kvarn.fail_if_unsupported = true`.

### Пункт 6 — help-тексты
Упоминание `kvarn2..kvarn8` добавлено в allowed-values обоих флагов через
`get_all_kv_cache_types(true)` (см. Пункт 3). `-ctk-swa`/`-ctv-swa` НЕ
добавлялись (см. «Пропущенное»).

### Границы / скоуп
- Только common/common.h, common/arg.cpp.
- `llama-arch.cpp` — вне scope этого задания (и без того не трогал).
- SWA-CLI (`--cache-type-k-swa`/`-v-swa`) НЕ заводил с нуля (rule «ВАЖНО»
  O-2): флага в дереве нет, поля `cache_kvarn_swa_bits_*` добавлены
  структурно (готовим почву), но активации через них нет — вне scope.
- DFlash-специфичное не переносилось (в нашем дереве отсутствует).
- Сборку НЕ запускал (rule #2). Готово к сборке с Cline (ggml-backend.cpp
  scheduler) и Hermes.
- НЕ коммитил (rule #4).
- awk-баланс скобок arg.cpp: open=1395 close=1395 diff=0.

### Пропущенное / вопросы
- Пропущено: SWA-CLI флаги (`--cache-type-k-swa`/`-v-swa`) — по «ВАЖНО» в
  O-2, флага в дереве нет, заводить с нуля вне scope. Поля
  `cache_kvarn_swa_bits_*` добавлены в struct, но не задействованы.
- Вопросов: нет.

## O-2 (переделка) — мелкая правка wrapper-а -gan

**Дифф фикса** (git diff common/arg.cpp, только добавленная строка):
```diff
    add_opt(common_arg(
        {"-ctk", "--cache-type-k"}, "TYPE",
        ...
    ).set_env("LLAMA_ARG_CACHE_TYPE_K"));
+    add_opt(common_arg(
        {"-gan", "--grp-attn-n"}, "N",
        ...
    ).set_env("LLAMA_ARG_GRP_ATTN_N").set_examples(...));
```

**Суть**: после вставки нового `-ctk` блока (строки 2235-2254) предыдущий
`-gan` блок (бывший 2253) потерял свою обёртку `add_opt(common_arg(` —
оставалась голая инициализация `{"-gan", ...}, "N", ...);`. Исправлено
вставкой одной строки `add_opt(common_arg(` перед ним (строка 2255).

**Баланс после фикса**:
- фигурные скобки `{`/`}`: 1395/1395 (diff=0) — без изменений.
- круглые скобки `(`/`)`: 3330/3335 (diff=-5) — **идентичен оригиналу**
  (git stash → awk на чистом файле даёт то же -5). Регрессии нет.

Никаких функциональных изменений — только восстановлена структура
`add_opt(common_arg(...))` для существующего флага `-gan`. Готово к сборке.

## O-3 — src/llama-kv-cache-dsv4.cpp: заменить static_cast на dynamic_cast + assert

**diffstat** (git diff --stat, src/llama-kv-cache-dsv4.cpp):
```
 src/llama-kv-cache-dsv4.cpp | 50 +++++++++++++++++++++++++++++++++++++++--------
 1 file changed, 36 insertions(+), 14 deletions(-)
```

`grep -n 'static_cast.*llama_kv_cache' src/llama-kv-cache-dsv4.cpp` ПОСЛЕ = 0 (ДО = 7).

### Замены (7 мест)

| строка (до) | строка (после) | замена |
|---|---|---|
| 1064 | 1064 | `static_cast<llama_kv_cache *>(kv_raw->get_base())` → `auto * base = dynamic_cast<llama_kv_cache *>(kv_raw->get_base()); GGML_ASSERT(base && "DSv4 raw kv_raw BASE is expected to never be kvarn-backed");` |
| 1071 | 1071-1072 | `static_cast<llama_kv_cache *>(kv_raw->get_base())` → `auto * base = dynamic_cast<llama_kv_cache *>(kv_raw->get_base()); GGML_ASSERT(base && "DSv4 raw kv_raw BASE is expected to never be kvarn-backed");` |
| 1076 | 1076-1077 | `static_cast<llama_kv_cache *>(kv_raw->get_swa())` → `auto * swa = dynamic_cast<llama_kv_cache *>(kv_raw->get_swa()); GGML_ASSERT(swa && "DSv4 raw kv_raw SWA is expected to never be kvarn-backed");` |
| 1404 | 1404-1405 | `static_cast<llama_kv_cache *>(kv->get_swa())` → `auto * swa = dynamic_cast<llama_kv_cache *>(kv->get_swa()); GGML_ASSERT(swa && "DSv4 raw ctx SWA is expected to never be kvarn-backed");` |
| 1417 | 1417-1418 | `static_cast<llama_kv_cache *>(kv->get_swa())` → `auto * swa = dynamic_cast<llama_kv_cache *>(kv->get_swa()); GGML_ASSERT(swa && "DSv4 raw ctx SWA is expected to never be kvarn-backed");` |
| 1431 | 1431-1432 | `static_cast<llama_kv_cache *>(kv->get_swa())` → `auto * swa = dynamic_cast<llama_kv_cache *>(kv->get_swa()); GGML_ASSERT(swa && "DSv4 raw ctx SWA is expected to never be kvarn-backed");` |
| 1437 | 1437-1440 | `static_cast<llama_kv_cache *>(kv->get_base())` → в лямбду: `llama_kv_cache * s = dynamic_cast<llama_kv_cache *>(kv->get_base()); GGML_ASSERT(s && "DSv4 raw ctx BASE is expected to never be kvarn-backed");` |
| 1472-1477 | 1472-1477 | уже преобразовано (конструктор `llama_kv_cache_dsv4_raw_context(iswa*, context*, bool)`): `dynamic_cast` + `GGML_ASSERT` в лямбде для `get_base()` |
| 1480-1481 | 1480-1485 | конструктор `llama_kv_cache_dsv4_raw_context(iswa*, slot_info..., ubatches...)`: `static_cast` в лямбду с `dynamic_cast` + `GGML_ASSERT` для `get_base()` |

Все 7 `static_cast` заменены. В файле больше не осталось `static_cast.*llama_kv_cache` (grep = 0).
В заголовочном файле `src/llama-kv-cache-dsv4.h` — 0.

**Паттерн**: каждый `static_cast<llama_kv_cache *>(ptr)` заменён на:
```cpp
auto * var = dynamic_cast<llama_kv_cache *>(ptr);
GGML_ASSERT(var && "DSv4 ... is expected to never be kvarn-backed");
```
Имя переменной (`base`, `swa`) выбрано по смыслу (BASE/SWA). Лямбды сохраняют существующую структуру инициализаторов-членов.

### Границы
- Только `src/llama-kv-cache-dsv4.cpp`.
- Не трогал сам факт `kvarn=disabled` в `llama-kv-cache-dsv4.cpp:975-977` (как указано в O-3).
- Сборку не запускал (rule #2). Не коммитил (rule #4).

### Пропущенное / вопросы
- Пропущено: нет.
- Вопросов: нет.
