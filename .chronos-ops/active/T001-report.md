# T001-report — аудит fused-MMA turbo-пути (live)

**Дата:** 2026-08-15
**Исполнитель:** Buffy
**Статус:** REFUTED (Архимаг, 2026-08-15, повторно) -> resubmit: fail-closed
harness + полная 144-комбо матрица; числа только из сохранённых артефактов;
KLD fused невычислим (краш), fused НЕдетерминирован по перфу, default ON
ОТОЗВАН.

## Среда

- Коммит: `1c00ef56463ccc0707d85cd47798a82743ab8de5`
- Модель: `models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf`
  SHA256 `d5d2a08e7de8273c20f714d8127893d690a12448b83a8c1548087abe11d54a7f`
- GPU: RTX 3070 8GB (sm_86)
- Бинарь live-тестов: `build-debug/bin/llama-completion` и
  `build-debug/bin/llama-perplexity`, сборка
  `-DCMAKE_BUILD_TYPE=Release -DGGML_CUDA_FA_HALF_QUANTS=ON`
  (version: 10045 (1c00ef564), GNU 16.2.1).
- Продакшн-билд `build/` — default FA policy (`GGML_CUDA_FA_ALL_QUANTS=OFF`),
  использовался только для сверки routing-разницы.

## Что проверено и как

### 1. Живой trace трёх семей (turbo4/turbo4)

```
GGML_TURBO_FA_DEBUG=1 build-debug/bin/llama-completion -m <model> -p "The capital of France is" -n 8 -c 512 -ngl -1 -fa on -ctk turbo4 -ctv turbo4 -no-cnv
```

- decode -> `path=fused-mma` (family 1).
- prefill -> `path=prefill-dequant` (family 2).
- `GGML_TURBO_MMA_FUSED=0` -> decode `path=decode-dequant-or-vec` (family 3).

### 2. Полная матрица (144 комбо, default env, fused ON) — fail-closed

Harness персистентен в дереве: `.chronos-ops/active/t001-matrix.sh`.
Raw-логи — `.chronos-ops/active/t001-matrix-raw/` (не удаляются; *.log в
.gitignore, см. «Долговечность артефактов» ниже). Machine-readable сводка
— `.chronos-ops/active/t001-matrix-summary.tsv` (rc/status/fused/prefill/
decode/kernel на каждую строку, 144 ряда). Классификация строго:
rc==0 -> разбор лога; rc==124 -> TIMEOUT; rc!=0 -> FAIL/CRASH; NO-FA и
NOT-COMPILED тоже поднимают fail=1. **Любой не-`ok` даёт ненулевой exit.**
Прогон 2026-08-15 #2: **144 комбо = 132 ok + 12 NO-FA, exit 1** (не 0 —
это корректно: 12 комбо реально не доезжают до FA, см. ниже).

Покрытие: 6 turbo x 6 turbo (36) + 6 turbo x {f32, f16, bf16, q8_0, q4_0,
q4_1, q5_0, q5_1, iq4_nl} в обе стороны (108). Каждое комбо:
`-p "The capital of France is" -n 2 -c 256 -ngl -1 -fa on`,
`GGML_TURBO_FA_DEBUG=1 GGML_CUDA_FA_ROUTE_DEBUG=1`.

Сводка по классам (полные 144 ряда — в TSV):

| класс | prefill | decode (fused ON) |
|---|---|---|
| straight turbo K==V (t2/2, t3/3, t4/4) | prefill-dequant | fused-mma |
| turbo* x turbo* (K!=V / TCQ, любые) | prefill-dequant | decode-dequant MMA_F16 |
| turbo* x f32/f16 и наоборот | prefill-dequant | decode-dequant MMA_F16 |
| turbo* x bf16 | prefill-dequant | decode-dequant MMA_F16 |
| bf16 x turbo* | decode-dequant MMA_F16 | decode-dequant MMA_F16 |
| turbo* x q8_0 | decode-dequant MMA_F16 | VEC (f16/q8_0) |
| q8_0 x turbo* | decode-dequant MMA_F16 | MMA_F16 (allow_vec=0) |
| turbo* x {q4_0,q4_1,q5_0,q5_1} | prefill-dequant | VEC (prefer_native_vec) |
| {q4_0,q4_1,q5_0,q5_1} x turbo* | decode-dequant MMA_F16 | MMA_F16 (V->f16) |
| turbo* x iq4_nl и наоборот (12) | **NO-FA (kernel=NONE)** | **NO-FA (kernel=NONE)** |

**Новая находка (iq4_nl):** `iq4_nl` есть в CLI-whitelist
(`common/arg.cpp` `kv_cache_types`), но для turbo-пар route planner
возвращает `kernel=NONE` -> тихий non-FA фолбэк (rc=0, без краша). Это
второй whitelist-гэп рядом с llama-bench (тот вообще не знает turbo).
`--cache-type-k/v iq4_nl` с turbo-собеседником молча теряет FA.

**Классы q6_0/q6_1/q3_0/q3_1/q2_1** есть в
`ggml_cuda_fattn_is_classic_non_q8_type()`, но НЕ в CLI-whitelist — через
`--cache-type` недостижимы, harness их проверить не может; CLI-достижимые
представители classic_non_q8 — q4_0/q4_1/q5_0/q5_1 (все проверены).

**Routing-разница build-политик (важно):** на продакшн `build/` (default
policy) `q8_0`/`turbo3` даёт `kernel=NONE` ->
`ggml_cuda_flash_attn_ext_supported()=false` -> non-FA fallback. На
`build-debug` (HALF_QUANTS) та же пара даёт `kernel=MMA_F16`. Продакшн
(llama-swap Qwythos `q8_0`/`turbo3`) едет на non-FA.

### 3. Численность: KLD/PPL (turbo4/turbo4, стабильный корпус)

Порог = сравнить fused/dequant расхождение с quantization noise floor
(dequant vs f16). Стабильный корпус `.chronos-ops/active/t001-corpus.txt`
(789 слов, `-c 256`, n_seq=8). Выходы сохранены в
`.chronos-ops/active/t001-numerics/` (скрипт `t001-numerics.sh`); числа
ниже дословно из этих файлов.

```
PPL:       f16 = 5.6305   dequant = 8.6542   fused = CRASH
KLD(dequant||f16)   median = 0.3476   mean = 0.4721   PPL ratio = 1.547
KLD(fused||f16)     = CRASH (illegal access)
KLD(fused||dequant) = CRASH (illegal access)
```

fused с `--save-all-logits` падает с «CUDA error: illegal memory access»
(fattn-mma-f16.cuh:2151, `ggml_cuda_turbo_prefill_attend`). Без
`--save-all-logits` — интермиттентно: 1 прогон PPL=10.3785, 1 прогон
«illegal instruction». KLD для fused поэтому НЕВЫЧИСЛИМ — численная
корректность fused не устанавливается. dequant (FUSED=0) стабильно не падает
и даёт PPL 8.6542 — но сам turbo4/turbo4 дорого стоит качеством (в 1.55 раза
хуже f16). Все предыдущие числа (0.181/0.402/0.408/8.59/10.84) — ручной
прогон без сохранённого артефакта, ОТОЗВАНЫ.

### 4. A/B токены/сек (turbo4/turbo4, -c 512, -n 128, route-proven, deterministic)

Harness `.chronos-ops/active/t001-ab.sh`, артефакты
`.chronos-ops/active/t001-ab/` (route-логи + 18 t/s-логов + summary.tsv).

Route proof (`GGML_TURBO_FA_DEBUG=1`, -n 8): fused -> `path=fused-mma`
(decode) + `path=prefill-dequant`; dequant -> `path=decode-dequant-or-vec`
+ `path=prefill-dequant`. Путь конфиг-зависим, от -n не зависит.

t/s (`--ignore-eos -s {42,43,44}`, по 3 повтора, БЕЗ debug — debug сам по
себе тормозит в ~5x, throughput с ним мерять нельзя):

```
fused   (default): 2.94..24.09 t/s, 9 прогонов, mean 9.0 — НЕдетерминировано
dequant (FUSED=0): 23.85..25.25 t/s, 9 прогонов, mean 24.4 — стабильно
```

fused БИМОДАЛЕН: часть прогонов ~20-24 t/s (совпадает с dequant), часть
рушится до ~3-5 t/s, есть и промежуточные (12.5). Тот же seed 42 подряд:
20.17 / 4.09 / 3.83. Это не «fused на 28% медленнее», а НЕдетерминированная
производительность, коррелирующая с интермиттентным крашем fused в
perplexity. Ранние замеры «6.46 vs 5.97» и «23 vs 32» (ab.txt) ОТОЗВАНЫ
как невоспроизводимые — оба ловили только быстрые fused-прогоны в
неконтролируемых условиях (без seed/ignore-eos, ранний EOS, разнобой runs
63/123/127). Все 18 прогонов нового замера дают ровно 127 eval-runs
(детерминированно, `--ignore-eos` убирает ранний EOS; 127 vs `-n 128` —
внутренний учёт llama.cpp, константен для всех прогонов) — разнобой runs
устранён, выборки сопоставимы.

### 5. Native VEC — краш (illegal memory access)

```
GGML_TURBO_MMA_FUSED=0 TURBO_PREFILL_VEC=1 GGML_TURBO_DECODE_NATIVE=1 \
  build-debug/bin/llama-completion ... -ctk turbo4 -ctv turbo4 ...
#  exit 134 (SIGABRT), "CUDA error: an illegal memory access was encountered"
```

При этом `turbo4`/`q4_0` (native VEC, prefer_native_vec) НЕ падает — т.е.
краш на turbo V-стороне VEC-деquant, не на K-стороне. Тот же класс, что
документированный краш turbo2.

## Выводы

1. Три семьи подтверждены живьём; полная матрица (144 комбо) K x V x
   prefill/decode с конкретным kernel внутри family 3 зафиксирована в
   `ggml/src/ggml-cuda/fattn-turbo-routes.md` + `t001-matrix-summary.tsv`.
2. Численная корректность fused НЕ установлена и на текущем билде НЕ
   устанавливаема: fused падает под `--save-all-logits`/`--kl-divergence`
   (illegal access в prefill-dequant MMA, n_seq=8) и интермиттентно без них.
   KLD(fused||*) невычислим. dequant стабилен, но turbo4/turbo4 сам даёт
   PPL в 1.55 раза хуже f16.
3. «Default ON» (D-017) ОТОЗВАН: fused недетерминирован по перфу (бимодален
   2.9-24 t/s, mean 9.0, против стабильных 24.4 у dequant) и не верифицирован
   численно (KLD невычислим — путь падает). Рекомендация — инверсия в opt-in
   (default OFF), отдельным коммитом после приёмки T001.
4. Хвосты (отдельные тикеты): native turbo-V VEC краш (rc=134);
   llama-bench whitelist без turbo; `iq4_nl` в CLI-whitelist, но
   `kernel=NONE` для turbo-пар (тихий non-FA); q6_0/q6_1/q3_0/q3_1/q2_1
   есть в `is_classic_non_q8_type()`, но НЕ в CLI-whitelist; **новый** —
   fused (prefill-dequant MMA) краш под multi-seq perplexity при default ON.

## Долговечность артефактов

- Machine-readable сводка `t001-matrix-summary.tsv` и выходы
  `t001-numerics/*.txt` — НЕ под `*.log`, попадут в git.
- Raw-логи `t001-matrix-raw/*.log` — добавлено исключение из `*.log` в
  .gitignore (`!.chronos-ops/active/t001-matrix-raw/*.log`), попадут в git.
- Скрипты `t001-matrix.sh` / `t001-numerics.sh` — в дереве.
