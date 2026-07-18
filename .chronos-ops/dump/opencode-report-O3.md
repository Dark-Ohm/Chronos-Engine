# OpenCode Report

## O-3

### Diffstat
```
27	7	src/llama-kv-cache-dsv4.cpp
```

### static_cast count after
```
0
```

### Bracket balance (excluding comments)
```
Parens balance: 0
Braces balance: 0
```

### Changed blocks after edit

#### Function: llama_kv_cache_dsv4::init_batch (lines 1058-1090)
```cpp
llama_memory_context_ptr llama_kv_cache_dsv4::init_batch(
            llama_batch_allocr & balloc,
            uint32_t n_ubatch,
            bool embd_all) {
    GGML_UNUSED(embd_all);

    auto * base = dynamic_cast<llama_kv_cache *>(kv_raw->get_base());
    GGML_ASSERT(base != nullptr && "DSv4 raw kv_raw is expected to never be kvarn-backed");
    const bool raw_per_seq  = base->get_n_stream() != 1;
    const bool comp_per_seq = csa_state->get_n_stream() > 1;
    const bool has_coupled = dsv4_batch_has_coupled(balloc.get_batch());

    const auto make_context = [&](std::vector<llama_ubatch> ubatches) -> llama_memory_context_ptr {
        auto ubatches_raw = dsv4_build_raw_write_ubatches(ubatches);

        auto sinfos_raw_base_write = base->prepare(ubatches_raw);
        if (sinfos_raw_base_write.empty()) {
            return nullptr;
        }

        auto * swa = dynamic_cast<llama_kv_cache *>(kv_raw->get_swa());
        GGML_ASSERT(swa != nullptr && "DSv4 raw kv_raw is expected to never be kvarn-backed");
        auto sinfos_raw_swa_write = swa->prepare(ubatches_raw);
        if (sinfos_raw_swa_write.empty()) {
            return nullptr;
        }

        auto sinfos_raw_swa_read = dsv4_build_raw_read_sinfos(sinfos_raw_swa_write, ubatches);

        return std::make_unique<llama_kv_cache_dsv4_context>(
                this,
                std::move(sinfos_raw_base_write),
                std::move(sinfos_raw_swa_write),
                std::move(sinfos_raw_swa_read),
                std::move(ubatches),
                std::move(ubatches_raw));
    };

    // Match llama_kv_cache_iswa splitting when DSV4 compressed state does not
    // require per-sequence graph layout.
    do {
        if (raw_per_seq || comp_per_seq) {
            break;
        }

        balloc.split_reset();

        std::vector<llama_ubatch> ubatches;
        while (true) {
            auto ubatch = balloc.split_simple(n_ubatch);
            if (ubatch.n_tokens == 0) {
                break;
            }
            ubatches.push_back(std::move(ubatch)); // NOLINT
        }

        if (balloc.get_n_used() < balloc.get_n_tokens()) {
            break;
        }

        if (auto ctx = make_context(std::move(ubatches))) {
            return ctx;
        }
    } while (false);
```

#### Constructor 1: llama_kv_cache_dsv4_raw_context(llama_kv_cache_iswa * kv)
```cpp
llama_kv_cache_dsv4_raw_context::llama_kv_cache_dsv4_raw_context(llama_kv_cache_iswa * kv) :
    kv_swa([&]() {
        llama_kv_cache * s = dynamic_cast<llama_kv_cache *>(kv->get_swa());
        GGML_ASSERT(s != nullptr && "DSv4 iswa SWA is expected to never be kvarn-backed");
        return s;
    }()),
    ctx_base_mem(nullptr),
    ctx_swa_mem(nullptr),
    n_kv(kv_swa->get_size()),
    status(LLAMA_MEMORY_STATUS_SUCCESS) {
    sinfos_read.push_back(dsv4_build_full_sinfo(kv_swa));
    sinfos_write = sinfos_read;
}
```

#### Constructor 2: llama_kv_cache_dsv4_raw_context(llama_kv_cache_iswa * kv, llama_context * lctx, bool optimize)
```cpp
llama_kv_cache_dsv4_raw_context::llama_kv_cache_dsv4_raw_context(
        llama_kv_cache_iswa * kv,
        llama_context * lctx,
        bool optimize) :
    kv_swa([&]() {
        llama_kv_cache * s = dynamic_cast<llama_kv_cache *>(kv->get_swa());
        GGML_ASSERT(s != nullptr && "DSv4 iswa SWA is expected to never be kvarn-backed");
        return s;
    }()),
    ctx_base_mem(kv->get_base()->init_update(lctx, optimize)),
    ctx_swa_mem(kv->get_swa()->init_update(lctx, optimize)),
    n_kv(kv_swa->get_size()),
    status(llama_memory_status_combine(ctx_base_mem->get_status(), ctx_swa_mem->get_status())) {
}
```

#### Constructor 3: llama_kv_cache_dsv4_raw_context(llama_kv_cache_iswa * kv, slot_info_vec_t sinfos_base_write, slot_info_vec_t sinfos_swa_write, slot_info_vec_t sinfos_swa_read, std::vector<llama_ubatch> ubatches, std::vector<llama_ubatch> ubatches_write)
```cpp
llama_kv_cache_dsv4_raw_context::llama_kv_cache_dsv4_raw_context(
        llama_kv_cache_iswa * kv,
        slot_info_vec_t sinfos_base_write,
        slot_info_vec_t sinfos_swa_write,
        slot_info_vec_t sinfos_swa_read,
        std::vector<llama_ubatch> ubatches,
        std::vector<llama_ubatch> ubatches_write) :
    kv_swa([&]() {
        llama_kv_cache * s = dynamic_cast<llama_kv_cache *>(kv->get_swa());
        GGML_ASSERT(s != nullptr && "DSv4 iswa SWA is expected to never be kvarn-backed");
        return s;
    }()),
    sinfos_write(std::move(sinfos_swa_write)),
    sinfos_read(std::move(sinfos_swa_read)),
    ubatches(std::move(ubatches)),
    ubatches_write(std::move(ubatches_write)),
    ctx_base_mem(std::make_unique<llama_kv_cache_context>(
                [&]() {
                    llama_kv_cache * b = dynamic_cast<llama_kv_cache *>(kv->get_base());
                    GGML_ASSERT(b != nullptr && "DSv4 iswa base is expected to never be kvarn-backed");
                    return b;
                }(), std::move(sinfos_base_write), this->ubatches_write)),
    ctx_swa_mem(nullptr),
    n_kv(kv_swa->get_size()),
    status(LLAMA_MEMORY_STATUS_SUCCESS) {
}
```

## O-4

### Status
BLOCKED: GGML_TYPE_Q2_0 is present in ggml.h but absent from CUDA SET_ROWS support list.

### Diffstat
```
0	0	common/arg.cpp
```

### Verification table

| Type | ggml.h line | ggml-cuda.cu SET_ROWS |
|------|-------------|------------------------|
| GGML_TYPE_Q2_0 | 432 | NOT FOUND |
| GGML_TYPE_Q3_0 | 444 | 4764 |
| GGML_TYPE_Q4_0 | 392 | 4779 |
| GGML_TYPE_Q5_0 | 396 | 4779 |
| GGML_TYPE_Q6_0 | 446 | 4784 |
| GGML_TYPE_Q8_0 | 400 | 4780 |

### Bracket balance (excluding comments) - common/arg.cpp
```
Parens balance: 6
Braces balance: 0
```

### Current function text (not modified)
```cpp
static ggml_type kvarn_fallback_cache_type(int32_t bits) {
    switch (bits) {
        case 2:  return GGML_TYPE_Q2_K;
        case 3:  return GGML_TYPE_Q3_K;
        case 4:  return GGML_TYPE_Q4_K;
        case 5:  return GGML_TYPE_Q5_K;
        case 6:  return GGML_TYPE_Q6_K;
        case 8:  return GGML_TYPE_Q8_0;
        default: return GGML_TYPE_F16;
    }
}
```

## O-4b

### Diffstat
```
5	5	common/arg.cpp
```

### Verification for Q2_1
```
GGML_TYPE_Q2_1 in ggml.h: line 443
GGML_TYPE_Q2_1 in ggml-cuda.cu SET_ROWS: line 4780 (also 4730, 4799)
```

### Bracket balance (excluding comments) - common/arg.cpp
```
Parens balance: 6 (unchanged)
Braces balance: 0 (unchanged)
```

### Function text after edit
```cpp
static ggml_type kvarn_fallback_cache_type(int32_t bits) {
    switch (bits) {
        case 2:  return GGML_TYPE_Q2_1; // donor uses Q2_0; no CUDA kernels for it in this tree, Q2_1 is the supported sibling
        case 3:  return GGML_TYPE_Q3_0;
        case 4:  return GGML_TYPE_Q4_0;
        case 5:  return GGML_TYPE_Q5_0;
        case 6:  return GGML_TYPE_Q6_0;
        case 8:  return GGML_TYPE_Q8_0;
        default: return GGML_TYPE_F16;
    }
}
```

## O-5

### Diffstat
```
9	1	common/common.cpp
3	0	common/fit.cpp
```

### kvarn grep in fit.cpp after
```
378:    if (cparams->kvarn.type != LLAMA_KVARN_TYPE_DISABLED) {
```

### Bracket balance (excluding comments)
```
fit.cpp - Parens balance: 0
fit.cpp - Braces balance: 0
common.cpp - Parens balance: 0
common.cpp - Braces balance: 0
```

### fit.cpp around line 180 (old guard removed)
```cpp
static void common_params_fit_impl(
        const char * path_model, struct llama_model_params * mparams, struct llama_context_params * cparams,
        float * tensor_split, struct llama_model_tensor_buft_override * tensor_buft_overrides,
        size_t * margins_s, uint32_t n_ctx_min, enum ggml_log_level log_level) {
    if (mparams->split_mode == LLAMA_SPLIT_MODE_TENSOR) {
        throw common_params_fit_exception("llama_params_fit is not implemented for SPLIT_MODE_TENSOR, abort");
    }
    constexpr int64_t MiB = 1024*1024;
    typedef std::vector<llama_device_memory_data> dmds_t;
    const llama_model_params default_mparams = llama_model_default_params();
```

### common.cpp lines 1222-1239 after indent fix
```cpp
    if (params.fit_params) {
        COM_TRC("%s", "fitting params to device memory ...\n");
        COM_TRC("%s", "(for bugs during this step try to reproduce them with -fit off, or provide --verbose logs if the bug only occurs with -fit on)\n");
        common_params_fit_status fit_status = common_fit_params(params.model.path.c_str(), &mparams, &cparams,
            params.tensor_split,
            params.tensor_buft_overrides.data(),
            params.fit_params_target.data(),
            params.fit_params_min_ctx,
            params.verbosity >= LOG_LEVEL_DEBUG ? GGML_LOG_LEVEL_DEBUG : GGML_LOG_LEVEL_ERROR);
        if (fit_status != COMMON_PARAMS_FIT_STATUS_SUCCESS) {
            if (fit_status == COMMON_PARAMS_FIT_STATUS_FAILURE) {
                COM_ERR("%s", "failed to fit model parameters to device memory: insufficient memory\n");
            } else {
                COM_ERR("%s", "error while fitting model parameters to device memory\n");
            }
            return;
        }
    }
```