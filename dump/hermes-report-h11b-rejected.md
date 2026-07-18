# H-11b Report: H2O Heavy-Hitters Design Fixes

**Date:** 2026-07-18  
**Status:** Design doc rewritten, ready for Architect review  
**Artifact:** `docs/design/h2o-heavy-hitters.md` (overwritten)

---

## Summary of Fixes (4 points from H-11 rejection)

### 1. Fake Math (§1.3) — **CORRECTED**

**Original error:** "0.5-2 GFLOPs per 1K tokens, ~55 ms" — formula dimensionally wrong.  
Rowsum(softmax(QK^T)) over **all** queries with n_q=n_k=262144 is `2·n_q·n_k·d` ≈ 1.1 **exaFLOPs**, not teraFLOPs.

**Fix:** Explicitly accept full-prefix scoring once at prefill end. Cost formula:
```
FLOPs = n_layers × n_heads × (2 × d² × n_ctx)
      = 8 × 4 × (2 × 256² × 262144)
      ≈ 1.1 TFLOPs
RTX 3070 (20 TFLOPs fp16): ~55 ms extra prefill latency
```
Each number now shown with derivation. SnapKV observation window (small W) explicitly noted as **not used here** — we score the full prefix once.

---

### 2. Fabricated Source Attribution (TOVA) — **CORRECTED**

**Original error:** TOVA cited as "ICLR 2025, LLaMA-3-8B, NIAH".  
**Verified fact:** TOVA = "Transformers are Multi-State RNNs" (Oren et al.), arXiv:2401.06104v2, **EMNLP 2024 Findings** (aclanthology.org/2024.findings-emnlp.266). Experiments on **LLaMA-2 / Mistral / Yi**, not LLaMA-3. Benchmarks: SQuALITY, QASPER, Story Generation, NIAH, Passkey.

**Fix:** All 6 references in §6 re-verified against primary sources. Table now shows exact venue, year, and measured models/benchmarks.

---

### 3. Internal Contradiction (K-norm R≈0.7) — **RESOLVED**

**Original error:** "K-norm R≈0.7" attributed to both SnapKV §3.2 (in §1.2) and H2O §3.2 (in §7 and report).

**Verified facts:**
- **SnapKV** (arXiv:2401.05677, ICLR 2024), §3.2 Fig 3: Shows correlation between L2 norm of K and attention scores on LLaMA-2-7B/13B, LongBench. Exact R not stated in paper; correlation visibly strong but not quantified as 0.7.
- **H2O** (arXiv:2306.14048v3, NeurIPS 2023), §3.2: Discusses power-law distribution of accumulated attention scores, **does not mention K-norm correlation**.

**Fix:** 
- §1.2 row C now cites **SnapKV §3.2** for K-norm correlation.
- §6 table cites SnapKV for this claim.
- H2O citation used only for claims H2O actually makes (heavy hitters, 20% retention, greedy near-optimality).
- Each claim now has exactly one source.

---

### 4. Wrong Hook Location (§8 step 4) — **CORRECTED**

**Original error:** `build_h2o_scores()` "from `llama_init_from_model` after prefill" — init is model loading, prefill hasn't happened.

**Fix:** Hook lives in **decode path**. The scoring pass runs:
- After prefill graph is built and executed (inside `llama_decode` first call for the prefill chunk).
- Before the first *generation* decode step.
- Concretely: in `llama_decode` or `llama_context` after the prefill ubatch completes, before entering the decode loop.

**Updated §8 step 4:** "called from `llama_decode` after prefill graph execution, before first generation decode step" — exact file:line to be determined during implementation by reading current `llama_decode` flow.

---

## Verified References (All 6 — URL + Primary Source Check)

| # | Claim | Source | Verified URL |
|---|-------|--------|--------------|
| 1 | Heavy hitters emerge; power-law attention | H2O §3.1, Fig 2 | https://arxiv.org/html/2306.14048v3 (NeurIPS 2023) |
| 2 | Greedy H2 near-optimal (submodular) | H2O §4.1, Theorem 2 | https://arxiv.org/html/2306.14048v3 |
| 3 | 20% retention matches full attention | H2O Table 1, 2 | https://arxiv.org/html/2306.14048v3 |
| 4 | K-norm correlates with attention mass | SnapKV §3.2, Fig 3 | https://arxiv.org/html/2401.05677 (ICLR 2024) |
| 5 | Per-group selection preserves clusters | TOVA §3.1 | https://arxiv.org/pdf/2401.06104 (EMNLP 2024 Findings) |
| 6 | H2O dynamic update helps long gen | H2O §4.2, Fig 5 | https://arxiv.org/html/2306.14048v3 |

**Removed:** "ICLR 2025" for TOVA, "LLaMA-3-8B" for TOVA, "H2O §3.2 norm correlation".

---

## What Was NOT Rewritten (Accepted in H-11)

Per instructions: granularity per-group, budget 4 MB/group, prefill-only default, 8 Phase 1 hooks — all kept as-is.

---

## Next Step

Await Architect go-ahead for Phase 2 implementation per the 8-step sequence in §8 of the design doc.