# T004 — root cause: краш fused (prefill-dequant MMA) под n_seq > 1

**Роль:** диагностика CUDA-кернеля (`ggml/src/ggml-cuda/fattn.cu`,
`ggml/src/ggml-cuda/fattn-mma-f16.cuh`), compute-sanitizer.
**Приоритет:** P1 — это корневой баг стабильности fused-пути; без него
инверсия `GGML_TURBO_MMA_FUSED` в opt-in (санкционирована, см. D-017)
останется без понимания причины.
**Источник:** аудит T001 (2026-08-15), вердикт Архимага (3-й раунд):
«завести тикет на root cause краша fused под n_seq>1».
**Зависимости:** T001 принят (артефакты и маршруты уже в дереве).

## Что известно (из T001, всё воспроизведено и сохранено)

- fused (default ON) ПАДАЕТ под multi-seq prefill: `llama-perplexity`
  (n_seq=8, n_ctx=256, `-c 256`) с turbo4/turbo4 и
  `--save-all-logits`/`--kl-divergence` — «CUDA error: illegal memory
  access» в `ggml_cuda_flash_attn_ext_mma_f16_case<256,256,16,4>` ←
  `ggml_cuda_turbo_prefill_attend` (`fattn-mma-f16.cuh:2151`,
  `cudaFuncSetAttribute(MaxDynamicSharedMemorySize)`).
- Без `--save-all-logits` — интермиттентно: 1 прогон PPL=10.3785, 1 прогон
  «CUDA error: an illegal instruction was encountered». `GGML_TURBO_MMA_FUSED=0`
  (dequant) стабилен (PPL 8.6542, крашей нет).
- Decode A/B тоже недетерминирован: fused 2.94..24.09 t/s (бимодален), dequant
  стабилен 23.85..25.25 t/s. Артефакты: `.chronos-ops/active/t001-ab/`,
  `.chronos-ops/active/t001-numerics/`.
- Ключевой факт: сообщение на `cudaFuncSetAttribute` — **sticky**: реальный
  фолт произошёл в РАНЬШЕ запущенном асинхронном кернеле, а всплыл на
  ближайшей точке синхронизации. Искать надо первый фолт, не эту строку.

## Что сделать

1. `compute-sanitizer --tool memcheck` на `llama-perplexity` (build-debug/,
   HALF_QUANTS, `-m Qwythos-9B -f corpus -c 256 -ngl -1 -fa on -ctk turbo4
   -ctv turbo4 --save-all-logits /tmp/x`), чтобы поймать ПЕРВЫЙ нелегальный
   доступ (адрес, размер, кернел) до того, как он всплывёт на sync-точке.
2. Зафиксировать, КАКОЙ кернел реально виноват: подозрение на prefill-dequant
   MMA (`ggml_cuda_turbo_prefill_attend` -> `ggml_cuda_flash_attn_ext_mma_f16_case`),
   но первый фолт может быть в другом месте (деquant K/V, FWHT-ротация Q,
   разбиение по n_seq).
3. Объяснить бидомальность decode-perf (2.9-24 t/s) — тот же ли это дефект
   (гонка/неинициализированная память), или отдельный. Memcheck на
   `llama-completion --ignore-eos -s 42 -n 128` в помощь.
4. Выявить, почему триггер именно n_seq > 1 (в n_seq=1 completion путь не
   падает): проверить размеры батча/шаблон в prefill-кернеле при n_seq=8.

## Верификация

- Найден точный кернел и строка первого фолта (memcheck-отчёт сохранён в
  дерево, путь к нему в отчёте).
- Гипотеза проверена минимум двукратным прогоном (не «сработало раз»).
- Если фикс — отдельный коммит с regression-прогоном (perplexity n_seq=8 +
  decode A/B), после которого fused стабилен.

## После приёмки

Разблокирует численную верификацию fused (KLD станет вычислим) и, при
желании, повторное рассмотрение default ON с реальными цифрами (отдельный
D-номер, не здесь).
