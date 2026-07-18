# OPENCODE Report

## O-6 — kvarn-контекст должен классифицироваться как SEQ_RM_TYPE_FULL

### diffstat

```
1       0       include/llama.h
4       0       src/llama-context.cpp
6       0       common/common.cpp
```

### 1. include/llama.h — декларация

```c
LLAMA_API bool                      llama_kvarn_enabled       (const struct llama_context * ctx);
```

Добавлена на :269, после `llama_kvarn_params_for_type`.

### 2. src/llama-context.cpp — реализация

```cpp
bool llama_kvarn_enabled(const llama_context * ctx) {
    return ctx->cparams.kvarn.type != LLAMA_KVARN_TYPE_DISABLED;
}
```

Вставлена на :3641, сразу после `llama_n_ctx` (по стилю соседних простых getters).

### 3. common/common.cpp — вставка в `common_context_can_seq_rm`

```cpp
// :1510-1514 — проверка RS
    if (llama_n_rs_seq(ctx) > 0) {
        COM_TRC("%s", "the context supports bounded partial sequence removal\n");
        res = COMMON_CONTEXT_SEQ_RM_TYPE_RS;
        goto done;
    }

// :1516-1520 — НОВЫЙ kvarn-гард
    if (llama_kvarn_enabled(ctx)) {
        COM_TRC("%s", "KVarN context supports only full sequence removal\n");
        res = COMMON_CONTEXT_SEQ_RM_TYPE_FULL;
        goto done;
    }

// :1522 — probe-попытка (не изменилась)
    if (!llama_memory_seq_rm(mem, 0, 1, -1)) {
```

Полный контекст `common_context_can_seq_rm` после правки (:1488-1534):

```cpp
common_context_seq_rm_type common_context_can_seq_rm(llama_context * ctx) {
    auto * mem = llama_get_memory(ctx);
    if (mem == nullptr) {
        return COMMON_CONTEXT_SEQ_RM_TYPE_NO;
    }

    common_context_seq_rm_type res = COMMON_CONTEXT_SEQ_RM_TYPE_PART;

    llama_memory_clear(mem, true);

    // eval 2 tokens to check if the context is compatible
    std::vector<llama_token> tmp;
    tmp.push_back(0);
    tmp.push_back(0);

    int ret = llama_decode(ctx, llama_batch_get_one(tmp.data(), tmp.size()));
    if (ret != 0) {
        COM_ERR("llama_decode() failed: %d\n", ret);
        res = COMMON_CONTEXT_SEQ_RM_TYPE_NO;
        goto done;
    }

    if (llama_n_rs_seq(ctx) > 0) {
        COM_TRC("%s", "the context supports bounded partial sequence removal\n");
        res = COMMON_CONTEXT_SEQ_RM_TYPE_RS;
        goto done;
    }

    if (llama_kvarn_enabled(ctx)) {
        COM_TRC("%s", "KVarN context supports only full sequence removal\n");
        res = COMMON_CONTEXT_SEQ_RM_TYPE_FULL;
        goto done;
    }

    // try to remove the last tokens
    if (!llama_memory_seq_rm(mem, 0, 1, -1)) {
        COM_TRC("%s", "the context does not support partial sequence removal\n");
        res = COMMON_CONTEXT_SEQ_RM_TYPE_FULL;
        goto done;
    }

done:
    llama_memory_clear(mem, true);
    llama_synchronize(ctx);

    return res;
}
```

### 4. Баланс скобок

| Файл | `{ }` | `( )` |
|---|---|---|
| include/llama.h | 39/39 (0) | 437/443 (-6)* |
| src/llama-context.cpp | 720/720 (0) | 2014/2018 (-4)* |
| common/common.cpp | 387/387 (0) | 1196/1196 (0) |

\* — перекосы были ДО правки (строковые литералы/макросы), не регрессия O-6.

### 5. Карта call-site'ов `common_context_seq_rm` в tools/server/server-context.cpp

Полные удаления (`-1, -1`) — безрисковые для kvarn:

| Позиция | Вызов | Гейт |
|---|---|---|
| :262/264 | `(ctx_tgt, id, -1, -1)` / `(ctx_dft, id, -1, -1)` | нет, но full seq — всегда ок |
| :677/681 | `(ctx_tgt, other.id, -1, -1)` / `(ctx_dft, other.id, -1, -1)` | нет, но full seq — всегда ок |

Частичные диапазоны:

| # | Позиция | Вызов | Гейтирован `ctx_tgt_seq_rm_type`? | Вердикт |
|---|---|---|---|---|
| **1** | :2863/2867 | `(ctx_tgt/slot.id, n_keep, n_keep + n_discard)` / `(ctx_dft, ...)` | **НЕТ** — context shift в `pre_decode()` безусловен | **⚠ НЕГЕЙЧЕН** — kvarn с partial range упадёт в GGML_ABORT |
| **2** | :2980 | `(ctx_dft, slot.id, ckpt.pos_max + 1, -1)` | НЕТ (всегда выполняется, если ctx_dft существует) | Хвостовое удаление от чекпоинта — может пройти на kvarn (если попадает в хвостовую fp16-группу), но не гарантировано; ctx_dft — это draft-контекст, kvarn там маловероятен |
| **3** | :3183/3187 | `(ctx_tgt, slot.id, head_p, head_c)` / `(ctx_dft, ...)` | **НЕТ** — cache reuse в prompt eval, без гейта | **⚠ НЕГЕЙЧЕН** — partial-range удаление внутри cache-reuse для kvarn будет крашем |
| **4** | :3361/3363 | `(ctx_tgt, slot.id, p0, -1)` / `(ctx_dft, ...)` | **НЕТ** — trim после prompt eval, безусловен | **⚠ НЕГЕЙЧЕН** — partial range `[p0, -1)` на kvarn не пройдёт |
| **5** | :3841/3847 | `(slot.ctx_tgt, slot.id, ckpt.pos_max + 1, -1)` / `(slot.ctx_dft, ...)` | **ДА** — внутри `if (use_ckpt_tgt)`, который проверяет `ctx_tgt_seq_rm_type == FULL \|\| RS` | **ГЕЙЧЕН** — достижим только при FULL/RS, код уже использует checkpoint-restore |
| **6** | :3890/3892 | `(slot.ctx_tgt, slot.id, slot.prompt.tokens.pos_next(), -1)` / `(slot.ctx_dft, ...)` | **НЕТ** — speculative accept trim, вне check-гейта | **⚠ НЕГЕЙЧЕН** — partial range `[pos_next, -1)` для kvarn упадёт |

**Итого:** Из 6 частичных сайтов 4 негейченные (#1, #3, #4, #6). Sites #2 и #5 частично защищены (ctx_dft маловероятен для kvarn, #5 под чекпоинт-гейтом).

**Рекомендация:** Негейченные сайты (#1, #3, #4, #6) нужно гейтить проверкой `ctx_tgt_seq_rm_type == COMMON_CONTEXT_SEQ_RM_TYPE_FULL` с переходом на чекпоинт/полный перепроцесс — аналогично тому, как это уже сделано для speculative decoding. Это отдельное задание (не O-6).
