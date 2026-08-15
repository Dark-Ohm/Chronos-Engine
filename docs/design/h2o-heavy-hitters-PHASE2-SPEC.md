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
| Накопление скоров в attention-пути (§1.3) | ❌ Нет |
| CLI: `--kv-h2o-groups` | ❌ Нет |
| Поля `h2o_group_flags`, `h2o_group_scores` в KV cache | ❌ Нет |
| Пин групп против перезаписи в кольце + проброс их в live-set `view()` | ❌ Нет |

**Ревизия 2026-08-16 (T003d).** Прошлая редакция описывала Phase 1,
которой нет: `hot_boundary`, `flush_hot_to_cold()`, prefetch ring, «F16 до
n_ctx», «K/V уже в VRAM». Отдельный scoring-пасс (`ggml_kvarn_h2o_score`,
`build_h2o_scores()`, SnapKV observation window, `causal=false`) и флаг
`--kv-h2o-prefill-only` из спеки удалены как нереализуемые/лишние. Принято:
скоры накапливаются по ходу prefill с горизонтом стейджа, удержание — пин в
сжатом кольце, отбор — per-layer.

**Зависит от:** Phase 1 SPEC (`tiered-kv-offload-PHASE1-SPEC.md`) — но даже Phase 1 не полностью реализована.

---

## 1. Scoring: Computing Attention Mass per Token

### 1.1 The Core Problem

Flash-attention (and KVarN's `ggml_kvarn_view` kernel) never materializes the full K×Q matrix. We only get the final attention output `O = softmax(QK^T)V`. The per-token attention scores (`softmax(QK^T)_i`) are intermediate values inside the kernel and are **not** exposed to the host or graph.

### 1.2 Candidate Approaches (judged against the real Phase 1 layout)

**Hard constraint that kills the entire A family.** Any "scoring pass at
prefill end" assumes the prefix K/V are still readable when the pass runs.
In Phase 1 they are not:

- The F16 stage holds only `stage_groups` (`llama-kv-cache-kvarn.h:222`) —
  the positional tail, ~7-9 groups, **not** `n_ctx`.
- Older groups exist only as compressed records in the GPU ring, and
  `host_cold_k/v_records` is a write-through mirror for export
  (`enqueue_cold_offloads` / `offload_group_to_host`,
  `llama-kv-cache-kvarn.cpp:1036/1063`) — never read back for attention.
- There is no cold→hot promotion path.

So at prefill end there is nothing left to score. This is a property of
the storage design, not a tuning problem.

| Approach | Source | How it works | Verdict against Phase 1 |
|----------|--------|--------------|-------------------------|
| **A1. Full-prefix scoring pass** | H2O §3.1, SnapKV §3.1 | Separate attention pass over every query × every key at prefill end. | **Rejected twice over.** Prefix K/V are gone by then (constraint above); and even if present, `2·n_q·n_k·d × 16 heads × 8 layers` at `n_q=n_k=262144, d=256` ≈ **4.5 PFLOPs** ≈ minutes on an RTX 3070. |
| **A2. SnapKV observation window** | SnapKV §3.1 | Score only the last `W` queries against all keys at prefill end. | **Rejected.** Cost would be acceptable (`W=512` ≈ 8.8 TFLOPs ≈ 440 ms), but it needs all keys readable at prefill end — they are not. Its formula also requires looking backwards from a window that does not exist yet while prefill is still running. |
| **B. Accumulate during prefill (chosen)** | H2O §4.1 (greedy H2) | Each prefill ubatch adds its attention mass to every group still live in the F16 stage; a group's score freezes when it leaves the stage. | **Chosen.** The only variant that reads K/V while they are still readable. Costs no extra pass — it piggybacks on attention already being computed. See §1.3. |
| **C. Approximation by K-norms** | SnapKV §3.2 (Fig 3) | `score_i ≈ ‖K_i‖²`, computed at write time, no Q needed. | **Fallback** if B's kernel work proves too invasive. Quality loss: norm correlates with attention mass but imperfectly. Cheap: 8 layers × 4 heads × 262K × 2 B = 1.6 MB. |
| **D. Sliding-window update on decode** | H2O §4.2 (dynamic H2) | Update scores each decode step. | **Deferred to Phase 3.** Needs per-step attention scores — Problem 1 again. |

### 1.3 Chosen: Approach B — Accumulation During Prefill ("H2O with a stage horizon")

**How it works.** Every prefill ubatch adds the attention mass it produced
to **all groups still living in the F16 stage** at that moment. When a
group leaves the stage and is compressed into a record, its accumulated
score is **frozen** and never updated again.

**This is not a single snapshot.** Scoring a group once, at the instant it
flushes, would record the attention of the last ubatch only — that is not
H2O and must not be implemented.

**Horizon — say it out loud.** A group accumulates mass only from the
queries that arrive while it is still in the stage: roughly `stage_groups`
worth of "future", order 1K tokens. Zhang et al. accumulate over the whole
remaining suffix. Ours is therefore **H2O with a stage horizon**, and it
must be named that way everywhere. Consequence to accept openly: a token
that becomes important much later in the prompt cannot be recognised — its
group froze long before. If measurements later show this matters, the fix
is Phase 3 (decode-side refresh), not a re-reading of dead K/V.

**Causality is structural.** The mass comes from attention prefill already
computed causally — each query sees only its own prefix. There is no
separate scoring pass, hence no mask to choose and no `causal=false`
anywhere in Phase 2. The "observation window votes for itself" failure mode
does not exist in this design.

**Buffer layout (VRAM, per layer) — one contract, not three:**
```
h2o_group_scores: float[n_kv_heads][max_groups][n_layers]
// Qwythos: 4 KV-heads × 2048 groups × 8 layers × 4 B = 256 KB total.
// Accumulated per KV-head; no per-key scratch buffer exists in this design.
```

**GQA reduction (16 Q-heads → 4 KV-heads):** the mass of the Q-heads
belonging to one KV-head is **summed** (attention mass is additive; a mean
only rescales it and loses "how much arrived in total"). Scores are stored
per KV-head.

**From scores to flags:** sum over KV-heads → `[max_groups][n_layers]` →
take top-K within each layer → set bits in
`h2o_group_flags[max_groups][n_layers]`. Selection is per-layer: different
layers attend to different things, and collapsing them into one global set
destroys exactly the signal H2O exists to capture.

**Correction history (two prior wrong numbers, both from the fired Hermes
H-11/H-11b review):**
1. "0.5-2 GFLOPs per 1K tokens" — wrong, missing the `n_k` (all-keys) factor.
2. "1.1 TFLOPs / ~55ms" for full-prefix scoring — wrong by ~3 orders of
   magnitude; the formula was quoted correctly but never evaluated with real
   numbers. Verified by direct substitution 2026-07-19; see A1 above.

Both are kept here because the FLOP figures still justify rejecting A1 on
cost alone — but note that A1/A2 are now rejected primarily on **feasibility**
(the data is gone), not on price.

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

- Select top `H2O_GROUPS` groups per layer by accumulated score (§1.3).
- **H2O groups are pinned in the compressed GPU record ring — not in the
  F16 stage.** The stage is a fixed-depth positional tail, not storage;
  nothing can be held there persistently. What pinning actually buys: when
  `--kv-hot-size` turns the model into a windowed (fake-SWA) ring
  (`llama_kvarn_apply_hot_window`, `llama-model.cpp:2037`), pinned groups
  are **not** handed out for overwrite on wraparound, while unpinned ones
  are evicted as they are today.
- Accepted cost of this: H2O groups survive at **record precision**
  (`key_bits`/`value_bits`), not F16. Any claim that heavy hitters are
  retained losslessly is false.
- **Budget:** pinning shrinks the effective sliding window, so the pinned
  count is capped as a fraction of `n_groups_per_stream` (the ring's
  per-stream capacity, `llama-kv-cache-kvarn.h:224`). Beyond the cap,
  additional candidates are simply not pinned. Default kept conservative.

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

H2O groups are **not** F16, so they do not add to the F16 budget. The two
budgets are independent:

```
# F16 tail stage — fixed by position semantics, NOT by a CLI flag:
stage_groups = tail_groups + 1 (non-SWA) | tail_groups (SWA)   # ~7-9 groups

# Hot window — tokens, not groups:
--kv-hot-size N        # rounded up to a multiple of 128; 0 = off

# H2O pins — slots inside the compressed record ring:
h2o_groups = min(--kv-h2o-groups, max(1, n_groups_per_stream / 4))   # 0 = off
```

Pinning costs no new VRAM (the records are already in the ring); it costs
**window**: every pinned slot is one fewer slot cycling through the sliding
window. That is the real budget being spent, and why the cap exists.

**Cap = one quarter of the ring** (`KVAR_H2O_RING_FRACTION_DIVISOR = 4`,
`llama-kv-cache-kvarn.cpp`). Fixed here as canon by T003a acceptance: the
divisor is a design constant, not a tunable. Rationale — beyond a quarter
the pins stop being a bias on the window and start being the window;
a request above the cap is clamped with a warning, never refused.

**CLI default is 0 (feature off).** The numbers below are recommended
budgets *once you enable it*, not defaults; without the flag no H2O buffer
is allocated and `has_h2o()` is false. Same contract as `--kv-hot-size`.

| Config | `--kv-hot-size` | `--kv-h2o-groups` | Effect on window |
|--------|-----------------|-----------|------------------|
| Off (default) | 0 | 0 | no pins, no buffers |
| Minimal | 512 | 8 | 8 ring slots held back |
| **Recommended** | **512** | **16** | 16 slots held back |
| Generous | 1024 | 32 | 32 slots held back |

**The table assumes a ring large enough to hold the request** — with the
quarter cap, `h2o_groups = 16` needs `n_groups_per_stream >= 64`. On a
small context the cap bites and the effective count drops (a 4-group ring
clamps any request to 1). Check `n_groups_per_stream` in the KVarN startup
log before reading these rows as achievable.

The old table here multiplied `(hot_groups + h2o_groups) × 4 MB` of F16.
That arithmetic described a design where H2O lives in F16; it does not.

### 3.4 CLI Flags (extends Phase 1)

```bash
--kv-hot-size N         # Phase 1, ALREADY EXISTS (common/arg.cpp:2288).
                        # Unit is TOKENS, not groups; rounded up to a multiple of 128.
                        # 0 disables the hot window. There is no --kv-hot-groups.
--kv-h2o-groups N       # Phase 2, EXISTS since T003a (common/arg.cpp:2307).
                        # Unit is GROUPS (128 tokens), NOT tokens, and there is
                        # no rounding -- deliberately unlike --kv-hot-size.
                        # 0 disables (default). Clamped at cache construction to
                        # n_groups_per_stream / 4 with a warning (§2.3, §3.3).
```

`--kv-h2o-prefill-only` is **deleted from this spec**. There is no decode
refresh to turn off (§4.2), so a switch defaulting to `true` would only
document an alternative that does not exist.

---

## 4. Update Policy: Prefill vs Decode

### 4.1 Prefill (Accumulate, Then Select)

1. Prefill runs normally. The F16 stage holds `stage_groups` — the tail —
   and rolls; it does **not** fill up to `n_ctx`.
2. **During** prefill, each ubatch adds its attention mass to every group
   still live in the stage (§1.3). A group's score freezes as it leaves.
3. At prefill end all groups already carry frozen scores. No separate
   scoring pass runs, and none is possible (§1.2).
4. Sum over KV-heads, take top-`h2o_groups` **per layer**, set bits in
   `h2o_group_flags[max_groups][n_layers]`, subject to the ring-fraction
   cap (§2.3).
5. From then on the windowed ring skips pinned groups when choosing a slot
   to overwrite.

### 4.2 Decode: Periodic Refresh (Optional, Off by Default)

H2O paper (§4.2) shows dynamic heavy-hitter update helps on very long generation. But:
- Requires per-step attention scores (Problem 1).
- Without kernel support, not feasible.

**Phase 2 decision:** the H2O set is static after prefill, and there is no
flag for it — decode refresh is simply not implemented (deferred to Phase 3).
- Quality: H2O §4.2 shows prefill-only retains >90% of heavy hitters for typical chat/coding workloads (heavy hitters = early system prompts, function defs, etc.).
- Note this figure comes from full-suffix accumulation; with a stage horizon
  (§1.3) it is an upper bound for us, not a promise.

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
| 1 | ~~`hot_boundary` field~~ — **does not exist.** | — | The field appears only in the Phase 1 design docs, never in `src/`. Phase 2 must not reference it. Stage depth is `stage_groups` (`llama-kv-cache-kvarn.h:222`); ring capacity is `n_groups_per_stream` (`:224`). |
| 2 | **New field:** `h2o_group_flags`, size = **`max_groups × n_layers`** | `llama-kv-cache-kvarn.h` | Per-layer pin bits (§1.3). A single global `max_groups` vector is wrong — layers select different groups. |
| 3 | **New field:** `h2o_group_scores`, `float[n_kv_heads][max_groups][n_layers]` | `llama-kv-cache-kvarn.h` | Accumulated during prefill (§1.3). There is **no** per-key scratch buffer in this design. |
| 4 | **Hook in the ring's overwrite path:** a pinned group is not offered as a wraparound victim | `llama-kv-cache-kvarn.cpp::store()` and the SWA ring slot selection | ~~`flush_hot_to_cold()` does not exist.~~ The real write path is `enqueue_cold_offloads()` → `offload_group_to_host()` (`:1036`/`:1063`), and it is a write-through export mirror — skipping it would not retain anything. Retention happens by not overwriting the ring slot. |
| 5 | **Hook in view path: REQUIRED, not free.** The `ggml_kvarn_view` call itself stays single-source, but the live set must change | `llama-kv-cache-kvarn.cpp::view()` (`:1397`), `mat_idxs` / `n_kv` / metadata cells | Pinned groups sit **outside** the SWA window. Unless the indices, `n_kv` and metadata cells carry them, the kernel never asks for those records and the pin buys nothing. "No code change needed" was false. |
| 6 | **CLI param plumbing:** `--kv-h2o-groups` alongside `kv_hot_size` | `common/arg.cpp`, `llama.h`, `llama-context.cpp`, `llama-kv-cache-kvarn.cpp` | Follow how `kv_hot_size` is plumbed — it lives **next to** the kvarn params, not inside `llama_kvarn_params`. There is no `cparams.kvarn.h2o_groups` slot today. |
| 7 | **Accumulation hook in the attention path** (replaces the old "graph node for a scoring pass") | attention/KVarN kernel epilogue | Adds each ubatch's mass to still-live stage groups; freezes on eviction. No standalone scoring graph node, no `build_h2o_scores()` at prefill end. |
| 8 | ~~**Scoring kernel** `ggml_kvarn_h2o_score`~~ — **not needed** | — | Approach A is rejected (§1.2); there is no separate pass to launch. |

**What Phase 1 provides unchanged:** compressed GPU record ring, F16 tail
stage, host-pinned cold export mirror, metadata cache, hot-window logic.
**What Phase 1 does NOT provide, contrary to earlier drafts:** any prefetch
ring for attention reads, any cold→hot promotion, any `hot_boundary` field.

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

**Gate:** none of this starts before [[T010]] is closed by a live run —
`--kv-hot-size` currently breaks retrieval *inside* the window, and H2O
built on a broken window measures nothing.

1. **Fields** in `llama_kv_cache_kvarn`: `h2o_group_flags[max_groups][n_layers]`,
   `h2o_group_scores[n_kv_heads][max_groups][n_layers]`, pinned-group count.
2. **CLI plumbing** for `--kv-h2o-groups`, following how `kv_hot_size` is
   plumbed (next to the kvarn params, not inside `llama_kvarn_params`).
3. **Accumulation** in the attention path: add each ubatch's mass to
   still-live stage groups, freeze on eviction (§1.3). No separate kernel,
   no `build_h2o_scores()`, no `llama_init_from_model` hook — at context
   creation time prefill has not happened yet, so there is nothing to score
   there.
4. **Selection**: sum over KV-heads → top-K per layer → set pin bits, subject
   to the ring-fraction cap (§2.3).
5. **Ring retention**: pinned groups are not chosen as wraparound victims.
6. **Read path**: `mat_idxs` / `n_kv` / metadata cells must carry pinned
   groups that lie outside the SWA window (§5, row 5) — otherwise the pin is
   invisible to the kernel.
7. **Integration test:** Qwythos-9B, `--kv-hot-size 512 --kv-h2o-groups 16
   --ctx-size 262144`. Confirm from the startup log that the request was NOT
   clamped (needs `n_groups_per_stream >= 64`, §3.3) — a clamped run measures
   1 pinned group, not 16, and reads as "H2O does nothing". Retrieval (NIAH)
   must improve over hot-window-only at equal VRAM; PPL and VRAM reported
   from artifacts, not estimated.

---

## Appendix: Memory Layout Summary (Qwythos, 262K ctx, kvarn4)

| Buffer | Location | Size |
|--------|----------|------|
| Weights (Q4_K_M) | VRAM | 5.9 GB |
| Desktop / compositor | VRAM | 1.3–1.9 GB |
| **F16 tail stage (`stage_groups`, ~7–9 groups)** | VRAM | ~28–36 MB |
| **KVarN compressed record ring** (H2O pins live here, at record precision) | VRAM | sized by `n_groups_per_stream` |
| Metadata cache (positions, flags) | VRAM | ~2 MB |
| Cold export mirror (write-through, never read for attention) | **RAM (host-pinned)** | ~1.3 GB |
| H2O scores `float[4 kv-heads][2048 groups][8 layers]` | VRAM | 256 KB |
| H2O pin flags `[2048 groups][8 layers]` | VRAM | 2 KB |

**Removed from this appendix:** the "F16 H2O stage (16 groups)" row — H2O
groups are pinned in the compressed ring, not held in F16 (§2.3) — and the
"Prefetch ring buffer (2 groups)" row, which described infrastructure that
does not exist (see §5). Any total that summed those rows was fiction.

The remaining figures are layout arithmetic, not measurements. Real VRAM
numbers come from the integration test in §8, from artifacts.