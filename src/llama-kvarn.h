#pragma once

#include "llama.h"

#include "ggml-backend.h"

#include <cstddef>
#include <cstdint>

struct llama_kvarn_type_desc {
    llama_kvarn_type type;
    const char * name;
    int key_bits;
    int value_bits;
    int group;
};

struct llama_kvarn_tile_layout {
    size_t k_payload_off;
    size_t v_payload_off;
    size_t k_s_col_off;
    size_t k_zp_off;
    size_t k_s_row_off;
    size_t v_s_col_off;
    size_t v_s_row_off;
    size_t v_zp_off;

    size_t k_payload_bytes;
    size_t v_payload_bytes;
    size_t tile_bytes;
};

struct llama_kvarn_runtime_requirements {
    bool attention_supported;
    bool head_dims_supported;
    bool kv_offload;
    bool native_backend_supported;
    uint32_t n_seq_max;
    bool kv_unified;
};

size_t llama_kvarn_type_count();

const llama_kvarn_type_desc * llama_kvarn_type_desc_from_name(const char * name);
const llama_kvarn_type_desc * llama_kvarn_type_desc_from_type(llama_kvarn_type type);

llama_kvarn_tile_layout llama_kvarn_make_layout(int head_dim, int group, int key_bits, int value_bits);

int  llama_kvarn_head_slices(int head_dim);
bool llama_kvarn_head_dim_supported(int head_dim);

size_t  llama_kvarn_packed_bytes(int n_values, int bits);
void    llama_kvarn_pack_bits(const uint8_t * values, int n_values, int bits, uint8_t * dst);
uint8_t llama_kvarn_unpack_bits_value(const uint8_t * src, int index, int bits);

const char * llama_kvarn_validate_runtime(
        const llama_kvarn_params & params,
        const llama_kvarn_runtime_requirements & requirements);

bool llama_kvarn_can_remove_range(llama_pos pos_max, llama_pos p0, llama_pos p1, uint32_t group);

void llama_kvarn_hadamard_128(float * values);

void llama_kvarn_quantize_k_tile(
        const float * tile,
        int sinkhorn_iters,
        int bits,
        const llama_kvarn_tile_layout & layout,
        uint8_t * record);

void llama_kvarn_quantize_v_tile(
        const float * tile,
        int sinkhorn_iters,
        int bits,
        const llama_kvarn_tile_layout & layout,
        uint8_t * record);

void llama_kvarn_dequantize_k_tile(
        const uint8_t * record,
        int bits,
        const llama_kvarn_tile_layout & layout,
        float * tile);

void llama_kvarn_dequantize_v_tile(
        const uint8_t * record,
        int bits,
        const llama_kvarn_tile_layout & layout,
        float * tile);

// Phase 1 tiered hot/cold KV offload (docs/design/tiered-kv-offload.md).
// Copies one KVarN-compressed record group from a GPU-resident tensor `src`
// (at byte offset `src_offset`) into a host destination pointer `dst_host`.
//
// When `backend` is non-null, the copy is issued asynchronously on that
// backend's stream via ggml_backend_tensor_get_async, and `event` (if
// non-null) is recorded immediately after so a caller can defer waiting on
// it (this is the shape Phase 2/3 prefetch pipelines need, modeled on the
// codacus expert-prefetch pattern in ggml-backend.cpp). The caller is then
// responsible for waiting on `event` (or synchronizing `backend`) before
// touching `dst_host`.
//
// When `backend` is null, the copy runs fully blocking via
// ggml_backend_tensor_get and `event` is ignored. This is the path Phase 1
// actually uses: callers that only have tensor handles (no owned backend
// instance) get a correct, safe copy without needing to stand up a backend.
void llama_kvarn_offload_copy_to_host(
        ggml_backend_t backend,
        ggml_backend_event_t event,
        const ggml_tensor * src,
        size_t src_offset,
        void * dst_host,
        size_t size);
