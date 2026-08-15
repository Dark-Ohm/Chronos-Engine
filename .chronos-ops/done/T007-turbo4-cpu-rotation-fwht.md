# T007 — turbo4-CPU: ротация Гауссова QR -> FWHT+signs (совместимость CPU<->GPU)

**Роль:** `ggml/src/ggml-turbo-quant.c` (`turbo_init_rotation`,
`turbo_rotation`/`turbo_rotation_t`, `quantize_row_turbo4_0_ref`,
`dequantize_row_turbo4_0`).
**Приоритет:** P2 — ПЕРВЫМ из тройки T006/T007/T008 (мина совместимости,
см. «Что было найдено»).
**Источник:** приёмка T002 (Архимаг, 2026-08-15), D-018.
**Зависимости:** T002 принят. Ничего не блокирует старт. Делит файл
`ggml/src/ggml-turbo-quant.c` с T006 (те же turbo4-функции) и T008
(TCQ-заглушки) — в общем рабочем дереве правки одного файла не
параллелить; порядок T007 -> T006.

## Что было найдено (T002, подтверждено живым PPL)

turbo4-CPU использует ДРУГОЕ ортогональное преобразование, чем все остальные:

- turbo2/3-CPU и ВСЕ turbo-типы CUDA: FWHT+signs (seed 42). CPU-знаки
  `turbo_cpu_s1/s2[128]` (ggml-turbo-quant.c) побайтно равны CUDA
  `d_turbo_wht_s1/s2` (turbo-wht.cu) и `d_turbo_wht_signs*`
  (turbo-quant-cuda.cuh / fattn-common.cuh) — сверено в T002.
- turbo4-CPU: случайная Гауссова матрица + модифицированный Гра-Шмидт
  (`turbo_init_rotation`, Box-Muller seed 42). Ни разу не FWHT.

Итог — два разных ортогональных преобразования под одним именем типа.
KV-кэш, записанный turbo4 на CPU (QR-домен), нечитаем на GPU (FWHT-домен)
и наоборот: графовый inverse-WHT (`ggml_turbo_wht`, FWHT) не является
инверсией QR-ротации. Это баг совместимости представления, а не деталь
фикса PPL — фиксировать и документировать отдельно.

## Что сделать

1. Заменить ротацию turbo4_0 с Гауссовой QR на `turbo_cpu_fwht` — тот же
   FWHT+signs (seed 42), что уже применяют turbo2/3-CPU в
   `quantize_row_turbo{2,3}_0_ref` и что применяют все CUDA-кернелы.
   В `quantize_row_turbo4_0_ref` шаг «Rotate» (`matvec(turbo_rotation, ...)`)
   становится `turbo_cpu_fwht(...)`; симметрично dequant.
2. Вычистить Гауссову QR-машинерию (`turbo_init_rotation`, `turbo_rotation`,
   `turbo_rotation_t`, `turbo_prng_normal`/Box-Muller), чтобы под тем же
   именем типа не осталось второго преобразования. Проверить, что
   `turbo_init_rotation` больше нигде не нужен (QJL-инициализация —
   отдельный путь, не трогать).
3. Зафиксировать несовместимость кэша CPU<->GPU как отдельный баг
   совместимости в отчёте и в `docs/chronos-port-map.md` (или SPEC KV):
   до фикса кэши turbo4, записанные на CPU, невалидны для GPU и наоборот;
   после фикса домены совпадают, старые кэши подлежат рекванту (нормально,
   реквант одноразовый — D-005).

## Верификация

- После замены сверить знаковые массивы: `turbo_cpu_s1/s2` == CUDA
  `d_turbo_wht_s1/s2` / `d_turbo_wht_signs*` (в T002 сверено для
  `GGML_OP_TURBO_WHT`; для quantize-пути turbo4 повторить).
- Round-trip: `quantize_row_turbo4_0_ref` -> dequant в rotated-домен (как
  потребует T006) -> графовый inverse-WHT (FWHT) возвращает исходник в
  пределах квант-ошибки, а не мусор.
- CPU turbo4/turbo4 PPL: 84.66 (до) -> в классе честной квант-деградации
  (как turbo2/3 после T006), не катастрофа. Тот же корпус / -c 128 / -s 42
  из `.chronos-ops/active/t002-cpu/`.
- (При наличии GPU у исполнителя) кэш, записанный CPU-сборкой, читается
  CUDA-сборкой с тем же PPL-классом.

## После приёмки

T006 берёт turbo4-ногу (split K/V dequant строится на FWHT, а не на QR).
