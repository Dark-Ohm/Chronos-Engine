# Карта порта beellama v0.3.2 -> Chronos

Источник: `git diff d73cd076..fe67745d` в donors/beellama.cpp.
Итого: 763 файла, +83923/-13051. Разметка: TAKE / MIXED (резать построчно) / DROP.
Порог шума: файлы <15 изменённых строк не в TAKE-паттернах опущены.

## TAKE — берём целиком (49 файлов, +29.8k)

### Ядро TurboQuant/TCQ
| Файл | Строки | Фаза |
|---|---|---|
| ggml/src/ggml-turbo-quant.c | +885 | 1 |
| ggml/src/ggml-quants.c/h | +519/+45 | 1 |
| ggml/src/ggml-cpu/quants.c/h | +257/+30 | 1 |
| ggml/src/ggml-common.h | +181 | 1 |
| src/turbo-rotation-data.h / -32.h | +4103/+71 | 1 |
| ggml/src/ggml-cuda/turbo-quant-cuda.cuh | +1642 | 2 |
| ggml/src/ggml-cuda/turbo-wht.cu/cuh | +170/+4 | 2 |
| ggml/src/ggml-cuda/turbo-sink.cu/cuh | +39/+16 | 2 |
| ggml/src/ggml-cuda/turbo4-tcq-codebook.cuh | +132 | 2 |
| ggml/src/ggml-cuda/cross-ring-interleave.cu | +955 | 2 |
| ggml/src/ggml-cuda/argmax.cu | +498 | 2 (TCQ nearest-codeword, проверить) |
| ggml/src/ggml-cuda/fwht.cu | +1/-1 | 2 |

### KVarN
| Файл | Строки | Фаза |
|---|---|---|
| src/llama-kvarn.cpp/h | +580/+86 | 3 |
| src/llama-kv-cache-kvarn.cpp/h | +1218/+213 | 3 |
| ggml/src/ggml-cuda/kvarn.cu/cuh | +1828/+8 | 2 |
| ggml/src/ggml-cuda/fattn-mma-kvarn*.cuh (7 шт) | ~2600 | 2 |
| ggml/src/ggml-cuda/fattn-kvarn-vec*.cuh (2 шт) | +372 | 2 |
| ggml/src/ggml-cuda/fattn-mma-turbo*.cuh (2 шт) | +140 | 2 |

### Условное (Фаза 6) + утилиты
| Файл | Строки | Фаза |
|---|---|---|
| common/suffix-tree.cpp/h (CopySpec) | +697/+104 | 6 |
| tools/server/server-loop-guard.cpp/h | +253/+47 | 6 |
| common/reasoning-budget.cpp/h | +38/+7 | 6 |
| common/int32-map.h | +338 | 1 (хелпер, нужен kvarn) |

### Тесты (портировать вместе с соответствующей фазой)
test-kvarn.cpp (+2577, Ф.3), test-turbo-quant.c (+110, Ф.1),
test-turbo-mma-fused-static.py (Ф.2), test-server-loop-guard.cpp (Ф.6),
test-reasoning-budget.cpp (Ф.6).

### Metal/Vulkan (ОТЛОЖЕНО, D-008: скоуп CPU+CUDA)
ggml-metal/turbo-matrices.h (+8207), turbo-wht.h (+49), ggml-metal.metal (+550),
ggml-vulkan/vulkan-shaders/kvarn_store.comp (+277), ggml-vulkan.cpp (+144).

## MIXED — резать построчно (116 файлов, +37.9k)

### Почти целиком DFlash -> берём только не-DFlash крохи
| Файл | Строки | Что брать |
|---|---|---|
| src/llama-context.cpp/h | +7842/+628 | только KVarN prompt-cache save/restore (~27 упоминаний) |
| tools/server/server-context.cpp | +4484 | только loop-guard wiring (~52 строки) |
| common/speculative.cpp/h | +3607/+141 | только CopySpec-кусок (Ф.6) |
| tools/server/server-task.cpp/h | +741/+82 | проверить: request-level overrides = DFlash, скорее DROP |
| common/sampling.cpp/h | +301/+51 | вероятно spec-sampling = DROP, проверить |
| src/llama-memory-recurrent.cpp | +559 | DFlash state -> DROP |

### Преимущественно KV-стек -> берём с фильтрацией
| Файл | Строки | Фаза |
|---|---|---|
| ggml/src/ggml-cuda/fattn.cu | +3344 | 2 (route policy для kvarn/turbo пар) |
| ggml/src/ggml-cuda/fattn-common.cuh | +1303 | 2 |
| ggml/src/ggml-cuda/fattn-vec.cuh / fattn-mma-f16.cuh | +247/+242 | 2 |
| ggml/src/ggml-cuda/set-rows.cu | +503 | 2 (KVarN store) |
| ggml/src/ggml-cuda/ggml-cuda.cu | +496 | 2 |
| ggml/src/ggml-cuda/vecdotq.cuh / mmq.cuh / mmvq.cu | +304/+314/+62 | 2 |
| ggml/src/ggml-cuda/cpy.cu / cpy-utils.cuh / convert.cu / dequantize.cuh / getrows.cu | ~640 | 2 |
| ggml/src/ggml-cpu/ops.cpp/h | +789/+6 | 1 (KVARN_VIEW op) |
| ggml/src/ggml.c / include/ggml.h | +660/+114 | 1 (типы, op, С РЕМАПОМ ID) |
| ggml/src/ggml-backend.cpp / ggml-alloc.c / ggml-backend-meta.cpp | +116/+31/+49 | 4 |
| src/llama-kv-cache.cpp/h | +452/+62 | 3 |
| src/llama-kv-cache-iswa.cpp/h | +142/+20 | 3 |
| src/llama-memory-hybrid*.cpp/h, llama-memory.h, llama-kv-cells.h | ~270 | 3 |
| src/llama-graph.cpp/h | +310/+111 | 3 (ОСТОРОЖНО: апстрим сменил 585 строк там же) |
| src/llama-model.cpp, llama-arch.cpp, llama-quant.cpp, llama-cparams.h | ~300 | 3 |
| src/models/qwen35.cpp / qwen35moe.cpp / gemma4.cpp | +184/+184/+154 | 3 (фильтровать: там и DFlash-крюки, и KVarN wiring) |
| common/arg.cpp, common.h/cpp | +583/+192/+37 | 4 (фильтровать DFlash-флаги) |
| include/llama.h | +396 | 3 (фильтровать DFlash API) |
| tools/llama-bench/llama-bench.cpp | +173 | 4 (kvarn cache names) |
| tools/perplexity/perplexity.cpp | +220 | 7 (валидация) |
| CMake: ggml/CMakeLists, ggml-cuda/CMakeLists, ggml-hip/CMakeLists, ggml-musa/CMakeLists | ~470 | 2 (FA-матрица типов, GGML_CUDA_FA_HALF_QUANTS и пр.) |
| scripts/gen-fattn-vec-dispatch.py | +141 | 2 (генератор диспатча) |
| gguf-py/gguf/constants.py, convert_hf_to_gguf.py | +40/+21 | 1 (типы, с ремапом) |
| tests/test-backend-ops.cpp, test-quantize-fns.cpp, test-arg-parser.cpp и пр. | ~1500 | 1-4 |

### Непонятные — разобраться перед Фазой 2
gated_delta_net.cu (+493), ssm-conv.cu (+128), norm.cu (+61), scale.cu (+25),
quantize.cu, dream.cpp, delta-net-base.cpp, clip.cpp, mtmd*. Возможно: перф-фиксы
bee, बэкпорты, или уже есть в апстриме. Сверять с апстримом пофайлово.

## DROP (364 файла, +15k)
DFlash: models/dflash_draft.cpp, dflash-profile.h, server-adaptive-dm.h,
conversion/dflash.py, memory-recurrent. CI/devops/docs/брендинг beellama (83).
template-instances (452) — перегенерация, не порт. web UI. Кастомные скрипты
релизов beellama.
