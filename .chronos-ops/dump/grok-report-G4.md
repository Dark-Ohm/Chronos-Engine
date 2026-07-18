# G-4 — Валидация Z-2/Z-3 + качество Phase 1 hot-window

**Повторный прогон** после сноса ollama. Код не менялся.

## Окружение

| | |
|---|---|
| HEAD | `88d4a06c126a0dcaf45d5831a9a10822196ec5c0` (= `88d4a06c1`) |
| Z-2/Z-3 | `cc4d8d597` |
| Бинарники | `build/` Release CUDA (rebuild 2026-07-19 01:20) |
| Модель | `models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf` |
| GPU | RTX 3070 8GB |
| **Фон VRAM** | **~740–750 MiB** (ollama **нет**) |
| Пред. G-4 (с ollama) | ~1.5–1.6 GB |
| Эталон G-3 | `.chronos-ops/dump/grok-report-g3.md` (фон тогда ~1.6 GB + ollama) |

---

## 1. Parity: `test-backend-ops`

```bash
BG=728 MiB
./build/bin/test-backend-ops -j 8  # /tmp/g4r-test-backend-ops.log
```

| | |
|---|---|
| Итог | **13994/13994 tests passed** |
| vs G-3 / prev G-4 | идентично |
| turbo/kvarn/WHT cases | 0 (suite gap, не fail) |

### Вердикт §1: **PASS**

---

## 2. Регрессия без `--kv-hot-size`

### 2a. PPL @8192, wiki.spot 80KB, 2 chunks

| cache | PPL | ± | Δ vs f16 | vs G-3 |
|---|---:|---:|---:|---|
| **f16** | **5.6636** | 0.14333 | — | = G-3 f16 |
| **kvarn4** | **5.6611** | 0.14307 | **−0.04%** | G-3 kvarn4 5.6512 (−0.22% then) |

В шуме. Красного флага нет.

### 2b. Server PP/TG (−np 1, −c 8192, ~1254 tok prompt)

| config | BG | VRAM load | prompt_n | PP t/s | pred_n | TG t/s |
|---|---:|---:|---:|---:|---:|---:|
| kvarn4 nohot | 750 | **6204** | 1254 | **1683.7** | 64 | **61.04** |
| f16 nohot | 750 | **6358** | 1254 | **2032.3** | 64 | **63.87** |
| G-3 kvarn4 (ollama BG) | 1596 | — | 948 | 1857 | 54 | 61.04 |
| G-3 f16 | 1596 | — | 948 | 1998 | 54 | 63.71 |

Относительно f16: kvarn4 PP −17%, TG −4.4% (сопоставимо с G-3 по TG; PP шумнее из‑за другого prompt_n).

VRAM load без ollama ~1 GB ниже, чем в prev G-4 (7220 → 6204 kvarn4).

### Вердикт §2: **PASS**

---

## 3. Качество hot-window Phase 1

Конфиг hot: `kvarn4 --kv-hot-size 4096 -c 65536 -ub 256 -fit off -np 1` (short: `-c 8192`).

### 3a. Short A/B (prompt_n=**1763** << hot 4096) — всё обязано быть «hot»

| config | content | HAS_NEEDLE |
|---|---|---|
| kvarn4 **nohot** | `BLUE-ORBIT-7749` | **True** |
| kvarn4 **hot 4096** | `Dolor` | **False** |

### 3b. Long ~50k

| needle | config | prompt_n | result | HAS_NEEDLE | design |
|---|---|---:|---|---|---|
| **END** (внутри hot) | hot 4096 | 50713 | «Answer is: 100…» (мимо) | **False** | **должна True** |
| **END** (тот же промпт) | **nohot** kvarn4 | 50713 | `BLUE-ORBIT-7749` | **True** | baseline |
| **START** (вне hot) | hot 4096 | 50671 | gibberish | False | False OK, но мусор |
| END first attempt hot | hot 4096 | — | HTTP 500 peg-native format | — | quality fail |

### 3c. Вывод

Phase 1 **не** «cold-amnesia по дизайну». SWA/hot path **ломает retrieval даже когда весь промпт внутри окна**. Без флага kvarn4 на 50k иглу находит (с чистым VRAM).

Подозреваемый path: `mat_idxs` / `ggml_kvarn_view` SWA (Z-3 wiring) — индексы/кольцо.

### Вердикт §3: **FAIL**

---

## 4. kvarn4 @ 63488 OOM — актуальность гэпа

Прогон: `kvarn4 -c 63488 -ub 256 -fit off`, ~48.9k g3-style NIAH, **BG ~750 MiB**.

| variant | VRAM load | prefill | content | HAS_NEEDLE |
|---|---:|---|---|---|
| **-np 1** | **6704** | OK 1503 t/s | `BLUE-ORBIT-7749` | **True** |
| **default slots=4** | **6854** | OK 1475 t/s | `BLUE-ORBIT-7749` | **True** |
| G-3 / prev G-4 (BG~1.6G ollama, slots=4) | ~7690 | **CUDA OOM** mma_kvarn | — | — |

Стек OOM раньше: `ggml_cuda_flash_attn_ext_mma_kvarn_case<256,256,16,4>` → `pool_vmm::alloc`.

**Сейчас с чистым фоном гэп закрыт** — и single-slot, и 4 slots. Это был **бюджет VRAM на FA workspace** (ollama + headroom), не «вечный kernel bug». На 8GB с BG≥1.6G всё ещё легко словить OOM.

### Вердикт §4: **PASS** (гэп закрыт при BG≈0.75G; оговорка: edge на 8GB)

---

## 5. Бенч с `--kv-hot-size 4096` (VRAM + timings)

| config | c | np | BG | VRAM load | PP | TG |
|---|---:|---:|---:|---:|---:|---:|
| kvarn4 nohot | 8192 | 1 | 750 | **6204** | 1684 | 61.0 |
| kvarn4 **hot 4096** | 8192 | 1 | 750 | **6150** | 1738 | 61.3 |
| kvarn4 **hot 4096** | **65536** | 1 | 750 | **6178** | 1620 | 58.0 |
| kvarn4 nohot | 63488 | 1 | 750 | **6704** | 1503 | 43.4 |
| kvarn4 nohot | 63488 | 4 | 750 | **6854** | 1475 | 43.2 |

### VRAM claim Z-2/Z-3

- hot@65536 ≈ hot@8192 (**6178** vs **6150**) → GPU ring **не** растёт с полным ctx.
- nohot@63488 **6704** vs hot@65536 **6178** (−526 MiB load).
- Claim «ring = окно, не контекст» — **PASS**.

### Вердикт §5: **PASS** (VRAM/scalability); quality — §3 FAIL

---

## Сводка вердиктов

| # | Пункт | Вердикт | vs prev G-4 (с ollama) |
|---|---|---|---|
| 1 | test-backend-ops 13994 | **PASS** | same |
| 2 | no-flag vs G-3 | **PASS** | same |
| 3 | Phase 1 quality hot-window | **FAIL** | same (short A/B) |
| 4 | kvarn4 @63488 OOM | **PASS** (закрыт @ BG 0.75G) | **было FAIL** |
| 5 | VRAM/timings hot | **PASS** | same, абсолютные VRAM ниже |

---

## Найденные баги / gaps (без починки)

1. **`--kv-hot-size` quality broken even inside hot window** (главный)  
   Short A/B 1763: nohot → needle; hot → `Dolor`. Long in-window → wrong/gibberish; nohot same prompt → exact needle.  
   Z-3 чинит segfault, не correctness SWA-attend.

2. **kvarn4 FA OOM** — **условный**: закрыт без ollama; на 8GB с BG≥~1.5G + large prefill + slots=4 — edge. Не «чистый code bug only».

3. Hot long prefill иногда даёт **HTTP 500 peg-native format** (мусорный reasoning ломает chat parser) — симптом §3, не отдельный root cause.

4. tool gaps (из G-3): `llama-bench` без kvarn/turbo; test-backend-ops без turbo/kvarn/WHT.

---

## Команды

```bash
export MODEL=models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf
export LD_LIBRARY_PATH=./build/bin:$LD_LIBRARY_PATH
pkill -x llama-server
nvidia-smi --query-gpu=memory.used --format=csv,noheader   # expect ~0.7G

./build/bin/test-backend-ops -j 8

./build/bin/llama-perplexity -m $MODEL -ngl -1 -fa on -c 8192 -ub 256 -b 512 -fit off \
  -f /tmp/wiki.spot.raw -ctk kvarn4 -ctv kvarn4

# §4 now OK
./build/bin/llama-server -m $MODEL -ngl -1 -fa on -c 63488 -ub 256 -fit off -np 1 \
  --cache-type-k kvarn4 --cache-type-v kvarn4 --port 8099

# §3/5
./build/bin/llama-server -m $MODEL -ngl -1 -fa on -c 65536 -ub 256 -fit off -np 1 \
  --cache-type-k kvarn4 --cache-type-v kvarn4 --kv-hot-size 4096 --port 8099
```

---

## Итог одной строкой

Без ollama: **OOM@63k закрыт**, VRAM ring claim **держится**, no-flag **OK**; Phase 1 hot-window **по-прежнему не работает как дизайн** (ломает NIAH даже внутри окна).
