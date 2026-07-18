# G-1 — SIGSEGV при turbo-типах KV-кеша

## Симптом (до фикса)

```
PORT=8099 ./run-server.sh qwythos-v3 -c 4096 -ub 256 \
  --no-kvarn --cache-type-k turbo3 --cache-type-v turbo3
-> Segmentation fault (core dumped) на этапе load_model / create KV cache
```

## Бэктрейс (корневой краш, release `build/bin`, not stripped)

```
#0  ggml_new_tensor ()                         libggml-base.so
#1  ggml_new_tensor_2d ()                      libggml-base.so
#2  llama_kv_cache::llama_kv_cache(...)        libllama.so
#3  llama_memory_hybrid::llama_memory_hybrid   libllama.so
#4  llama_model::create_memory                 libllama.so
#5  llama_context::llama_context               libllama.so
#6  llama_init_from_model                      libllama.so
#7  common_get_device_memory_data_impl         (fit path)
...
```

## Корневая причина

**Не** OOB по `ggml_type` 200+ (гипотеза из задания отвергнута).

`GGML_TYPE_COUNT = 213`, `type_traits[GGML_TYPE_COUNT]` и `type_traits_cpu[GGML_TYPE_COUNT]`
уже содержат designated initializers для turbo 200-205. `ggml_type_size` /
`ggml_blck_size` для turbo3 валидны.

Реальная причина #1 (SIGSEGV на `ggml_new_tensor_2d` в ctor):

В `llama_kv_cache::llama_kv_cache` (`src/llama-kv-cache.cpp`):

1. K/V тензоры создаются в `ctx_map`.
2. Цикл аллокации буферов делает `ctxs_bufs.emplace_back(std::move(ctx), buf)`.
3. **После** `std::move` unique_ptr в `ctx_map` пустой (`ctx.get() == nullptr`).
4. Блок TurboQuant создавал `turbo_rotation` / `turbo_rotation_inv` через
   `ggml_new_tensor_2d(ctx.get(), ...)` по уже опустошённому map → null ctx → SIGSEGV.

Дополнительно: даже без move, создание **после** `ggml_backend_alloc_ctx_tensors`
означало, что rotation-тензоры не попадали в буфер (`buffer == nullptr`), и fill
через `ggml_backend_tensor_set` молча не работал.

### Каскады после фикса #1 (тот же turbo-путь, warmup decode)

| Тип | Где | Причина |
|-----|-----|---------|
| turbo2/3/4 | CPU FA (`ggml_compute_forward_flash_attn_ext`) | `type_traits_cpu[TURBO*].vec_dot == NULL` → call 0x0. Qwythos hybrid: часть графа/warmup на CPU. |
| turbo*_tcq | CPU `set_rows` | `type_traits_cpu[TURBO*_TCQ].from_float == NULL` при наличии `quantize_row_turbo*_tcq_ref`. |

Все 6 turbo-типов — одна цепочка (turbo path), три дырки: ctor move-after-free,
CPU FA без vec_dot, TCQ без from_float.

## Фикс (минимальный, рабочая копия, без коммита)

### 1. `src/llama-kv-cache.cpp`

Перенос создания `turbo_rotation` / `turbo_rotation_inv` **до** цикла alloc+move,
чтобы:
- ctx был жив;
- тензоры вошли в `ggml_backend_alloc_ctx_tensors` и получили buffer;
- последующий fill rotation data сработал.

### 2. `ggml/src/ggml-cpu/ops.cpp`

В `ggml_compute_forward_flash_attn_ext_f16_one_chunk`: если `kq_vec_dot == NULL`,
но есть `to_float` — dequant K в scratch + `ggml_vec_dot_f32`. Покрывает все turbo
без полноценных CPU vec_dot-ядер.

### 3. `ggml/src/ggml-cpu/ggml-cpu.c`

`from_float` для `TURBO2/3/4_TCQ` → `quantize_row_turbo*_tcq_ref` (символы уже были).

## Дифф фикса (только G-1 файлы)

```diff
--- a/src/llama-kv-cache.cpp
@@ -309,6 +309,20 @@ llama_kv_cache::llama_kv_cache(
     }

+    // TurboQuant: create rotation tensors before buffer alloc.
+    // Must happen before ctx_map entries are moved into ctxs_bufs ...
+    if (is_turbo) {
+        for (auto & [buft, ctx] : ctx_map) {
+            turbo_rotation = ggml_new_tensor_2d(ctx.get(), GGML_TYPE_F32, 128, 128);
+            ...
+            break;
+        }
+    }
+
     // allocate tensors ...
     for (auto & [buft, ctx] : ctx_map) {
         ...
         ctxs_bufs.emplace_back(std::move(ctx), buf);
     }
-    // (старый блок создания turbo_rotation — удалён)
```

```diff
--- a/ggml/src/ggml-cpu/ops.cpp
+    ggml_to_float_t const k_to_float = ggml_get_type_traits(k->type)->to_float;
+    GGML_ASSERT((kq_vec_dot || k_to_float) && "...");
+    std::vector<float> k_f32_buf;
+    if (!kq_vec_dot) k_f32_buf.resize((size_t) DK);
...
-            kq_vec_dot(DK, &s, 0, k_data, 0, Q_q, 0, 1);
+            if (kq_vec_dot) {
+                kq_vec_dot(...);
+            } else {
+                k_to_float(k_data, k_f32_buf.data(), DK);
+                ggml_vec_dot_f32(DK, &s, 0, k_f32_buf.data(), 0, (const float *)Q_q, 0, 1);
+            }
```

```diff
--- a/ggml/src/ggml-cpu/ggml-cpu.c
-        .from_float = NULL,   // TURBO2/3/4_TCQ
+        .from_float = (ggml_from_float_t) quantize_row_turbo*_tcq_ref,
```

## Сборка

Релизный инкрементальный rebuild: `cmake --build build -j$(nproc) --target llama-server`.
Отдельный `build-debug/` не поднимал: release-бинарь not stripped, bt + исходники
дали однозначную локализацию.

## Smoke

### Все 6 типов — health after load (после фикса)

```
OK  turbo2
OK  turbo3
OK  turbo4
OK  turbo2_tcq
OK  turbo3_tcq
OK  turbo4_tcq
```

(ctx 2048, qwythos-v3 Q4_K_M, -ngl -1)

### turbo3 completion

```bash
./build/bin/llama-server \
  -m models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf \
  -c 16384 -ub 256 -ngl -1 --port 8099 \
  --cache-type-k turbo3 --cache-type-v turbo3
```

HTTP: `listening on http://127.0.0.1:8099`

Request:
```bash
curl -sS http://127.0.0.1:8099/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Say hi in one short sentence."}],"max_tokens":32,"temperature":0}'
```

Ответ сервера (структурно OK, HTTP 200, 32 tokens):
```json
{
  "choices":[{"finish_reason":"length","message":{"role":"assistant","content":"","reasoning_content":"..."}}],
  "usage":{"completion_tokens":32,"prompt_tokens":47,"total_tokens":79},
  "timings":{
    "prompt_per_second": 83.45,
    "predicted_per_second": 26.57
  }
}
```

Лог:
```
prompt eval time = 563.18 ms / 47 tokens (83.45 t/s)
eval time        = 1204.16 ms / 32 tokens (26.57 t/s)
```

### Замечание по качеству (вне scope G-1 crash)

Текст completion — мусор (пустой content / бред в reasoning). Сервер не падает и
считает токены. Вероятные остаточные дыры: CPU quantize без FWHT, graph-level
rotation / CUDA path для write+attend. Это отдельная задача качества turbo, не
SIGSEGV на create KV.

## Что исключено

- OOB `type_traits[200]` — `GGML_TYPE_COUNT=213`, записи на месте.
- Отсутствие turbo в CLI whitelist — парсинг ок.
- Отсутствие block size / type_size — `sizeof(block_turbo3_0)=50`, QK=128, ок.

## Статус

G-1: **закрыт по crash path + smoke**.
- Корневой SIGSEGV ctor: fixed.
- Каскад CPU FA / TCQ set_rows: fixed.
- 6/6 типов поднимают server health.
- turbo3 отвечает на completion (~26.6 t/s decode).
- Качество генерации turbo — residual, не блокирует G-1.
