# CLINE — Рабочий журнал

> **ТЕКУЩЕЕ ЗАДАНИЕ: нет. HOTFIX-D принят, идёт чистый ребилд у Архитектора.**
> **Ничего не делать до нового задания в этом файле.**

## Baseline (Фаза 1 закрыта)

Сборка `5c2bc4ef2`. Qwythos: полный offload в 7.8GB VRAM.
- **pp512** = 2298 t/s
- **tg64** = 61 t/s

Это baseline для регрессий — после Фаз 2-5 сверяем с ним.

---

## Фаза 2 — Сводка заданий

### 2.0 — Разминирование «Непонятных» ✅ ВЫПОЛНЕНО

| Файл | Вердикт | Куда |
|---|---|---|
| `gated_delta_net.cu/cuh` | (а) SKIP upstream + (в) DROP DDTree | — |
| `ssm-conv.cu/cuh` | (в) DROP (100% DDTree) | — |
| `ssm-scan.cu` | (б) мелкий perf (syncthreads) | → 2.3 попутно |
| `norm.cu` | (б) bf16 kernel | → 2.3 |
| `scale.cu` | (б) bf16 kernel | → 2.3 |
| `quantize.cu` | (б) HIP ULL fix | → 2.3 |
| `dream.cpp` | (б) bee-model | → Фаза 3 |
| `delta-net-base.cpp` | (в) DROP (DDTree) | — |
| `clip.cpp` + `mtmd*` (14 файлов) | (а) SKIP (upstream evolution) | — |

**Итог:** ни один файл не блокирует Фазу 2.1–2.3.

---

### 2.1 — TurboQuant CUDA (зависит от 2.0)

1. **turbo-quant-cuda.cuh** (+1642) — копировать целиком
2. **cross-ring-interleave.cu** (+955) — копировать целиком
3. **turbo-wht.cu/cuh**, **turbo-sink.cu/cuh**, **turbo4-tcq-codebook.cuh** — копировать целиком
4. **fwht.cu** (+1/−1) — минорное изменение
5. **argmax.cu** (+498) — MIXED: брать ТОЛЬКО TCQ nearest-codeword, не брать bee-правки самого argmax
6. **ggml-cuda.cu** — диспатч guards для новых типов (TURBO\*, TCQ, TQ3\_1S, TQ4\_1S) в convert/cpy/mul\_mat; фильтровать DFlash-хвосты
7. **convert.cu / cpy.cu / cpy-utils.cuh / dequantize.cuh / getrows.cu** — поддержка новых типов, фильтровать DFlash
8. **vecdotq.cuh / mmq.cuh / mmvq.cu** — инстансы/guards для новых типов
9. **CMakeLists.txt** — добавить новые файлы

**Вернуть:** diffstat, что из argmax.cu пропущено и почему.

---

### 2.2 — KVarN CUDA (зависит от 2.0, параллельно с 2.1)

1. **kvarn.cu** (+1828) — копировать целиком
2. **kvarn.cuh** (+8) — копировать целиком
3. **ggml-cuda.cu** — диспатч `GGML_OP_KVARN_VIEW` (case в switch, backend support check, split logic); фильтровать DFlash
4. **set-rows.cu** (+503) — MIXED: брать KVarN store, фильтровать DFlash
5. Вердикты 2.0 категории (б): `ssm-scan.cu` perf-фикс попутно если затрагивается

**Вернуть:** diffstat, список точек диспатча в ggml-cuda.cu.

---

### 2.3 — FlashAttention (зависит от 2.1 + 2.2)

1. **fattn.cu** (+3344) — MIXED: брать turbo/kvarn-ветки диспатча и FA-диспатч, **НЕ** брать DFlash-хвосты
2. **fattn-mma-kvarn-\*.cuh** (7 файлов, ~2600) — копировать
3. **fattn-kvarn-vec-\*.cuh** (2 файла, +372) — копировать
4. **fattn-mma-turbo-\*.cuh** (2 файла, +140) — копировать
5. **fattn-vec.cuh** — расширить поддержку кеш-типов q6\_0/q6\_1/q3\_0/q3\_1/q2\_1; **ДРОП** bee-q2\_0 инстансы (D-009)
6. **fattn-common.cuh** (+1303) — фильтровать DFlash
7. **generate\_cu\_files.py** — расширить по образцу донорского, перегенерить template-instances (НЕ копировать пофайлово, D-007)
8. perf-фиксы из 2.0: norm bf16, scale bf16, quantize ULL, ssm-scan syncthreads

**Вернуть:** diffstat, список сгенерённых инстансов, что из fattn.cu НЕ взято (DFlash-куски).

---

## ПРАВИЛА ИСПОЛНИТЕЛЯ — читать перед любым заданием

1. **Нет разрешения на инструмент — значит НЕТ.** Попытка обхода ограничений
   (любым способом: другой тулзой, скриптом, через файл) — нарушение, а не
   инициатива. 15 минут перебора обходов = 15 минут сожжённых токенов и
   недоверенный результат. Уперся в запрет — СТОП, одна строка в отчёт:
   какой инструмент нужен и для чего. Решение принимает Архитектор.
2. **Сборку и тесты запускает Архитектор.** Твоя зона: правка файлов строго
   по заданию + отчёт «готово к сборке». cmake/ctest/gdb не трогать.
3. **Скоуп задания — граница.** Захотел выйти за него — сначала строка в
   отчёте, потом (после добра) правка. Молчаливый выход за скоуп = откат.
4. Не коммитить. Всё остаётся staged, коммитит Архитектор после приёмки.
5. **Каналы связи.** Этот файл (CLINE.md) пишет ТОЛЬКО Архитектор: задания,
   брифы, поправки. Твои отчёты — ТОЛЬКО в `cline-report.md` (перезаписывай
   под каждое задание: заголовок с номером задания, diffstat, список
   пропущенного с причинами, вопросы). В CLINE.md не пишешь ничего.
   Цикл: задание здесь -> работа -> отчёт в cline-report.md -> поправка/добро здесь.

---

## Поправки Архитектора к вердиктам 2.0

- **dream.cpp — дефолт ДРОП, не Фаза 3.** Dream — диффузионная модель, вокруг
  таких bee строил DFlash (D-001). Проверка: показать 5-10 строк bee-диффа;
  если там tree_bufs / draft / n_accepted-лексика — дроп окончательно.
- **norm.cu / scale.cu (bf16), quantize.cu (ULL), ssm-scan.cu (syncthreads):**
  категория (б) присвоена неверно — это generic-бэкпорты, не turbo/kvarn.
  Правило: брать ТОЛЬКО при доказанной зависимости — есть вызов из
  портируемого kvarn/turbo-кода — берём, нет — дроп. Проверяет агент 2.3,
  вердикт по каждому файлу в отчёт. HIP ULL-фикс — дроп в любом случае (D-008).

## АКТИВНЫЕ ЗАДАНИЯ: 2.1 и 2.2 (параллельно) — ДОБРО ВЫДАНО

Списки файлов — выше в этом журнале. Напоминания:
- argmax.cu: только TCQ nearest-codeword кусок.
- set-rows.cu: только KVarN store, DFlash-хвосты фильтровать.
- bee-q2_0 инстансы где бы ни встретились — дроп (D-009).
- Отчёт по каждому заданию: diffstat + список пропущенного с причинами.

2.3 стартует после приёмки 2.1+2.2 и ответа по dream.cpp.

---

## Приёмка 2.1+2.2 — ПРИНЯТО с одним блокером

Проверено Архитектором: argmax.cu = полный ДРОП подтверждён (0 упоминаний TCQ
в донорском файле, порт-карта исправлена). Точки диспатча сходятся с донором.
Follow-up список (kvarn_view_base, bufferless, native_ops) — согласен, Фаза 4.

**БЛОКЕР (моя ошибка в задании 1.4, чиним сейчас):** у донора KVarN — ТРИ
оператора: GGML_OP_KVARN_WHT, GGML_OP_KVARN_STORE, GGML_OP_KVARN_VIEW
(donors ggml.h:600-602). Фаза 1 завела только VIEW. Диспатч 2.2 уже ссылается
на WHT/STORE — без них сборка упадёт.

## ЗАДАНИЕ 2.2b — доводка KVarN-опов (СРОЧНО, перед 2.3)

1. ggml/include/ggml.h: добавить GGML_OP_KVARN_WHT и GGML_OP_KVARN_STORE
   СТРОГО В КОНЕЦ enum ggml_op (после KVARN_VIEW; донорский порядок не
   копировать, у нас append-only).
2. ggml/src/ggml.c: записи в таблицы имён опов (GGML_OP_NAME/SYMBOL),
   static_assert по количеству, конструкторы/валидация по образцу донора.
3. CPU-путь: диспатч в ggml-cpu (по образцу того, как в 1.4 сделан VIEW;
   у донора смотреть ggml-cpu.c/ops.cpp cases для WHT/STORE).
4. НЕ трогать CUDA-файлы — они уже готовы и ждут только enum.

**Отчёт:** diffstat + подтверждение, что таблицы имён и asserts согласованы.

## ЗАДАНИЕ 2.3 — ДОБРО ВЫДАНО (после 2.2b)

Список файлов — выше в журнале. Дополнение: include "fattn-mma-kvarn.cuh"
в ggml-cuda.cu:69 сейчас битый (файла нет) — 2.3 его закрывает, убедиться,
что имя файла после переноса совпадает с include.
Напоминание: norm/scale/ssm-scan — только при доказанной зависимости из
kvarn/turbo-кода; вердикт по каждому в отчёт. quantize.cu ULL — дроп (D-008).

Сборка всего пакета (2.1+2.2+2.2b+2.3) — у Архитектора после отчёта 2.3.

---

## Приёмка 2.2b — ПРИНЯТО (CPU-сборка зелёная, exit 0)

## ЗАДАНИЕ 2.2c — удаление bee-q2_0 из CUDA (БЛОКЕР, перед 2.3)

Найдено Архитектором в диффе 2.1: перенесён bee-q2_0 CUDA-код и подцеплен к
GGML_TYPE_Q2_0 — это АПСТРИМНЫЙ ID 42 с несовместимым layout (D-009:
10 vs 18 байт/блок, другая карта квантов). Апстрим CUDA-кейсов для Q2_0 не
имеет — код компилируется молча и портит данные при первом же использовании.

Удалить ВСЕ bee-q2_0 следы из CUDA-слоя:
1. convert.cu — 6 case-блоков GGML_TYPE_Q2_0 (строки ~729, 796, 866, 935, 970, 1005).
2. mmq.cuh — load_tiles_q2_0, его type_traits/tile-записи, Q2_0-кейсы в switch.
3. mmvq.cu + vecdotq.cuh — vec_dot_q2_0, VDR_Q2_0, Q2_0-кейсы.
4. set-rows.cu, cpy.cu, dequantize.cuh — проверить grep'ом, вычистить если есть.
5. Q2_1 и прочие 200-212 НЕ ТРОГАТЬ — они легальны.

Критерий приёмки (проверю сам):
`git diff HEAD -- ggml/src/ggml-cuda/ | grep -iE "^\+.*q2_0" | grep -v iq2` = ПУСТО.

**К отчёту обязательный пункт:** объяснить расхождение — в отчёте 2.1/2.2
написано "vecdotq.cuh — только комментарии, SKIP", в диффе vecdotq.cuh +299
строк. Отчёт обязан совпадать с диффом. Это второй пункт правил: недостоверный
отчёт = недоверенный результат.

2.3 стартует после приёмки 2.2c.

---

## Приёмка 2.2c — ПРИНЯТО

Проверено Архитектором: критерий-grep = 0 строк; новые CUDA-файлы изнутри
чисты от q2_0; объяснение по vecdotq.cuh принято (реализации въехали в Фазе 1
вместе с переносом quants, файл в Фазе 2 не трогался — впредь в diffstat
указывать слой происхождения). Новые файлы застейджены Архитектором.

## ЗАДАНИЕ 2.3 — СТАРТ ПОДТВЕРЖДЁН

Список файлов и напоминания — выше в журнале (секция 2.3 + дополнение).
Ключевое: fattn-vec instances для q2_0 — НЕ генерить (D-009);
generate_cu_files.py расширять, инстансы не копировать пофайлово (D-007);
norm/scale/ssm-scan — вердикт по зависимости в отчёт.
После отчёта 2.3 — полная CUDA-сборка у Архитектора.

---

## Приёмка 2.3 — БЛОКЕР: замена fattn* откатила месяц апстримных фиксов

Кернели, генератор, инстансы, вердикты по perf-фиксам — ПРИНЯТО, хорошая работа.
НО: fattn.cu / fattn-common.cuh / fattn-vec.cuh взяты "полностью из донора",
а донор отстаёт от нашей базы на месяц (merge base d73cd076, 2026-06-09).
Проверка Архитектора: 3 из 4 апстримных коммитов за это окно ПОТЕРЯНЫ.

## ЗАДАНИЕ 2.3b — вернуть апстримные fattn-фиксы (БЛОКЕР, перед сборкой)

Для каждого коммита: `git show <hash> -- ggml/src/ggml-cuda/` и вручную
переналожить hunks на текущие (донор-структурные) файлы. По приоритету:

1. **0eca4d490** — int64 strides в flash_attn_mask_to_KV_max (overflow на
   длинных контекстах — наш главный сценарий 1M ctx). ПОТЕРЯН.
2. **cb295bf59** — ggml_cuda_fattn_kv_type_supported (валидация K/V-типов).
   ПОТЕРЯН. ВАЖНО: восстановив функцию, РАСШИРИТЬ её нашими кеш-типами
   (turbo 200-205, q2_1/q3_0/q3_1/q6_0/q6_1 208-212), иначе она отсечёт
   собственные типы форка в supports_op.
3. **e495d1e74** — Gemma MTP FA fix. Маркеры совпали, но сверить вручную:
   дифф коммита против текущего fattn.cu, что логика ncols1/gqa на месте.
4. **b820cc8e6** — __restrict__/PDL. Переналожить на общие пути; если hunk
   упирается в kvarn/turbo-ветки донора — адаптировать, не пропускать.

**Отчёт:** по каждому коммиту — восстановлен/был на месте/адаптирован + где.
После отчёта — полная CUDA-сборка у Архитектора, затем parity и bench.

---

## ФАЗА 2 — ЗАКРЫТА (коммиты 18fa6e87a + 135714305)

Сборка exit 0; parity test-backend-ops 14001/14001; bench pp512 2268±10 /
tg64 60.1±0.4 — в шуме от baseline. Хорошая работа.

## ФАЗА 3 — llama-уровень. ЗАДАНИЯ

Общее: донор тот же. Главная опасность фазы: llama-graph.cpp (bee +327 строк
на фоне +585 апстримных за месяц — горячая зона конфликтов) и llama-context.cpp
(у bee +7842, из них ~99% DFlash — брать ТОЛЬКО kvarn-строки, их ~27).
Урок 2.3 обязателен: НИКАКИХ «целиком из донора» для MIXED-файлов.

### 3.0 — разведка hotspot'ов (первым, блокирует остальные)
Для llama-graph.cpp и llama-context.cpp: выделить kvarn/turbo-only hunks
из bee-диффа (merge base d73cd076), сопоставить с апстримными изменениями
тех же мест. Отчёт: список hunks «берём» (с якорями функций), список
коллизий bee<->апстрим и предложение разруливания по каждой. НЕ КОДИТЬ.

### 3.1 — изолированные файлы (после 3.0)
llama-kvarn.cpp, llama-kv-cache-kvarn.cpp/.h — целиком (они bee-собственные,
изолированные, тут «целиком» легально). Адаптировать к дрейфу API памяти
апстрима (llama_memory_i и родня менялись за месяц) — сверять с текущими
заголовками, не с донорскими. + CMakeLists src/.

### 3.2 — интеграция kv-cache (после 3.1)
kvarn-hunks в llama-kv-cache.cpp/.h, llama-kv-cache-iswa.*,
llama-memory-hybrid.* (Qwythos = SSM+attention гибрид — этот путь обязателен),
llama-graph.cpp по плану из 3.0. DFlash-хвосты не тащить.

### 3.3 — model wiring (после 3.2)
qwen35, qwen35moe, gemma4 (у донора: src/models/*.cpp + llama-model.cpp
hparams/wiring). Только KVarN/turbo-проводка, не DFlash/MTP-правки bee
(MTP у нас апстримный).

### 3.4 — приёмка (Архитектор)
CPU+CUDA сборка, существующие тесты, bench-регрессия. Активация kvarn через
CLI появится только в Фазе 4 (arg.cpp) — рантайм-смок kvarn отложен туда,
критерий Фазы 3: ничего не сломано + всё собирается.

Порядок: 3.0 -> 3.1 -> 3.2 -> 3.3 -> 3.4. Отчёты в cline-report.md.

---

## Приёмка 3.0 — ПРИНЯТО. Отличная разведка.

- Стратегия по build_attn_mha (kvarn-ханки поверх текущего апстрима,
  ~6 строк в конец функции) — одобрена.
- Обрезка DFlash-ветки внутри llm_kvarn_attn_domain (dflash_verify_logits ->
  оставить только n_q==1 ? ROTATED : ROTATED_K_ORIGINAL_V) — одобрена.
- Вывод по 3.3 (0 kvarn-refs в моделях, wiring model-agnostic) — принят,
  скоуп 3.3 сужается до проверки llama-model.cpp / llama-arch.cpp.

**ДОПОЛНЕНИЕ к 3.2 (пропущено в разведке):** hunks 3/5/8 llama-context.cpp
тянут публичный API: поле kvarn в llama_context_params (include/llama.h),
дефолт в llama_context_default_params, поле в llama-cparams.h. Взять из
донора ТОЛЬКО kvarn-поля (не DFlash-поля рядом!), тип и дефолт сверить
с донором. Без этого 3.2 не компилируется.

## ЗАДАНИЕ 3.1 — СТАРТ ПОДТВЕРЖДЁН

4 файла целиком (llama-kvarn.cpp/.h, llama-kv-cache-kvarn.cpp/.h) +
CMakeLists src/. Адаптация к текущему API памяти — сверяться с нашими
заголовками (llama-memory.h, llama-kv-cache.h HEAD), не с донорскими.
Отчёт: diffstat + список мест, где API дрейфанул и что адаптировано.

---

## Приёмка 3.1 — СБОРКА КРАСНАЯ, два класса ошибок (лог у Архитектора)

## ЗАДАНИЕ 3.1b — адаптация к дрейфу интерфейсов (блокер)

1. **llama_context_params:** поле kvarn вставлено после type_v, а
   llama_context_default_params() в llama-context.cpp инициализирует
   позиционно — всё съехало (ошибка на :3471). Фикс: перенести поле kvarn
   В КОНЕЦ struct llama_context_params + добавить строку
   `/*.kvarn =*/ ...` в default_params на соответствующую позицию.
   Дефолт сверить с донором. То же проверить для всех наших вставок в
   публичные структуры (llama.h): только append, никаких вставок в середину.

2. **llama-kv-cache-kvarn.h/.cpp:** ~15 override'ов не совпадают с текущим
   базовым интерфейсом (get_n_kv, get_kv, current_sinfo, type_k/v, get_k/v,
   cpy_k/v, build_input_k_idxs, get_turbo_rot_* и др.). Метод: построчный
   дифф донорского src/llama-kv-cache.h против нашего HEAD, для каждого
   изменившегося метода — привести сигнатуру kvarn-класса и реализацию
   к текущей. НЕ подгонять базовый класс под kvarn — только наоборот.
   Если у метода в новом интерфейсе появились параметры, которых kvarn
   не использует, — прокинуть и проигнорировать с комментарием.

Критерий: cmake -t llama (CPU) зелёный. Сборка у Архитектора, как обычно.

---

## Приёмка 3.1b — заголовки чисты, ошибки переехали в базовые классы

Остаток красноты — не вина 3.1b: kvarn-код зовёт bee-расширения БАЗОВЫХ
классов, которые по плану идут в 3.2. Зависимость оказалась жёсткой:
3.1 не линкуется без части 3.2. Стартуем 3.2 немедленно.

## ЗАДАНИЕ 3.2 — интеграция kv-cache. СТАРТ

Первым делом — bee-расширения базовых классов (точный чеклист из лога сборки):
1. llama-kv-cache.h/.cpp: current_sinfo(), get_cells() (или публичный
   аксессор к v_cells), set_input_k/v_idxs_backend, set_input_k/v_rot_backend,
   seq_rm_cell(), cells_at_pos() — перенести из донора. ВАЖНО: поправка
   к выводу 3.1 «не в донорском kvarn-коде» — эти методы НУЖНЫ kvarn'у,
   лог сборки это доказал.
2. llama-hparams.h/.cpp: n_layer_kv (+ всё, что рядом по донорскому диффу
   относится к kvarn, не к DFlash).
3. Дальше по плану разведки 3.0: kvarn-hunks в llama-kv-cache.cpp/.h (76),
   llama-kv-cache-iswa.* (22), llama-memory-hybrid.* (4+2),
   llama-graph.cpp (8 ханков по якорям из 3.0),
   llama-context.cpp (8 ханков, ~27 строк, DFlash-ветку в
   llm_kvarn_attn_domain обрезать как одобрено).
4. Урок 2.3 в силе: hunks поверх текущего апстрима, не замена файлов.

Критерий: cmake -t llama (CPU) зелёный. Отчёт в cline-report.md.

---

## Приёмка 3.2 (промежуточная) — фундамент ЗЕЛЁНЫЙ

- Базовые расширения (get_cells, set_input_*_backend, current_sinfo,
  get_stream_for_seq, seq_rm_cell, cells_at_pos, n_layer_kv,
  LLAMA_KVARN_TYPE_INVALID) — приняты.
- CPU-сборка -t llama: exit 0, ноль ошибок.
- Правка Архитектора поверх: удалён дубль n_layer_kv_from_start в
  llama-hparams.h:87 — поле уже есть в апстриме на :60. Метод n_layer_kv()
  оставлен. Учесть: перед добавлением поля в апстримный класс — grep на
  существование.

## 3.2 — ПРОДОЛЖАТЬ по TODO (добро действует)

Остаток: kvarn-hunks в llama-kv-cache.cpp/.h (76), iswa (22), hybrid (4+2),
llama-graph.cpp (8 по якорям 3.0), llama-context.cpp (8, ~27 строк, с
обрезкой DFlash-ветки llm_kvarn_attn_domain).
Это самая рискованная часть фазы — ханки лезут в живой inference-путь
(build_attn_mha, set_input). После завершения: сборка + bench у Архитектора.

---

## Приёмка 3.2 (статус) — ЧАСТИЧНО. Перенос остатка в Фазу 4 ОТКЛОНЁН.

Сделанное (базовые классы 204 строки, изолированные 2097) — принято.

**НО:** «runtime-интеграция — Phase 4» — нет. Границы фаз определяет
ARCHITECTURE.md, а не отчёт: Фаза 4 = scheduler + CLI (arg.cpp, loader,
ggml-backend split). Проводка graph/context/kv-cache/iswa/hybrid — это
ядро Фазы 3, и именно её ты сейчас предлагаешь пропустить. «Сборка зелёная
без hunks» — не критерий: она зелёная, потому что kvarn мёртвый груз.
Фаза 4 должна ложиться CLI-активацией на УЖЕ проведённые внутренности.

## 3.2 — ДОДЕЛАТЬ. Список не изменился:

1. llama-kv-cache.cpp/.h — turbo initialization в конструкторе (76 refs)
2. llama-kv-cache-iswa.h/.cpp — kvarn param + cache creation (22)
3. llama-memory-hybrid.* — wiring (4+2)
4. llama-graph.cpp — 8 ханков по якорям 3.0 (build_attn_inp/build_attn_mha)
5. llama-context.cpp — 8 ханков ~27 строк (+ обрезка DFlash-ветки)

Да, это самая рискованная часть — поэтому она и в плане, а не вместо него.
Критерий 3.2: сборка зелёная С проведёнными ханками + существующие тесты
не сломаны (проверяет Архитектор). Отчёт по завершении, не по обходу.

---

## ИНЦИДЕНТ (для сведения обоих исполнителей): протухшая зелёная сборка Ф2

«Зелёная» сборка приёмки Фазы 2 прошла на stale-объектниках: make не
пересобрал mmvq.cu после правок vecdotq.cuh. В закоммиченном состоянии
были две поломки, всплывшие только при пересборке из-за H-1:
1. QI/QR-константы новых типов (q6_0/q6_1/q3_0/q3_1/q2_1) не перенесены
   в ggml-common.h — vecdotq.cuh ссылался на несуществующие дефайны.
2. Чистка 2.2c съела закрывающую скобку cpy_blck_f32_q5_1 в cpy-utils.cuh.

Оба фикса внесены Архитектором (10 строк дефайнов из донора + скобка).
Ошибка приёмки — моя: фазовые приёмки теперь ТОЛЬКО на чистом ребилде
(rm -rf build). Исполнителям: при правке .cuh-заголовков предупреждать
в отчёте, что зависимые .o требуют пересборки.

Статус: полный чистый ребилд запущен. После зелёного — повторная
parity+bench приёмка Ф2 и fixup-коммит.

---

## ЗАДАНИЕ 2.4-HOTFIX — ПРИОРИТЕТ НАД 3.2 (сборка сломана целиком)

Чистый ребилд вскрыл недопорт Фазы 2 (stale-кеш прятал). Донор тот же. Порт:

1. **ggml/src/ggml-cuda/common.cuh**: специализации ggml_cuda_type_traits<>
   для GGML_TYPE_Q2_1, Q3_0, Q3_1, Q6_0, Q6_1 (qk/qi/qr) — из донорского
   common.cuh. QI/QR-дефайны в ggml-common.h уже добавлены Архитектором.
2. **ggml/include/ggml.h (+ ggml.c если есть impl)**: enum
   GGML_FLASH_ATTN_EXT_KVARN_DOMAIN_* и связанный API
   (ggml_flash_attn_ext_set_kvarn_domain и родня) — из донорского ggml.h.
   Размещение: append-friendly, рядом с flash_attn ext секцией.
3. После 1-2 грепнуть донорские fattn/mmq на ДРУГИЕ идентификаторы,
   которых нет в нашем дереве (класс ошибок тот же), — закрыть все разом,
   а не по одному ребилду на дырку. Отчёт: полный список закрытого.

3.2 — на паузу до зелёного ребилда. Правки строго в перечисленных файлах.

---

## ЗАДАНИЕ 2.4-HOTFIX-B — добить сборку (после твоего отчёта 17:14)

Контекст: недостающий GGML_OP_TURBO_WHT внесён Архитектором (ggml.h: enum
перед KVARN_VIEW + декларация ggml_turbo_wht; ggml.c: обе таблицы,
конструктор из донора, static_assert 101->102). НЕ трогать эти места.

Остаток:
1. ggml/src/ggml-cuda/cpy-utils.cuh, строка 410: лишняя одиночная `}`
   после cpy_blck_f32_q2_1 — удалить. Парсер режет всё, что ниже неё.
2. Донорский ggml-cpu.c: грепнуть GGML_OP_TURBO_WHT. Если есть case'ы в
   compute_forward / n_tasks / workspace — перенести по образцу твоих же
   KVARN_WHT/STORE вставок. Если нет — так и написать в отчёте.
3. ggml-cuda.cu:2269 вызывает ggml_cuda_op_turbo_wht — проверить, что
   декларация есть в turbo-wht.cuh и include подключён в ggml-cuda.cu.
4. Финальный греп класса ошибок: идентификаторы из fattn*/mmq*/cpy*,
   которых нет в нашем дереве, — добить одним заходом.

Отчёт в cline-report.md. Сборку НЕ запускать — чистый ребилд за
Архитектором после твоего отчёта.

---

## ЗАДАНИЕ 2.4-HOTFIX-C — порт kvarn-дельты в fattn-mma-f16.cuh

**Статус: НЕ НАЧАТО. Единственная текущая задача. Задание в этом файле =
приказ на исполнение, подтверждения не спрашивать.**

ВАЖНО: CLINE.md пишет только Архитектор. Твоя предыдущая перезапись файла
снесла первую версию этого задания — больше НИКОГДА не редактируй CLINE.md.
Твой файл — cline-report.md, только он.

### Симптом

Сборка падает: fattn-mma-kvarn-case.cuh:41/46/50 — "no instance of function
template flash_attn_ext_f16" (18 ошибок на каждый kvarn template-instance).

### Причина

fattn-mma-kvarn-case.cuh инстанцирует flash_attn_ext_f16 с ВОСЕМЬЮ шаблонными
параметрами (последние два — ggml_type type_K, type_V). Наш
ggml/src/ggml-cuda/fattn-mma-f16.cuh — чистый апстрим, у ядра (строка ~1703)
только ШЕСТЬ. Донорская kvarn-обвязка этого файла не портирована вовсе.
Твой вердикт из HOTFIX-B ("kvarn_smem и turbo_always_false не используются")
был ошибочен — не повторять его.

### Шаги

1. Получить донорскую дельту:
   cd donors/beellama.cpp && git diff d73cd076 v0.3.2 -- ggml/src/ggml-cuda/fattn-mma-f16.cuh > /tmp/kvarn-mma.diff
   Размер +242/-36. Донорские коммиты для контекста: a8061cc9c (Add native
   KVarN MMA FlashAttention), eb1e51787, 60c446013, de3873f01, 25901d670.

2. Перенести дельту ханками в НАШ ggml/src/ggml-cuda/fattn-mma-f16.cuh:
   - шаблонные параметры "ggml_type type_K = GGML_TYPE_F16, ggml_type
     type_V = GGML_TYPE_F16" у flash_attn_ext_f16 и у всех промежуточных
     функций, через которые дельта их прокидывает (iter/process/load_tile);
   - kvarn_smem, ggml_cuda_fattn_mma_turbo_always_false,
     kvarn_original_domain — вся kvarn/turbo-логика дельты.

3. НЕ затереть апстримный фикс e495d1e74 (Gemma E4B MTP FA): наш файл его
   содержит, донорский — нет. При конфликте ханков апстримная строка
   остаётся, kvarn-логика адаптируется поверх.

4. DFlash-упоминания в дельте — ДРОП.

5. Верификация без сборки: грепнуть fattn-mma-kvarn-case.cuh,
   fattn-mma-kvarn-*.cuh, fattn-mma-turbo-*.cuh на все идентификаторы и
   убедиться, что каждый определён в новом fattn-mma-f16.cuh или другом
   нашем заголовке. Недостающие — добить в этом же заходе.

### Границы

- Правки ТОЛЬКО в ggml/src/ggml-cuda/fattn-mma-f16.cuh (+ kvarn/turbo
  заголовки, если п.5 выявит дыры).
- CLINE.md НЕ трогать. Сборку НЕ запускать (её делает Архитектор).
- Отчёт в cline-report.md, новая секция "2.4-HOTFIX-C": список перенесённых
  ханков, что дропнуто, результат грепа из п.5.

---

## Приёмка 2.4-HOTFIX-C — ПРИНЯТО

Проверено Архитектором: единственный апстримный коммит по fattn-mma-f16.cuh
после merge base — e495d1e74, и его дельта = ровно 4 DECL-строки (сохранены);
наш файл до хотфикса был идентичен апстриму (терять было нечего); DFlash = 0.
«Целиком из донора» в этот раз без ущерба — файл оказался не MIXED. Но метод
остаётся запрещённым: MIXED-статус определяет Архитектор, не исполнитель.

Дальше: чистый CUDA-ребилд у Архитектора. Зелёный -> parity+bench -> возврат к 3.2.

---

## ЗАДАНИЕ 2.4-HOTFIX-D — линковка fattn-инстансов + два llama-компайл-фикса

Чистый ребилд после HOTFIX-C: CUDA компилируется, падает ЛИНКОВКА (сотни
undefined ggml_cuda_flash_attn_ext_vec_case) + 2 ошибки компиляции в src/.
Диагноз Архитектора готов, причины ниже — исполнять по пунктам.

### 1. mma 512/ncols2=2 (4 undefined символа)

template-instances/generate_cu_files.py:159 — наш расширенный генератор
основан на донорском и потерял апстримный фикс e495d1e74:
`ncols2 not in (4, 8)` -> должно быть `not in (2, 4, 8)` (Gemma 4 + MTP).
Поправить, перегенерить инстансы (запуск python-генератора разрешён, это
не сборка). Проверить: DECL_FATTN_MMA_F16_CASE(512, 512, {4,8,16,32}, 2)
появились в fattn-mma-f16-instance-ncols1_*-ncols2_2.cu.

### 2. q2_0 в vec-диспатче (все undefined с (ggml_type)42) — нарушение D-009

scripts/gen-fattn-vec-dispatch.py до сих пор содержит GGML_TYPE_Q2_0
(строки 24, 46, 96-111) — сгенерённые им таблицы в fattn.cu ссылаются на
q2_0-инстансы, которых по D-009 не существует. Сделать:
- убрать Q2_0 из TYPES, HALF_RANKS, PAIRS в gen-fattn-vec-dispatch.py;
- перегенерить таблицы FATTN_VEC_CASES_* в fattn.cu этим скриптом;
- убрать Q2_0-кейсы из ручных функций fattn.cu: kv_rank (~1707),
  default_kv_tier (~2029), tier-таблица (~2062) и всё, что грепнется по
  GGML_TYPE_Q2_0 в ggml-cuda (кроме упоминаний в комментариях).

### 3. CMakeLists: не портирована донорская секция fattn-vec (основная масса
undefined — обычные пары типа f16/q5_1, q8_0/q5_0)

Наш ggml/src/ggml-cuda/CMakeLists.txt остался апстримным: default-ветка
компилирует 4 инстанс-файла, а донорские диспатч-таблицы (уже в fattn.cu)
ссылаются на default-набор донора. У донора (donors/beellama.cpp/ggml/src/
ggml-cuda/CMakeLists.txt:124+) три ветки: ALL_QUANTS (glob), HALF_QUANTS
(упорядоченный список типов, K>=V), default (свой набор). Перенести секцию
целиком по образцу донора, из списков типов ИСКЛЮЧИТЬ q2_0 (D-009).
Инвариант, который обязан сойтись: множество файлов, компилируемых CMake
в каждом режиме == множество пар, на которые ссылаются таблицы fattn.cu
в том же режиме (#if-guards). Проверить это грепом, несостыковки — чинить
на стороне таблиц/скрипта, не раздуванием default-набора.

### 4. src/llama-kv-cache.cpp:403-405 (компайл-ошибка, код 3.2)

ctx из map-итерации — unique_ptr, а не ggml_context*. Создавать
turbo_rotation/turbo_rotation_inv тем же путём, каким апстримный
конструктор рядом создаёт k/v-тензоры (там есть helper ctx_for_buft /
аналог — сверить с текущим кодом файла), а не сырым ggml_new_tensor_2d
от пары из map.

### 5. src/llama-kv-cache-iswa.cpp:122 (компайл-ошибка, код 3.2)

make_unique<llama_kv_cache_kvarn>(...) не совпадает с фактическим ctor
(llama-kv-cache-kvarn.h:89, 14 параметров — там два uint32_t между n_pad
и n_swa, которых в вызове нет). Привести вызов к сигнатуре; значения
недостающих аргументов взять по образцу соседнего создания обычного
llama_kv_cache в этом же файле. Ctor НЕ менять.

### Границы

- Файлы: generate_cu_files.py + перегенерённые инстансы,
  gen-fattn-vec-dispatch.py, fattn.cu (таблицы/q2_0), ggml-cuda/CMakeLists.txt,
  llama-kv-cache.cpp (2 строки), llama-kv-cache-iswa.cpp (1 вызов).
- Сборку НЕ запускать. CLINE.md НЕ трогать.
- Отчёт в cline-report.md, секция "2.4-HOTFIX-D": по каждому пункту —
  что сделано; для п.3 — доказательство инварианта (списки пар по режимам).


---

## Приёмка 2.4-HOTFIX-D — ПРИНЯТО, с замечанием по отчёту

Проверено Архитектором: mma DECL(512,512,*,2) в инстансах есть; Q2_0 в
ggml-cuda = 0 не-комментных ссылок; int64-strides (0eca4d490) на месте в
fattn-common.cuh; n_batch в kvarn-ctor GGML_UNUSED — подстановка n_ubatch
в iswa легальна (у донора iswa имеет параметр n_batch, у нашего апстрима
нет — при активации kvarn в Фазе 4 решим, прокидывать ли настоящий).

ЗАМЕЧАНИЕ: в отчёте "fattn.cu скопирован из донора, т.к. отсутствовал" —
ложь: git diff показывает +5/-107, файл существовал и не заменялся.
Формулировки отчёта обязаны соответствовать диффу (третий раз, см. 2.2c).

ПОСТСКРИПТУМ к приёмке D: ребилд упал из-за 483 дублей инстансов,
нагенерённых в КОРЕНЬ ggml-cuda/ (генератор запускать только из
template-instances/). Дубли удалил Архитектор. Впредь: после генерации
проверять `git status` на неожиданные файлы и указывать их в отчёте.

---

## Задание 2.4-HOTFIX-E

После HOTFIX-D чистый ребилд (rm -rf build) прошёл линковку CUDA-ядра
(отдельная проблема с 68 удалёнными core-файлами устранена Архитектором
напрямую, `git restore`, тебя не касается). Остался один класс ошибок:
компиляция `src/llama-kv-cache-iswa.cpp` — `kv_base`/`kv_swa` теперь
`unique_ptr<llama_memory_i>` (могут быть `llama_kv_cache` ИЛИ
`llama_kv_cache_kvarn` — это два СИБЛИНГА, оба напрямую реализуют
`llama_memory_i`, не связаны наследованием друг с другом). Код файла
местами всё ещё зовёт конкретное API `llama_kv_cache` (`prepare()`,
`get_size()`), которого у `llama_kv_cache_kvarn` нет — отсюда ошибки
компиляции. Правильный путь — работать только через базовый интерфейс
`llama_memory_i`, как это уже сделано у донора. Эталон:
`donors/beellama.cpp/src/llama-kv-cache-iswa.cpp` и `.h`.

### 1. src/llama-kv-cache-iswa.h:93-94

```
llama_kv_cache * get_base() const;
llama_kv_cache * get_swa () const;
```
→ поменять тип возврата на `llama_memory_i *` (донор делает так же,
см. его .h). Внимание: это ДРУГАЯ пара get_base/get_swa, чем
`llama_kv_cache_iswa_context::get_base/get_swa` (:151-152 нашего .h) —
ту НЕ трогать, она возвращает `llama_kv_cache_context *` и уже корректна.

### 2. src/llama-kv-cache-iswa.cpp:306-311

Определения `get_base()`/`get_swa()` — привести тип возврата к
`llama_memory_i *` вслед за п.1 (просто `return kv_base.get();` /
`return kv_swa.get();`, тело не меняется).

### 3. src/llama-kv-cache-iswa.cpp — init_batch() (текущие строки ~218-259)

Сейчас метод зовёт `kv_base->prepare(ubatches)` / `kv_swa->prepare(ubatches)`,
получает `slot_info_vec_t` и передаёт их в конструктор
`llama_kv_cache_iswa_context`. Заменить на донорский паттерн: звать
`kv_base->init_kv_batch(ubatches)` / `kv_swa->init_kv_batch(ubatches)`
(метод уже есть в нашем базовом `llama_memory_i`, ничего добавлять не
нужно), проверять `!ctx_base || llama_memory_status_is_fail(ctx_base->get_status())`
вместо `sinfos_base.empty()`, и строить `llama_kv_cache_iswa_context` из
готовых `ctx_base`/`ctx_swa` (`std::move`), а не из slot_info-векторов.
Смотри донора целиком (обе ветки: simple split и equal split, плюс
хвостовой `return ...FAILED_PREPARE`) — переносить логику 1:1, у нас
дополнительных отличий в этой части быть не должно.

Заодно проверь: раз конструктор `llama_kv_cache_iswa_context` теперь
принимает context-ptr'ы, а не slot_info — соответствует ли сигнатура
конструктора в нашем .h/.cpp этому вызову, или её тоже надо привести
к донорской (context-ptr вариант). Если наш конструктор физически уже
принимает slot_info-векторы и по-другому не умеет — это отдельная правка
конструктора по образцу донора, включи её в тот же коммит с явным
описанием в отчёте.

### 4. src/llama-kv-cache-iswa.cpp:285-287 (get_can_shift)

```
return kv_base->get_can_shift() &&
       kv_swa->get_can_shift() &&
       kv_base->get_size() == kv_swa->get_size();
```
`get_size()` не существует в базовом интерфейсе. Донор сравнивает через
`get_kv_size()` (base-interface метод, override в обоих конкретных
классах). У `llama_kv_cache_kvarn` `get_kv_size()` уже есть
(llama-kv-cache-kvarn.h:113) — НЕ трогать. У `llama_kv_cache` его нет —
добавить `uint32_t get_kv_size() const override;` в src/llama-kv-cache.h
рядом с существующим `get_size()` (:158) и в .cpp реализовать как тонкую
обёртку `return get_size();` (тело НЕ дублировать). Добавить чистый
абстрактный `virtual uint32_t get_kv_size() const = 0;` в базовый
`llama_memory_i` (src/llama-memory.h) — сверить точку вставки и сигнатуру
с донорским llama-memory.h (там она есть, `override`-пары с ней уже
есть в обоих конкретных классах после этой правки).

### Границы

- НЕ переносить из донора ничего сверх перечисленного (get_kv_n_stream,
  can_seq_rm, seq_rm_cell, cells_at_pos, recurrent-профили,
  state_seq_restore_requires_exclusive_kv_stream и т.п. — это чужой,
  более широкий интерфейс донора под фичи, которых у нас нет и не будет
  в этой фазе; НЕ добавлять эти методы в llama_memory_i).
- Файлы: src/llama-memory.h (1 виртуальный метод), src/llama-kv-cache.h/.cpp
  (get_kv_size override), src/llama-kv-cache-iswa.h/.cpp (get_base/get_swa
  тип возврата, init_batch(), get_can_shift(), и конструктор
  llama_kv_cache_iswa_context ЕСЛИ понадобится по п.3).
- llama-kv-cache-kvarn.h/.cpp НЕ трогать — там уже всё готово.
- Сборку НЕ запускать. CLINE.md НЕ трогать.
- Отчёт в cline-report.md, секция "2.4-HOTFIX-E": по каждому пункту —
  что сделано, дифф-статистика (+N/-M) по файлу. Формулировки отчёта
  обязаны совпадать с фактическим диффом.

---

## Приёмка 2.4-HOTFIX-E — ПРИНЯТО, с оговоркой

Проверено Архитектором диффом по всем 4 пунктам:
- get_base()/get_swa() (класс llama_kv_cache_iswa) → llama_memory_i*,
  тело не менялось. Context-класс (get_base/get_swa на
  llama_kv_cache_context*) не трогался — он и был корректен.
- init_batch(): обе ветки (simple/equal split) переписаны на
  kv_base->init_kv_batch()/kv_swa->init_kv_batch() 1:1 с донором, включая
  проверку fail-статуса и хвостовой FAILED_PREPARE. Конструктор
  llama_kv_cache_iswa_context переведён на llama_memory_context_ptr,
  старый slot_info_vec_t-конструктор удалён из .h/.cpp, висячих
  использований не осталось (проверено грепом).
- get_can_shift(): get_size() → get_kv_size() с обеих сторон.
- get_kv_size(): override добавлен в llama_kv_cache.h/.cpp (тонкая
  обёртка над get_size()), llama_kv_cache_kvarn не трогали (уже был).
  init_kv_batch-override в llama_kv_cache.h — обязательная правка, не
  зафиксированная явно в задании, но необходимая (без неё
  kv_base->init_kv_batch() на обычном, не-kvarn кеше падал бы в
  дефолтный nullptr-возврат базового класса) — Cline сделал правильно,
  не дожидаясь отдельного тикета.

ОГОВОРКА: get_kv_size() в базовом llama_memory_i сделан
`virtual ... { return 0; }` вместо запрошенного чистого `= 0`. Практически
безвредно (оба реальных наследника переопределяют, других вызовов кроме
iswa::get_can_shift() нет) и совпадает с уже принятым в проекте паттерном
для init_kv_batch. Не переделывать, доказательная база меня устраивает.

Границы соблюдены — kvarn-файлы не тронуты, лишние донорские методы
(get_kv_n_stream/can_seq_rm/etc) не тащились. Ждём чистый ребилд от
пользователя (rm -rf build).

---

## Внеплановая правка Архитектора (не задание Cline)

ggml/src/ggml-cuda/cpy-utils.cuh:388 — пропущена закрывающая `}` у
cpy_blck_f32_q5_1 (следующая функция cpy_blck_f32_q6_0 открывалась
внутри неё), осиротевшая `}` нашлась четырьмя функциями ниже (была
:410, ничего не закрывала). Однозначный мусор от мерджа, фикс — два
однострочных изменения (добавить `}` в одном месте, убрать в другом).
Исправил напрямую, без Cline — задача тривиальна и w/o двусмысленности,
раунд-трип не оправдан. Проверено: count('{') == count('}') == 58 по
файлу, все 11 cpy_blck_f32_* функций — ровные блоки.

Второй заход ребилда: mmvq.cu использует ggml_cuda_type_traits<GGML_TYPE_Q3_1>
(и Q6_0/Q6_1/Q3_0/Q2_1 — все 5 TurboQuant-типов) в mul_mat_vec_q-диспатче,
но специализации шаблона для этих типов в common.cuh отсутствовали
(incomplete type). У донора все 5 есть (common.cuh:997-1036), макросы
QK/QR/QI для них уже были в ggml-common.h (более ранняя фаза порта, не
трогал). Портировал 5 специализаций 1:1 из донора в common.cuh, точка
вставки — перед GGML_TYPE_MXFP4 (та же позиция, что у донора). Дублей
нет (grep — по одному вхождению на тип). Тоже напрямую, без Cline —
чисто механический перенос, эталон донора однозначен.

Третий заход ребилда: fattn-mma-kvarn-instance-ncols1_1-ncols2_8.cu не
компилировался на DKQ=512,DV=512 — "no instance of flash_attn_ext_f16
matches". Причина: наш ggml/src/ggml-cuda/fattn-mma-f16.cuh ОТСТАВАЛ от
донора на ~200 строк несмотря на приёмку HOTFIX-C ("донор целиком+4
DECL"), которая на деле НЕ была донором целиком — четвёртый случай
недостоверного отчёта Cline (см. предыдущие три в приёмке D). Реально
отсутствовали: #include "fattn-mma-kvarn.cuh", тайл-лоадеры
flash_attn_ext_turbo{2,3}_0_load_tile, и главное — сам flash_attn_ext_f16
не был темплейтирован по type_K/type_V (донор: 8 параметров шаблона,
у нас было 6), а fattn-mma-kvarn-case.cuh зовёт его именно с 8.
Фикс: скопировал донорский файл целиком (diff donor↔наш показал ровно
это расхождение, больше ничего), затем вернул на место 4 уже одобренные
строки (512,512,{4,8,16,32},2) из ncols2-expansion (HOTFIX-D, п.1) —
их у донора нет, у нас были законно. Итоговый diff donor↔наш = ровно
+4 строки, ничего больше. Напрямую, без Cline — источник истины
(донор) однозначен, весь риск был в идентификации delta, а не в
самом мердже.

---

## Задание 2.4-HOTFIX-F

CUDA-ядро и src/llama-kv-cache-iswa.cpp теперь собираются (HOTFIX-E
принят). Следующая (и с высокой вероятностью последняя перед зелёной
сборкой) ошибка — src/llama-memory-hybrid-iswa.cpp, использует API,
которого не хватает после HOTFIX-E: `mem_attn->get_base()->get_n_stream()`,
`mem_attn->get_base()->prepare()`/`->get_swa()->prepare()` (нет в базовом
интерфейсе), и старый 4-аргументный конструктор `llama_kv_cache_iswa_context`
(HOTFIX-E перевёл его на 3-аргументный, ctx-ptr).

САМОКОРРЕКЦИЯ: в HOTFIX-E я запретил переносить `get_kv_n_stream()` в
базовый интерфейс, посчитав его "чужим более широким API донора". Это
было ошибкой — `get_kv_n_stream()` и `init_kv_batch()` НА УРОВНЕ
`llama_kv_cache_iswa` (не путать с `init_batch()`, который правили в п.3
HOTFIX-E) — рабочая лошадка, которую напрямую использует hybrid-iswa
(донор: `mem_attn->get_kv_n_stream()`, `mem_attn->init_kv_batch(ubatches)`).
Остальной запрет (`can_seq_rm`, `seq_rm_cell`, `cells_at_pos`, recurrent-
профили, `state_seq_restore_requires_exclusive_kv_stream` и т.п.) остаётся
в силе — это НЕ нужно, наш `llama-memory-hybrid-iswa.h` их сознательно не
имеет (сверил диффом с донором — у нас нет DFlash/force_split_seq и
всего этого набора, и это НЕ трогать, оставить обрезанным как есть).

### 1. src/llama-memory.h

Уже есть `init_kv_batch` (default-body). Добавить туда же:
```
virtual uint32_t get_kv_n_stream() const { return 0; }
```

### 2. src/llama-kv-cache.h / .cpp

`llama_kv_cache` уже имеет конкретный `get_n_stream()` (:160 в .h).
Добавить override-обёртку рядом с уже добавленным `get_kv_size()`:
```
uint32_t get_kv_n_stream() const override;
```
и в .cpp: `uint32_t llama_kv_cache::get_kv_n_stream() const { return get_n_stream(); }`
(тонкая обёртка, тело не дублировать). `llama_kv_cache_kvarn` уже имеет
`get_kv_n_stream()` (llama-kv-cache-kvarn.h:112) — НЕ трогать.

### 3. src/llama-kv-cache-iswa.h / .cpp

Добавить в класс `llama_kv_cache_iswa` (рядом с `get_base()`/`get_swa()`,
:92-93 нашего .h) два новых override:
```
uint32_t get_kv_n_stream() const override;
llama_memory_context_ptr init_kv_batch(const std::vector<llama_ubatch> & ubatches) override;
```
Реализация в .cpp — 1:1 донор (donors/beellama.cpp/src/llama-kv-cache-iswa.cpp,
методы `get_kv_n_stream()` и `init_kv_batch()`, идут сразу после `init_update()`
в донорском файле): `get_kv_n_stream()` возвращает `kv_base->get_kv_n_stream()`;
`init_kv_batch(ubatches)` зовёт `kv_base->init_kv_batch(ubatches)` /
`kv_swa->init_kv_batch(ubatches)`, при неудаче любого из двух — возвращает
`llama_kv_cache_iswa_context(LLAMA_MEMORY_STATUS_FAILED_PREPARE)`, иначе
собирает `llama_kv_cache_iswa_context` из готовых ctx (тот же 3-арг
конструктор, что уже используется в `init_batch()` после HOTFIX-E).

### 4. src/llama-memory-hybrid-iswa.h / .cpp

- `:81` (или где сейчас) `mem_attn->get_base()->get_n_stream()` →
  `mem_attn->get_kv_n_stream()`.
- Заменить два блока `mem_attn->get_base()->prepare(ubatches)` /
  `mem_attn->get_swa()->prepare(ubatches)` (с двумя проверками `.empty()`)
  на один вызов `auto ctx_attn = mem_attn->init_kv_batch(ubatches);` с
  проверкой `!ctx_attn || llama_memory_status_is_fail(ctx_attn->get_status())`
  (см. донор, тот же кусок).
- Конструктор `llama_memory_hybrid_iswa_context` — тот, что принимает
  `slot_info_vec_t sinfos_base, slot_info_vec_t sinfos_swa, ubatches` —
  заменить на однопараметрический `llama_memory_context_ptr ctx_attn_in`
  (по донору), тело: `ctx_attn(std::move(ctx_attn_in))`. Член `ctx_attn`
  в .h УЖЕ имеет тип `llama_memory_context_ptr` (:137) — менять не нужно,
  только сигнатуру конструктора в .h (:126-129 примерно) и .cpp.
- Вызов конструктора в `init_batch()` — один аргумент `std::move(ctx_attn)`
  вместо `std::move(sinfos_base), std::move(sinfos_swa)`.
- ВНИМАНИЕ: НЕ переносить остальные донорские отличия в этом куске
  (force_split_seq/DFlash-ветка, n_rs_seq в split_equal, can_seq_rm и
  прочее из диффа с донором) — они за пределами задания, наш файл их
  сознательно не имеет.

### Границы

- Файлы: src/llama-memory.h (1 метод), src/llama-kv-cache.h/.cpp
  (override-обёртка), src/llama-kv-cache-iswa.h/.cpp (2 override),
  src/llama-memory-hybrid-iswa.h/.cpp (описанные правки, без DFlash/
  force_split_seq/n_rs_seq и прочего трим-скоупа).
- llama-kv-cache-kvarn.h/.cpp НЕ трогать.
- Сборку НЕ запускать. CLINE.md НЕ трогать.
- Отчёт в cline-report.md, секция "2.4-HOTFIX-F": по каждому пункту —
  что сделано, дифф-статистика по файлу. Формулировки — строго по факту
  диффа.

---

## Приёмка 2.4-HOTFIX-F — ПРИНЯТО

Проверено диффом по всем 4 пунктам, всё 1:1 с донором и заданием:
get_kv_n_stream() добавлен в базу/llama_kv_cache/iswa как тонкие обёртки,
init_kv_batch() у iswa зеркалит донора (fail-check на оба, иначе context
из готовых ctx), hybrid-iswa переведён на mem_attn->init_kv_batch()
единым вызовом и упрощённый 3-арг конструктор context-класса.
DFlash/force_split_seq/n_rs_seq не тронуты, kvarn-файлы не тронуты.
Замечаний нет. Ждём следующий чистый ребилд.

---

## Внеплановая правка Архитектора: src/llama-kv-cache-dsv4.cpp (не задание Cline)

Четвёртый заход ребилда: llama-kv-cache-dsv4.cpp — 9 мест использует
iswa::get_base()/get_swa(), рассчитывая на старый тип llama_kv_cache*
(::prepare(), ::get_n_stream() напрямую). Это ЧИСТЫЙ АПСТРИМ (DeepSeek
V4, коммиты 8c146a836/13f2b28b0), донор его не касался, kvarn там не
упоминается ни разу (grep пусто) — DSv4 никогда не работал с kvarn,
писан до появления kv_base/kv_swa как llama_memory_ptr. Раскаст
`static_cast<llama_kv_cache *>(...)` в 9 местах (7 прямых get_base/
get_swa под ::prepare/::get_n_stream/член kv_swa, 2 места на
kv->get_base()->init_update()/kv->get_swa()->init_update() оставил
как есть — init_update() есть в базовом интерфейсе, каста не требует).
Семантика не меняется (значение и раньше было де-факто llama_kv_cache*,
просто теперь тип статически шире) — чинит только компиляцию. Напрямую,
без Cline — 9 однотипных строк, источник истины (фактический тип
объекта) прослеживается по всей цепочке создания без двусмысленности.

ПРИМЕЧАНИЕ для Фазы 4: DSv4/DFlash и kvarn совместно никогда не
проверялись и, возможно, несовместимы по дизайну (raw_context жёстко
хранит llama_kv_cache*, при активном kvarn на этом пути будет UB через
static_cast на llama_kv_cache_kvarn). Если в Фазе 4 kvarn понадобится
вместе с DSv4 — нужен отдельный guard/assert, сейчас не добавлял (вне
scope текущего чинения сборки).

---

## МОЯ ОШИБКА: снёс HOTFIX-D в CMakeLists.txt, восстановил

Пятый заход ребилда: линковка — undefined vec_case для пар типа
(Q6_1,Q4_1), (F16,Q5_0), (Q3_1,Q2_1) и т.п. — все входят в
DEFAULT_PAIRS (56), т.е. таблица в fattn.cu их ждёт, но CMake их не
компилировал. Причина — НЕ Cline: `ggml/src/ggml-cuda/CMakeLists.txt`
оказался ПОЛНОСТЬЮ БЕЗ ИЗМЕНЕНИЙ относительно HEAD (git diff --stat
пустой), хотя HOTFIX-D (п.3, принят) добавлял туда macro
ggml_add_fattn_vec_pair + 3-ветку ALL_QUANTS/HALF_QUANTS/default.
В начале сессии я делал `git restore ggml/src/ggml-cuda/` для возврата
68 удалённых core-.cu файлов — но CMakeLists.txt в тот момент УЖЕ был
в git status как "M" (некоммиченная правка HOTFIX-D), и restore на всю
директорию откатил его тоже вместе с удалёнными файлами. Я не исключил
этот файл из restore. Моя ошибка, не Cline.

Восстановил сам: собрал секцию заново по структуре донора
(macro/FATAL_ERROR при одновременных ALL_QUANTS+HALF_QUANTS/3 ветки),
но со списками типов/пар БЕЗ q2_0 (D-009) — сверил программно через
сам scripts/gen-fattn-vec-dispatch.py (тот же источник истины, что и
таблицы в fattn.cu), а не вручную transcribe донора. Итог: 197
half-пар, 56 default-пар — совпадает с уже утверждёнными в HOTFIX-D
инвариантами. `cmake -B build` прошёл конфигурацию без FATAL_ERROR
(macro's file-exists check и оба count-assert'а прошли на первом
запуске). Напрямую, без Cline — программная генерация из готового
скрипта, риск ручной опечатки исключён.

Урок на будущее: `git restore <директория>` затрагивает ВСЕ файлы под
путём, включая некоммиченные правки, не только те, что я хотел
исправить. Впредь — restore только по конкретным путям файлов, никогда
по директории целиком, если в ней могут быть чужие незакоммиченные
изменения.

---

## Тот же restore снёс ЕЩЁ 4 файла — Q2_0-чистка (D-009) и ncols2-фильтр

Шестой заход ребилда показал: помимо CMakeLists.txt, тот же
`git restore ggml/src/ggml-cuda/` откатил ЕЩЁ 4 файла с некоммиченной
работой HOTFIX-D: template-instances/generate_cu_files.py (строка 159,
ncols2-фильтр для DKQ=512), fattn.cu (вся Q2_0-чистка, ~600 строк
диспатч-таблиц), fattn-common.cuh, fattn-vec.cuh (Q2_0 в constexpr-
диспатче и EXTERN_DECL). Восстановил всё сам, программно:

1. generate_cu_files.py:159 → вернул ncols2=2 в допустимый набор для
   DKQ=512, перезапустил генератор ИЗ template-instances/ (483 файла,
   без дублей — количество не изменилось).
2. fattn.cu: перегенерировал таблицу FATTN_VEC_CASES_* через
   `python3 scripts/gen-fattn-vec-dispatch.py` (581 строка) и заменил
   ей блок целиком (был между строками 2163 и 2806 — ALL_QUANTS/
   HALF_QUANTS/default секции с q2_0). Плюс убрал 5 (не 4 — нашёл ещё
   одну, ggml_cuda_fattn_is_classic_non_q8_type, не упомянутую в
   исходном отчёте HOTFIX-D, но подпадающую под критерий "0 ссылок")
   ручных Q2_0-мест: kv_rank, tier-функция(return 5), K-type
   accept-switch, is_classic_non_q8_type.
3. fattn-common.cuh: убрал 2 `else if constexpr (type_* == GGML_TYPE_Q2_0)`
   (функции vec_dot_fattn_vec_KQ_q2_0/dequantize_V_q2_0 остались как
   неиспользуемый мёртвый код — не содержат литерала GGML_TYPE_Q2_0
   в теле, инвариант не нарушают, трогать не стал).
4. fattn-vec.cuh: убрал `extern DECL_FATTN_VEC_CASE(D, type_K, GGML_TYPE_Q2_0)`
   из макроса EXTERN_DECL_FATTN_VEC_CASES + 4 вызова
   EXTERN_DECL_FATTN_VEC_CASES(*, GGML_TYPE_Q2_0).

Итог: `grep -rn GGML_TYPE_Q2_0` по всему ggml-cuda (включая
template-instances) = 0 некомментных совпадений. `cmake -B build`
проходит конфигурацию чисто. Всё напрямую, без Cline — источники истины
(оба python-скрипта) не пострадали от restore (untracked/уже в HEAD на
момент коммита), использовал их для программной регенерации вместо
ручной транскрипции.

---

## СБОРКА ЗЕЛЁНАЯ, ЗАКОММИЧЕНО

Чистый ребилд прошёл 100%, `test-backend-ops` 13994/13994, bench
pp512=2488/tg64=69 (baseline 2298/61, без регрессии). Вся серия
хотфиксов + накопленный 3.2 закоммичены (`54747fc74`, без AI-трейлеров).
Дерево снова чистое по коду порта — работаем с HEAD, не с "текущим
working tree с прошлой сессии".

## Задание 3.2-GRAPH — параллельно с Hermes (llama-context.cpp) и omp (3.3)

Три исполнителя работают ОДНОВРЕМЕННО, каждый в своих файлах, без
пересечений (Zed не задействован, забудь — опечатка в первой версии
этого задания):
- ТЫ — этот файл: `src/llama-graph.cpp` + `src/llama-graph.h`.
- Hermes — `src/llama-context.cpp` (HERMES.md, задание H-4, разовое
  исключение из его обычного codacus-трека), независимо, файлы разные.
- omp — Фаза 3.3, `src/llama-model.cpp` (llama-arch.cpp вычеркнут из
  скоупа omp — донор его не касается) (OMP.md, задание O-1).

Не трогай llama-context.cpp, llama-model.cpp, llama-arch.cpp — не твоя
полоса в этом заходе.

### Задача

`src/llama-graph.cpp` и `src/llama-graph.h` — обвязка kvarn (WHT-ротация
K/V, выбор attention-domain, native K/V путь для flash-attn) НЕ ПОРТИРОВАНА
вообще (`grep -c "kvarn\|KVARN" src/llama-graph.cpp` = 0, не считая
случайных совпадений). Донор: `donors/beellama.cpp/src/llama-graph.cpp`
(113 совпадений kvarn) и `.h` (239 строк diff с нашим, но не всё это
kvarn — часть diff может быть посторонним дрейфом, разбираться по месту).

МЕТОД (тот же, что в HOTFIX-C/D/E/F, «целиком из донора» ЗАПРЕЩЕНО):
1. `grep -n "kvarn\|KVARN" donors/beellama.cpp/src/llama-graph.cpp` — это
   твоя карта. Основные зоны (по моей разведке, сверь сам):
   - :1-22 — includes (добавить `#include "llama-kv-cache-kvarn.h"` в наш
     существующий include-блок, ничего не удалять).
   - :27-166 — новые статические хелперы (`llm_kvarn_attn_domain`,
     `llm_flash_attn_ext_set_kvarn_domain`, `ggml_kvarn_wht_aux`,
     `llm_kvarn_rot_for_dim`, `llm_kvarn_set_rot_inputs`).
   - ~:606-764 (номера строк у донора могут отличаться от наших — искать
     по контексту функций `llm_graph_input_attn_kv::set_input` и
     `llm_graph_input_attn_kv_iswa::set_input`) — добавка блока
     `if ((self_kvarn_rot_128 && ...` после существующей установки
     `self_v_rot`.
   - ~:2434-2549 и ~:2776-2861 — два ПОЧТИ идентичных блока (self-attn и
     SWA/iswa-attn варианты `build_attn`): построение rotation-инпутов,
     `use_kvarn`/`use_kvarn_rotated_domain`/`use_kvarn_native` и т.д.,
     переключение K/V на `kvarn_ctx->get_k_native()/get_v_native()`,
     WHT-ротация Q на входе и V на выходе, простановка kvarn_domain в
     op_params.
   - ~:3001-3019 — построение `self_kvarn_rot_*`/`self_kvarn_mat_idxs_swa`
     инпутов при сборке input-класса (симметрично для base и swa cache).
2. `src/llama-graph.h`: добавить члены `self_kvarn_rot_128/256/512` и
   `self_kvarn_mat_idxs_swa` в соответствующие input-классы (донор
   :386-388, :507-510 — сверь имена классов у нас, могут быть в другом
   месте из-за нашей другой структуры файла) + добавить объявления новых
   статических хелперов если они у донора в .h, а не в .cpp (проверь).
3. НЕ переносить ничего, не относящегося к kvarn (DFlash, dsa, что угодно
   ещё в diff .h/.cpp — у donора и нашего дерева разный апстримный дрейф,
   тебе нужны ТОЛЬКО kvarn-хунки).
4. Наши файлы уже включают `llama-kv-cache-dsv4.h` (донора нет) — не
   трогать, не удалять, kvarn-инклюд добавляется РЯДОМ.

### Границы

- Файлы: src/llama-graph.cpp, src/llama-graph.h. Больше ничего.
- Сборку НЕ запускать (я соберу вместе с Zed/omp после всех трёх
  отчётов — файлы разные, но фича общая, тестируем вместе).
- CLINE.md не трогать.
- Отчёт в cline-report.md, секция "3.2-GRAPH": по каждому пункту — что
  перенесено, diffstat, явно указать что НЕ переносил и почему (DFlash/
  dsa-шум). Если donor'ские номера строк разъехались с реальностью —
  так и написать, что ориентировался по контексту функций, а не по
  номерам.

---

## Приёмка 3.2-GRAPH — ПРИНЯТО

Лучший отчёт за сессию: diffstat сверен `--numstat` (217/6 + 7/0, совпало
1:1), баланс скобок в обоих файлах = 0, ссылка на решение по DFlash-ветке
(CLINE.md:274-279) проверена и подтверждена дословно.

По флагам:
1. **Turbo output-inverse-WHT не перенесён** — согласен, задание было
   "только kvarn-hunks", turbo graph-wiring реально отдельный скоуп. Сейчас
   ни одна модель не сконфигурирована на turbo-KV (активация — Фаза 4),
   значит `v->type != TURBO*` в рантайме всегда — пропуск безопасен.
   Записываю в HANDOFF как известный TODO для Фазы 4 (turbo output-WHT
   на graph-уровне не завязан, при активации turbo-KV нужно вернуться
   к этому куску донора).
2. **Domain-блок после mctx_cur, а не до k_rot-пре-ротации** — одобряю,
   перемещать mctx_cur не нужно. Проверил сам: пре-ротация в
   build_attn(llm_graph_input_attn_kv*) гейтится на `if (inp->self_k_rot)` /
   `if (inp->self_v_rot)` (:2762-2769), а `self_k_rot`/`self_v_rot`
   популяруются из `mctx_cur->build_input_k_rot()/build_input_v_rot()` для
   ЛЮБОГО типа кеша, но для kvarn-кеша (нативный формат, без rope-трюка)
   возвращают nullptr по конструкции — гейт и так не сработает независимо
   от того, до или после assert'а стоит domain-блок. Assert на :2793-2794
   (`self_k_rot == nullptr` при `use_kvarn`) — это defensive double-check
   того же инварианта, а не источник корректности. Семантика верна.

Границы соблюдены (ggml_mul_mat_aux/ggml_turbo_wht/TURBO-типы/dflash — 0
добавлений, только один предсуществующий комментарий не в счёт). Замечаний
нет. Готово к общему сборочному раунду вместе с Hermes (H-4, принят) и
omp (O-1, принят после переделки).

СБОРКА ЗЕЛЁНАЯ, ЗАКОММИЧЕНО (240a0f51b, поверх 54747fc74). Parity
13994/13994, bench в шуме. Фаза 3 закрыта. Дальше — Фаза 4.

---

## Задание 4.1-BACKEND — ggml-backend.cpp: KVARN_VIEW split-логика

Фаза 4 (ARCHITECTURE.md: "Scheduler + CLI"). Это твоя часть — scheduler.
CLI (arg.cpp/common.h) параллельно у omp (OMP.md, задание O-2), файлы не
пересекаются.

### Контекст

`GGML_OP_KVARN_VIEW` (ggml.c/ggml.h) уже существует и работает — это
bufferless view-тензор с 3 источниками (`src[0]=records, src[1]=stage_after_store,
src[2]=indices`), потребляется напрямую `FLASH_ATTN_EXT`. Планировщик
(`ggml_backend_sched_split_graph` в ggml-backend.cpp) про него ничего не
знает — в графе с несколькими бэкендами/сплитами он будет трактоваться как
обычный тензор, требующий буфера и кросс-сплит копирования, что для
bufferless-view семантически неверно (и, возможно, падает/ассертит).
Донор: `donors/beellama.cpp/ggml/src/ggml-backend.cpp`, `grep -n "kvarn"`
даёт полную карту (13 строк, все в одном файле).

На один GPU (наш RTX 3070, текущий рантайм-стенд) это может не проявляться
вообще (нет сплитов между бэкендами) — но без этой правки multi-backend/
multi-GPU конфигурации с kvarn сломаны, и это явно прописано в
ARCHITECTURE.md как обязательная часть Фазы 4, не опция.

### Точки (донор, ggml-backend.cpp)

1. **:746 `ggml_is_view_op`** (у нас та же функция на этой же строке,
   проверь `grep -n "static bool ggml_is_view_op" ggml/src/ggml-backend.cpp`) —
   добавить `|| op == GGML_OP_KVARN_VIEW` в дизъюнкцию.
2. **:749-764** — два новых статических хелпера,
   `ggml_backend_sched_kvarn_view_base` (const-версия) и
   `ggml_backend_sched_kvarn_view_base_mut` (mutable) — оба одинаковые:
   проходят по цепочке `RESHAPE`/`PERMUTE` до первого не-view предка,
   возвращают его, если это `GGML_OP_KVARN_VIEW`, иначе `NULL`. Перенести
   1:1, обе версии (const и mutable) нужны разным call-сайтам ниже.
3. **:766-773** — `ggml_backend_sched_allows_bufferless_kvarn_src(node, src_index, src)`:
   true, если `node->op == GGML_OP_FLASH_ATTN_EXT` и
   `ggml_backend_sched_kvarn_view_base(src) != NULL` (сверь донора точно —
   там может быть доп. условие на src_index, не срезай). Перенести 1:1.
4. **~:1326-1335** (внутри `ggml_backend_sched_split_graph`, там где решается
   `need_new_split` по src-тензорам ноды) — блок:
   ```
   if (ggml_backend_sched_allows_bufferless_kvarn_src(node, j, src)) {
       struct ggml_tensor * kvarn_view = ggml_backend_sched_kvarn_view_base_mut(src);
       GGML_ASSERT(kvarn_view != NULL);
       for (int ks = 0; ks < 3; ++ks) {
           if (kvarn_view->src[ks] != NULL && check_new_split_src(kvarn_view->src[ks])) {
               need_new_split = true;
               break;
           }
       }
       if (need_new_split) {
           break;
       }
       continue;
   }
   ```
   Вставить в начало тела цикла `for (int j = 0; j < GGML_MAX_SRC; j++)`
   (после `if (src == NULL) continue;`, до обычной обработки src). У нас
   имя локальной функции `check_new_split_src` и структура цикла могут
   отличаться по мелочи (переменные) — сверяй по СМЫСЛУ (если новый
   cross-backend вход не влезает в текущий сплит — начинаем новый), не по
   тексту.
5. **~:1403-1413** (дальше в той же функции, там где реально строится
   список `split->inputs`/копий через `move_src_to_split`) — симметричный
   блок:
   ```
   if (ggml_backend_sched_allows_bufferless_kvarn_src(node, j, src)) {
       // FLASH_ATTN_EXT consumes KVarN view descriptors directly; the view
       // output stays bufferless, but its hidden records/stage/indices sources
       // must still be visible from the CUDA split.
       struct ggml_tensor * kvarn_view = ggml_backend_sched_kvarn_view_base_mut(src);
       GGML_ASSERT(kvarn_view != NULL);
       for (int ks = 0; ks < 3; ++ks) {
           move_src_to_split(&kvarn_view->src[ks]);
       }
       continue;
   }
   ```
   Тоже перед обычной src-обработкой, тот же принцип: сверяй по смыслу,
   не по номерам (`move_src_to_split` у нас может называться иначе —
   найди функцию с той же ролью: "перетащить src-тензор в текущий сплит
   как явный вход").

### Границы

- Файл: ggml/src/ggml-backend.cpp. Больше ничего (в частности — не трогай
  ggml.c/ggml.h, GGML_OP_KVARN_VIEW и `ggml_kvarn_view()` уже полностью
  готовы и закоммичены).
- Если у нас структура `ggml_backend_sched_split_graph` разошлась с донором
  настолько, что якоря 4-5 не находятся по смыслу — СТОП, опиши в отчёте
  расхождение и жди меня, не изобретай интеграцию сам.
- Сборку НЕ запускать. Не коммитить. CLINE.md не трогать.

**Отчёт в cline-report.md, секция "4.1-BACKEND":** по каждому из 5 пунктов
— что перенесено, diffstat, при расхождении со структурой донора — что
именно разошлось и как адаптировал (или что застопорился).

---

## ФАЗА 4 ЗАКРЫТА (76e57c616). Новое задание — гэп из списка Фазы 3.2.

## ЗАДАНИЕ 3.2c — kvarn в llama_memory_hybrid_iswa

Гэп из HANDOFF: `llama_memory_hybrid_iswa` (гибрид recurrent+attention,
напр. Qwen35MoE + SWA) вообще не принимает kvarn. Проверил сам: это
ДОСТИЖИМЫЙ путь — `LLM_ARCH_QWEN35MOE` (наша эталонная MoE-модель, см.
ARCHITECTURE.md) явно в списке фильтров у ветки `llama_memory_hybrid_iswa`
в src/llama-model.cpp:2111-2135 (условие `hparams.swa_type !=
LLAMA_SWA_TYPE_NONE`). Если у такой модели включат kvarn через CLI (Фаза 4
уже это позволяет) — тихо получат кеш без kvarn, никакой ошибки.

### Донор
`donors/beellama.cpp/src/llama-memory-hybrid-iswa.h`/`.cpp` — ctor берёт
`llama_kvarn_params kvarn = llama_kvarn_default_params()` последним
параметром и пробрасывает его в свой внутренний
`new llama_kv_cache_iswa(...)` (тоже последним аргументом — этот ctor
`llama_kv_cache_iswa` УЖЕ принимает kvarn у нас, ничего менять не надо).

### Точки (наше дерево, проверено мной)

1. **src/llama-memory-hybrid-iswa.h** — ctor `llama_memory_hybrid_iswa(...)`
   (единственный, в классе один конструктор): добавить
   `llama_kvarn_params kvarn = llama_kvarn_default_params()` ПОСЛЕДНИМ
   параметром (после `filter_recr`). Донор делает так же.
2. **src/llama-memory-hybrid-iswa.cpp** — определение ctor: добавить тот же
   параметр в сигнатуру; в member-init-list у `mem_attn(new
   llama_kv_cache_iswa(...))` добавить `kvarn` последним аргументом внутри
   вызова (сейчас там `nullptr, nullptr` на конце — сверь с донором, у нас
   там на один `nullptr` меньше, т.к. `n_batch`-параметра в нашем ctor нет
   вообще, это уже известное и принятое расхождение, НЕ трогай его — только
   добавляешь kvarn, ничего не выравнивай по n_batch).
3. **src/llama-model.cpp:2111-2135** — единственный call-site, ветка
   `if (hparams.swa_type != LLAMA_SWA_TYPE_NONE)` внутри hybrid-блока:
   добавить `params.kvarn` последним аргументом в вызов
   `new llama_memory_hybrid_iswa(...)`. НЕ трогай соседнюю ветку `else`
   (`new llama_memory_hybrid(...)` — это НЕ iswa-класс, kvarn туда по
   плану не идёт, донор её тоже не трогает).

### Границы
- Файлы: src/llama-memory-hybrid-iswa.h/.cpp, src/llama-model.cpp (только
  этот один call-site, не путай с O-1'овскими вызовами omp — те другие,
  строки ~2200+, не твои).
- Ничего сверх добавления параметра — не рефактори n_batch/n_ubatch
  расхождение, оно принято (см. HOTFIX-D).
- Сборку не запускать, не коммитить.

**Отчёт в cline-report.md, секция "3.2c":** diffstat по каждому из 3
файлов, подтверждение что n_batch-расхождение не трогал.

---

## Приёмка 3.2c — ПРИНЯТО

Проверено диффом напрямую (все 3 файла): kvarn добавлен последним
параметром/аргументом везде по цепочке (.h declaration -> .cpp definition
-> внутренний вызов llama_kv_cache_iswa -> call-site в llama-model.cpp),
`else`-ветка (`llama_memory_hybrid`, не iswa) не тронута, n_batch-расхождение
не трогал. Замечаний нет.

Свободен — новых заданий пока нет, следующий раунд после отчётов
omp (O-3) и Hermes (H-2/H-3).

---

## ЗАДАНИЕ 2.2d — недостающий ggml_backend_cuda_kvarn_native_ops (найдено на рантайм-смоке)

Первый живой запуск kvarn через CLI (`--cache-type-k/-v kvarn4`, RTX 3070)
упал на валидации: `cannot enable kvarn_k4v4_g128: KVarN requires a
backend with native KVarN FlashAttention support`. Раскопал: причина НЕ
в железе (RTX 3070 sm_86 умеет turing_mma, должен проходить) — причина в
том, что `src/llama-kv-cache-kvarn.cpp:38` (`llama_kvarn_backend_supports_native_ops`)
резолвит функцию через `ggml_backend_reg_get_proc_address(reg,
"ggml_backend_kvarn_native_ops")` — а у нас в `ggml/src/ggml-cuda/ggml-cuda.cu`
ЭТОЙ ЗАПИСИ НЕТ ВООБЩЕ (`grep -c ggml_backend_kvarn_native_ops
ggml-cuda.cu` = 0). У донора она есть (`ggml-cuda.cu:5357` — сама функция,
`:6055` — регистрация в proc_address). Без неё `fn == nullptr` и
`llama_kvarn_backend_supports_native_ops` ВСЕГДА возвращает `false`,
независимо от реального железа — вся CUDA-kvarn-кернельная работа Фазы 2
(fattn-mma-kvarn-*, kvarn.cu) физически недостижима через этот путь. Это
пропуск из задания 2.2 (`ggml-cuda.cu — диспатч GGML_OP_KVARN_VIEW (case в
switch, backend support check, split logic)`) — "backend support check"
был воспринят как op-dispatch (уже есть, работает), а не как ЭТА
capability-query функция.

### Донорский эталон

`donors/beellama.cpp/ggml/src/ggml-cuda/ggml-cuda.cu`:
- `:5357-5381` — сама функция `ggml_backend_cuda_kvarn_native_ops(ggml_backend_dev_t dev)`.
- `:6055-6057` — регистрация в `ggml_backend_cuda_reg_get_proc_address`
  (`if (strcmp(name, "ggml_backend_kvarn_native_ops") == 0) { return (void *)ggml_backend_cuda_kvarn_native_ops; }`).
- `:5828-5831` — в `device_supports_op`, случаи `GGML_OP_KVARN_WHT`/
  `GGML_OP_KVARN_STORE` гейтятся через эту же функцию
  (`return ggml_backend_cuda_kvarn_native_ops(dev);`), а не `return true;`.

Все символы, от которых зависит донорская функция, УЖЕ есть в нашем
дереве (проверено): `turing_mma_available` (ggml-cuda/common.cuh:348),
`ggml_cuda_kvarn_required_shared_bytes`/`ggml_cuda_kvarn_low_shared_bytes`
(ggml-cuda/kvarn.cu:369,373, объявлены в kvarn.cuh:5-6),
`ggml_cuda_info()`, `ggml_cuda_get_device()` — стандартные, уже
используются рядом в файле.

### Точки (наше дерево, номера сверены)

1. **Добавить саму функцию** `static bool ggml_backend_cuda_kvarn_native_ops(ggml_backend_dev_t dev)`
   рядом с похожими device-capability функциями в файле (например, рядом
   с `ggml_backend_cuda_host_buffer_type`/`ggml_backend_cuda_device_supports_buft`
   — найди подходящее соседство по стилю, не обязательно рядом с донорской
   строкой 5357, у нас дрейф). Тело — 1:1 донор (MUSA-ветка тоже перенеси,
   `#if defined(GGML_USE_MUSA) ... #else ... #endif`, у нас MUSA-путь тоже
   в дереве есть — проверь grep, если MUSA-кода в файле нет вообще, MUSA-
   ветку не переноси и отметь в отчёте почему).
2. **Регистрация в proc_address**: наш `ggml_backend_cuda_reg_get_proc_address`
   (наш :5175-5195, найди по имени функции, не по номеру) — добавить
   `if (strcmp(name, "ggml_backend_kvarn_native_ops") == 0) { return (void
   *)ggml_backend_cuda_kvarn_native_ops; }` рядом с существующими
   `strcmp`-блоками (например, после `ggml_backend_get_features`).
3. **device_supports_op**: наш `case GGML_OP_KVARN_WHT: case
   GGML_OP_KVARN_STORE: { return true; }` (найди грепом
   `GGML_OP_KVARN_STORE` в файле, их 3 вхождения — 2 в диспетчере
   `compute`, 1 в `supports_op`, тебе нужен ИМЕННО `supports_op`) —
   заменить `return true;` на `return ggml_backend_cuda_kvarn_native_ops(dev);`
   (донор делает так же, `dev` уже есть в скоупе этой функции — сверь имя
   локальной переменной, может отличаться от донорского).

### Границы

- Файл: `ggml/src/ggml-cuda/ggml-cuda.cu`. Больше ничего (kvarn.cu/.cuh,
  fattn-mma-kvarn* уже готовы, не трогать).
- Не переноси ничего DFlash-специфичного, если попадётся по соседству в
  донорском диффе.
- Сборку не запускай (я соберу и прогоню рантайм-смок kvarn сам после
  твоего отчёта — это первый реальный прогон, важно проверить аккуратно).
- Не коммитить, CLINE.md не трогать.

**Отчёт в cline-report.md, секция "2.2d":** diffstat, подтверждение что
MUSA-ветка перенесена/пропущена и почему, что все 3 точки закрыты, что
`grep -c ggml_backend_kvarn_native_ops` в файле теперь >= 2 (объявление +
регистрация, плюс use-сайт в supports_op).

---

## Приёмка 2.2d — ПРИНЯТО

Сверил `git diff` напрямую — совпадает 1:1 с отчётом по всем 3 точкам.
Функция на месте с MUSA-веткой, регистрация в proc_address корректна,
`supports_op` теперь гейтит через реальную capability-проверку вместо
`return true;`. Стилистическое расхождение (блок+break у нас vs голый
return у донора) — верно оставлено как есть, вне скоупа задания.

Готово к пересборке и рантайм-смоку kvarn — делаю сам.

---

## Приёмка 4.1-BACKEND (промежуточная) — точки 1-3 ПРИНЯТО, 4-5 РЕШЕНИЕ ПО СТОПУ

Точки 1-3 — чистый 1:1 донор, без вопросов. Стоп на 4-5 обоснован: якоря
по смыслу нашлись, но интеграция требует решения о форме, ты его не
изобретал сам — правильно. Решение: **Вариант A (рефактор в лямбды)**,
с уточнением ниже. Ни B, ни C — дублирование кода ради формальной чистоты
скоупа хуже, чем небольшой некоvarn-рефактор рядом: копия split-логики
разойдётся с оригиналом при следующем апстрим-мердже и это никто не
заметит вовремя.

## ЗАДАНИЕ 4.1-BACKEND-b — лямбды + донорская pending-семантика (продолжение)

1. Вынеси наш существующий инлайн-код (наш :1282-1299 "need new split" и
   наш :1352-1370 "move to split") в две локальные лямбды внутри
   `ggml_backend_sched_split_graph`, по донорскому образцу и с донорскими
   именами — `check_new_split_src(src)` и `move_src_to_split(src_ptr)`.
   Поведение эквивалентное, НЕ импортируй пока pending-логику (следующий
   пункт делает это отдельно, чтобы было видно в диффе, что именно
   изменилось семантически, а что просто вынесено).
2. Отдельным hunk-ом: добавь `pending_new_split_inputs`-счётчик и поменяй
   проверку в `check_new_split_src` с нашей `split->n_inputs ==
   GGML_SCHED_MAX_SPLIT_INPUTS` на донорскую `split->n_inputs +
   pending_new_split_inputs > GGML_SCHED_MAX_SPLIT_INPUTS` (донор
   :1310-1319). Это касается ВСЕХ src, не только kvarn — донор чинит эту
   логику один раз для общего случая, kvarn-блоки просто вызывают ту же
   лямбду. Сверить донорский код на предмет того, где/как
   `pending_new_split_inputs` инкрементируется и обнуляется (это должно
   остаться консистентным с существующим циклом, не только с новым
   kvarn-веткой) — перенеси 1:1.
3. Теперь вставь kvarn-блоки точек 4-5 из исходного задания как есть
   (донор :1327-1340 и :1404-1413), они зовут уже готовые лямбды.
4. Проверка: 2 unused-warning'а из отчёта (`_view_base_mut`,
   `_allows_bufferless_kvarn_src`) должны исчезнуть — обе функции
   получают call-site.

### Границы
- Тот же файл: ggml/src/ggml-backend.cpp. Больше ничего.
- Это НЕ выход за скоуп "kvarn-хунк" по факту цели (лямбда-рефактор +
  pending-фикс страхуют именно kvarn-путь, который без них либо
  дублирует ~111 строк, либо живёт с неточной "too many inputs"
  проверкой) — упомянутое расхождение с "только kvarn" одобрено явно,
  писать отдельную строку в отчёте с оговоркой не нужно, но диффстат
  по каждому из 3 пунктов — обязателен.
- Сборку не запускать, не коммитить, CLINE.md не трогать.

**Отчёт в cline-report.md, секция "4.1-BACKEND-b":** diffstat по каждому
из 3 пунктов + подтверждение, что unused-warning'и закрыты + где именно
донорский pending-counter инкрементируется/обнуляется (список строк).

---

## ЗАДАНИЕ 2.2e — KVARN_VIEW: обвязка CUDA-графа (донорский пропуск, блокер смока)

### Контекст (диагноз Архитектора, 2026-07-16)

Рантайм-смок kvarn4 (после 2.2d, с `-fit off -c 65536`) прошёл валидацию
и загрузку, но упал на первом decode: `ggml-cuda.cu:3941 GGML_ASSERT(ok)`,
`op not supported node_213 (KVARN_VIEW)`. Причина: в нашем
ggml/src/ggml-cuda/ggml-cuda.cu НОЛЬ упоминаний KVARN_VIEW, у донора — их
пять + две функции. 2.2d закрыл только native_ops-регистрацию; вся
KVARN_VIEW-обвязка CUDA-графа не переносилась никогда (не входила ни в
2.2, ни в 2.2d). ВАЖНОЕ отличие структуры: у донора скипы view/noop-опов
захардкожены инлайн-условиями в каждом цикле, а у нас апстрим вынес их в
хелпер `ggml_cuda_is_view_or_noop` (:2407), который используется в :2421,
:2585, :3904 — поэтому пункты 1-2 у нас РЕЗКО проще донорского диффа.

### Что сделать (файл: ggml/src/ggml-cuda/ggml-cuda.cu)

1. **`ggml_cuda_is_view_or_noop` (:2407-2410):** добавь
   `|| t->op == GGML_OP_KVARN_VIEW` в условие. Это одной строкой кроет
   донорские скипы :3460 (info-loop), :4612 (evaluate-loop, наш :3904 —
   именно тут лежит краш) и наш :2585.
2. **Лямбда `is_noop` (:4120-4123):** добавь
   `|| node->op == GGML_OP_KVARN_VIEW` — зеркало донорского :4832
   (у донора эта лямбда — отдельная копия условия, у нас тоже).
3. **Порт двух хелперов** (донор :3399-3411, у нас отсутствуют целиком):
   `ggml_cuda_kvarn_view_base` и `ggml_cuda_allows_bufferless_kvarn_src`
   — 1:1. Размести перед `#ifdef USE_CUDA_GRAPH` (:2412), рядом с
   `ggml_cuda_is_view_or_noop`.
4. **`ggml_cuda_graph_node_buffers_visible`** (донор :3413-3445, вызовы
   донор :4626 и :4744): у донора это вынесенная проверка видимости
   буферов нод для CUDA-graph-capture с kvarn-исключением
   (`ggml_cuda_allows_bufferless_kvarn_src` разрешает bufferless src у
   FLASH_ATTN_EXT). Промапь донорские call-site'ы :4626/:4744 на наши
   эквиваленты (наша структура evaluate/capture отличается — апстрим
   рефакторил; ближайший родственник — NDEBUG-assert-блок :3925-3933,
   где `assert(node->src[j]->buffer)` СЛОМАЕТСЯ на bufferless kvarn-src
   в debug-сборке). Если мапится однозначно — переноси; если наша
   структура не даёт очевидного места — СТОП по образцу 4.1-BACKEND:
   отчёт с анализом, что нашёл и какие варианты видишь. НЕ изобретай
   свою интеграцию без согласования.

### Границы

- Один файл: ggml/src/ggml-cuda/ggml-cuda.cu.
- Сборку не запускать, не коммитить, CLINE.md не трогать.

**Отчёт в cline-report.md, секция "2.2e":** diffstat по каждому из 4
пунктов отдельно; полный текст обоих новых хелперов и (если перенесена)
buffers_visible-функции; для пункта 4 — таблица маппинга донорский
call-site -> наш (строки); баланс `{}`/`()` до/после.

---

## Приёмка 2.2e — пункты 1-3 ПРИНЯТЫ, по пункту 4 решение: вариант A (гибрид C)

Сверил дерево грепами: :2409, :2417-2424, :4136 — 1:1 с отчётом, балансы
сходятся. Стоп по пункту 4 правильный — обе missing dependencies
(log_nonlocal_src_buffer, buffer_visible_to_backend) это не-kvarn
graph-capture инфраструктура, тянуть её сейчас — расползание скоупа.

Решение: **вариант A сейчас** (NDEBUG-фикс), вариант B — в список
известных пробелов (полная graph-capture валидация буферов; вернуться,
если CUDA-graph capture начнёт глючить с kvarn на single-token
generation пути — там донорский :4744-loop страхует capture).

## ЗАДАНИЕ 2.2e-b — NDEBUG-блок: kvarn-исключение (вариант A)

В #ifndef NDEBUG assert-блоке evaluate-петли (:3924-3935, тот что
`assert(node->src[j]->buffer)`): перед assert'ами по src[j] добавить
пропуск bufferless kvarn-src, как ты сам предложил:
`if (ggml_cuda_allows_bufferless_kvarn_src(node, j, node->src[j])) { continue; }`
— внутри существующего for по j, до первого assert. Это закрывает
debug-сборку и даёт call-site для allows_bufferless_kvarn_src
(-Wunused-function warning из отчёта 2.2e должен исчезнуть).

### Границы
- Тот же файл, только NDEBUG-блок. Сборку не запускать, не коммитить,
  CLINE.md не трогать.

**Отчёт в cline-report.md, секция "2.2e-b":** полный текст NDEBUG-блока
ПОСЛЕ, diffstat, подтверждение что warning-пара закрыта (unused больше
нет), баланс `{}`/`()`.

---

## Приёмка 2.2e-b — ПРИНЯТО

Сверил дерево (:3940-3949): вставка внутри `if (node->src[j] != nullptr)`,
до обоих assert'ов, continue корректно скипает итерацию j-цикла.
Call-site для allows_bufferless_kvarn_src появился — unused-warning
закрыт. 2.2e-раунд целиком завершён. Cline свободен.

## ЗАДАНИЕ 2.5 — разведка: TQ3_1S/TQ4_1S весовые типы, насколько реально готовы. БЕЗ КОДА.

_Не пересекается с OpenCode (он сейчас на O-8/O-7, другие файлы) — можно
параллельно. Только чтение и грепы, ничего не менять._

### Контекст

`ARCHITECTURE.md` §«Скоуп порта» указывает веса `TQ3_1S`/`TQ4_1S`
(WHT-rotated Lloyd-Max) в списке того, что берём из beellama. Я
(Архитектор) уже проверил грепом: `GGML_TYPE_TQ3_1S`/`GGML_TYPE_TQ4_1S`
объявлены в `ggml.h` и математика (quantize/dequant) есть на CPU
(`ggml/src/ggml-quants.c`, `ggml/src/ggml.c`,
`ggml/src/ggml-cpu/ops.cpp`), НО:
- Ноль упоминаний в `src/llama-quant.cpp` (инструмент `llama-quantize`,
  которым реально производят `.gguf`-файл из исходной модели).
- Ноль упоминаний в `ggml/src/ggml-cuda/*.cu`/`*.cuh` (никакого
  CUDA-пути вообще).

Это отличается от KV-cache runtime-типов (turbo2/3/4, *_tcq, kvarn2-8) —
те вытянуты полностью (CUDA есть, CLI-парсинг в `common/arg.cpp:328-339`
подтверждён, я лично гонял `--cache-type-k kvarn4` живьём сегодня).
Вопрос — насколько TQ3_1S/TQ4_1S (веса, не KV-cache) реально близки к
рабочему состоянию, важен для продуктовой разведки O-7 (квантование
весов как продаваемый продукт — если нельзя даже СОЗДАТЬ файл штатным
`llama-quantize`, это принципиально другой уровень готовности, чем
turbo/kvarn).

### Задача — только разведка

1. Подтверди/опровергни мою находку грепом сам (не доверяй мне на
   слово — те же грепы + свои): `grep -rn "TQ3_1S\|TQ4_1S"` по
   `src/llama-quant.cpp`, `src/llama-model-loader.cpp`,
   `ggml/src/ggml-cuda/`.
2. Загляни в донор `donors/beellama.cpp` — там эти типы точно рабочие
   (иначе откуда взялось решение их брать)? Найди коммит(ы), где донор
   вводит TQ3_1S/TQ4_1S, посмотри его `src/llama-quant.cpp`/CUDA-диф —
   есть ли там то, что у нас отсутствует, и сколько строк это (оценка
   объёма недостающего порта, не сам порт).
3. Проверь, есть ли CPU-путь инференса вообще (без CUDA) — если
   математика в `ggml-cpu/ops.cpp` реально подключена к общему
   диспетчеру типов (`ggml.c` type_traits таблица), теоретически можно
   было бы хотя бы протестировать на CPU, пусть медленно. Ответь прямо:
   можно ли сегодня, без единой строки кода, произвести
   TQ3_1S-квантованный `.gguf` и загрузить его хоть на CPU (даже
   медленно) — или это физически невозможно текущим тулингом.
4. НЕ пытайся портировать/дописывать недостающее — это чистая
   разведка, отчёт с честной оценкой объёма, не фикс.

### Границы

Ничего не редактировать. Можно смотреть в `donors/beellama.cpp` (чужой
git-репо внутри `donors/`, read-only всегда). Не трогай `CLINE.md`
кроме отчёта.

**Отчёт в cline-report.md, секция "2.5":** таблица найденных
упоминаний (файл → есть/нет, со строками); диф-объём в доноре (сколько
строк/файлов недостаёт, если донор их имеет); прямой ответ на вопрос
пункта 3; итоговая оценка "готово ли TQ3_1S/TQ4_1S как весовой продукт
уже сегодня, или нужен ещё порт — и какого примерно объёма".

## Приёмка 2.5 — ПРИНЯТО (2026-07-18, Архитектор)

Сверил лично ключевые заявления: `GGML_ABORT` в `ggml-cpu/ops.cpp`
реально ловит `TQ3_1S`/`TQ4_1S` в списке типов (подтверждено чтением);
донор `beellama.cpp/include/llama.h` реально имеет
`LLAMA_FTYPE_MOSTLY_TQ3_1S`/`TQ4_1S`; CUDA-директория донора —
буквально ноль упоминаний (`grep -rl` пусто) — это НЕ наш недопорт, а
реально неразработанная часть даже у донора, критический блокер вне
зависимости от наших усилий.

**Итог для продуктовой разведки (O-7):** `TQ3_1S`/`TQ4_1S` как
продаваемые весовые файлы — не готовы. Дешёвая часть (ftype +
quantize-диспетчер, ~8 строк по двум файлам) чинится быстро, но без
параллельной работы над CUDA (объём неизвестен, ядер нет даже у донора)
даёт только "можно заквантовать, нельзя погонять на GPU" — половинчатый
результат. Приоритет как продукта ниже, чем KV-cache turbo/kvarn-типы
(те полностью рабочие уже сегодня, живой inference подтверждён).

Cline свободен.
