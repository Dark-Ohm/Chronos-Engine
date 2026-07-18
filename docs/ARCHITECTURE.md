# Архитектура Chronos-Engine

> **Последнее обновление:** 2026-07-18  
> **Версия:** соответствует коммиту `0be1eb542` (G-3 parity)  
> **Upstream base:** llama.cpp (ggml-org/llama.cpp), порт beellama.cpp v0.3.2

---

## Навигация по архитектурной документации

| Документ | Статус | Описание |
|----------|--------|----------|
| [`design/tiered-kv-offload-PHASE1-SPEC.md`](design/tiered-kv-offload-PHASE1-SPEC.md) | 📋 **Спецификация (не реализована полностью)** | Phase 1: Tiered hot/cold KV offload — полная схема с cold-tier в RAM, prefetch, attend modes |
| [`design/h2o-heavy-hitters-PHASE2-SPEC.md`](design/h2o-heavy-hitters-PHASE2-SPEC.md) | 📋 **Спецификация (не реализована)** | Phase 2: H2O heavy-hitter retention в VRAM |
| [`user-guide/tiered-kv-offload.md`](user-guide/tiered-kv-offload.md) | ✅ **Реализовано** | Руководство пользователя: `--kv-hot-size`, kvarn types, SWA requirement |
| [`chronos-port-map.md`](chronos-port-map.md) | 📋 Карта порта | Порт beellama → Chronos (на русском) |
| [`DECISIONS.log`](../DECISIONS.log) | 📋 История решений | D-001…D-015 с обоснованиями |

> ⚠️ **Важно:** Дизайн-доки (`*_SPEC.md`) описывают **целевую архитектуру**. Реализовано только подмножество Phase 1 (см. user-guide). Phase 2 (H2O) в коде отсутствует.

---

## Ключевые компоненты

### 1. KVarN KV-кэш (Phase 1 foundation)
- **Файлы:** `src/llama-kvarn.h/.cpp`, `src/llama-kv-cache-kvarn.h/.cpp`
- **CUDA kernels:** `ggml/src/ggml-cuda/kvarn.cu`, `fattn-mma-kvarn*.cuh`
- **Форматы:** kvarn2/4/6/8 (4/6/8 бит на вес, Hadamard rotation)
- **Группа:** 128 токенов (`KVAR_N_GROUP = 128`)

### 2. Tiered Hot/Cold Offload (Phase 1 — частично)
| Компонент | Статус | Детали |
|-----------|--------|--------|
| `--kv-hot-size` (tokens) | ✅ Реализовано | `common/arg.cpp:2288`, `src/llama-cparams.h:71` |
| Host-pinned cold buffers | ✅ Реализовано | `llama-kv-cache-kvarn.cpp:666-683` |
| Cold offload (SWA-gated) | ✅ Реализовано | Требует `swa && n_stream==1` |
| `--kv-cold-offload` flag | ❌ Нет | Автоматически включается при `kv_hot_size > 0` |
| `--kv-prefetch-groups` | ❌ Нет | Инфраструктура есть (`ggml-backend.cpp` expert prefetch), не подключена |
| Attend modes (hot/h2o/periodic) | ❌ Нет | Только hot-window attend |

### 3. TurboQuant / TCQ (Phase 1 donor port)
- **Файлы:** `ggml/src/ggml-turbo-quant.c`, `ggml/src/ggml-cuda/turbo-quant-cuda.cuh`, rotation data
- **Типы:** TURBO2_0, TURBO3_0, TURBO4_0 + asymmetric K
- **Статус:** Портировано из beellama, интегрировано в quantize pipeline

### 4. Qwythos-9B (Target Model)
- **Архитектура:** 33 слоя, 8 attention layers, GQA=4 kv-heads, head_dim=256
- **KVarN group:** 128 tokens
- **Target:** 262K context на RTX 3070 8GB
- **VRAM budget:** Weights 5.9GB + Desktop 1.3-1.9GB = 0.2-0.8GB для KV

---

## Реализованные CLI флаги (текущее состояние)

```bash
# KVarN cache type (required for tiered offload)
--cache-type-k kvarn4 --cache-type-v kvarn4

# Phase 1: Hot window size (tokens, multiple of 128)
--kv-hot-size 512

# Implicit: cold offload auto-enables when kv_hot_size > 0 AND SWA mode
# No separate --kv-cold-offload flag needed

# TurboQuant (weight quantization)
--quant-type turbo4
```

---

## Дизайн-решения (из DECISIONS.log)

| ID | Решение | Статус |
|----|---------|--------|
| D-001 | Не портировать DFlash (upstream merged) | ✅ Accepted |
| D-003 | Patch-series port на свежий upstream | ✅ Accepted |
| D-005 | Type ID remap: fork-private types в ID 200+ | ✅ Accepted |
| D-008 | Scope: CPU+CUDA only (Metal/Vulkan deferred) | ✅ Accepted |
| D-009 | Drop bee-Q2_0 (incompatible) | ✅ Accepted |
| D-010 | kvarn fallback bits=2 → Q2_1 | ✅ Accepted |
| D-011 | kvarn seq_rm = FULL only | ✅ Accepted |
| D-012 | kvarn runs with `-fit off` | ✅ Accepted |
| D-013 | Turbo reference: TheTom/llama-cpp-turboquant | ✅ Accepted |
| **D-014** | **Tiered hot/cold KV offload path to 262K** | 🟡 **Phase 1 partial** |
| D-015 | grammar MAX_REPETITION_THRESHOLD 2000→200000 | ✅ Accepted |

---

## Roadmap (from design specs)

| Phase | Target | Key Deliverables | Code Status |
|-------|--------|------------------|-------------|
| **1** | Hot-only attend + cold RAM tier | `--kv-hot-size`, host-pinned buffers, SWA-gated offload | ✅ 80% done |
| **2** | H2O heavy hitters in VRAM | `--kv-h2o-groups`, scoring kernel, graph node, selection logic | ❌ 0% (spec only) |
| **3** | Periodic full attend | Streaming cold→GPU, full attention every N steps | ❌ 0% (spec only) |

---

## Связанные файлы в кодовой базе

```
src/
├── llama-kvarn.h/.cpp              # KVarN core types & validation
├── llama-kv-cache-kvarn.h/.cpp     # Tiered KV cache implementation
├── llama-cparams.h                 # kv_hot_size, kvarn_params
├── llama-context.cpp               # Wiring: params → cache ctor
├── llama-graph.cpp/.h              # Graph nodes (future: H2O score node)
└── llama-model.cpp                 # Runtime validation

ggml/src/ggml-cuda/
├── kvarn.cu/.cuh                   # Store/view kernels
├── fattn-mma-kvarn*.cuh            # Flash-attn for KVarN
├── turbo-quant-cuda.cuh            # TurboQuant kernels
└── cross-ring-interleave.cu        # Rotation data

common/
├── arg.cpp                         # CLI flags (--kv-hot-size)
└── common.h                        # Param structs
```

---

## Как читать эту документацию

1. **Начинай здесь** — понимание статуса каждого компонента
2. **User-guide** — для запуска и использования текущих фич
3. **Design specs** — для понимания цели архитектуры (не для текущего API)
4. **DECISIONS.log** — почему выбраны текущие пути
5. **Chronos-port-map** — история порта от beellama (на русском)