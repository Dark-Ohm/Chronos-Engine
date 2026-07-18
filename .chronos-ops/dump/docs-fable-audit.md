# Fable-method Audit: docs/ — Chronos-Engine

**Task shape:** Assessment (question/assessment) — findings and recommendation, no changes made.

**Step 1 — Done definition:** Every claim below traces to a file:line or grep result. No "should work" — only "I read X at line Y and it shows Z".

---

## Executive Summary

The `docs/` folder contains two classes of documentation with a critical mismatch:

| Class | Files | Status vs Code |
|-------|-------|----------------|
| **Upstream llama.cpp docs** (install.md, build.md, docker.md, function-calling.md, multimodal.md, ops.md, speculative.md, etc.) | ~12 files | Accurate for upstream; lack Chronos-specific flags |
| **Chronos design docs** (design/tiered-kv-offload.md, design/h2o-heavy-hitters.md) | 2 files | **Describe aspirational Phase 1/2 design that is NOT implemented** |

**Root cause:** Design docs were written *before* implementation and never reconciled. The code implements only a **subset of Phase 1** (kv_hot_size + cold offload behind SWA), while the docs describe full Phase 1 + all of Phase 2.

---

## Evidence Matrix (Primary Sources Only)

### 1. What actually exists in code (verified by grep/read_file)

| Feature | Code location | Status |
|---------|--------------|--------|
| `--kv-hot-size` (tokens) | `common/arg.cpp:2288-2305` | ✅ Implemented |
| `llama_cparams.kv_hot_size` | `src/llama-cparams.h:71` | ✅ Implemented |
| `llama_kv_cache_kvarn.kv_hot_size` | `src/llama-kv-cache-kvarn.h:228` | ✅ Implemented |
| `cold_offload = (kv_hot_size > 0)` | `src/llama-kv-cache-kvarn.cpp:518-522` | ✅ Implemented |
| Host-pinned cold buffers (`host_cold_k/v_records`) | `src/llama-kv-cache-kvarn.cpp:666-683, 729-745` | ✅ Implemented |
| `enqueue_cold_offloads()` / `offload_group_to_host()` | `src/llama-kv-cache-kvarn.cpp:1032-1095` | ✅ Implemented |
| **BUT: cold_offload requires `swa == true`** | `src/llama-kv-cache-kvarn.cpp:565-566` | ⚠️ Conditional |

| Missing in code (grepped 0 hits) | Design doc claim |
|----------------------------------|------------------|
| `--kv-hot-groups` | `tiered-kv-offload.md:173`, `h2o-heavy-hitters.md:104` |
| `--kv-h2o-groups` | `h2o-heavy-hitters.md:105,123,172` |
| `--kv-h2o-prefill-only` | `h2o-heavy-hitters.md:124` |
| `--kv-cold-offload` | `tiered-kv-offload.md:175` |
| `--kv-prefetch-groups` | `tiered-kv-offload.md:176` |
| `--kv-attend-mode` | `tiered-kv-offload.md:177` |
| `--kv-h2o-k` | `tiered-kv-offload.md:178` |
| `--kv-periodic-attend` | `tiered-kv-offload.md:179` |
| `h2o_group_flags` field | `h2o-heavy-hitters.md:168` (table row 2) |
| `h2o_scores` field | `h2o-heavy-hitters.md:169` (table row 3) |
| `ggml_kvarn_h2o_score` kernel | `h2o-heavy-hitters.md:174` (table row 8) |
| `llm_graph_input_h2o_score` graph node | `h2o-heavy-hitters.md:173` (table row 7) |

### 2. Critical numeric error in design doc

**File:** `docs/design/h2o-heavy-hitters.md`

| Location | Claim | Reality (from text correction at line 56) |
|----------|-------|-------------------------------------------|
| Table 1.2, line 19 | "Extra prefill FLOPs: 8 layers × 4 heads × 256² × n_tokens ≈ **0.5-2 GFLOPs per 1K tokens**" | **Wrong**. Correction at line 56 states: formula `2 × n_q × n_k × d` with `n_q=n_k=262144` → **~1.1 TFLOPs total** (55 ms on RTX 3070) |
| Line 52 | "FLOPs: 8 layers × 4 heads × (2 × 256² × 262144) ≈ **1.1 TFLOPs**" | **Correct** (this is the corrected version) |

**Finding:** The table was not updated after the correction. A reader sees two contradictory numbers in the same document.

### 3. Missing `docs/ARCHITECTURE.md`

**Referenced by:** `tiered-kv-offload.md:84` ("D-014, ARCHITECTURE.md"), `h2o-heavy-hitters.md:84` (same), `README.md:7` ("Architecture and decision history: ARCHITECTURE.md"), `chronos-port-map.md` (implicit)

**Actual state:** `ls docs/ARCHITECTURE.md` → No such file. Root `/ARCHITECTURE.md` exists but is 0 bytes.

**Impact:** All architecture navigation links are dead.

### 4. Language inconsistency

| File | Language |
|------|----------|
| `docs/design/tiered-kv-offload.md` | English |
| `docs/design/h2o-heavy-hitters.md` | English |
| `docs/chronos-port-map.md` | **Russian** |

User requirement: "только docs folder - все правки на русском" — but design docs are in English.

---

## Step 3 — Decision

**Classification:** Documentation drift (failure mode 9: "plowing through surprises" — design docs written before implementation, never updated when reality diverged).

**Single recommendation:** Do not patch individual flags. The design docs are **architectural specifications for future work**, not documentation of current state. They must be relabelled and split:

1. **Rename** `design/tiered-kv-offload.md` → `design/tiered-kv-offload-PHASE1-SPEC.md`
2. **Rename** `design/h2o-heavy-hitters.md` → `design/h2o-heavy-hitters-PHASE2-SPEC.md`
3. **Add** `docs/ARCHITECTURE.md` as the single entry point, linking to specs with clear "NOT IMPLEMENTED" badges
4. **Create** `docs/user-guide/tiered-kv-offload.md` documenting ONLY what works today (`--kv-hot-size`, kvarn types, SWA requirement)
5. **Translate** specs to Russian per user requirement, or add Russian summaries

---

## Step 5 — Verification (by observation)

| Check | Method | Result |
|-------|--------|--------|
| CLI flags exist | `grep -r "kv.hot.groups\|kv.h2o\|kv.cold\|kv.prefetch" common/arg.cpp src/` | 0 hits — confirmed missing |
| H2O kernel exists | `grep -r "h2o_score\|ggml_kvarn_h2o" ggml/src/ggml-cuda/ src/` | 0 hits — confirmed missing |
| Cold offload code path | `read_file src/llama-kv-cache-kvarn.cpp` lines 560-570, 666-683, 1032-1095 | Exists but gated behind `swa && n_stream == 1` |
| ARCHITECTURE.md exists | `ls docs/ARCHITECTURE.md` | Missing |
| FLOPs table vs correction | `read_file docs/design/h2o-heavy-hitters.md` lines 19 vs 52-56 | Contradiction confirmed |

---

## Report (outcome-first)

**The docs/ folder contains two design specifications masquerading as implemented-feature documentation.** They describe a full Phase 1 (tiered hot/cold offload with host-pinned buffers, prefetch, multiple attend modes) and Phase 2 (H2O heavy-hitter retention), but the codebase implements only a **SWA-gated subset of Phase 1** (`--kv-hot-size` + cold mirror buffers). No Phase 2 code exists (no kernels, no graph nodes, no CLI flags, no struct fields).

**Critical blockers for users:**
- `docs/ARCHITECTURE.md` is missing — all architecture links are dead
- Design docs use CLI flag names that don't exist (`--kv-hot-groups`, `--kv-h2o-groups`, etc.)
- `h2o-heavy-hitters.md` has a numerical error: Table 1.2 claims 0.5-2 GFLOPs/1K tokens; the corrected text 40 lines later says 1.1 TFLOPs total
- Language split: port-map is Russian, design specs are English

**Recommended next action (plan-first):** Create `docs/ARCHITECTURE.md` as the authoritative index, relabel the two design files as SPEC (not current reality), write a user-facing guide for the actually-working `--kv-hot-size` feature, and decide on the Russian/English policy for the folder.

---

**TWINS:** N/A (no defect fixed — this is an assessment).

**PENDING:** None — this is an audit report, no changes made.