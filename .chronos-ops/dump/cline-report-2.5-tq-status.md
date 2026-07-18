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