# G-3 — Формальная валидация (Фаза 7)

**Код не менялся.** Только прогоны и фиксация.

## Окружение

| | |
|---|---|
| Заявлено в GROK.md | HEAD `d3680c912` |
| Фактический HEAD | `a86efb9a6` (docs-коммит поверх `d3680c912`; code path = post G-2 / kvarn activation) |
| Бинарники | `build/` (llama-server build id `3c8794f52` / b10016) |
| Модель | `models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf` (qwen35 9B Q4_K_M, 5.47 GiB) |
| GPU | RTX 3070 8GB; фон перед прогонами **~1.6 GB** (ollama serve) |
| Baseline Фаза 1 (CLINE) | pp512=**2298**, tg64=**61** |

---

## 1. Parity: `test-backend-ops`

### Команда
```bash
pkill -x llama-server
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # 1693 MiB
./build/bin/test-backend-ops -j 8 2>&1 | tee /tmp/g3-test-backend-ops.log
```

### Результат
| | |
|---|---|
| Итог | **13994/13994 tests passed** |
| Backend | CUDA0: OK; CPU: skipped |
| Exit | 0 |
| VRAM фона | 1693 MiB |

Совпадает с эталоном предыдущих раундов (13994/13994).

### turbo / kvarn / WHT в покрытии
```
rg -ic "turbo|kvarn|WHT|TURBO" /tmp/g3-test-backend-ops.log  → 0
```
- **Ноль** кейсов с именами turbo / kvarn / TURBO_WHT / KVARN_* в логе.
- FLASH_ATTN: ~5097 строк (в т.ч. OK).
- SET_ROWS: ~379; часть `not supported [CUDA0]` для q6_K / iq2_* (не turbo) — не считаются failed, suite всё равно 13994/13994.
- LIGHTNING_INDEXER: not supported [CUDA0] — skip, не fail.

**Вывод:** после G-2 (CPU TURBO_WHT + quantize turbo2/3) **новых fail не появилось**, но и **нового покрытия turbo/kvarn/WHT в test-backend-ops нет** — регрессии по suite нет, parity turbo-опов suite не проверяет.

### Вердикт §1: **PASS**
(по suite; покрытие turbo/kvarn — **ВОПРОС**/gap, не fail suite)

---

## 2. Бенч vs baseline

### 2a. `llama-bench` (канонический pp512 / tg64)

```bash
./build/bin/llama-bench -m $MODEL -ngl -1 -p 512 -n 64 -r 3 -fa on -ctk f16 -ctv f16
# VRAM фона: 1672 MiB
```

| cache | pp512 t/s | tg64 t/s | vs baseline |
|---|---:|---:|---|
| **f16/f16** | **2373.98 ± 27.23** | **65.39 ± 0.16** | +3.3% / +7.2% (лучше baseline 2298/61) |
| kvarn4 | — | — | **отклонён CLI** |
| turbo3 | — | — | **отклонён CLI** |

```
error: invalid parameter for argument: -ctk
```
Причина (не чинили): `tools/llama-bench/llama-bench.cpp:478` `ggml_type_from_name` знает только  
`f16,bf16,q8_0,q4_0,q4_1,q5_0,q5_1,iq4_nl` — **нет turbo/kvarn**, хотя `common/arg.cpp` whitelist их имеет.

### 2b. Server timings (одинаковые условия, обход whitelist)

```bash
# фон 1596 MiB; -c 8192 -ub 256 -ngl -1 -fa on -fit off; port 8099
# PP: ~948 prompt tokens; TG: short "2+2" max_tokens=64
```

| config | VRAM start | PP prompt_n | PP t/s | TG pred_n | TG t/s | TG content |
|---|---:|---:|---:|---:|---:|---|
| f16/f16 | 1596 | 948 | **1998.4** | 54 | **63.71** | `4` |
| kvarn4/kvarn4 | 1596 | 948 | **1857.2** | 54 | **61.04** | `4` |
| turbo3/turbo3 | 1596 | 948 | **1938.4** | 62 | **60.28** | `4` |

Относительно f16 (server):
- kvarn4 PP −7.1%, TG −4.2%
- turbo3 PP −3.0%, TG −5.4%

Красный флаг регрессии vs **baseline llama-bench** (f16): **нет** (f16 bench выше baseline).  
Регрессия kvarn/turbo vs f16 в server-режиме: PP kvarn4 ~7% (мягкий жёлтый), TG все в пределах ~5–6%.

### Вердикт §2: **PASS** (f16 vs baseline); **ВОПРОС** (llama-bench не умеет kvarn/turbo — tooling gap)

---

## 3. PPL-спот-чек

### Корпус
- `wikitext-2` test из pytorch/examples → `/tmp/wiki.test.raw` (~1.2 MB)
- Спот: first 80 KB → `/tmp/wiki.spot.raw`
- `n_ctx=8192`, 2 chunks

### Команда
```bash
./build/bin/llama-perplexity -m $MODEL -ngl -1 -fa on -c 8192 -ub 256 -b 512 -fit off \
  -f /tmp/wiki.spot.raw -ctk <TYPE> -ctv <TYPE>
# VRAM фона ~1.6 GB
```

### Результат

| cache | PPL | ± | Δ vs f16 |
|---|---:|---:|---:|
| **f16** | **5.6636** | 0.14333 | — |
| **kvarn4** | **5.6512** | 0.14272 | **−0.22%** (чуть лучше) |
| **turbo3** | **5.6913** | 0.14415 | **+0.49%** |

Ожидание: turbo3 ≈ нейтрален, kvarn4 небольшая дельта — **совпало**. Сильного расхождения нет.

### Вердикт §3: **PASS**

---

## 4. Длинный контекст (облегчённый NIAH)

### Промпт
- Игла в начале: `SECRET_NEEDLE_CODE is BLUE-ORBIT-7749`
- Filler ~44k слов
- Вопрос в конце: `What is the SECRET_NEEDLE_CODE?`
- Факт. prompt_tokens на kvarn2: **47677**

### Команда
```bash
./build/bin/llama-server -m $MODEL -ngl -1 -fa on -c 63488 -ub 256 \
  --port 8099 -fit off --cache-type-k kvarnN --cache-type-v kvarnN
# VRAM фона ~1.6 GB
```

### kvarn4 / kvarn4, `-c 63488`
| | |
|---|---|
| Server start | OK, listening |
| Request | **CUDA OOM** mid-prefill (2/2 попытки) |
| Ошибка | `ggml-cuda.cu:107 CUDA error: out of memory` в `ggml_cuda_pool_vmm::alloc` ← `ggml_cuda_flash_attn_ext_mma_kvarn_case<256,256,16,4>` |
| До OOM | slot progress `n_tokens=6174` @ ~1941 t/s; параллельно reject другого task «request exceeds context» (chat-template раздувает / multi-slot) |
| Ответ | **нет** (соединение оборвано) |

### kvarn2 / kvarn2, `-c 63488`
| | |
|---|---|
| prompt_n | **47677** |
| prompt t/s | **1553.2** |
| pred_n / t/s | 64 / **45.47** |
| content | `''` (reasoning-модель) |
| reasoning (дословно, фрагмент) | *«The user has asked… SECRET_NEEDLE_CODE is BLUE-ORBIT-7749… the answer is simply the code they provided. I need to output only the code…»* |
| Игла | **найдена** (BLUE-ORBIT-7749) |

### Вердикт §4: **PASS** kvarn2; **FAIL** kvarn4 @ 63k (CUDA OOM в FA kvarn-mma)

---

## Сводка вердиктов

| # | Пункт | Вердикт |
|---|---|---|
| 1 | test-backend-ops 13994/13994 | **PASS** |
| 1b | покрытие turbo/kvarn/WHT в suite | **ВОПРОС** (0 кейсов) |
| 2 | bench f16 vs baseline | **PASS** (лучше baseline) |
| 2b | bench kvarn/turbo via llama-bench | **FAIL tooling** (whitelist) |
| 2c | server PP/TG f16/kvarn4/turbo3 | **PASS** (сопоставимо) |
| 3 | PPL f16/kvarn4/turbo3 | **PASS** |
| 4 | NIAH kvarn2 ~48k | **PASS** (игла найдена) |
| 4b | NIAH kvarn4 `-c 63488` | **FAIL** (CUDA OOM) |

---

## Найденные баги / gaps (без починки)

1. **`llama-bench` не принимает `-ctk turbo*` / `kvarn*`**  
   `tools/llama-bench/llama-bench.cpp:478` — урезанный `ggml_type_from_name`. Server/cli/`common/arg.cpp` типы знают.

2. **kvarn4 @ `-c 63488` + большой prefill → CUDA OOM**  
   `ggml_cuda_flash_attn_ext_mma_kvarn_case<256,256,16,4>` → `ggml_cuda_pool_vmm::alloc`.  
   Server поднимается, падает на decode/prefill. kvarn2 на том же ctx проходит.  
   Усугубляет: default `n_slots=4` (×ctx memory), chat-template раздувает request.

3. **test-backend-ops не покрывает TURBO_WHT / turbo SET_ROWS / kvarn ops**  
   Suite зелёный, но не страхует G-1/G-2 path.

4. **`llama-cli` без жёсткого non-interactive** легко уходит в цикл `>` (наблюдалось: 67M строк prompt), не баг Chronos-специфичный, но мешает автоматизации.

5. **HEAD drift:** GROK.md ссылался на `d3680c912`, фактически валидировали `a86efb9a6` (docs-only поверх; код G-2/kvarn уже в предках).

---

## Команды (шпаргалка)

```bash
# 1 parity
./build/bin/test-backend-ops -j 8

# 2 bench f16 only (llama-bench)
./build/bin/llama-bench -m models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf \
  -ngl -1 -p 512 -n 64 -r 3 -fa on -ctk f16 -ctv f16

# 3 PPL
./build/bin/llama-perplexity -m ... -ngl -1 -fa on -c 8192 -fit off \
  -f /tmp/wiki.spot.raw -ctk f16 -ctv f16   # + kvarn4, turbo3

# 4 NIAH
./build/bin/llama-server -m ... -ngl -1 -fa on -c 63488 -ub 256 -fit off \
  --cache-type-k kvarn2 --cache-type-v kvarn2 --port 8099
# curl /v1/chat/completions with needle prompt
```
