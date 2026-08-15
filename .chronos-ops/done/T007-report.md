# T007-report — turbo4-CPU: Гауссова QR -> FWHT+signs

**Дата:** 2026-08-15
**Исполнитель:** Buffy
**Статус:** готов к приёмке. Код изменён (одна цель, см. ниже).
**Роль:** `ggml/src/ggml-turbo-quant.c`.

## Среда

- Коммит: `ac586c098` (та же база, что T002/T006).
- Билд: `build-cpu/`, `-G Ninja -DGGML_CUDA=OFF -DCMAKE_BUILD_TYPE=Release`,
  цели `llama-perplexity` + `llama-completion`. Пересобран после правки —
  чисто, без ворнингов в изменённом файле.
- Модель/корпус PPL: те же, что T002 (`Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf`,
  `.chronos-ops/active/t002-cpu/corpus.txt`, `-c 128`, `-s 42`, n_seq=16).

## Что сделано (код)

1. **Добавлен** `turbo_cpu_ifwht` (inverse WHT: signs2 -> butterfly ->
   signs1 * 1/sqrt(n)) рядом с `turbo_cpu_fwht`. Это точное зеркало CUDA
   `k_turbo_wht` direction=1 (turbo-wht.cu: s_first=s2, s_second=s1).
2. **turbo4 quantize:** шаг «Rotate» — `matvec(turbo_rotation, ...)`
   (Гауссова QR) заменён на `turbo_cpu_fwht(normalized, d)`.
3. **turbo4 dequant:** обратная ротация — `matvec(turbo_rotation_t, ...)`
   заменена на `turbo_cpu_ifwht(rotated_recon, d)`.
4. **Вычищена QR-машинерия:** `TURBO_SEED_ROTATION`, `turbo_rotation`,
   `turbo_rotation_t`, `turbo_rotation_initialized`, `turbo_init_rotation`,
   `matvec`. Оставлены `turbo_prng_seed`/`turbo_prng_normal` — они общие
   с QJL-инициализацией (`turbo_init_qjl`), не только с QR.

Контракт dequant НЕ менялся: turbo4 по-прежнему отдаёт original-домен
(un-ротация). Разделение K/V (V должен перестать un-ротировать) — это
T006, не здесь.

## Верификация

### 1. Знаковые массивы CPU == CUDA (побайтно)

Скрипт `.chronos-ops/active/t007-signcheck.py` извлекает все шесть массивов
и сравнивает:

```
cpu_s1 == wht_s1:        MATCH (128)
cpu_s2 == wht_s2:        MATCH (128)
cpu_s1 == quant_signs1:  MATCH (128)   // turbo-quant-cuda.cuh
cpu_s2 == quant_signs2:  MATCH (128)
cpu_s1 == fattn_signs1:  MATCH (128)   // fattn-common.cuh
cpu_s2 == fattn_signs2:  MATCH (128)
```

Т.е. ротация turbo4-CPU теперь использует те же знаки seed=42, что turbo2/3-CPU
и все CUDA-кернелы. (В T002 это уже сверено для `GGML_OP_TURBO_WHT`; здесь
проверка расширена на quantize-знаки `d_turbo_wht_signs*`.)

### 2. Forward == CUDA set_rows, inverse == точная инверсия

- Forward `turbo_cpu_fwht` = signs1 -> butterfly -> signs2 * 1/sqrt(n) —
  совпадает с CUDA `turbo_rotate_forward_cuda` (turbo-quant-cuda.cuh:795/817).
- Inverse `turbo_cpu_ifwht` = signs2 -> butterfly -> signs1 * 1/sqrt(n) —
  совпадает с CUDA `k_turbo_wht` direction=1.
- Математически `T_inv o T_fwd = I`: при s1,s2 ∈ {±1} композиция сводится к
  `diag(s1) * (1/n)*H*H * diag(s1) = I` (H*H = n*I).

### 3. Живой PPL (тот же корпус, что T002)

```
               T002 (до)   T007 (после)   смысл
f16/f16        2.3888      2.3888         контроль: не тронут ✓
turbo4/f16     2.4083      2.4076         K-изоляция: КРУГ-ТРИП верен ✓
f16/turbo4     95.7375     83.0502        V-изоляция: всё ещё мусор (это T006)
turbo4/turbo4  84.6620     88.4929        та же катастрофа V (это T006)
turbo2/turbo2  4.2193      4.2193         контроль: turbo2 не тронут ✓
```

Ключевой сигнал — **turbo4/f16 = 2.4076 ~ 2.41 (реф 2.39)**: forward-FWHT
quantize + inverse-FWHT dequant возвращают K в original-домен, то есть
круг-трип корректен, а не «похоже». Если бы пара fwht/ifwht была неверной,
K-изоляция взорвалась бы до класса V (~85+). Разница 2.4083 -> 2.4076 (4-й
знак) — ожидаема: сменилась матрица квантования, чуть другой шум, но тот же
класс точности.

f16/turbo4 и turbo4/turbo4 ОСТАЛИСЬ в катастрофическом классе — это
ПРЕДНАЗНАЧЕНО: T007 меняет только представление, двойная un-ротация V
(dequant + графовый inverse-WHT) остаётся и чинится в T006. PPL после T007
один и не обязан был упасть.

### 4. Round-trip (измерение, не выкладка)

`t007-roundtrip.c` гоняет quantize_row_turbo4_0_ref -> dequantize_row_turbo4_0
на 1000 гауссовых векторов × 128 (тот же LCG+Box-Muller, seed 42), метрики:

```
max|delta|            global=0.447447  mean-per-vector=0.268629
rel L2 (||r-x||/||x||) max=0.164067  mean=0.095403
norm ratio (||r||/||x||) mean=1.000002  min=0.999609  max=1.000402
```

- **norm ratio = 1.000002 (разброс ±0.04%)** — систематического крена НЕТ.
  Коррекция нормы (`y.norm = norm/recon_norm`) сохраняет норму по построению
  независимо от ротации; fp16-округление даёт тот самый ±0.04%.
- **rel L2 mean 9.5% / max 16.4%** — честная 4-битная квантизационная
  деградация turbo4 (референс для T006: «кроме честной квант-деградации»).
- **max|Δ| = 0.447** абсолютно на N(0,1)-векторах (‖x‖≈11.3) → ~4% от нормы.

Ожидание Архимага подтверждено измерением: FWHT не хуже QR для подбора
центроидов (обе — ортогональные преобразования гауссианы, дисперсия на
координату сохраняется). Крен не найден → отдельного тикета не нужно.

## Совместимость CPU<->GPU (заявленный пункт 3 тикета)

Представление turbo4-CPU теперь FWHT+signs, идентичное CUDA set_rows: знаки
побайтно равны (п.1), transform-форма совпадает (п.2). Значит кэш, записанный
turbo4 на CPU, теперь читаем на GPU (и наоборот) на уровне самой матрицы
ротации. Живой кросс-бэкенд прогон (CPU-запись -> CUDA-чтение) здесь не
выполнен — эта сборка CPU-only, GPU у исполнителя нет; это в разделе
«Верификация» тикета как опциональный пункт для железа Архитектора (RTX 3070).
До фикса старые кэши turbo4, записанные на CPU (QR-домен), невалидны для GPU —
реквант (одноразовый, D-005).

## Артефакты (попадут в git)

- `t007-signcheck.py` — сравнение знаковых массивов (вывод выше).
- `t007-cpu/ppl-*.log` — 5 PPL-прогонов (числа в отчёте дословно).
- `t007-roundtrip.c` + `t007-cpu/roundtrip.txt` — измеренный round-trip
  (1000 гауссовых векторов × 128).
