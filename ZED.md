# ZED.md — задания для Zed (Chronos-Engine)

Правила: работаешь только в этом репо. Релизный билд в `build/` не ломать.
Никаких коммитов — изменения в рабочей копии + отчёт. Никаких AI-трейлеров.
Не путать с `zed-2.md` (это отдельный трек стресс-теста через Zed editor).

## ЗАДАНИЕ Z-1 — kvarn: fit-оценка не даёт поднять kvarn2 там, где влезал kvarn4

### Симптом
Сегодняшние живые факты на RTX 3070 8GB (модель
`models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf`, веса ~5.9GB):

- kvarn4/kvarn4, `-c 65536 -ub 256` — поднимался и работал (фон VRAM ~1.3GB).
- kvarn2/kvarn2, `-c 65536` и даже `-c 49152` (фон ~1.9GB) — отказ ещё на fit:

```
W common_fit_params: failed to fit params to free device memory:
  KVarN requires full GPU offload; cannot fit by reducing n_gpu_layers --
  reduce n_ctx or free device memory
E cmn  common_init_: failed to fit model parameters to device memory
```

kvarn2 обязан есть В ДВА РАЗА меньше KV-памяти, чем kvarn4. Разница фона
0.6GB не объясняет, почему 49152@kvarn2 не влезает там, где влезал
65536@kvarn4. Подозрение: fit-оценка (`common/fit.cpp`, kvarn-гард на
~fit.cpp:378) считает размер KV-кеша НЕ по kvarn-битности, а по
fallback/полному типу — т.е. переоценивает, и тем сильнее, чем ниже битность.

### Что сделать
1. Разбери, как `common_fit_params` оценивает память KV-кеша при активном
   kvarn (kvarn — псевдотип поверх `GGML_OP_KVARN_VIEW`, не настоящий
   `ggml_type`; K/V-битность обязана совпадать, см. `kvarn_type_from_bits`
   в `common/arg.cpp`).
2. Ответь с цифрами: сколько fit насчитал для kvarn2@49152 и kvarn4@65536,
   сколько реально занимает KV в каждом случае (лог сервера пишет размеры
   буферов при загрузке). Совпадает оценка с реальностью или нет.
3. Если оценка завышена — почини: fit должен считать по фактической
   kvarn-битности. Если оценка честная и дело в чём-то другом (например
   kvarn2 требует доп. буферы) — покажи, в чём именно.
4. Живая проверка: kvarn2/kvarn2 должен подниматься с МАКСИМАЛЬНЫМ
   контекстом, который реально влезает (подбери), и отвечать на один
   completion. Запуск: `cd models/main && PORT=8099 KVARN_K=2 KVARN_V=2
   ./run-server.sh qwythos-v3 -c <N> -ub 256`. Перед запуском смотри фон:
   `nvidia-smi --query-gpu=memory.used --format=csv,noheader` — он гуляет
   1.3–1.9GB, фиксируй его в отчёте рядом с каждым результатом.

### Отчёт
`zed-report.md` в корне: цифры оценки vs факта, корневая причина, дифф (если
чинил), максимальный рабочий `-c` для kvarn2 с фоном на момент замера.
