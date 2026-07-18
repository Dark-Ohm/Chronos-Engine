# Z-1 отчёт: kvarn2 не влезает там, где влезал kvarn4

## Вердикт

**Оценка fit честная, бага в подсчёте KV-памяти по kvarn-битности нет.**
Живые прогоны (RTX 3070 8GB, тот же `Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf`,
фон ~1.86-1.9GB) показывают, что `common_fit_params`/`common_get_device_memory_data_impl`
предсказывают размер KVarN-буфера **с точностью до долей MiB** — не переоценка,
не недооценка. Разница в поведении kvarn4@65536 (в HANDOFF: "поднялся") vs
kvarn2@49152/65536 (в задании: "отказ на fit") объясняется тремя факторами,
none из которых — ошибка в kvarn-битности:

1. Модельные веса (5058.83 MiB, Q4_K_M) + RS-буфер гибрида (SSM-state,
   201 MiB, не зависит от kvarn/ctx) + compute-буфер (~70-80 MiB) — это
   **~90% всего бюджета** 8GB-карты. KV-кеш (даже полный fp16) — это
   только 8 слоёв внимания из ~33 (остальное — Gated Delta Net/Mamba-style
   SSM без KV). Экономия kvarn (2-бит vs 4-бит) применяется только к этой
   малой доле, поэтому "в 2 раза меньше KV-памяти" на практике означает
   единицы сотен MiB разницы, а не гигабайты.
2. `-fit` по умолчанию требует **1024 MiB свободной памяти "на всякий
   случай"** (`--fit-target`, `common_params.fit_params_target`, дефолт
   `1024*1024*1024` байт на устройство, `common/common.h:481`). Это не
   баг, а сознательно консервативный дефолт upstream llama.cpp,
   не специфичный для kvarn.
3. **`common_params_fit_impl` не пытается уменьшить `n_ctx`, если
   пользователь передал `-c` явно** (шаг 2 в `common/fit.cpp` целиком
   под `if (cparams->n_ctx == 0)`, `common/fit.cpp:308`). Как только
   ngl-редукция блокируется kvarn-гардом (`common/fit.cpp:378-380`),
   fit сразу бросает исключение с текстом "reduce n_ctx or free device
   memory" — но сам этого не делает, если `-c` был явным. Пользователю
   приходится подбирать `-c` руками, как и было сделано в этом задании.

Разница фона 0.6GB (1.3GB в момент успеха kvarn4, 1.9GB на момент этого
задания) на карте с бюджетом ~7816 MiB (после драйверского резерва) и
margin в 1024 MiB — это ~8% всего бюджета, чего достаточно, чтобы решение
fit переключилось с "войдёт" на "не войдёт" при фиксированных 5058+201+70
MiB весов/RS/compute, которые всё равно нужно разместить целиком.

## Цифры: оценка fit (`-lv 5`, живой прогон) vs факт

Фон на момент каждого прогона указан отдельно (`nvidia-smi
--query-gpu=memory.used`, до запуска сервера).

### kvarn4/kvarn4, `-c 65536 -ub 256` (фон 1913 MiB)

Фаза fit (dry-run, `no_alloc=true`, тот же путь, что использует
`common_get_device_memory_data_impl`):

```
CUDA0 (RTX 3070) | total 7816 = free 5552 + (self 5935 = model 5058 + context 797 + compute 80) + unaccounted -3671
projected to use 5935 MiB of device memory vs. 5552 MiB of free device memory
cannot meet free memory target of 1024 MiB, need to reduce device memory by 1407 MiB
context size set by user to 65536 -> no change   <-- ctx-редукция не срабатывает, n_ctx задан явно
failed to fit params to free device memory: KVarN requires full GPU offload; ...
```

Живой факт (`-fit off`, тот же `-c 65536`, фон 1864 MiB — практически то же):

```
load_tensors:        CUDA0 model buffer size =  5058.83 MiB
llama_memory_recurrent:      CUDA0 RS buffer size =   201.00 MiB
ggml_backend_cuda_buffer_type_alloc_buffer: allocating 596.00 MiB on device 0: cudaMalloc failed: out of memory
```

`context` (797) ≈ `RS` (201) + `KVarN` (596, число из реальной попытки
`cudaMalloc`) = **797** — совпадение точное. Реальный OOM на попытке
выделить сам KVarN-буфер, т.е. до compute-резерва даже не дошло. Оценка
fit не ошиблась: реального места действительно не было.

### kvarn2/kvarn2, `-c 49152 -ub 256` (фон 1901 MiB)

Фаза fit (dry-run):

```
CUDA0 (RTX 3070) | total 7816 = free 5552 + (self 5587 = model 5058 + context 457 + compute 72) + unaccounted -3323
projected to use 5587 MiB of device memory vs. 5552 MiB of free device memory
cannot meet free memory target of 1024 MiB, need to reduce device memory by 1059 MiB
context size set by user to 49152 -> no change
failed to fit params to free device memory: KVarN requires full GPU offload; ...
```

Живой факт (`-fit off`, `-c 49152`, фон 1897 MiB):

```
load_tensors:        CUDA0 model buffer size =  5058.83 MiB
llama_memory_recurrent:      CUDA0 RS buffer size =   201.00 MiB
llama_kv_cache_kvarn:      CUDA0 KVarN buffer size =   256.00 MiB
srv  llama_server: listening on http://127.0.0.1:8099
nvidia-smi: 7695 MiB used, 123 MiB free
completion: " Paris. Paris is located in France. France is a country. France borders Germany"
```

`context` (457, dry-run) = `RS` (201) + `KVarN` (256, реальный) = **457** —
снова точное совпадение. Сервер поднялся и ответил, свободно осталось
123 MiB. Т.е. настоящий зазор действительно был, просто **тоньше, чем
margin fit требует по умолчанию** (нужно было 1059 MiB запаса, реально
хватило бы и без margin — не хватало только 35 MiB "чистого" самонужного
объёма относительно dry-run free, а margin добросил это до "нужно на
1059 больше").

### Прямое сравнение kvarn4 vs kvarn2 (context-доля, без весов/RS/compute)

| конфиг | ctx | KVarN buffer (реальный) | equivalent F16 | экономия vs F16 |
|---|---|---|---|---|
| kvarn4/kvarn4 | 65536 | 596.00 MiB (попытка cudaMalloc) | 2048.00 MiB | ~71% |
| kvarn2/kvarn2 | 49152 | 256.00 MiB | 1536.00 MiB | ~83% |
| kvarn2/kvarn2 | 51200 | 265.50 MiB | — | — |
| kvarn2/kvarn2 | 57344 | 294.00 MiB | — | — |
| kvarn2/kvarn2 | 61440 | 313.00 MiB | — | — |
| kvarn2/kvarn2 | 63488 | 322.50 MiB | — | — |
| kvarn2/kvarn2 | 65536 | 340.00 MiB (успешно выделен, OOM позже) | 1536*65536/49152=2048.00 | — |

kvarn-компрессия масштабируется ожидаемо и почти линейно и по битности,
и по `n_ctx` (соответствует формуле `kvarn_record_bytes(bits)` в
`src/llama-kv-cache-kvarn.cpp:52-55` — `llama_kvarn_packed_bytes(128*128,
bits) + 3*128*sizeof(fp16)`). Никакого "падения на fallback-тип" не
происходит — фиксированный оверхед на группу (768 байт на K и на V,
метаданные квантования) даёт лишь мягкое отклонение от идеального "в 2
раза меньше при вдвое меньшей битности" (реально kvarn2 ~0.54x от
kvarn4 на уровне одного group-record, что видно и в измеренных буферах:
322.5/596 без учёта разницы ctx ближе к ожидаемому, если привести к
одному ctx).

## Живая проверка (п.4 задания): максимальный `-c` для kvarn2/kvarn2

Фон на протяжении всех прогонов ниже: 1864-1901 MiB (`nvidia-smi
--query-gpu=memory.used`, перед каждым запуском).

| `-c` | режим | результат |
|---|---|---|
| 49152 | `-fit off` | **работает**, completion получен, 123 MiB free после загрузки |
| 51200 | `-fit off` | работает, 129 MiB free |
| 57344 | `-fit off` | работает, 99 MiB free |
| 61440 | `-fit off` | работает, 99 MiB free |
| 63488 | `-fit off` | **работает**, completion получен ("a city known for its beautiful architecture..."), 89 MiB free |
| 65536 | `-fit off` | **реальный CUDA OOM** (`cudaMalloc failed: out of memory`), 164 MiB free после отказа (упал на compute/следующем буфере) |

**Максимум на этом железе/фоне для kvarn2/kvarn2: `-c 63488`** (шаг ниже
64k-порога, за которым `kvarn_stage_tail_groups` добавляет +2 группы к
F16-хвосту, `src/llama-kv-cache-kvarn.cpp:172`, что и толкает 65536 за
край). Все прогоны 49152-63488 сделаны с `-fit off`, потому что default
`-fit` (margin 1024 MiB) отклоняет **любой** `-c` на этом фоне — см.
следующий пункт.

### Почему default `-fit` отклоняет kvarn2 на ЛЮБОМ `-c` при текущем фоне

Фиксированная часть self-need (веса + RS + compute) ≈ 5058.83 + 201 + 70
≈ **5330 MiB**, независимо от `-c` и от битности kvarn. При фоне ~1.9GB
`free` (dry-run) ≈ 5552-5577 MiB. `free - margin(1024)` ≈ 4528-4553 MiB —
**меньше, чем один только фиксированный вес модели с RS-буфером**, ещё
до единого байта KV-кеша. Т.е. с default margin fit гарантированно
откажет для kvarn на этой карте при этом фоне, вне зависимости от `-c` —
не специфично для битности.

Проверено: `-fitt 64` (margin 64 MiB вместо 1024) на `-c 63488` **всё
равно отклонён** fit-ом ("need to reduce device memory by 147 MiB"),
хотя тот же `-c 63488` реально загрузился и ответил через `-fit off` с
89 MiB свободных. Разница (~150-200 MiB) — это шум между
dry-run-измерением свободной памяти (в отдельном пробном процессе, без
реальных буферов) и фактическим состоянием в момент настоящей загрузки
(CUDA context/driver overhead колеблется между запусками процесса на
эту величину — то же самое, что `unaccounted` в `common_memory_breakdown_print`,
-3671/-3323 MiB в таблицах выше). Именно для поглощения такого шума
margin и существует; 1024 MiB — с большим запасом перекрывает эти
150-200 MiB, но на этой карте с этой моделью это же и убивает любой fit
с kvarn.

## Что не является причиной

- **Не** ошибка выбора типа: лог явно печатает `type = kvarn_k2v2_g128`
  и `type = kvarn_k4v4_g128` — битность прокинута верно
  (`kvarn_type_from_bits`, `common/arg.cpp:367-373`).
- **Не** переоценка размера KV-буфера по fallback/полному типу — реальный
  `KVarN buffer size` при фактической загрузке (256/596/etc. MiB) **точно**
  совпадает с тем, что dry-run предсказал в бюджете `context`. Гипотеза
  задания ("fit считает по fallback-типу") не подтвердилась.
- Побочно заметил: строка лога `llama_kv_cache_kvarn: CUDA0 KVarN buffer
  size = 0.00 MiB` во время самого fit dry-run (`no_alloc=true`) — это
  косметический артефакт (буфер физически не создаётся в no_alloc-режиме,
  поэтому его собственный размер читается как 0), **не** влияет на расчёт
  в таблице `memory breakdown` (там цифра берётся из другого пути и она
  верна, что подтверждено сравнением с реальной загрузкой). Не источник
  бага, но сбивает с толку при чтении лога — можно поправить косметически
  отдельным тикетом, не трогал.

## Правки в дереве

**Никаких.** Оценка честная — по условию задания чинить нечего. Рабочая
копия не менялась (кроме создания этого файла и временных логов в `/tmp`,
которые не относятся к репозиторию).

## Рекомендация (не реализована, на решение Архитектора)

`common/fit.cpp:378-380` бросает исключение сразу после того, как
ngl-редукция блокирована kvarn-гардом, **не пробуя** ctx-редукцию, если
`n_ctx` был передан пользователем явно (`cparams->n_ctx != 0`, весь блок
ctx-редукции в `common/fit.cpp:308-369` под условием `== 0`). Сообщение
об ошибке при этом рекомендует "reduce n_ctx" — то, что сам код не
пытается сделать. Для kvarn (где ngl-редукция архитектурно невозможна)
это единственный рычаг fit, и сейчас он выключен именно в том случае,
когда он нужнее всего (пользователь явно указал `-c`, как в этом
задании). Возможное направление: при активном kvarn пробовать
ctx-редукцию (до `n_ctx_min`) даже при явном `-c`, а не сразу бросать.
Это дизайн-решение с user-facing последствиями (тихая подмена
пользовательского `-c`), поэтому не делал сам — оставляю на решение
Архитектора/раунд 4.
