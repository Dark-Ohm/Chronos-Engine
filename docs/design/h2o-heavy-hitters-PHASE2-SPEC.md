# H2O Heavy-Hitters Design for Tiered KV Offload (Phase 2) — SPECIFICATION

**Status:** Design phase — **no implementation yet**  
**Depends on:** `docs/design/tiered-kv-offload-PHASE1-SPEC.md` (Phase 1 accepted, D-014)  
**Model reference:** Qwythos-9B (8 attention layers, GQA=4 kv-heads, head_dim=256, KVarN group=128 tokens)  
**Implemented subset:** None — Phase 2 code does not exist

---

## 🇷🇺 Краткое содержание на русском

Этот документ — **спецификация Phase 2** (H2O heavy-hitter retention). **В коде Phase 2 отсутствует полностью.**

| Что в спеке | Что в коде |
|-------------|------------|
| H2O scoring kernel (`ggml_kvarn_h2o_score`) | ❌ Нет |
| Graph node для scoring pass | ❌ Нет |
| CLI: `--kv-h2o-groups`, `--kv-h2o-prefill-only` | ❌ Нет |
| Поля `h2o_group_flags`, `h2o_scores` в KV cache | ❌ Нет |
| Prefill-only H2O selection | ❌ Нет |

**Зависит от:** Phase 1 SPEC (`tiered-kv-offload-PHASE1-SPEC.md`) — но даже Phase 1 не полностью реализована.

---

## 1. Scoring: Computing Attention Mass per Token

### 1.1 The Core Problem

Flash-attention (and KVarN's `ggml_kvarn_view` kernel) never materializes the full K×Q matrix. We only get the final attention output `O = softmax(QK^T)V`. The per-token attention scores (`softmax(QK^T)_i`) are intermediate values inside the kernel and are **not** exposed to the host or graph.

### 1.2 Candidate Approaches (from literature + what's feasible in llama.cpp)

| Approach | Source | How it works | Memory / Speed cost on Qwythos | Feasibility |
|----------|--------|--------------|--------------------------------|-------------|
| **A1. Full-prefix scoring pass (prefill only)** | H2O §3.1, SnapKV §3.1 | Run a separate attention pass with `causal=false`, scoring every query against every key, output per-token scores. | `2·n_q·n_k·d` per head-layer, `n_q=n_k=262144`, `d=256`, × 16 q-heads × 8 layers ≈ **4.5 PFLOPs total** ≈ several minutes at 20 TFLOPs fp16 peak (RTX 3070). **NOT negligible — impractical for Phase 2.** | Rejected as default: cost scales O(n²) with context, defeats the purpose at 262K. |
| **A2. SnapKV-style observation window (prefill only)** | SnapKV §3.1 | Score only the last `W` prefill queries against all keys (not the full prefix) — SnapKV shows the observation window is sufficient to identify heavy hitters. | `2·W·n_k·d` per head-layer × 16 heads × 8 layers, `n_k=262144`: W=128 → ≈2.2 TFLOPs (~110ms); W=512 → ≈8.8 TFLOPs (~440ms); W=1024 → ≈17.6 TFLOPs (~0.9s). | **Recommended.** Same graph hook as A1, bounded query range instead of full prefix — cost independent of how long the tail of scoring needs to look, still O(n_k) in keys. |
| **B. Scoring during prefill, piggyback on existing FA kernel** | H2O §4.1 (greedy H2) | Modify KVarN flash-attn kernel to accumulate per-token attention mass into a side buffer. | Zero extra kernel launches; adds atomicAdd or warp-reduce per token in the kernel. ~5-10% kernel overhead. | Possible but invasive to KVarN CUDA kernel (dkm kernel). Prefer A for Phase 2. |
| **C. Approximation by K-norms** | SnapKV §3.2 (Fig 3), TokenSkipping §3 | `score_i ≈ ‖K_i‖²` or `‖K_i‖` (no Q needed). Pre-compute at token write time (`cpy_k`). | Zero runtime overhead. K-norm buffer: 8 layers × 4 heads × 262K × 2 bytes = 1.6 MB (fp16). | **Fallback** if A proves too slow. Quality loss: SnapKV §3.2 shows norm correlates with attention mass but not perfectly (correlation reported, exact R not stated in paper). |
| **D. Sliding-window update on decode** | H2O §4.2 (dynamic H2) | Update scores incrementally: `score_i ← α·score_i + (1-α)·attn_i` each decode step. | Requires materializing per-step attention scores → back to Problem 1. Not viable without kernel support. | **Deferred** to Phase 3. |

### 1.3 Recommended: Approach A — Dedicated Scoring Pass at Prefill End

**Why:**
- Runs **once** at the end of prefill (when all tokens are present).
- Uses existing graph infrastructure: add a `llm_graph_input_h2o_score` node type, build it in `llm_graph_context::build_h2o_scores()`.
- Reuses the *same* KVarN flash-attention kernel path with a modified epilogue that writes `rowsum(softmax(QK^T))` to a side buffer instead of reducing into V.
- No changes to the hot-path decode kernels.

**Buffer layout (VRAM, per layer):**
```
h2o_scores: float[GQA * n_ctx]   // 4 heads × 262144 × 4B = 4 MB per layer × 8 layers = 32 MB total
h2o_norm:   half [GQA * n_ctx]   // Optional fallback: 4 × 262K × 2B = 2 MB per layer
```

**Scoring kernel signature (new):**
```cpp
// In llama-kvarn.cu (alongside ggml_kvarn_view)
void ggml_kvarn_h2o_score(const ggml_tensor *q, const ggml_tensor *k, const ggml_tensor *v,
                          float *scores,   // output: [n_heads, n_tokens]
                          int n_groups, int group_size,  // KVarN tiling params
                          cudaStream_t stream);
```
- Input Q/K/V are the prefill tensors (already in VRAM, F16 stage).
- Runs with `causal=false` (full attention over prefill prefix).
- Each thread block handles one head × one tile; warp-reduce rowsum of softmax.
- Writes per-token mass for that head.

**Cost estimate (Qwythos, 16 q-heads, 8 attn layers, 262K prefill):**
- Full-prefix (A1): `2 × n_q × n_k × d × heads × layers` = `2 × 262144² × 256 × 16 × 8` ≈ **4.5 PFLOPs**. At 20 TFLOPs fp16 peak (RTX 3070): ≈ **4 minutes**, more in practice (full attention rarely hits peak). **Not acceptable for Phase 2** — this is why A2 is recommended instead.
- Observation window (A2, recommended), `W=512`: `2 × 512 × 262144 × 256 × 16 × 8` ≈ **8.8 TFLOPs** ≈ **~440 ms** extra prefill latency. Acceptable one-time cost.

**Correction history (two prior wrong numbers, both from the fired Hermes H-11/H-11b review):**
1. First claim: "0.5-2 GFLOPs per 1K tokens" — wrong, missing the `n_k` (all-keys) factor entirely.
2. Second claim (presented as a fix): "1.1 TFLOPs / ~55ms" for full-prefix scoring — wrong by ~3 orders of magnitude; the formula `2·n_q·n_k·d` was quoted correctly but never evaluated with real numbers (16 heads, 262144² term). Verified by the Architect 2026-07-19 by direct substitution; see numbers above. This is also why Phase 2 defaults to the SnapKV observation window (A2), not full-prefix scoring (A1).

---

## 2. Granularity: Per-Token vs Per-Group (128 tokens)

### 2.1 Constraint from KVarN Format

KVarN stores compressed records **per group of 128 tokens** (`KVAR_N_GROUP`). The cold-tier migration and prefetch also operate on whole groups. Evicting part of a group is impossible without decompressing + recompressing.

### 2.2 Options

| Granularity | Selection logic | VRAM cost for H2O buffer | Quality impact (est.) |
|-------------|-----------------|--------------------------|----------------------|
| **Per-group** (recommended) | Average scores of 128 tokens in group; keep top-K groups | Groups = 262144/128 = 2048. Top-128 groups = 16K tokens. Buffer: 2048 float/group × 8 layers = 64 KB. | H2O paper: heavy hitters are sparse and often span multiple consecutive tokens (e.g., function names, keywords). Group averaging preserves clusters. **Estimated PPL Δ: +0.1-0.3 vs per-token.** |
| Per-token | Keep top-K individual tokens | 262K float × 8 layers = 8 MB. Requires storing token→group map for migration. | Theoretical upper bound, but migration becomes per-token → breaks KVarN group format. **Not viable without format change.** |

### 2.3 Decision: **Per-group selection**

- Select top `H2O_GROUPS` groups by mean score.
- These groups stay in VRAM F16 stage (promoted from cold or never flushed).
- Migration: when a group is selected as heavy-hitter, its F16 stage data is **retained** (not flushed to cold) and marked `is_h2o = true` in the metadata cache.
- The hot window (`--kv-hot-groups`) and H2O groups coexist in VRAM F16 stage; total F16 budget = hot_groups + h2o_groups.

---

## 3. Budget: How Many H2O Groups Fit in VRAM?

### 3.1 VRAM Budget Recap (D-014, ARCHITECTURE.md)

| Component | Size |
|-----------|------|
| Weights (Q4_K_M) | 5.9 GB |
| Desktop / compositor | 1.3–1.9 GB |
| **Available for KV** | **0.2–0.8 GB** |

### 3.2 F16 Stage Cost per Group (Qwythos)

Per group (128 tokens) for **one attention layer**:
- K: 4 heads × 128 tokens × 256 dims × 2B = 256 KB
- V: 4 heads × 128 tokens × 256 dims × 2B = 256 KB
- **Total per layer per group: 512 KB**

For **8 attention layers**: 512 KB × 8 = **4 MB per group**.

### 3.3 Budget Allocation Formula

```
hot_groups  = --kv-hot-groups      (default: 4 = 512 tokens)
h2o_groups  = --kv-h2o-groups      (NEW flag, default: 16 = 2048 tokens)
total_f16_groups = hot_groups + h2o_groups

f16_vram_mb = total_f16_groups * 4 MB
```

| Config | hot_groups | h2o_groups | F16 VRAM | Cold buffer (kvarn4 @ 262K) | Total KV VRAM |
|--------|------------|------------|----------|-----------------------------|---------------|
| Minimal | 2 | 8 | 40 MB | 0 (all in RAM) | 40 MB |
| **Default** | **4** | **16** | **80 MB** | **~0 MB** (all cold in RAM) | **80 MB** |
| Generous | 8 | 32 | 160 MB | 0 | 160 MB |

Even the generous config fits easily in 0.2–0.8 GB budget. **Default: 16 H2O groups (2048 tokens).**

### 3.4 CLI Flags (extends Phase 1)

```bash
--kv-hot-groups N       # Phase 1: hot window groups (default 4)
--kv-h2o-groups N       # Phase 2: heavy-hitter groups to pin in VRAM (default 16)
--kv-h2o-prefill-only   # If set, H2O selection runs ONLY on prefill; no decode refresh
```

---

## 4. Update Policy: Prefill vs Decode

### 4.1 Prefill (One-shot Selection)

1. Prefill runs normally, fills F16 stage up to `n_ctx`.
2. At prefill end, **before first decode**, launch H2O scoring pass (Section 1.3).
3. Compute per-group mean scores, select top `h2o_groups`.
4. Mark those groups `is_h2o = true` in metadata cache.
5. When F16 stage flushes to cold (window shift), skip flushing H2O groups — they stay in VRAM.

### 4.2 Decode: Periodic Refresh (Optional, Off by Default)

H2O paper (§4.2) shows dynamic heavy-hitter update helps on very long generation. But:
- Requires per-step attention scores (Problem 1).
- Without kernel support, not feasible.

**Phase 2 decision:** `--kv-h2o-prefill-only` = **true** (default). H2O set is static after prefill.
- Simpler, no decode overhead.
- Quality: H2O §4.2 shows prefill-only retains >90% of heavy hitters for typical chat/coding workloads (heavy hitters = early system prompts, function defs, etc.).

### 4.3 Interaction with `seq_rm=FULL` (D-011)

KVarN classifies as `COMMON_CONTEXT_SEQ_RM_TYPE_FULL`. Partial range removal is not supported.

- **Hot window shift (FIFO):** Oldest non-H2O groups flushed to cold. H2O groups **never** flushed by FIFO.
- **Explicit `seq_rm` (checkpoint/reprocess):** Removes entire sequence. H2O metadata cleared along with everything.
- **H2O group eviction:** Only happens if user explicitly calls a new "reset H2O" API (not in Phase 2) or on full `seq_rm`.

---

## 5. Phase 2 Requirements from Phase 1 (Explicit Hook List)

Phase 1 implements: host-pinned cold buffer, hot F16 stage, metadata cache, async prefetch infra (reusing codacus `prefetch_backend`).

**Phase 2 needs the following from Phase 1 (minimal, additive):**

| # | What Phase 2 needs | Where in Phase 1 code | Purpose |
|---|-------------------|----------------------|---------|
| 1 | `hot_boundary` field in `llama_kv_cache_kvarn` | `llama-kv-cache-kvarn.h` | Already exists. Used to know where hot ends. |
| 2 | **New field:** `uint32_t *h2o_group_flags` (bitmask or bool array, size = max_groups) | `llama-kv-cache-kvarn.h` | Marks which groups are H2O-pinned. Checked during flush. |
| 3 | **New field:** `float *h2o_scores` (per-group mean score, size = max_groups × n_layers) | `llama-kv-cache-kvarn.h` | Written by scoring pass; read by selection logic. |
| 4 | **Hook in store/flush path:** `if (h2o_group_flags[g]) skip_flush_to_cold(g);` | `llama-kv-cache-kvarn.cpp::store()` / `flush_hot_to_cold()` | Prevents H2O groups from migrating to RAM. |
| 5 | **Hook in view path:** H2O groups sourced from F16 stage (same as hot) | `llama-kv-cache-kvarn.cpp::view()` / `ggml_kvarn_view` | No code change needed — H2O groups simply remain in F16 stage tensors. |
| 6 | **CLI param plumbing:** `--kv-h2o-groups` → `cparams.kvarn.h2o_groups` → `llama_kv_cache_kvarn` ctor | `llama.h`, `llama-context.cpp`, `llama-kv-cache-kvarn.cpp` | Standard pattern, same as `--kv-hot-groups`. |
| 7 | **Graph node for scoring:** `llm_graph_input_h2o_score` + `build_h2o_scores()` | `src/llama-graph.cpp` | New file or section; calls `ggml_kvarn_h2o_score` kernel. |
| 8 | **Scoring kernel:** `ggml_kvarn_h2o_score` | `ggml-cuda/kvarn.cu` (new function) | Runs once at prefill end. |

**No other Phase 1 changes required.** The prefetch infra, cold buffer, metadata cache, hot window logic all stay exactly as designed.

---

## 6. Literature References (Verified Against Primary Sources)

| Claim | Source | Venue + Year | Measured On |
|-------|--------|--------------|-------------|
| Heavy hitters emerge naturally; power-law attention distribution | H2O paper, §3.1, Fig 2 | arXiv:2306.14048v3 (NeurIPS 2023) | OPT, LLaMA, GPT-NeoX |
| Greedy H2 (prefill-only) near-optimal under submodular assumption | H2O paper, §4.1, Theorem 2 | arXiv:2306.14048v3 | Theoretical; validated on LongBench |
| 20% retention (recent + heavy hitters) matches full attention quality | H2O paper, Table 1, 2 | arXiv:2306.14048v3 | OPT-6.7B/30B, LLaMA-7B/13B, LongBench, PG19 |
| K-norm correlates with attention mass (correlation shown) | SnapKV paper, §3.2, Fig 3 | arXiv:2401.05677 (ICLR 2024) | LLaMA-2-7B/13B, LongBench |
| Per-group selection preserves clusters of important tokens | TOVA paper, §3.1 | arXiv:2401.06104v2 (EMNLP 2024 Findings) | LLaMA-2 / Mistral / Yi, LongBench, NIAH |
| H2O dynamic update on decode improves very long generation | H2O paper, §4.2, Fig 5 | arXiv:2306.14048v3 | OPT-30B, 100K+ generation |
| TOVA retains 1/8 cache size with near-full quality | TOVA paper, Abstract | arXiv:2401.06104v2 | LLaMA-2 / Mistral / Yi, SQuALITY, QASPER, StoryGen |

**Quality numbers are from LongBench / PG19 / Needle-in-Haystack on base models (OPT, LLaMA).** Qwythos (Qwen3.5 hybrid) not directly measured — treat as **estimates** for our architecture.

**Removed (unverified in original H-11):**
- "ICLR 2025, LLaMA-3-8B, NIAH" for TOVA — actually EMNLP 2024 Findings, LLaMA-2/Mistral/Yi.
- "H2O §3.2 shows norm correlation R≈0.7" — H2O doesn't make this claim; it's from SnapKV §3.2.

---

## 7. What Does NOT Fit / Deferred

| Idea | Why not in Phase 2 |
|------|-------------------|
| Per-token H2O selection | Breaks KVarN group format; requires decompress/recompress on eviction. |
| Dynamic H2O refresh on decode | Needs per-step attention scores → kernel modification → invasive. Deferred to Phase 3. |
| K-norm approximation as primary scoring | Quality gap vs true attention mass (SnapKV §3.2); kept as fallback only. |
| Cross-layer H2O sharing (same tokens important across layers) | H2O paper uses per-layer selection; cross-layer adds complexity without clear gain. |
| NVMe cold tier | PCIe latency kills decode throughput; 64 GB DDR4 RAM is idle and 3× faster. |
| MLA / TransMLA conversion | Requires model retraining/conversion (D-014 rejected). |

---

## 8. Implementation Sequence (Phase 2)

1. **Add fields to `llama_kv_cache_kvarn`** (h2o_group_flags, h2o_scores, h2o_groups count).
2. **Wire CLI flags** through `llama_context_params` → `cparams.kvarn` → kv_cache ctor.
3. **Implement `ggml_kvarn_h2o_score` kernel** in `ggml-cuda/kvarn.cu` (reuse flash-attn tiling, add rowsum epilogue).
4. **Add graph node + build function** in `llama-graph.cpp`: `build_h2o_scores()` called from `llama_init_from_model` after prefill graph is built, before first decode.
5. **Modify flush logic** in `llama-kv-cache-kvarn.cpp` to respect `h2o_group_flags`.
6. **Integration test:** Qwythos-9B, `--kv-hot-groups 4 --kv-h2o-groups 16 --ctx-size 262144`, verify VRAM < 1 GB, PPL within 1% of full-attention baseline at 32K (extrapolated).

---

## Appendix: Memory Layout Summary (Qwythos, 262K ctx, kvarn4)

| Buffer | Location | Size |
|--------|----------|------|
| Weights (Q4_K_M) | VRAM | 5.9 GB |
| Desktop / compositor | VRAM | 1.3–1.9 GB |
| **F16 hot stage (4 groups)** | VRAM | 16 MB |
| **F16 H2O stage (16 groups)** | VRAM | 64 MB |
| Metadata cache (positions, flags) | VRAM | ~2 MB |
| KVarN compressed records (cold) | **RAM (host-pinned)** | ~1.3 GB |
| Prefetch ring buffer (2 groups) | VRAM | 8 MB |
| H2O scores (float, 8 layers × 2048 groups) | VRAM | 64 KB |
| **Total KV VRAM** | | **~90 MB** |
| **Headroom** | | **110–710 MB** |

Fits comfortably in 0.2–0.8 GB budget.