# Tiered KV Offload — User Guide

> **Статус:** ✅ Реализовано (Phase 1 subset)  
> **Спецификация:** [`../design/tiered-kv-offload-PHASE1-SPEC.md`](../design/tiered-kv-offload-PHASE1-SPEC.md)  
> **Архитектура:** [`../../ARCHITECTURE.md`](../../ARCHITECTURE.md)

---

## Что работает сегодня

| Функция | CLI флаг | Статус | Примечание |
|---------|----------|--------|------------|
| KVarN KV-кэш | `--cache-type-k kvarn4 --cache-type-v kvarn4` | ✅ | Обязателен для tiered offload |
| Горячее окно (hot window) | `--kv-hot-size N` | ✅ | N токенов, кратно 128 |
| Cold offload в RAM | Автоматически при `kv_hot_size > 0` | ✅ | Требует SWA mode |
| Host-pinned буферы | Внутренне | ✅ | Для async DMA |
| TurboQuant квантизация | `--quant-type turbo4` | ✅ | Для весов |

---

## Быстрый старт (Qwythos-9B на RTX 3070 8GB)

```bash
# Сборка с CUDA и KVarN
cmake -B build -DGGML_CUDA=ON -DGGML_NATIVE=OFF
cmake --build build --config Release -j$(nproc)

# Запуск сервера с 262K контекстом
./build/bin/llama-server \
    -hf your-org/Qwythos-9B-GGUF:Q4_K_M \
    -c 262144 \
    --cache-type-k kvarn4 \
    --cache-type-v kvarn4 \
    --kv-hot-size 512 \
    --n-gpu-layers 999 \
    --flash-attn on \
    --port 8080
```

### Ключевые параметры

| Параметр | Значение | Пояснение |
|----------|----------|-----------|
| `-c 262144` | 262144 | Размер контекста (262K токенов) |
| `--cache-type-k/v kvarn4` | kvarn4 | 4-битный KVarN (лучший баланс качества/размера) |
| `--kv-hot-size 512` | 512 | Горячее окно = 512 токенов (4 группы по 128) |
| `--n-gpu-layers 999` | 999 | Все слои на GPU |
| `--flash-attn on` | on | Обязательно для KVarN |

---

## Как это работает (упрощённо)

```
VRAM (GPU):
├── Weights (Q4_K_M)     ~5.9 GB
├── Desktop/compositor   ~1.5 GB
├── F16 Hot Stage        ~16 MB  ← последние 512 токенов (lossless)
├── Metadata cache       ~2 MB
└── Headroom             ~0.2-0.8 GB

RAM (Host, 64 GB DDR4):
└── Cold KVarN records   ~1.3 GB  ← всё остальное (сжато kvarn4)
```

**Поток данных:**
1. Prefill заполняет F16 stage до `kv_hot_size` токенов
2. При появлении новых токенов старые группы (по 128) сжимаются в kvarn4
3. Сжатые записи копируются в host-pinned буфер в RAM (async DMA)
4. На декоде attention работает только с hot window (512 токенов)
5. Cold данные сохранены но не attend'ятся каждый шаг

---

## Важные ограничения (читать перед использованием)

### ⚠️ Требует SWA (Sliding Window Attention)

Cold offload **работает только** когда включён SWA mode:
- `--kv-hot-size > 0` автоматически включает cold offload
- Но код проверяет: `swa && n_stream == 1` (стр. 565-566 `llama-kv-cache-kvarn.cpp`)
- Без SWA cold offload не активируется

### ⚠️ Только hot-window attend

На декоде attention видит **только** последние `kv_hot_size` токенов.
Ранний контекст (system prompt, старые сообщения) сохранён в RAM но **не используется** на каждом шаге.

### ⚠️ Поддерживаемые kvarn типы

| Тип | Бит на вес | Качество | VRAM экономия |
|-----|------------|----------|---------------|
| `kvarn2` | 2 | Низкое | Максимальная |
| `kvarn4` | 4 | **Рекомендуемый баланс** | 4x vs F16 |
| `kvarn6` | 6 | Высокое | 2.7x vs F16 |
| `kvarn8` | 8 | Почти lossless | 2x vs F16 |

Для 262K контекста на 8GB — **kvarn4** оптимален.

---

## Траблшутинг

### OOM на старте

```bash
# Уменьшите hot size или context
--kv-hot-size 256
-c 131072

# Или отключите fit (kvarn требует -fit off)
-fit off
```

### Медленный prefill

Cold offload добавляет overhead на prefill (async DMA копии). Это нормально.

### Качество деградирует на длинных диалогах

Это ожидаемо — attention видит только последние 512 токенов.
Для задач, требующих длинный контекст, ждите Phase 2 (H2O heavy hitters).

### `llama_kvarn_validate_runtime` ошибка

Проверьте:
- `head_dim` поддерживается KVarN (256 для Qwythos — ок)
- Backend поддерживает native KVarN ops (CUDA — да, CPU — fallback)
- `GGML_CUDA_FA_HALF_QUANTS` включён при сборке

---

## Мониторинг VRAM

```bash
# В логах сервера ищите:
KVarN cache: stage_groups=5 tail_groups=4 n_batch=2048 n_ubatch=512
KVarN cold offload: hot_size=512 tokens, cold ring capacity=1024 groups/stream
KVarN buffer size =   12.34 MiB  (GPU)
KVarN buffer size = 1342.17 MiB  (CPU pinned)  ← cold buffer в RAM
```

---

## Roadmap (что дальше)

| Phase | Фича | CLI | Статус |
|-------|------|-----|--------|
| 1 (текущая) | Hot window + cold RAM | `--kv-hot-size` | ✅ Done |
| 2 | H2O heavy hitters в VRAM | `--kv-h2o-groups` | 📋 Spec only |
| 3 | Periodic full attend | `--kv-periodic-attend` | 📋 Spec only |

Phase 2 добавит возможность "прибить" важные токены (system prompt, функции) в VRAM рядом с hot window, чтобы они attend'ились каждый шаг.

---

## Ссылки на код

| Компонент | Файл |
|-----------|------|
| CLI parsing | `common/arg.cpp:2288` |
| Context params | `src/llama-cparams.h:71` |
| KV cache ctor | `src/llama-kv-cache-kvarn.h:104` |
| Cold offload logic | `src/llama-kv-cache-kvarn.cpp:560-570, 1032-1095` |
| Host buffers alloc | `src/llama-kv-cache-kvarn.cpp:666-683` |
| KVarN kernels | `ggml/src/ggml-cuda/kvarn.cu` |