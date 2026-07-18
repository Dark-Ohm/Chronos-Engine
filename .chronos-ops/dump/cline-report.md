# CLINE Report — 2.5

## Таблица найденных упоминаний

| Файл | Есть TQ3_1S/TQ4_1S | Строки |
|---|---|---|
| ggml/include/ggml.h | ДА | :441-442 (enum GGML_TYPE) |
| ggml/src/ggml-quants.c | ДА | :6040-6049 (switch, quantize_row_tq3_1s/tq4_1s_ref) |
| ggml/src/ggml.c | ДА | :996-1007 (type_traits таблица) |
| ggml/src/ggml-cpu/quants.h | ДА | :51-52 (decl, extern) |
| ggml/src/ggml-cpu/ggml-cpu.c | ДА | :208-237, :502-510 (vec_dot implementations) |
| ggml/src/ggml-cpu/ops.cpp | ДА | :5745-5746 (clamp - GGML_ABORT!) |
| src/llama-quant.cpp | НЕТ | (отсутствуют case в tensor_type_fallback :387 и llama_ftype_get_default_type :822) |
| src/llama-model-loader.cpp | НЕТ | (нет упоминаний) |
| ggml/src/ggml-cuda/*.cu/cuh | НЕТ | (ноль упоминаний) |
| include/llama.h | НЕТ | (нет LLAMA_FTYPE_MOSTLY_TQ3_1S/TQ4_1S) |

## Дифф-объём в доноре

Донор `donors/beellama.cpp` имеет TQ3_1S/TQ4_1S в следующих местах, которых нет у нас:

1. **include/llama.h** — LLAMA_FTYPE_MOSTLY_TQ3_1S (:158), LLAMA_FTYPE_MOSTLY_TQ4_1S (:159) — ~2 строки

2. **src/llama-quant.cpp**:
   - tensor_type_fallback switch добавляет TQ3_1S/TQ4_1S (:387-388) — fallback к Q4_0 — ~2 строки
   - llama_ftype_get_default_type добавляет case для LLAMA_FTYPE_MOSTLY_TQ3_1S (:822), LLAMA_FTYPE_MOSTLY_TQ4_1S (:823) — ~4 строки

3. **ggml/src/ggml-cuda/** — ноль упоминаний (CUDA-кернели TQ3_1S/TQ4_1S НЕТ даже у донора)

**Итого недостающего объёма: ~8 строк в 2-х файлах.**

## Вопрос пункта 3: CPU-инференс без единой строки кода?

**ОТВЕТ: НЕТ, физически невозможно.**

Причины:
1. **GGML_ABORT в clamp**. В ggml-cpu/ops.cpp :5745-5746, TQ3_1S и TQ4_1S попадают в `case ... GGML_ABORT("fatal error")` в функции `ggml_compute_forward_clamp`. Это значит, что при попытке выполнить clamp (используется в attention) процесс упадёт.

2. **Отсутствуют LLAMA_FTYPE** в include/llama.h. Без ф-тайпа `llama-quantize --type tq3_1s` не примет тип, CLI не узнает его.

3. **Отсутствуют quantize dispatcher entries** в src/llama-quant.cpp. Даже если обойти CLI, `llama_quantize` не сможет правильно обработать несовместимые размеры тензоров (fallback logic отсутствует).

4. **Нет CUDA-кернелей**. TQ3_1S/TQ4_1S не будут работать на GPU вообще.

## Итоговая оценка готовности TQ3_1S/TQ4_1S как весового продукта

**НЕ ГОТОВ к внешнему релизу.** Требуется дополнительный порт:

| Пробел | Объём | Приоритет |
|---|---|---|
| LLAMA_FTYPE_MOSTLY_TQ3_1S/TQ4_1S в include/llama.h | ~2 строки | Высокий |
| llama_ftype_get_default_type cases в llama-quant.cpp | ~4 строки | Высокий |
| tensor_type_fallback cases в llama-quant.cpp | ~2 строки | Высокий |
| CUDA-кернели (нет даже в доноре) | ~? | Критический |

Без этих правок:
- Нельзя создать GGUF (нет ftype, нет quantize dispatcher)
- Нельзя загрузить GGUF (clamp упадёт)
- Нельзя запустить на GPU (нет CUDA)

Отличается от KV-cache turbo/kvarn-типов — те вытянуты полностью (CUDA есть, CLI парсится, живой inference). TQ3_1S/TQ4_1S имеют только CPU-математику без реального пути inference.

## Таблица найденных упоминаний

| Файл | Есть TQ3_1S/TQ4_1S | Строки |
|---|---|---|
| ggml/include/ggml.h | ДА | :441-442 (enum GGML_TYPE) |
| ggml/src/ggml-quants.c | ДА | :6040-6049 (switch, quantize_row_tq3_1s/tq4_1s_ref) |
| ggml/src/ggml.c | ДА | :996-1007 (type_traits таблица) |
| ggml/src/ggml-cpu/quants.h | ДА | :51-52 (decl, extern) |
| ggml/src/ggml-cpu/ggml-cpu.c | ДА | :208-237, :502-510 (vec_dot implementations) |
| ggml/src/ggml-cpu/ops.cpp | ДА | :5745-5746 (clamp - GGML_ABORT!) |
| src/llama-quant.cpp | НЕТ | (отсутствуют case в tensor_type_fallback :387 и llama_ftype_get_default_type :822) |
| src/llama-model-loader.cpp | НЕТ | (нет упоминаний) |
| ggml/src/ggml-cuda/*.cu/cuh | НЕТ | (ноль упоминаний) |
| include/llama.h | НЕТ | (нет LLAMA_FTYPE_MOSTLY_TQ3_1S/TQ4_1S) |

## Дифф-объём в доноре

Донор `donors/beellama.cpp` имеет TQ3_1S/TQ4_1S в следующих местах, которых нет у нас:

1. **include/llama.h** — LLAMA_FTYPE_MOSTLY_TQ3_1S (:158), LLAMA_FTYPE_MOSTLY_TQ4_1S (:159) — ~2 строки

2. **src/llama-quant.cpp**:
   - tensor_type_fallback switch добавляет TQ3_1S/TQ4_1S (:387-388) — fallback к Q4_0 — ~2 строки
   - llama_ftype_get_default_type добавляет case для LLAMA_FTYPE_MOSTLY_TQ3_1S (:822), LLAMA_FTYPE_MOSTLY_TQ4_1S (:823) — ~4 строки

3. **ggml/src/ggml-cuda/** — ноль упоминаний (CUDA-кернели TQ3_1S/TQ4_1S НЕТ даже у донора)

**Итого недостающего объёма: ~8 строк в 2-х файлах.**

## Вопрос пункта 3: CPU-инференс без единой строки кода?

**ОТВЕТ: НЕТ, физически невозможно.**

Причины:
1. **GGML_ABORT в clamp**. В ggml-cpu/ops.cpp :5745-5746, TQ3_1S и TQ4_1S попадают в `case ... GGML_ABORT("fatal error")` в функции `ggml_compute_forward_clamp`. Это значит, что при попытке выполнить clamp (используется в attention) процесс упадёт.

2. **Отсутствуют LLAMA_FTYPE** в include/llama.h. Без ф-тайпа `llama-quantize --type tq3_1s` не примет тип, CLI не узнает его.

3. **Отсутствуют quantize dispatcher entries** в src/llama-quant.cpp. Даже если обойти CLI, `llama_quantize` не сможет правильно обработать несовместимые размеры тензоров (fallback logic отсутствует).

4. **Нет CUDA-кернелей**. TQ3_1S/TQ4_1S не будут работать на GPU вообще.

## Итоговая оценка готовности TQ3_1S/TQ4_1S как весового продукта

**НЕ ГОТОВ к внешнему релизу.** Требуется дополнительный порт:

| Пробел | Объём | Приоритет |
|---|---|---|
| LLAMA_FTYPE_MOSTLY_TQ3_1S/TQ4_1S в include/llama.h | ~2 строки | Высокий |
| llama_ftype_get_default_type cases в llama-quant.cpp | ~4 строки | Высокий |
| tensor_type_fallback cases в llama-quant.cpp | ~2 строки | Высокий |
| CUDA-кернели (нет даже в доноре) | ~? | Критический |

Без этих правок:
- Нельзя создать GGUF (нет ftype, нет quantize dispatcher)
- Нельзя загрузить GGUF (clamp упадёт)
- Нельзя запустить на GPU (нет CUDA)

Отличается от KV-cache turbo/kvarn-типов — те вытянуты полностью (CUDA есть, CLI парсится, живой inference). TQ3_1S/TQ4_1S имеют только CPU-математику без реального пути inference.

Файл: ggml/src/ggml-cuda/ggml-cuda.cu. Больше ничего не трогал.
Вариант A (он же гибрид C) для пункта 4 задания 2.2e.

## diffstat (кумулятивно с 2.2d + 2.2e)
```
49      3       ggml/src/ggml-cuda/ggml-cuda.cu
```
2.2d = +30/-1, 2.2e = +16/-2, 2.2e-b = +3/-0. Итого 49/3.
Контроль: 30+16+3=49, 1+2+0=3 — сходится.

## Что сделано

В #ifndef NDEBUG assert-блоке (наш :3938-3950), внутри for-j loop по src,
перед assert(node->src[j]->buffer) добавлен kvarn-скип:

    if (node->src[j] != nullptr) {
        if (ggml_cuda_allows_bufferless_kvarn_src(node, j, node->src[j])) {
            continue;
        }
        assert(node->src[j]->buffer);
        ...
    }

continue пропускает buffer-ассерты для bufferless kvarn-src (FLASH_ATTN_EXT
с K/V из KVARN_VIEW) — чинит debug-сборку (assert на nullptr buffer у
kvarn-src). Release-сборка не затронута: весь блок под #ifndef NDEBUG,
в #else GGML_UNUSED(integrated).

Полный текст вставки (3 строки, наш :3942-3944):
                        if (ggml_cuda_allows_bufferless_kvarn_src(node, j, node->src[j])) {
                            continue;
                        }

Вызывает готовый хелпер из 2.2e (пункт 3, наш :2420-2424) —
ggml_cuda_allows_bufferless_kvarn_src(node, src_index, src), который
проверяет node->op == GGML_OP_FLASH_ATTN_EXT && (src_index == 1 || 2) &&
ggml_cuda_kvarn_view_base(src) != nullptr.

## Unused-warning закрыт

ggml_cuda_allows_bufferless_kvarn_src (def :2420) получил call-site (:3942).
Был unused после 2.2e (пункт 3 добавил хелпер, но call-site был в пункте 4
= СТОП). Теперь used — -Wunused-function исчезнет.

## Вариант B — отложен (по решению Архитектора)

Полная ggml_cuda_graph_node_buffers_visible (донор :3413-3448) + 2 missing
dependencies (ggml_cuda_log_nonlocal_src_buffer,
ggml_cuda_buffer_visible_to_backend) + второй call-site (post-#endif loop) —
НЕ перенесено. Это не-kvarn graph-capture infrastructure, тянет расползание
скоупа. Вариант A чинит конкретный debug-крэш на bufferless kvarn-src;
вариант B вернёмся к нему, если CUDA-graph capture заглючит с kvarn.

## Верификация
- ggml_cuda_allows_bufferless_kvarn_src: 2 вхождения (def :2420 + call :3942).
- Edit внутри #ifndef NDEBUG (:3938) — debug-only.
- continue внутри for (int j = 0; j < GGML_MAX_SRC; j++) — корректный skip.
- node в скоупе (окружающий код: node->buffer, node->src[j]).
- balance: +1 { +1 } (if-блок) — сбалансировано.

## Границы
- Файл: ggml/src/ggml-cuda/ggml-cuda.cu. Одна правка (3 строки).
- Сборку НЕ запускал. Не коммитил. CLINE.md НЕ трогал.
