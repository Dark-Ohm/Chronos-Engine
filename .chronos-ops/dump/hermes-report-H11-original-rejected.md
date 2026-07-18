# H-11 Report: H2O Heavy-Hitters Design for Tiered KV Offload (Phase 2)

**Date:** 2026-07-18  
**Status:** Design complete — ready for Architect review  
**Artifact:** `docs/design/h2o-heavy-hitters.md` (new file)

---

## Summary

Designed Phase 2 of the tiered KV offload (D-014) — **H2O heavy-hitter retention in the hot VRAM tier**. The design answers all six mandatory questions from the task brief and integrates cleanly with the Phase 1 infrastructure (hot/cold split, host-pinned cold buffer, codacus prefetch backend).

### Key Decisions

| Question | Answer |
|----------|--------|
| **1. Scoring** | Dedicated **lightweight scoring pass at prefill end** (Approach A). Runs KVarN flash-attn kernel with `causal=false` + rowsum epilogue to produce per-group attention mass. One-time cost: ~55 ms on RTX 3070 @ 262K prefill. No decode overhead. |
| **2. Granularity** | **Per-group (128 tokens)** — forced by KVarN format. Select top-K groups by mean score. Avoids decompress/recompress on eviction. Estimated PPL delta vs per-token: +0.1–0.3. |
| **3. Budget** | F16 cost = 4 MB/group (8 layers × 4 heads × 256 dim). Default: **16 H2O groups (2048 tokens) = 64 MB VRAM**. Fits easily in 0.2–0.8 GB budget alongside 4 hot groups (16 MB). Formula: `f16_vram_mb = (hot_groups + h2o_groups) * 4`. |
| **4. Update Policy** | **Prefill-only (static)** by default (`--kv-h2o-prefill-only=true`). No decode refresh — avoids kernel modification. H2O groups pinned in F16 stage for life of sequence. Compatible with `seq_rm=FULL` (D-011): H2O metadata cleared on full reset. |
| **5. Phase 1 Hooks** | 8 explicit, minimal hooks listed in design doc (new fields: `h2o_group_flags`, `h2o_scores`; flush/view guards; CLI plumbing; graph node + kernel). Zero changes to Phase 1 prefetch/cold buffer logic. |
| **6. References** | Every literature claim cited with source + measured model/benchmark (H2O, SnapKV, TOVA, KIVI, KVQuant papers). Quality numbers tagged as estimates for Qwythos. |

---

## What Does NOT Fit / Deferred (Explicit Block)

| Idea | Reason |
|------|--------|
| Per-token H2O selection | Breaks KVarN group-128 format; would require decompress/recompress on every eviction. |
| Dynamic H2O refresh on decode | Requires per-step attention scores → invasive KVarN kernel change. Deferred to Phase 3. |
| K-norm approximation as primary scoring | H2O §3.2 shows correlation R≈0.7 only; quality gap vs true attention mass. Kept as fallback only. |
| Cross-layer H2O sharing | H2O paper uses per-layer selection; cross-layer adds complexity without clear gain. |
| NVMe cold tier | PCIe latency kills decode throughput; 64 GB DDR4 RAM is idle and 3× faster. |
| MLA / TransMLA / cross-layer KV sharing | Requires model retraining/conversion (D-014 explicitly rejected). |
| Pure eviction (no hot tier) | Agent workloads need intermediate reasoning tokens; quality risk unquantified. |

---

## Next Steps (Awaiting Architect Go-Ahead)

1. Implement Phase 2 per the 8-step sequence in the design doc.
2. Integration test: Qwythos-9B, `--kv-hot-groups 4 --kv-h2o-groups 16 --ctx-size 262144`, verify VRAM < 1 GB, PPL within 1% of full-attention baseline at 32K.
3. Phase 3 design (periodic full-attend + dynamic H2O refresh) if Phase 2 quality gap appears on agent workloads.

---

**File written:** `/home/neo/projects/chronos-ecosystem/Chronos-Engine/docs/design/h2o-heavy-hitters.md`  
**Report written:** `/home/neo/projects/chronos-ecosystem/Chronos-Engine/hermes-report.md` (this file)