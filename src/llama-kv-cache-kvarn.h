#pragma once

#include "llama-kv-cache.h"
#include "llama-kvarn.h"

#include <memory>
#include <unordered_map>
#include <vector>

struct llama_hparams;
struct llama_model;

bool llama_kvarn_backend_supports_native_ops(ggml_backend_dev_t dev);

class llama_kv_cache_kvarn;

class llama_kv_cache_kvarn_context : public llama_kv_cache_context {
public:
    llama_kv_cache_kvarn_context(
            llama_kv_cache_kvarn * cache,
            llama_memory_context_ptr base,
            llama_context * update_lctx = nullptr);

    bool next() override;
    bool apply() override;

    llama_memory_status get_status() const;
    const llama_ubatch & get_ubatch() const;

    uint32_t get_n_kv() const;
    llama_kv_cache * get_kv() const;
    const llama_kv_cache::slot_info & current_sinfo() const;

    ggml_type type_k() const;
    ggml_type type_v() const;

    ggml_tensor * get_k(ggml_context * ctx, int32_t il) const;
    ggml_tensor * get_v(ggml_context * ctx, int32_t il) const;
    ggml_tensor * get_k_native(ggml_context * ctx, int32_t il) const;
    ggml_tensor * get_v_native(ggml_context * ctx, int32_t il) const;

    // SWA sliding-window ring: per-cell absolute positions for native KVarN views.
    // Built as a graph input sized [n_kv]; set on the host from cells.pos_get(cell).
    ggml_tensor * build_input_kvarn_rot(ggml_context * ctx, int n_rot) const;
    void set_input_kvarn_rot(ggml_tensor * dst) const;
    ggml_tensor * build_input_kvarn_mat_idxs(ggml_context * ctx) const;
    void set_input_kvarn_mat_idxs(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_mat_idxs(ggml_tensor * idxs) const { mat_idxs = idxs; }

    // True when the underlying KVarN cache is in SWA (sliding-window) mode,
    // i.e. native views need per-cell absolute positions (mat_idxs).
    bool is_swa() const;

    ggml_tensor * get_turbo_rotation() const;
    ggml_tensor * get_turbo_rotation_inv() const;
    ggml_tensor * get_turbo_rot_forward() const;
    ggml_tensor * get_turbo_rot_inverse() const;

    ggml_tensor * cpy_k(ggml_context * ctx, ggml_tensor * k_cur, ggml_tensor * k_idxs, int32_t il) const;
    ggml_tensor * cpy_v(ggml_context * ctx, ggml_tensor * v_cur, ggml_tensor * v_idxs, int32_t il) const;

    ggml_tensor * build_input_k_idxs(ggml_context * ctx, const llama_ubatch & ubatch) const;
    ggml_tensor * build_input_v_idxs(ggml_context * ctx, const llama_ubatch & ubatch) const;
    ggml_tensor * build_input_k_rot(ggml_context * ctx) const;
    ggml_tensor * build_input_v_rot(ggml_context * ctx) const;

    void set_input_k_idxs(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_input_v_idxs(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_input_k_idxs_backend(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_input_v_idxs_backend(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_input_k_shift(ggml_tensor * dst) const;
    void set_input_kq_mask(ggml_tensor * dst, const llama_ubatch * ubatch, bool causal_attn) const;
    void set_input_pos_bucket(ggml_tensor * dst, const llama_ubatch * ubatch) const;
    void set_input_k_rot(ggml_tensor * dst) const;
    void set_input_v_rot(ggml_tensor * dst) const;
    void set_input_k_rot_backend(ggml_tensor * dst) const;
    void set_input_v_rot_backend(ggml_tensor * dst) const;

private:
    llama_kv_cache_context * base() const;

    llama_kv_cache_kvarn * cache;
    llama_memory_context_ptr base_ctx;
    llama_context * update_lctx;

    mutable std::unordered_map<int32_t, ggml_tensor *> stored_k;
    mutable std::unordered_map<int32_t, ggml_tensor *> stored_v;
    mutable ggml_tensor * mat_idxs = nullptr; // SWA per-cell absolute positions for native KVarN views
};

class llama_kv_cache_kvarn : public llama_memory_i {
public:
    llama_kv_cache_kvarn(
            const llama_model & model,
            const llama_hparams & hparams,
            llama_kvarn_params params,
            bool offload,
            bool unified,
            uint32_t kv_size,
            uint32_t n_seq_max,
            uint32_t n_batch,
            uint32_t n_ubatch,
            uint32_t n_pad = 1,
            uint32_t n_swa = 0,
            llama_swa_type swa_type = LLAMA_SWA_TYPE_NONE,
            // Phase 1 tiered hot/cold KV offload (docs/design/tiered-kv-offload.md,
            // --kv-hot-size). 0 = disabled, behavior identical to before Phase 1.
            uint32_t kv_hot_size = 0,
            // Phase 2 H2O heavy-hitter pins (docs/design/h2o-heavy-hitters-PHASE2-SPEC.md,
            // --kv-h2o-groups). Units are GROUPS (group = 128 tokens), not tokens.
            // 0 = disabled. The value is clamped to a fraction of the record ring's
            // per-stream capacity at construction (see the .cpp ctor); the pin
            // mechanism itself is Phase 2 (T003c) -- this cache only stores the
            // count and allocates the per-layer flag/score buffers.
            uint32_t kv_h2o_groups = 0,
            const layer_filter_cb & filter = nullptr,
            const layer_reuse_cb & reuse = nullptr);

    llama_memory_context_ptr init_batch(
            llama_batch_allocr & balloc,
            uint32_t n_ubatch,
            bool embd_all) override;
    llama_memory_context_ptr init_full() override;
    llama_memory_context_ptr init_update(llama_context * lctx, bool optimize) override;

    uint32_t get_kv_n_stream() const;
    uint32_t get_kv_size() const;
    llama_memory_context_ptr init_kv_batch(const std::vector<llama_ubatch> & ubatches) override;

    bool get_can_shift() const override;

    void clear(bool data) override;
    bool can_seq_rm(llama_seq_id seq_id, llama_pos p0, llama_pos p1) const;
    bool seq_rm(llama_seq_id seq_id, llama_pos p0, llama_pos p1) override;
    bool seq_rm_cell(llama_seq_id seq_id, uint32_t cell_idx);
    int cells_at_pos(llama_seq_id seq_id, llama_pos pos, uint32_t * cell_indices, int n_max);
    void seq_cp(llama_seq_id seq_id_src, llama_seq_id seq_id_dst, llama_pos p0, llama_pos p1) override;
    void seq_keep(llama_seq_id seq_id) override;
    GGML_NORETURN void seq_add(llama_seq_id seq_id, llama_pos p0, llama_pos p1, llama_pos shift) override;
    GGML_NORETURN void seq_div(llama_seq_id seq_id, llama_pos p0, llama_pos p1, int d) override;
    llama_pos seq_pos_min(llama_seq_id seq_id) const override;
    llama_pos seq_pos_max(llama_seq_id seq_id) const override;

    std::map<ggml_backend_buffer_type_t, size_t> memory_breakdown() const override;

    void state_write(llama_io_write_i & io, llama_seq_id seq_id = -1, llama_state_seq_flags flags = 0) const override;
    void state_read(llama_io_read_i & io, llama_seq_id seq_id = -1, llama_state_seq_flags flags = 0) override;

    llama_kv_cache * get_metadata_cache() const;
    int32_t mapped_layer_id(int32_t il) const;
    bool has_pending_stream_copies() const;
    bool apply_pending_stream_copies(llama_context * lctx);
    bool is_swa() const { return swa; }

    // Phase 1 tiered hot/cold KV offload (docs/design/tiered-kv-offload.md).
    // has_cold_offload() is true only when --kv-hot-size was set for this
    // cache; every other new code path below is inert when it is false.
    bool has_cold_offload() const { return cold_offload; }
    bool has_pending_cold_offloads() const;
    bool apply_pending_cold_offloads(llama_context * lctx);

    // Phase 2 H2O heavy-hitter pins (docs/design/h2o-heavy-hitters-PHASE2-SPEC.md).
    // has_h2o() is true only when --kv-h2o-groups resolved to a nonzero count
    // (after clamping against the record ring capacity). The per-layer flag and
    // score buffers exist only while it is true; no other code path here is
    // affected when it is false.
    bool has_h2o() const { return h2o_enabled; }
    uint32_t get_h2o_groups() const { return h2o_groups; }

    // Dynamic staging: the lossless F16 ring is position-oriented, not sized to
    // the full scheduler batch/window.
    //   non-SWA tail_groups = 4 + long_ctx_min + ceil(n_ubatch / KVAR_N_GROUP)
    //   SWA tail_groups     = KVAR_N_SWA_TAIL_GROUPS
    //   stage_groups        = tail_groups + 1 for non-SWA, tail_groups for SWA
    // The +1 is only the permanent sink slot for non-SWA. SWA has no sink slot,
    // so all F16 stage groups are live local tail groups. Its record ring also
    // carries the active ubatch span because early query rows can still attend
    // older window groups after later rows have flushed newer groups into the
    // ring. KVarN cache state is versioned to carry stage_groups/tail_groups so
    // restore can validate the saved layout against the current cache. The W2
    // gate rejects any layout mismatch; remap for differing save/restore ubatch
    // is future.
    uint32_t get_stage_groups() const { return stage_groups; }
    uint32_t get_tail_groups()  const { return tail_groups; }

    ggml_tensor * store(
            ggml_context * ctx,
            ggml_tensor * current,
            ggml_tensor * indices,
            int32_t il,
            const llama_kv_cache::slot_info & sinfo,
            bool value) const;
    ggml_tensor * view(
            ggml_context * ctx,
            ggml_tensor * stored,
            int32_t il,
            uint32_t n_kv,
            const llama_kv_cache::slot_info & sinfo,
            bool value,
            ggml_tensor * mat_idxs = nullptr) const;

private:
    struct layer {
        uint32_t il;
        uint32_t n_head_kv;
        uint32_t head_dim_k;
        uint32_t head_dim_v;
        uint32_t k_slices;
        uint32_t v_slices;
        ggml_tensor * k_records;
        ggml_tensor * v_records;
        ggml_tensor * k_stage;
        ggml_tensor * v_stage;
        std::vector<ggml_tensor *> k_records_stream;
        std::vector<ggml_tensor *> v_records_stream;
        std::vector<ggml_tensor *> k_stage_stream;
        std::vector<ggml_tensor *> v_stage_stream;
        // Phase 1 cold tier: host-pinned mirror of k_records/v_records, sized
        // for every group the hot ring will ever evict. Null when cold
        // offload is disabled (has_cold_offload() == false).
        ggml_tensor * host_cold_k_records = nullptr;
        ggml_tensor * host_cold_v_records = nullptr;
        std::vector<ggml_tensor *> host_cold_k_records_stream;
        std::vector<ggml_tensor *> host_cold_v_records_stream;
        // Phase 2 H2O heavy-hitter pins (docs/design/h2o-heavy-hitters-PHASE2-SPEC.md).
        // Per-layer, matching the class convention of per-layer storage
        // (k_records/v_records/... live here). Both are empty unless
        // has_h2o() == true.
        //   h2o_group_flags:  packed pin bits, word g bit = group g, size
        //                     ceil(max_groups / 32); only groups the layer
        //                     actually selected are set (written by T003c).
        //   h2o_group_scores: accumulated attention mass, flat [n_head_kv]
        //                     [max_groups] (the SPEC's [n_kv_heads][max_groups]
        //                     [n_layers] contract with the layer dimension
        //                     carried by the layers vector), zero-initialized.
        std::vector<uint32_t> h2o_group_flags;
        std::vector<float>    h2o_group_scores;
    };

    const layer & layer_for(int32_t il) const;
    bool can_remove(llama_seq_id seq_id, llama_pos p0, llama_pos p1) const;
    void copy_kvarn_stream(uint32_t stream_src, uint32_t stream_dst);

    const llama_hparams & hparams;
    const llama_kvarn_params params;
    const uint32_t n_stream;
    // Declaration order matters: stage_groups depends on tail_groups, so
    // tail_groups must be declared first (C++ initializes members in order).
    const uint32_t tail_groups;   // non-SWA bounded current-ubatch tail; SWA fixed local tail
    const uint32_t stage_groups;   // F16 stage depth (non-SWA sink + tail; SWA tail only)
    const bool swa;
    const uint32_t n_groups_per_stream;

    // Phase 1 tiered hot/cold KV offload (docs/design/tiered-kv-offload.md).
    // kv_hot_size is the raw --kv-hot-size value in tokens (0 = disabled);
    // cold_offload is the derived gate every new code path checks first.
    // cold_groups_per_stream is the host cold ring's per-stream capacity in
    // groups, sized once at construction for the worst case (every group the
    // hot ring will ever evict up to kv_size), so it never needs to grow.
    const uint32_t kv_hot_size;
    const bool cold_offload;
    const uint32_t cold_groups_per_stream;

    // Phase 2 H2O heavy-hitter pins (docs/design/h2o-heavy-hitters-PHASE2-SPEC.md).
    // h2o_groups is the effective pin count after clamping the requested
    // --kv-h2o-groups to a fraction of n_groups_per_stream at construction
    // (0 = disabled); h2o_enabled is the derived gate, mirroring cold_offload.
    const uint32_t h2o_groups;
    const bool h2o_enabled;

    // The llama_context this cache updates through. Set by init_update() (which
    // the decode path calls before init_batch/init_kv_batch). The decode-loop
    // memory contexts are built without an lctx argument, so without this the
    // per-ubatch apply() would skip the pending cold-offload drain and a single
    // llama_decode spanning more groups than the record ring could wrap ring
    // slots before the next llama_decode's memory_update() drains them (silent
    // cold-copy corruption; see enqueue_cold_offloads).
    llama_context * update_lctx = nullptr;

    std::unique_ptr<llama_kv_cache> metadata;
    std::vector<layer> layers;
    std::unordered_map<int32_t, int32_t> map_layer_ids;
    std::vector<std::pair<ggml_context_ptr, ggml_backend_buffer_ptr>> ctxs_bufs;
    llama_kv_cache::stream_copy_info pending_stream_copies;

    // Phase 1 cold-offload bookkeeping (all mutable: store() is logically
    // const -- it only builds graph nodes -- but still has to track how many
    // tokens/groups it has seen so far to know when a group has aged out of
    // the hot ring and needs to be write-through-copied to the host cold
    // buffer). See enqueue_cold_offloads()/offload_group_to_host() in the
    // .cpp for the exact trigger and safety argument.
    struct cold_offload_job {
        uint32_t stream;
        uint64_t abs_group;
    };
    mutable std::vector<uint64_t> cold_tokens_seen;       // per stream, raw token count fed to store()
    mutable std::vector<uint64_t> cold_groups_committed;  // per stream, groups already queued for offload
    mutable std::vector<cold_offload_job> pending_cold_offloads;

    void enqueue_cold_offloads(const llama_kv_cache::slot_info & sinfo) const;
    void offload_group_to_host(uint32_t stream, uint64_t abs_group);
};
