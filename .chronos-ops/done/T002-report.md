# T002-report — Q pre-rotate по инварианту (CPU live + код)

**Дата:** 2026-08-15
**Исполнитель:** Buffy
**Статус:** готов к приёмке. Код не менялся (по тикету «не код — данные»).
Таблица доменов закрыта полностью (чтение кода + live CPU-прогон); CPU-баг
подтверждён числами, а не гипотезой.

## Среда

- Коммит: `ac586c098` («cuda : GGML_TURBO_MMA_FUSED opt-in (default off) ...»)
- Билд: `build-cpu/`, свежий, `-G Ninja -DGGML_CUDA=OFF
  -DCMAKE_BUILD_TYPE=Release`, цели `llama-completion` + `llama-perplexity`.
  CPU: n_threads=6/12, AVX2/FMA, OPENMP, без CUDA вообще.
- Модель: `models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf`
  (SHA256 `d5d2a08e...` — тот же, что в T001).
- Корпус PPL: `.chronos-ops/active/t002-cpu/corpus.txt` (284 слова,
  `-c 128`, `-s 42`, n_seq=16 — дефолт perplexity).

## Как проверено

1. **Код** (домены dequant): `ggml/src/ggml-turbo-quant.c`
   (`dequantize_row_turbo{2,3,4}_0`, TCQ-заглушки), `ggml/src/ggml-cpu/ops.cpp`
   (`ggml_compute_forward_flash_attn_ext_f16_one_chunk`), `ggml-cpu/ggml-cpu.c`
   (traits + `GGML_OP_TURBO_WHT` kernel), `ggml-cuda/fattn.cu` (все три семьи).
2. **Live CPU** (базлайн ДО фикса): PPL на 8 комбо K×V (`-fa on`), completion
   на тех же комбо + `-fa off` (non-FA). Все логи в
   `.chronos-ops/active/t002-cpu/`.

## Ключевая поправка к таблице тикета

Тикет рисовал CPU одной строкой «rotated, Q не ротируется → баг». **Живой
прогон это опровергает: CPU раскалывается по типам, и баг КОМПЛЕМЕНТАРЕН
между turbo2/3 и turbo4** (K и V ломаются в противофазе):

```
PPL (меньше = лучше, f16 = эталон):
f16   / f16   = 2.3888     (эталон)
turbo2/ turbo2= 4.2193     K бит (rotated, Q не ротирован)
turbo3/ turbo3= 4.1110     K бит
turbo4/ turbo4= 84.6620    V бит (двойная un-ротация) — катастрофа
turbo2/ f16   = 4.2245     изоляция K: бит (≈ turbo2/2)
f16   / turbo2= 2.3985     изоляция V: НЕ бит (≈ f16)
turbo4/ f16   = 2.4083     изоляция K: НЕ бит (≈ f16)
f16   / turbo4= 95.7375    изоляция V: бит — катастрофа
```

Т.е.:
- **turbo2/turbo3:** `dequantize_row_turbo2_0`/`turbo3_0` отдают **rotated**
  домен (у turbo3 прямое: «Inv-WHT is graph-side»), Q в CPU FA никто не
  ротирует → **KQ-скалярники неверны** → PPL ~1.7× хуже. V при этом корректен
  (rotated V → графовый inverse-WHT на выходе → верно).
- **turbo4:** `dequantize_row_turbo4_0` **сам делает inverse-ротацию**
  (`matvec(turbo_rotation_t, ...)`) → K приходит в **original** домен и KQ
  верны (PPL 2.41). Но V тем же dequant'ом тоже приходит в original, а граф
  `build_attn_mha` безусловно гонит inverse-WHT на выходе для всех шести
  turbo-типов → **двойная un-ротация V** → PPL 95.7 (40× хуже).
- **TCQ:** `quantize_row_turbo*_tcq_ref` — заглушка (зануляет `qs`, пишет
  только norm), `dequantize_row_turbo*_tcq` возвращает **нули**. На CPU TCQ
  нефункционален ВООБЩЕ (не «не проверено» — детерминированно нули), это не
  про ротацию, а про отсутствие CPU-реализации TCQ.

Дополнительно: **CPU turbo4 использует ДРУГУЮ ротацию** — случайную
Гауссову QR (`turbo_rotation`, Box-Muller seed 42) вместо FWHT+signs
(seed 42), который используют turbo2/3 CPU и ВСЕ turbo-типы CUDA. Т.е. даже
если бы dequant turbo4 не un-ротировал, графовый inverse-WHT (FWHT) всё равно
был бы неверной инверсией для QR-домена. Представление turbo4 на CPU
несовместимо с CUDA и с графом на уровне самой матрицы ротации.

## Закрытие остальных «?» таблицы тикета

- **CUDA prefill-dequant, TCQ:** `ggml_cuda_turbo_prefill_attend`
  (fattn.cu) деquantит все три TCQ **простым** кернелем
  (`k_turbo*_tcq_dequant_f16`, без `_inv_fwht`) → rotated; Q-ротация
  гейтится `turbo_k && K->type != TURBO4_0` → для TCQ Q ротируется. TCQ
  на prefill ведёт себя как turbo2/3.
- **CUDA decode:** по умолчанию `decode_dequant` гонит ВСЕ turbo K (включая
  TCQ) через `*_inv_fwht` → original → Q НЕ ротируется. Исключения Bug #31
  (K=t2/V∈{t3,t4,q8_0,f16}, K=t3/V=t2) → rotated + Q ротируется. Native VEC
  (decode_dequant пропущен) читает raw rotated байты, Q ротируется снаружи
  (fattn-vec.cuh:310). Т.е. домен-логика CUDA закрыта чтением кода +
  матрицей T001 (144 комбо), live-дубля не требовала.
- **non-FA (`-fa off`), CPU:**
  - turbo K + turbo V → guard-аборт на init:
    `llama-context.cpp:3603` «V cache quantization requires flash_attn».
  - turbo K + classic V (например `turbo2/f16`) → **SIGSEGV (rc=139)**:
    `ggml_mul_mat(k,q)` с turbo K, а `vec_dot` у turbo-типов CPU = NULL.
  - classic K + turbo V → тот же guard-аборт.
  Итог: non-FA с любым turbo-типом недостижим (guard или краш), строка
  «не проверено» закрыта.

## Подтверждение: путь CPU FA действительно исполняется

non-FA недостижим (guard/краш), а PPL-прогоны дают осмысленные разные
числа по типам — значит исполняется именно
`ggml_compute_forward_flash_attn_ext` с `to_float`-деquantом. `-fa off`
не проходит init → у turbo на CPU выбора нет, FA обязателен и он же тихо
порчен.

## Инвариант и куда чинить (рекомендация, решение за Архитектором)

Граф уже кодирует инвариант правильно и **CUDA-симметрично**:
- V хранится rotated → dequant отдаёт rotated → граф `ggml_turbo_wht`
  (inverse) un-ротирует выход. Это верно для всех шести типов на CUDA.
- K и Q: либо K dequant un-ротирует (original, Q не трогаем) — turbo4/decode
  у CUDA; либо K rotated и Q pre-ротируется — turbo2/3 prefill у CUDA.

Баг целиком в CPU-слое, НЕ в графе. Минимальный CUDA-симметричный фикс
(одна ось, без `if (backend == CPU)`):

1. **Разделить K- и V-деquant в CPU FA.** Сейчас `to_float` один на оба
   (`ggml_get_type_traits(k/v->type)->to_float`). CUDA держит два кернеля:
   `k_turbo*_dequant_f16_inv_fwht` (K → original) vs `k_turbo*_dequant_f16`
   (V → rotated). CPU должен повторить: K — inv-FWHT (original), V — rotated
   (граф un-ротирует). Это чинит turbo2/3 K (сейчас rotated) и turbo4 V
   (сейчас un-ротируется дважды).
2. **Выровнять ротацию turbo4 под FWHT+signs** (сейчас Гауссова QR) — иначе
   CPU-turbo4 несовместим с графовым inverse-WHT и с CUDA-представлением.
3. **TCQ на CPU — отдельный большой тикет** (нет ни quantizer, ни dequantizer),
   не довесок сюда.
4. Альтернатива graph-side Q-ротации отклоняется по данным: она требовала бы
   явного признака домена на тензоре и всё равно не чинит turbo4-V — баг в
   dequant-конвенции, а не в отсутствии узла в графе.

`GGML_OP_TURBO_WHT` сигнатуры достаточно: direction=0 (forward) уже есть, CPU
kernel реальный (G-2), знаковые массивы s1/s2 CPU == `d_turbo_wht_s1/s2` CUDA
== `d_turbo_wht_signs*_fattn` (сверено побайтно по первым 32+ значениям, все
заявляют seed=42). НО forward НЕ применяет InnerQ channel scale — она
identity по умолчанию (калибровка выключена), так что при включённой
калибровке graph-side forward разойдётся с CUDA `k_turbo_fwht_forward`.

## Верификация (тикет §Верификация) — выполнена

- CPU-only собран и прогнан с **`--cache-type-k turbo2 --cache-type-v
  turbo2`** (K явно): базлайн = **тихий мусор, PPL 4.22 vs 2.39**, не краш.
  Плюс turbo3/3 (4.11) и turbo4/4 (84.66, почти «London» в completion).
- non-FA ветка: turbo K + classic V → SIGSEGV; turbo V → guard-аборт.
- PPL CPU vs CUDA: CUDA-эталон для сравнения не гонялся (тикет требовал
  только зафиксировать ФАКТ до фикса; CUDA-числа для turbo4/turbo4 уже есть
  в T001: dequant PPL 8.65 на стабильном корпусе — другой корпус, прямое
  сравнение не имеет смысла до фикса).

## Артефакты (попадут в git, как в T001)

- `t002-cpu/corpus.txt` — корпус PPL (284 слова).
- `t002-cpu/ppl-ctk-*_ctv-*.log` — PPL-логи (8 комбо, числа в отчёте дословно).
- `t002-cpu/ctk-*_ctv-*_fa-*.log` — completion + non-FA логи (rc/вывод/краши).
