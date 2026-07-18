# Chronos-Engine QA Audit Report
**Project:** Chronos-Engine (llama.cpp fork)  
**Branch:** chronos-main  
**Date:** 2026-07-16  
**Scope:** Deep code review of core engine (src/, ggml/src/, include/) — excluding `donors/`, `docs/`, `.dotfiles/`, build artifacts

---

## Executive Summary

Chronos-Engine is an ambitious llama.cpp fork integrating:
- **KVarN KV-cache** (from beellama.cpp) — structured pseudo-quantization via `GGML_OP_KVARN_VIEW`
- **TurboQuant KV-cache** — WHT rotation + PolarQuant/QJL (types 200-212)
- **codacus MoE optimizations** — host-pin mmap (`GGML_CUDA_REGISTER_HOST=1`) + expert prefetch (`GGML_SCHED_PREFETCH_EXPERTS`)
- **Hybrid SSM+Attention memory** — llama-memory-hybrid* for Qwen3.5-style architectures

**Status:** Phases 1-4 complete, Phase 5 (codacus) partially integrated with known bugs, Phase 6 (CopySpec) pending investigation.

**Overall Quality:** High engineering skill evident; clean separation of fork-specific types (ID 200+), good opt-in gating, solid test baseline. **Critical bugs exist in H-2 prefetch integration** (confirmed by Architect review in HERMES.md).

---

## 1. Architecture & Design — ✅ Strong

### What's Good
| Area | Assessment |
|------|------------|
| **Type ID strategy (D-005/B)** | All fork-private GGML types in 200+ range — zero upstream collision risk. Clean, forward-compatible. |
| **KVarN isolation** | `llama-kvarn.cpp/h`, `llama-kv-cache-kvarn.cpp/h` — self-contained, no DFlash bleed (D-001 honored). |
| **Memory interface** | `llama_memory_i` abstraction cleanly separates KV-cache implementations (standard, ISWA, DSV4, hybrid, recurrent). |
| **Opt-in gates** | Both codacus features behind env vars (`GGML_CUDA_REGISTER_HOST`, `GGML_SCHED_PREFETCH_EXPERTS`) — safe defaults. |
| **Phase discipline** | Clear phase gate in HERMES.md; Cline/Hermes/OMP work on disjoint files. |
| **Port methodology** | Hunk-by-hunk from donors (D-004), not wholesale file copies. Architect verification on diffs. |

### Architectural Risks
| Risk | Location | Severity |
|------|----------|----------|
| **GGML_TYPE_COUNT sparsity** | `ggml.c:type_traits` array now sparse at 200+ | Medium — must audit all `0..GGML_TYPE_COUNT` loops |
| **KVarN pseudo-types in CLI only** | `llama_kvarn_type` enum, no GGML type IDs | Low — by design, uses `GGML_OP_KVARN_VIEW` |
| **Hybrid memory double-indirection** | `llama_memory_hybrid::mem_attn` now `unique_ptr<llama_memory_i>` | Low — adds virtual dispatch but isolates kvarn |
| **DSv4 hard-coded `llama_kv_cache*` casts** | `llama-kv-cache-dsv4.cpp` fixed by 81729eb43 | Fixed — now `dynamic_cast` + assert |

---

## 2. Critical Bugs (Confirmed by Architect)

### BUG-1: Prefetch `prefetch_n_slots` Never Initialized ⚠️ **CRITICAL**
**File:** `ggml/src/ggml-backend.cpp` (lines ~2015-2019 in current tree)  
**Root Cause:** Partial port of codacus commit `5f83fbbe` — helper functions (`prefetch_init`/`disable`) support variable slots, but three integration points remained at 2-slot hardcode from `1163cb34`.

**Evidence in current code:**
```cpp
// ggml_backend_sched_new() — MISSING prefetch_n_slots init
const char * GGML_SCHED_PREFETCH_EXPERTS = getenv("GGML_SCHED_PREFETCH_EXPERTS");
sched->prefetch_experts = op_offload && GGML_SCHED_PREFETCH_EXPERTS && atoi(GGML_SCHED_PREFETCH_EXPERTS);
// sched->prefetch_n_slots NOT SET → remains 0 (calloc)

// compute_splits() — XOR rotation (2-slot only)
const int slot = sched->prefetch_cur;
sched->prefetch_cur ^= 1;  // Should be: (prefetch_cur + 1) % prefetch_n_slots

// ggml_backend_sched_free() — hardcoded 2
for (int i = 0; i < 2; i++) {  // Should be GGML_SCHED_MAX_PREFETCH_SLOTS
    ggml_backend_event_free(sched->prefetch_ready[i]);
```

**Impact:** With `GGML_SCHED_PREFETCH_EXPERTS=1`:
1. `prefetch_n_slots == 0` → `prefetch_init()` loops never run → no buffers/events allocated
2. First MoE batch triggers `input_cpy->buffer = sched->prefetch_slots[slot]` → **NULL deref in `ggml_backend_buffer_get_base()`** → **segfault**
3. Even if slots worked, rotation only uses slots 0/1; slots 2..N-1 dead code
4. Free leaks slots 2..N-1

**Status:** Architect rejected H-2 (2026-07-16); fix required before merge.

---

### BUG-2: Prefetch Staging Variables Scope Bug ⚠️ **CRITICAL**
**File:** `ggml/src/ggml-backend.cpp` (~lines 1750-1898)  
**Root Cause:** Variables `split_prefetch_slot`, `prefetch_input_cpy`, `prefetch_saved_buffer`, `prefetch_saved_data` declared inside inner `for (input_id...)` loop but used after loop exits.

**Current code pattern:**
```cpp
for (int input_id = 0; input_id < split->n_inputs; input_id++) {
    // ... inside prefetch block ...
    ggml_tensor * prefetch_input_cpy = input_cpy;  // SHADOW DECLARATION
    // ...
}
// AFTER LOOP — uses uninitialized outer variables (or shadowed ones)
if (split_prefetch_slot != -1) {
    prefetch_input_cpy->buffer = prefetch_saved_buffer;  // UB
}
```

**Architect fixed locally** (moved declarations to `split_id` loop level, removed shadow `ggml_tensor*` redeclarations). Not yet committed.

---

### BUG-3: H-1 Host-Pin — Opt-in Neutrality Not Verified by Tests
**Files:** `src/llama-mmap.cpp/h`, `src/llama-model-loader.cpp`  
**Status:** Ported in 54747fc74, Architect accepted gate check, **but no smoke test run** (blocked on Cline's 2.4-HOTFIX build fix).

**Risk:** `register_host()` called with `reg_fn`/`unreg_fn` resolved from backend registry. If CUDA backend not loaded or symbols missing, `reg_fn=nullptr` → early return 0 (safe). **But**: no test validates bit-identical behavior when `GGML_CUDA_REGISTER_HOST=0` vs unset.

---

## 3. High-Severity Issues

### ISSUE-1: `GGML_TYPE_COUNT` Sparse Array Access
**Location:** `ggml/src/ggml.c` — `ggml_type_traits[GGML_TYPE_COUNT]`  
**Problem:** Fork types at 200-212 make array ~213 elements but only ~120 populated. Upstream code iterating `for (int i = 0; i < GGML_TYPE_COUNT; i++)` will hit zero-initialized entries.

**Audited occurrences (grep):**
- `ggml_type_name()` — switch covers all known types, default returns "unknown" ✓
- `ggml_type_size()` — switch covers all, default 0 ✓
- `ggml_is_quantized()` — checks `type >= GGML_TYPE_Q4_0` ✓ (fork types > 200 pass)
- `ggml_blck_size()` — switch, default 1 ⚠️
- `ggml_row_size()` — uses `ggml_blck_size()` ⚠️
- Quantization dispatch tables — must be regenerated (Phase 2: `generate_cu_files.py`) ✓

**Recommendation:** Add `GGML_TYPE_COUNT` sentinel validation in CI; audit all dense-array walks.

---

### ISSUE-2: KVarN Runtime Validation — Missing Head-Dim Check Coverage
**File:** `src/llama-context.cpp` (H-4 wiring, ~line 8586+)  
**Code path:** `llama_kvarn_validate_runtime()` called with `llama_kvarn_runtime_requirements` struct.

**Struct fields (from `llama-kvarn.h`):**
```cpp
struct llama_kvarn_runtime_requirements {
    bool head_dim_supported;
    bool native_backend_supported;
    bool attention_supported;
    int  min_head_dim;
    int  max_head_dim;
    const char * error_message;
};
```

**Risk:** Donor (beellama) validation checks `head_dim % 128 == 0` for rotated domain, `head_dim % 256 == 0` for non-rotated. Current port (H-4 point 7) copies validation block 1:1 **but** `llama_kvarn_validate_runtime` implementation lives in `src/llama-kvarn.cpp` — must verify it matches donor logic for all 48 KVarN types (K2-K8 × V2-V8).

**Verification needed:** Cross-check `llama_kvarn_head_dim_supported()` and `llama_kvarn_backend_supports_native_ops()` against beellama.cpp donor.

---

### ISSUE-3: Hybrid-ISWA KVarN Param Plumbing — Incomplete
**Files:** `src/llama-memory-hybrid-iswa.cpp/h`, `src/llama-model.cpp`  
**Status:** 81729eb43 passes `params.kvarn` to `llama_memory_hybrid_iswa` constructor, but `llama_memory_hybrid_iswa` constructor signature in header shows `llama_kvarn_params kvarn = llama_kvarn_default_params()` — **default param hides caller's value** if not explicit.

**In `llama-model.cpp:2113-2131`:**
```cpp
res = new llama_memory_hybrid_iswa(
    /* ... */,
    /* kvarn             */ params.kvarn);  // OK — explicit
```

**But** `llama_memory_hybrid` (non-SWA) at line 2133-2152 also passes explicitly — **verified OK**.

**Risk:** Low, but default parameter in header is a footgun for future callers.

---

### ISSUE-4: DSv4 Static Cast → Dynamic Cast Fix (81729eb43) — Incomplete Audit
**File:** `src/llama-kv-cache-dsv4.cpp`  
**Change:** `static_cast<llama_kv_cache*>` → `dynamic_cast<llama_kv_cache*>` + `GGML_ASSERT` at `get_base()`/`get_swa()` call sites.

**Problem:** DSv4 predates KVarN and assumes concrete `llama_kv_cache`. If KVarN ever used with DSv4 architecture (DeepSeek-V4), the `dynamic_cast` will fail at runtime (assert). **No compile-time guard** preventing this config combo.

**Recommendation:** Add `static_assert` or runtime check in `create_memory` for DSv4: `if (params.kvarn.type != LLAMA_KVARN_TYPE_DISABLED) throw`.

---

## 4. Medium-Severity Issues

### ISSUE-5: `llama_kvarn_default_params()` in `llama_context_default_params()`
**File:** `src/llama-context.cpp` (~line 8561)  
**Status:** H-4 point 6 — Architect confirmed line **already present** in base commit 54747fc74 (not in H-4 diff). ✓ Verified.

### ISSUE-6: Missing `dflash_get_base_kv_cache` Equivalent for KVarN
**H-4 point 5:** Architect confirmed no native upstream analogue exists — correctly skipped.  
**Risk:** If native DFlash + KVarN combo ever ported, will need metadata cache resolver. Documented in HERMES.md.

### ISSUE-7: `llama_cuda_fa_missing_pair_message` Cosmetic Skip
**H-4 point 8:** No equivalent function in tree — correctly skipped. Low impact.

### ISSUE-8: CopySpec Investigation (H-3) — Pending
**Scope:** `donors/beellama.cpp/common/suffix-tree.cpp` (+697 lines) + speculative.cpp hunks + CLI flags.  
**Status:** Read-only investigation accepted; no code changes.  
**Risk:** Suffix-tree adds dependency surface; must verify zero DFlash coupling (D-001).

---

## 5. Code Quality & Maintainability

### Strengths
| Pattern | Example |
|---------|---------|
| **Explicit designated initializers** | `llama_memory_params params_mem = { ..., /*.kvarn =*/ cparams.kvarn, }` — prevents struct drift |
| **RAII for mmap pinning** | `llama_mmap` destructor calls `host_unreg_fn` before unmap — correct lifetime |
| **Backend abstraction** | Prefetch uses `ggml_backend_dev_init`, events, async copy — portable across CUDA/Metal/Vulkan |
| **Structured logging** | `LLAMA_LOG_INFO` with MiB sizes, context |
| **Assert-heavy** | `GGML_ASSERT` on dynamic_cast results, buffer bases, slot counts |

### Weaknesses
| Issue | Files |
|-------|-------|
| **C-style callbacks** | `ggml_backend_reg_get_proc_address` for `register_host_buffer` — fragile symbol lookup |
| **Magic env var strings** | `"GGML_CUDA_REGISTER_HOST"`, `"GGML_SCHED_PREFETCH_EXPERTS"` scattered — centralize in header |
| **No unit tests for KV-cache variants** | Tests/ covers basics; no KVarN/TurboQuant round-trip validation |
| **Template explosion** | `fattn-mma-f16.cuh` instances (56/197/324 pairs) — build time, binary size |
| **Dead code from partial ports** | `ggml-backend.cpp` still has XOR rotation, hardcoded `2` in free — cleanup after H-2 fix |

---

## 6. Security Scan (Static)

### Hardcoded Secrets — **None Found**
- Grep for `api_key`, `secret`, `password`, `token` in added lines — clean.

### Dangerous Patterns — **None in Fork Code**
- No `eval()`, `exec()`, `pickle.loads()`, `os.system()`, `subprocess(shell=True)` in C/C++ codebase.
- SQL injection N/A (no SQL).

### Memory Safety
| Pattern | Status |
|---------|--------|
| `malloc`/`free` paired | ✓ `ggml_backend_sched_new`/`free` balanced |
| `calloc` zero-init | ✓ `prefetch_*` arrays zeroed → safe `free(NULL)` |
| `mmap`/`munmap` | ✓ RAII in `llama_mmap::impl` destructor |
| `cudaHostRegister`/`cudaHostUnregister` | ✓ Wrapped in `register_host`/`~llama_mmap` — **but only if `reg_fn` resolved** |
| Buffer overflow | ⚠️ `ggml_nbytes` used for sizes; tensor shape validation upstream |

### Input Validation
- Model loading: `gguf` validation, tensor checksums (async futures) ✓
- Context params: `n_ctx` clamped, `n_seq_max` bounded ✓
- KVarN params: `fail_if_unsupported` gate, head-dim validation in `llama_kvarn_validate_runtime` ✓

---

## 7. Performance & Correctness Risks

### PREFETCH-EXPERTS Path (MoE Offload)
| Metric | Donor (codacus) | Chronos Status |
|--------|-----------------|----------------|
| Speedup (Qwen3.6-35B-A3B, pp2048, RTX 3060) | 1143 → 1880 t/s (+64%) | **Broken** — BUG-1, BUG-2 |
| Opt-in gate | `GGML_SCHED_PREFETCH_EXPERTS=1` | Env var read, but `prefetch_n_slots=0` |
| Slot default | 3 (gate/up/down per layer) | Not initialized |
| Rotation | Round-robin `% n_slots` | XOR 1 (2-slot only) |
| Cleanup | Loop to `MAX_PREFETCH_SLOTS` | Hardcoded `2` |

**Fix Plan (from Architect):**
1. `ggml_backend_sched_new`: init `prefetch_n_slots` from env with default 3, clamp to `GGML_SCHED_MAX_PREFETCH_SLOTS` (8)
2. `compute_splits`: replace `prefetch_cur ^= 1` with `(prefetch_cur + 1) % prefetch_n_slots`
3. `ggml_backend_sched_free`: loop `i < GGML_SCHED_MAX_PREFETCH_SLOTS` (safe on NULL)
4. Verify staging variable scope (Architect already fixed locally)

---

### HOST-PIN Path (MMap Page Pinning)
| Metric | Donor Claim | Chronos Status |
|--------|-------------|----------------|
| DMA H2D throughput | 6-7 → ~20 GB/s | Ported, **untested** |
| Opt-in | `GGML_CUDA_REGISTER_HOST=1` | Implemented |
| Fallback | No-op if backend lacks symbols | Implemented |
| Lifetime | Pin after load, unpin in `~llama_mmap` | Correct RAII |

**Risk:** `register_host` expands range to page boundaries (`sysconf(_SC_PAGESIZE)`). If `mmap_used` range is sub-page, may pin extra pages — harmless but wastes pinned memory quota (RLIMIT_MEMLOCK).

---

### KVarN KV-Cache Compression
| Variant | Bits (K/V) | Group | Status |
|---------|------------|-------|--------|
| `kvarn2` (K2V2) | 2/2 | 128 | Ported |
| `kvarn3` (K3V3) | 3/3 | 128 | Ported |
| `kvarn4` (K4V4) | 4/4 | 128 | Ported |
| ... up to `kvarn8` (K8V8) | 8/8 | 128 | Ported |
| SWA overrides | per-layer | 128 | `swa_key_bits`/`swa_value_bits` in params |

**Validation gap:** No numerical parity test (CPU vs CUDA) for KVarN attention kernels. Phase 5 benchmark pending.

---

## 8. Build & CI

### Current Build Status
- **Clean rebuild reported:** `test-backend-ops 13994/13994 PASS`, `llama-bench pp512=2488 tg64=69` (baseline 2298/61) — **no regression** (commit 54747fc74)
- **CMake:** Multiple presets (`CMakePresets.json`), CUDA/Metal/Vulkan optional
- **Template generation:** `generate_cu_files.py` regenerates 500+ kernel instances — must run after quant type changes

### Missing CI
- No GitHub Actions / GitLab CI visible in repo root
- No sanitizer builds (ASAN/TSAN/MSAN) configured
- No fuzzing harness for GGUF parser or KV-cache

---

## 9. Recommendations (Prioritized)

### P0 — Blockers (Must Fix Before Merge)
1. **Fix H-2 prefetch experts** — apply Architect's 3-point fix (init `prefetch_n_slots`, round-robin rotation, full-slot cleanup) + staging variable scope fix
2. **Run smoke test for H-1** — `GGML_CUDA_REGISTER_HOST=1` with MoE model, verify no segfault, measure H2D throughput
3. **Add KVarN head-dim validation test** — instantiate `llama_kvarn_validate_runtime` for all 48 types with supported/unsupported head dims

### P1 — High Priority
4. **Audit `GGML_TYPE_COUNT` dense loops** — add CI check: compile-test with `-DGGML_TYPE_COUNT=256` and verify no OOB
5. **Centralize env var names** — `ggml-backend.h`: `#define GGML_ENV_CUDA_REGISTER_HOST "GGML_CUDA_REGISTER_HOST"` etc.
6. **DSv4 + KVarN config guard** — in `llama_model::create_memory`, reject `params.kvarn.type != DISABLED` for `LLM_ARCH_DEEPSEEK4`
7. **Remove default `kvarn` param from `llama_memory_hybrid_iswa` constructor** — force explicit pass

### P2 — Medium
8. **Add unit tests** for:
   - `llama_mmap::register_host` round-trip (mock backend)
   - Prefetch slot allocation/free cycle
   - KVarN param serialization in GGUF
9. **Document type ID map** — `docs/chronos-type-map.md` (D-005 table) as source of truth
10. **Clang-tidy / cppcheck** — add to CI; currently only `.clang-tidy` config exists

### P3 — Nice to Have
11. **Benchmark harness** for Phase 5: pin + prefetch + kvarn on RTX 3070 8GB (target hardware)
12. **CopySpec decision** (H-3) — complete investigation, record verdict in D-006
13. **Metal/Vulkan backlog** — track in `PORT_MAP.md` (D-008) for future hardware

---

## 10. File-Level Risk Summary

| File | Risk | Notes |
|------|------|-------|
| `ggml/src/ggml-backend.cpp` | 🔴 **Critical** | BUG-1, BUG-2 — prefetch broken |
| `src/llama-mmap.cpp` | 🟡 Medium | H-1 ported, untested |
| `src/llama-model-loader.cpp` | 🟡 Medium | H-1 integration point |
| `src/llama-context.cpp` | 🟢 Low | H-4 wiring accepted |
| `src/llama-kvarn.cpp` | 🟡 Medium | Runtime validation untested |
| `src/llama-kv-cache-dsv4.cpp` | 🟡 Medium | Dynamic cast + missing config guard |
| `src/llama-memory-hybrid*.cpp` | 🟢 Low | KVarN plumbed, default param footgun |
| `src/llama-model.cpp` | 🟢 Low | Memory factory clean |

---

## 11. Verdict

**Codebase is production-quality for a research fork** — strong architecture, disciplined port process, clear separation of concerns. **Two critical bugs block MoE-offload path** (H-2) but are localized to `ggml-backend.cpp` and have known fixes. H-1 (host-pin) is functionally complete but unvalidated. KVarN wiring (H-4) accepted by Architect.

**Recommendation:** Fix P0 items, run full test suite (including `test-backend-ops`), then merge to `chronos-main`. Defer CopySpec (H-3) and Metal/Vulkan (D-008) to post-merge.

---

*Report generated by automated QA audit — read-only analysis of source tree. No modifications made.*