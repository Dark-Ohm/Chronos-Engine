# Tiered Hot/Cold KV Offload Design

**Target:** 262144 context on RTX 3070 8GB  
**Model reference:** Qwythos (8 attn layers, ~33 total, hybrid SSM+attn)  
**Constraint:** Weights ~5.9GB + desktop 1.3-1.9GB leaves 0.2-0.8GB VRAM; kvarn4@262K ~1.3GB  
**Opportunity:** 64GB DDR4 idle; PCIe 3.0 x16 ~16GB/s  

## 1. Data Structures

### Hot/Cold Buffer Split

Extend `llama_kv_cache_kvarn` (which already has a conceptual hot/cold split -- F16 stage + compressed records) into a *cross-device* hot/cold:

```
VRAM (hot tier, GPU):
  - F16 stage: last N KV_GROUPS groups (128 tokens each) in lossless F16
  - Sized by --kv-hot-groups (default: 256-512 tokens = 2-4 groups)
  - Uses existing KVarN stage tensor infrastructure

RAM (cold tier, host):
  - Compressed KVarN records: all tokens older than the hot window
  - Already in compressed format (kvarnX with Hadamard rotation)
  - Host-pinned (page-locked) for async DMA to GPU
  - Metadata cache (cell positions, seq IDs) stays in VRAM for fast lookup
```

### Metadata Boundary

The hot/cold boundary is a `uint32_t hot_boundary` stored in the existing `llama_kv_cache_kvarn` object. This is the token position dividing hot (>= boundary) from cold (< boundary). On window shift, the boundary advances.

### Window Shift Mechanics

When the hot window is full and a new token group arrives:
1. The oldest hot group(s) are flushed: their F16 stage data is quantized into compressed records (already done by KVarN) AND the compressed record data is written to the host-pinned cold buffer
2. The hot boundary advances
3. The cold buffer grows on the host side

This is a natural extension of KVarN's existing stage-to-records flush; the difference is that the records are now in host RAM rather than GPU VRAM.

## 2. Migration (Hot -> Cold)

### Trigger

When the hot F16 stage exceeds `--kv-hot-groups` groups AND the next token group arrives.

### Batch Size

- Minimum: 1 group (128 tokens) -- aligns with KVarN's KVAR_N_GROUP granularity
- Preferred: 2-4 groups (256-512 tokens) -- amortizes PCIe transaction overhead
- The existing KVarN store path already collapses F16->records; we add a host-side write after the compression

### Format

- **Always kvarn-compressed** (not raw F16). The compressed format is already optimized for the kvarn kernel and is 4-8x smaller than F16, minimizing PCIe bandwidth for migration.
- The existing `kvarn_record_bytes()` + tile layout (`llama_kvarn_tile_layout`) is reused as-is.
- The record data is written as a flat byte array into a pre-allocated host-pinned buffer, using the same layout as the GPU-side `k_records`/`v_records` tensors.

### Migration Path

```
[F16 stage on GPU]
    |
    v
[KVarN quantize: F16 -> compressed record] (existing ggml_kvarn_store path)
    |
    v
[memcpy from GPU record tensor -> host-pinned buffer via async DMA]
    |
    v
[Cold record now only on host; GPU record slot freed]
```

The GPU record slot can be reused after the DMA completes (tracked via CUDA event / `ggml_backend_event`).

## 3. Prefetch (Cold -> Hot)

### What Gets Prefetched

When a new token is decoded and the attention window needs cold tokens:
- The hot window is attended directly (already in VRAM F16 stage)
- Cold tokens are prefetched into a *prefetch pool* on the GPU before attention computation

### Prefetch Strategy

The prefetch is driven by the existing metadata cache (which tracks positions). For each decode step:

1. **Lookahead:** Compute which KVarN record groups will be needed for the upcoming attention. For a causal attention with sliding window, this is deterministic: groups in range `[max(0, pos - window), pos - hot_groups * 128)`.

2. **Prefetch buffer:** A dedicated GPU-side ring buffer (`--kv-prefetch-groups`, default 2-4 groups) receives cold records from host via async DMA.

3. **Stream management:** Use a dedicated CUDA stream (the same mechanism as `ggml_backend_sched_prefetch_init` in `ggml-backend.cpp` for MoE expert prefetch). The prefetch backend is initialized once per device.

4. **Overlap:** The async DMA runs on the prefetch stream while the main compute stream processes the current decode step. Events synchronize the streams: `prefetch_ready` signals the main stream, `prefetch_free` signals the prefetch stream that the slot is available.

### Reusing Codacus Expert Prefetch Infrastructure

The MoE expert prefetch in `ggml-backend.cpp` (commit 81729eb43) provides:

| Component | Reuse for KV |
|-----------|-------------|
| `prefetch_backend` (separate CUDA device/stream) | Direct reuse |
| `prefetch_slots[]` (ring buffer of device buffers) | Direct reuse (rename semantically) |
| `prefetch_ready[]` / `prefetch_free[]` events | Direct reuse |
| `ggml_backend_tensor_set_async` | Direct reuse |
| `ggml_backend_event_record` / `ggml_backend_event_wait` | Direct reuse |

The KV variant differs in *what* is copied: instead of MoE weight slices, we copy full KVarN record tensors (one per group, fixed-size). The slot management logic is identical.

### Prefetch vs Compute Overlap

For decode (single token):
- Total cold KV size at 262K: ~1.3GB (kvarn4)
- Per-decode-step bandwidth: reading a single attention head's worth of K/V from one group
- With PCIe 3.0 x16 (16GB/s), reading a full group (128 tokens worth of K/V for all heads) takes ~0.1ms for kvarn4
- This fits comfortably within a decode step (~10-50ms), and the overlap means the cost is hidden

## 4. Attend Over Cold Part

### Problem

Full attention over 262K tokens every decode step would require reading 1.3GB per token from host RAM over PCIe 3.0 -- ~80ms per step, unacceptable.

### Strategy: Hot-Only Attend + Periodic Cold Flush

**Phase 1 (recommended): Attend only hot window**
- Attention attends only the hot window (default 256-512 tokens)
- The cold tier serves as a "context buffer" -- it's preserved but NOT attended every step
- Quality impact: on long contexts, the model loses access to early tokens
- Trade-off: for many workloads (chat, summarization of recent context), this is acceptable
- CLI flag: `--kv-attend-mode hot` (default)

**Phase 2 (planned): Heavy Hitter (H2O) persistent tokens**
- Identify heavy-hitter tokens during prefill using attention scores
- Keep the top-K heavy hitters (e.g., 2048 tokens) in VRAM alongside the hot window
- These tokens are attended every step
- Heavy hitter selection is done once during prefill, refreshed periodically during decode

**Phase 3 (stretch): Periodic full attention**
- Every N steps (e.g., every 128 decode steps), run a full attention pass over all 262K tokens
- This is expensive (~1.3GB read over PCIe = ~80ms) but amortized over 128 steps adds only ~0.6ms/step
- The full attend uses the same kvarn flash-attention kernel; cold records are streamed group-by-group through the prefetch mechanism

### Quality Trade-offs

| Strategy | Quality | VRAM | Bandwidth | Complexity |
|----------|---------|------|-----------|------------|
| Hot-only (Phase 1) | Degrades on long context | Minimal | Negligible | Low |
| Hot + H2O (Phase 2) | Near-full retention | +H2O buffer | Low | Medium |
| Hot + periodic full (Phase 3) | Full retention | Same as Phase 2 | ~0.6ms/step avg | High |
| Full-attend every step | Best | Max | ~80ms/step | N/A (infeasible) |

## 5. Compatibility with KVarN Kernels

### Flash Attention Groups of 128

KVarN operates on groups of 128 tokens (`KVAR_N_GROUP = 128`). The hot/cold boundary must be aligned to 128-token boundaries. The prefetch also fetches full groups, which maps naturally to the existing `ggml_kvarn_view` kernel that reads from `k_records` + `k_stage`.

The tile layout (`llama_kvarn_tile_layout`) is unchanged -- the only difference is which device's memory the record pointer points to.

### seq_rm=FULL Classification

KVarN currently requires `seq_rm=FULL` (only full sequence removal, not ranges). This is because compressed records do not support fine-grained eviction. With cold offload:

- **Hot tier:** Same constraints as current KVarN -- range removal only within the F16 stage groups
- **Cold tier:** Host records are organized by group (128 tokens). Range removal on cold records requires marking groups as invalid at the boundary; the metadata cache (always in VRAM) tracks which cold groups are live
- The metadata cache (`llama_kv_cache` in VRAM) continues to handle seq_rm; the cold host buffers are shadow copies and the metadata tells the prefetch which groups to skip

For Phase 1, cold range removal is simply not supported -- only full sequence eviction (via seq_rm on the metadata cache, which invalidates the cold groups without modifying host buffers).

## 6. CLI

```
--kv-hot-size N        Size of hot window in tokens (default: 512). Must be multiple of 128.
--kv-cold-offload      Enable cold-tier RAM offload (default: true when hot window < context)
--kv-prefetch-groups N Number of prefetch groups (default: 2). Must be >= 1.
--kv-attend-mode MODE  Attention strategy: hot (default), h2o, periodic
--kv-h2o-k N           Number of heavy-hitter tokens to retain (default: 2048, used with --kv-attend-mode h2o)
--kv-periodic-attend N Run full-attention every N decode steps (default: 0=disabled)
```

These slot into the existing `llama_context_params` struct alongside `offload_kqv`.

## 7. Phased Implementation Plan

### Phase 1: Host-Pinned Cold Buffer + Hot-Only Attend (estimated: 1-2 weeks)

**Scope:**
- `src/llama-kv-cache-kvarn.h/.cpp`: Add `host_cold_k_records` / `host_cold_v_records` (host-pinned buffers), `hot_boundary` field
- `src/llama-kv-cache-kvarn.cpp`: Modify store() to write compressed records to host buffer when hot stage is full
- `src/llama-kvarn.h/.cpp`: Add `kvarn_offload_copy_to_host` helper
- `src/llama-model.cpp` / `src/llama-context.cpp`: Wire `--kv-hot-size` flag through params
- `ggml/src/ggml-backend.cpp`: Reuse expert prefetch infrastructure for KV prefetch (rename/parameterize)

**Files touched:** `llama-kv-cache-kvarn.h/.cpp`, `llama-kvarn.h/.cpp`, `llama-context.cpp`, `llama-model.cpp`, `ggml-backend.cpp`, `llama.h` (params)

**Verification:**
- Memory: VRAM KV stays within budget (0.2-0.8GB) at 262K context
- Correctness: perplexity match between hot-only and full-attention at moderate context (32K)
- Performance: decode speed within 20% of no-offload baseline

### Phase 2: Prefetch Overlap + H2O Heavy Hitters (estimated: 2-3 weeks)

**Scope:**
- `src/llama-kv-cache-kvarn.cpp`: Async prefetch of cold groups to GPU prefetch slots before attention
- `llama-kv-cache-kvarn.cpp`: Modify view() to source from prefetch slot when cold group is prefetched
- `src/llama-graph.cpp`: Add H2O attention score tracking during prefill
- New file (or extend): heavy-hitter selection and retention logic

**Files touched:** `llama-kv-cache-kvarn.h/.cpp`, `llama-graph.cpp`, `llama-context.cpp`

**Verification:**
- Overlap: DMA and compute overlap verified via CUDA events (prefetch completes before view() needs the data)
- Quality: perplexity within 1% of full-attention at 262K with H2O retention
- Bandwidth: PCIe utilization measured

### Phase 3: Periodic Full Attend (estimated: 2-4 weeks)

**Scope:**
- `src/llama-kv-cache-kvarn.cpp`: Streaming full-attention that reads cold groups through prefetch pipeline
- `src/llama-kv-cache-kvarn.cpp`: Async group-by-group streaming from host during attention computation
- Integration with the existing kvarn flash-attention kernel path

**Files touched:** `llama-kv-cache-kvarn.h/.cpp`, `llama-graph.cpp`

**Verification:**
- Quality: perplexity matches full-attention baseline (no offload) at 262K
- Performance: periodic full-attend adds <5% to total decode time

## 8. Risks and Open Questions

### Risks

1. **PCIe bandwidth contention:** The GPU is shared with the compositor/desktop. Under heavy desktop load, PCIe bandwidth for KV prefetch may be reduced. Mitigation: throttle prefetch based on measured bandwidth; fall back to smaller hot window.

2. **Host-pinned memory pressure:** 64GB DDR4 is abundant, but host-pinned (page-locked) memory cannot be swapped. At 262K kvarn4 cold storage ~1.3GB, this is acceptable (2% of 64GB). Mitigation: use staging buffers (pin only active prefetch regions, not the entire cold store).

3. **KVarN format stability:** If the KVarN compression format changes (new quantization scheme), the host cold store must be invalidated or converted. Mitigation: version the cold buffer format using the existing state versioning mechanism.

4. **Window shift with cold data:** When the hot window advances, cold data must be evicted from host. For simple FIFO, the oldest cold groups can be dropped. Mitigation: ring buffer on the cold side with configurable max cold size.

### Open Questions

1. **Should cold records stay compressed (kvarnX) or be stored as fp16?** Compressed is preferred (smaller PCIe transfers), but requires the GPU-side dequant path to work from host-provided data. The current kvarn view kernel assumes records are in GPU memory. Answer: store compressed on host, need to verify that the kernel can read from a prefetch slot (pinned host memory mapped into GPU address space via CUDA unified addressing).

2. **How does the hot boundary interact with SWA (sliding window attention)?** For SWA models, the entire window fits in VRAM (e.g., 32K tokens), so cold offload is rarely triggered. The hot window size should be at least the SWA window size.

3. **Can we use the CUDA unified memory (`cudaMallocManaged`) instead of explicit host/GPU buffers?** Unified memory would simplify programming but adds page fault overhead on GPU access. For streaming KV data, explicit async DMA is more predictable.

4. **Should cold data be compressed further (e.g., kvarn2 instead of kvarn4)?** For cold data that is rarely accessed, a higher compression ratio could save host RAM and PCIe bandwidth at the cost of dequant quality. Investigate: use `--kv-cold-type` separate from `--kvarn-type`.

5. **Does the attend-over-cold strategy need to handle the full 262K tokens in the Qwythos architecture where only 8/33 layers have KV?** Yes, but the memory savings from 8 layers (vs 33) means the cold buffer is proportionally smaller. The hot window can also be proportionally larger.
