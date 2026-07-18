# O-10 Отчёт: Дизайн tiered hot/cold KV-offload

**Статус:** Дизайн-док готов — `docs/design/tiered-kv-offload.md` (единственная правка в дереве).

## Diffstat
- `docs/design/tiered-kv-offload.md` — новый файл, ~250 строк

## Что сделано
1. **Исследовано дерево:** прочитаны и проанализированы `llama-kv-cache.cpp/.h`, `llama-kv-cache-kvarn.cpp/.h`, `llama-kvarn.cpp/.h`, `llama-memory-hybrid.cpp/.h`, `llama-context.cpp`, `llama-graph.cpp`, `llama-model.cpp`, `llama-kv-cache-dsv4.cpp`
2. **Исследован -nkvo:** `offload_kqv=false` — KV целиком на CPU, graph.cpp принудительно ставит CPU-бэкенд для KQV-операций
3. **Донор thetom-turboquant:** не имеет tiering/offload механик сверх стандартного `offload` флага; основная ценность — TurboQuant KV-типы и CUDA-ядра (уже смержены в наше дерево)
4. **Донор codacus-llama.cpp:** MoE expert prefetch портирован в ggml-backend.cpp (commit 81729eb43) — async upload весов через dedicated backend + event synchronization
5. **Codacus expert prefetch инфраструктура:** `prefetch_backend`, `prefetch_slots[]`, `prefetch_ready[]/prefetch_free[]` события — напрямую переиспользуема для KV prefetch

## Ключевые решения дизайна
- **Hot tier** (VRAM): существующий KVarN F16 stage (последние 256-512 токенов)
- **Cold tier** (RAM): kvarn-сжатые рекорды на host-pinned памяти
- **Миграция hot->cold:** при переполнении hot stage — kvarn-компрессия + async DMA на host
- **Prefetch cold->hot:** через существующий `ggml_backend_sched_prefetch` механизм (отдельный CUDA стрим, event-based синхронизация)
- **Attend:** Фаза 1 — только hot window; Фаза 2 — hot + Heavy Hitters (H2O); Фаза 3 — периодический полный attend
- **Совместимость:** группы по 128 токенов (KVAR_N_GROUP), metadata cache всегда в VRAM, seq_rm ограничен для cold

## Пропущенное
- `donors/thetom-turboquant` — не содержит tiering/offload механик, только TurboQuant KV-ядра

## Вопросы
- Нужно ли поддержать отдельный `--kv-cold-type` (более агрессивная квантизация для cold tier)?
- Можно ли использовать CUDA unified memory вместо explicit async DMA?
