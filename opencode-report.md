# O-10: Дизайн tiered hot/cold KV-offload

**Статус:** Готов. Единственная правка — `docs/design/tiered-kv-offload.md`.

## Что сделано
- Исследованы KV-аллокация (`llama-kv-cache.cpp/.h`), -nkvo (`offload_kqv=false`), доноры (turboquant, codacus), codacus expert prefetch в `ggml-backend.cpp`
- Написан дизайн-док: структуры hot/cold (KVarN F16 stage -> host-pinned kvarn-рекорды), миграция через async DMA, prefetch через `ggml_backend_sched_prefetch` (переиспользование механизма MoE expert prefetch), attend-стратегии (hot-only -> H2O -> periodic full), CLI-флаги, 3-фазный план внедрения

## Выводы
- Донар thetom-turboquant не имеет tiering/offload механик, только TurboQuant KV-ядра (уже смержены)
- Codacus expert prefetch инфраструктура (`prefetch_backend`, `prefetch_slots[]`, events) напрямую переиспользуема
- KVarN уже имеет двухуровневую структуру (F16 stage + compressed records) — естественная база для hot/cold

**Дизайн-док:** `docs/design/tiered-kv-offload.md`
