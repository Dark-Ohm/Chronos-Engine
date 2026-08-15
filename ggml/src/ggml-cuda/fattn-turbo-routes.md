# Turbo FA route matrix (fattn.cu)

Turbo KV-cache types (CLI names): `turbo2`, `turbo3`, `turbo4` (straight
TurboQuant), `turbo2_tcq`, `turbo3_tcq`, `turbo4_tcq` (trellis-coded).

`is_turbo_kv_type()` = any of the six. `kv_rank()` maps each turbo type to
the rank of its classic counterpart (turbo4 = rank 7, turbo3 = rank 9,
turbo2 = rank 11). `classic_non_q8` = q6_1/q6_0/q5_1/q5_0/q4_1/q4_0/
q3_1/q3_0/q2_1 (NOT q8_0, NOT f16/bf16).

`ggml_cuda_flash_attn_ext()` has THREE turbo families. Order matters: each
is tried in sequence, first match returns.

## 1. raw-fused MMA - `path=fused-mma`

Gate (~fattn.cu:3320):

    turbo_mma_fused && K->type == V->type &&
    K in {turbo4, turbo3, turbo2} &&
    Q->ne[1] <= 4 && (Q->ne[0] == 128 || Q->ne[0] == 256) &&
    turing_mma_available(cc)

- Reads raw turbo bytes directly in the MMA kernel; no f16 materialization.
- Straight turbo only (no TCQ, no mixed K/V).
- Decode-shaped (`Q->ne[1] <= 4`).
- Pre-rotates Q itself (`k_turbo_fwht_forward`, ~fattn.cu:3341-3357).
- `GGML_TURBO_MMA_FUSED=0` is a kill-switch (default ON), not opt-in.

## 2. prefill-dequant MMA - `path=prefill-dequant`

Gate (~fattn.cu:3378):

    turbo_prefill_mma_safe && !TURBO_PREFILL_VEC &&
    Q->ne[1] > 1 && Q->ne[0] <= 512 && turing_mma_available(cc)

where `turbo_prefill_mma_safe` =

    (K in {F16, turbo*} && V in {F16, turbo*} && at least one is turbo)
    || (K = turbo* && V = classic_non_q8)

so `q8_0`/`turbo3`, `turbo4`/`q8_0`, `bf16`/`turbo3`, etc. do NOT pass
this gate (they fall through to family 3).

- `ggml_cuda_turbo_prefill_attend()`.
- turbo4 K: inverse-FWHT dequant into the original domain (no Q rotation).
- turbo2/3 K: rotated-domain dequant + Q pre-rotation.
- V un-rotation handled at graph level (`ggml_turbo_wht`).
- Prefill-shaped (`Q->ne[1] > 1`).

## 3. unified decode route - `path=decode-dequant-or-vec`

Fall-through when neither gate above matches. `ggml_cuda_fattn_make_route_plan()`:

- `prefer_native_vec` (turbo K + classic non-q8 V, D<=512, D%64==0, pair
  compiled) -> native VEC, no dequant.
- else `decode_dequant` (turbo K/V -> f16; K via inverse FWHT into original
  domain, V stays rotated) -> `best_fattn_kernel` selects
  TILE / VEC / WMMA_F16 / MMA_F16.
- Q pre-rotation only when K remains in the rotated domain (Bug #31
  exceptions for turbo2/3 K vs specific V types).

## Live-verified matrix (Qwythos-9B, D=256, GQA=4, RTX 3070, commit 1c00ef564)

144 combos traced: 6 turbo x 6 turbo (36) + each turbo x each of
{f32,f16,bf16,q8_0,q4_0,q4_1,q5_0,q5_1,iq4_nl} both directions (108).
Machine-readable rows: `.chronos-ops/active/t001-matrix-summary.tsv`;
raw logs: `.chronos-ops/active/t001-matrix-raw/`. Result: 132 ok + 12 NO-FA.

| K | V | prefill | decode (fused ON) |
|---|---|---------|-------------------|
| straight turbo, K==V (t2/2, t3/3, t4/4) | same | prefill-dequant | fused-mma |
| turbo* (any, incl TCQ, K!=V or mixed) | turbo* (any) | prefill-dequant | decode-dequant-or-vec, MMA_F16 |
| turbo* | f32 or f16, and f32/f16 | turbo* | prefill-dequant | decode-dequant-or-vec, MMA_F16 |
| turbo* | bf16 | prefill-dequant | decode-dequant-or-vec, MMA_F16 |
| bf16 | turbo* | decode-dequant-or-vec, MMA_F16 | decode-dequant-or-vec, MMA_F16 |
| turbo* | q8_0 | decode-dequant-or-vec, MMA_F16 (K->f16) | decode-dequant-or-vec, VEC (f16/q8_0) |
| q8_0 | turbo* | decode-dequant-or-vec, MMA_F16 | decode-dequant-or-vec, MMA_F16 (q8_0/f16, allow_vec=0) |
| turbo* | classic_non_q8 (q4_0, q4_1, q5_0, q5_1) | prefill-dequant | decode-dequant-or-vec, VEC (prefer_native_vec; turbo2/3 MMA_F16 on prefill, turbo4 VEC) |
| classic_non_q8 (q4_0, q4_1, q5_0, q5_1) | turbo* | decode-dequant-or-vec, MMA_F16 | decode-dequant-or-vec, MMA_F16 (V->f16, allow_vec=0) |
| turbo* | iq4_nl, and iq4_nl | turbo* | NO-FA (kernel=NONE) | NO-FA (kernel=NONE) |

**iq4_nl finding (new in the full matrix):** `iq4_nl` is in the CLI cache-type
whitelist (`common/arg.cpp` `kv_cache_types`) but is NOT handled by the route
planner for turbo pairs — every `iq4_nl` x turbo combo returns `kernel=NONE`
and falls back to non-FA attention (rc=0, silent, slower). This is a second
whitelist-class gap next to llama-bench's missing turbo types; it means
`--cache-type-k/v iq4_nl` with a turbo counterpart silently loses FA. Not a
crash, but a correctness/throughput hole worth its own ticket.

The classic_non_q8 classes q6_0/q6_1/q3_0/q3_1/q2_1 are in
`ggml_cuda_fattn_is_classic_non_q8_type()` but NOT in the CLI whitelist, so
they are unreachable via `--cache-type` and untestable through the harness;
q4_0/q4_1/q5_0/q5_1 are the CLI-reachable classic_non_q8 representatives.

### Build-policy dependence (default vs HALF_QUANTS/ALL_QUANTS)

The kernel availability matrix depends on `GGML_CUDA_FA_HALF_QUANTS` /
`GGML_CUDA_FA_ALL_QUANTS`:

- `q8_0`/`turbo*` at D=256: effective pair q8_0/f16 with `allow_vec=0`
  (unsafe after turbo-V decode). In the **default** build
  `pair_compiled(q8_0, f16)` is false -> `kernel=NONE` ->
  `ggml_cuda_flash_attn_ext_supported()` returns false -> non-FA fallback.
  In **HALF_QUANTS** (V==f16 is always accepted) -> `kernel=MMA_F16`.
- Production (release `build/`, default policy) therefore routes the
  llama-swap Qwythos config (`q8_0`/`turbo3`) to non-FA attention.

## Numerical results (turbo4/turbo4, Qwythos-9B, HALF_QUANTS build)

Stable corpus (789 words, -c 256, n_seq=8). Numbers grepped verbatim from
`.chronos-ops/active/t001-numerics/*.txt`:

- PPL: f16 = 5.6305, dequant (FUSED=0) = 8.6542. fused (default ON) CRASHES
  under `--save-all-logits` ("illegal memory access",
  fattn-mma-f16.cuh:2151 <- ggml_cuda_turbo_prefill_attend); without
  `--save-all-logits` it is intermittent (one PPL=10.3785, one "illegal
  instruction").
- KLD(dequant||f16) median = 0.3476, mean = 0.4721, PPL ratio = 1.547
  (turbo4/turbo4 KV is ~55% worse PPL than f16).
- KLD(fused||f16) and KLD(fused||dequant): both CRASH — fused numerical
  correctness is not measurable on this build.
- A/B tokens/s (`llama-completion`, -c 512, -n 128, `--ignore-eos -s {42,43,44}`,
  3 runs each, idle GPU, no debug — debug perturbs t/s ~5x): fused
  NON-deterministic 2.94..24.09 t/s (mean 9.0, bimodal ~20-24 vs ~3-5) vs
  dequant stable 23.85..25.25 (mean 24.4). Route-proven (fused-mma vs
  decode-dequant-or-vec). Earlier "fused ~28% slower" (23 vs 32) does NOT
  reproduce (early-EOS, no seed) — retracted.

## Debug toggles

- `GGML_TURBO_FA_DEBUG=1`   - prints `path=` for each FA call.
- `GGML_CUDA_FA_ROUTE_DEBUG=1` - prints route plan + `kernel=` selection.
- `GGML_TURBO_MMA_FUSED=0`  - kill-switch for family 1.
- `TURBO_PREFILL_VEC=1`     - force VEC prefill (bypass family 2).
- `GGML_TURBO_DECODE_NATIVE=1` - force native VEC decode (no dequant).

## Known issues (audit 2026-08-15, T001)

- **Native VEC with turbo V crashes**: `GGML_TURBO_DECODE_NATIVE=1` on
  turbo4/turbo4 aborts with `CUDA error: illegal memory access`. The same
  native-VEC family is fine when only K is turbo (turbo4/q4_0 -> VEC, no
  crash), so the fault is on the turbo V-side dequant in the VEC path.
  Same class as the documented turbo2 crash. The donor's "KLD == VEC
  baseline" is therefore not reproducible against this path.
- **fused (default ON) crashes under multi-sequence prefill**: with the
  default `GGML_TURBO_MMA_FUSED`, `llama-perplexity` (n_seq=8) aborts with
  "illegal memory access" / "illegal instruction" in
  `ggml_cuda_turbo_prefill_attend` -> `ggml_cuda_flash_attn_ext_mma_f16_case`
  (fattn-mma-f16.cuh:2151). FUSED=0 (dequant) does not crash. This makes
  fused KLD unmeasurable and blocks the "default ON" sanction (D-017
  retracted). Root cause not isolated.
- **llama-bench cannot benchmark turbo**: its local `ggml_type_from_name()`
  (tools/llama-bench/llama-bench.cpp) whitelists only f16/bf16/q8_0/q4_0/
  q4_1/q5_0/q5_1/iq4_nl; turbo types are rejected as "invalid parameter".
  Use llama-cli / llama-completion instead.
