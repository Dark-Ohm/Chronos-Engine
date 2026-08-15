# T001 — аудит уже портированного fused-MMA turbo-пути (не порт, ревью)

**Роль:** CUDA-кернели (`ggml/src/ggml-cuda/fattn.cu`,
`ggml/src/ggml-cuda/fattn-mma-turbo.cuh`).
**Приоритет:** P2 — тихо живущий default-ON путь без формальной приёмки,
не perf-фича на будущее.
**Источник:** пересмотр после ревью (Архимаг, 2026-08-15) исходного
T001 «портировать turbo4 fused MMA» — **исходная версия тикета ложна**,
см. «Что было не так» ниже. Урок зафиксировать: не грепать по донорской
формулировке комментария вместо факта в дереве.
**Зависимости:** нет.

## Что было не так в снятой версии тикета (для памяти)

Утверждал «в нашем дереве этого пути нет вообще» и предлагал портировать
его как perf-фичу. Оба тезиса неверны:

- Диспатч и `ggml_cuda_flash_attn_ext_mma_turbo_case` уже в дереве —
  `ggml/src/ggml-cuda/fattn.cu:775` (switch_ncols1),
  `fattn.cu:804` (switch_ncols2), `fattn-mma-turbo.cuh:10` (сам кернель).
- Путь уже включён **по умолчанию**: `fattn.cu:3307-3315`,
  `turbo_mma_fused` = `true`, если `GGML_TURBO_MMA_FUSED` не выставлен в
  `0` явно (`GGML_TURBO_MMA_FUSED=0` — kill-switch, не opt-in флаг).
- Пришёл коммитом `18fa6e87a` («cuda : port beellama TurboQuant/KVarN
  kernels, FA dispatch, template instances») — ранний bootstrap-коммит,
  но НЕ до первого D-00X: между `943f698d4` (bootstrap) и `18fa6e87a`
  уже была `1a276784d` (порт quant-типов) и `5c2bc4ef2` (docs, D-009).
  Хронология в первой версии тикета была неточной — поправлено. Массовый
  порт, без адресного ревью именно этого fused-пути — в отличие от
  G-1/G-2/M-1, у него нет отдельного коммита-приёмки. Отсюда и аудит, а
  не повторный порт. **Не заявляю, что путь сегодня реально едет в
  проде** — это не подтверждено логом (`GGML_TURBO_FA_DEBUG` никто не
  включал и не смотрел) — это предмет самого аудита, не факт для отчёта.

## Что реально нужно проверить

Живой gate (`fattn.cu:3320-3329`), выписан точно:

```cpp
const bool turbo_matched = K->type == V->type && turbo_kv;
const bool turbo_mma_supported =
    turbo_matched &&
    (K->type == GGML_TYPE_TURBO4_0 ||
     K->type == GGML_TYPE_TURBO3_0 ||
     K->type == GGML_TYPE_TURBO2_0);
if (turbo_mma_fused && turbo_mma_supported && Q->ne[1] <= 4 &&
    (Q->ne[0] == 128 || Q->ne[0] == 256) &&
    turing_mma_available(...)) { /* fused MMA */ }
```

Т.е. этот КОНКРЕТНЫЙ gate (raw-turbo fused, читает turbo-байты прямо в
MMA-кернеле) — только straight turbo2/3/4 с K==V одного типа. **Но это
не значит «TCQ всегда VEC»** — ниже по той же функции (`fattn.cu:3378+`)
есть ВТОРОЙ MMA-путь, `turbo_prefill_mma_safe` → `ggml_cuda_turbo_prefill_attend`
(«prefill-dequant»): гейтится через `ggml_cuda_turbo_prefill_mma_can_make_f16(type)`,
которая возвращает true для `F16` ИЛИ любого `ggml_cuda_fattn_is_turbo_kv_type`
— TCQ входит в этот список (см. `TURBO4_TCQ` в соседнем
`ggml_cuda_fattn_kv_rank`). Значит TCQ **может** попасть в MMA через
dequant-to-F16 prefill-путь, просто не через raw-fused. Смешанные K/V
(`turbo_k_classic_v_prefill`) тоже имеют отдельную ветку в этом
prefill-пути, не факт что всегда VEC — это и предстоит аудиту
задокументировать явно, п.2 ниже.

Этот же блок (`fattn.cu:3341-3357`) делает **собственную Q pre-rotation**
внутри fused-пути (`k_turbo_fwht_forward` кернель, прямо тут, не через
граф) — важно для T002: если T002 добавит graph-side ротацию Q без
учёта того, что CUDA FA (и straight-VEC, и этот fused путь) уже ротирует
Q сама, получится двойная ротация. Держать это в голове при ревью обоих
тикетов вместе.

1. **Санкционировать дефолт.** Решить явно (не по умолчанию бутстрапа):
   `GGML_TURBO_MMA_FUSED` default ON — оставить, или потребовать
   осознанного opt-in. Донор сам себе противоречит (комментарий
   «DEFAULT OFF» рядом с кодом, дающим default ON) — не наследовать эту
   путаницу, зафиксировать НАШЕ решение отдельной строкой в
   DECISIONS.log.
2. **Type matrix, все маршруты.** В `fattn.cu` минимум ТРИ семьи для
   turbo-типов: raw-fused MMA (`turbo_mma_supported`, straight only),
   prefill-dequant MMA (`turbo_prefill_mma_safe`, шире — включает TCQ и
   смешанные K/V при выполнении условий), и **unified decode route** —
   когда ни один из двух gate'ов выше не сработал, управление уходит в
   общий route planner (`fattn.cu:3707`, `switch (selected_kernel)` по
   `best_fattn_kernel`), который сам выбирает между `TILE`, `VEC`,
   `WMMA_F16`, `MMA_F16` — **не «VEC fallback»**, это отдельная система
   выбора кернеля со своей логикой, ошибочно упрощённая в предыдущей
   правке тикета до одного VEC-варианта. Задокументировать (в коде или
   соседнем md) полную таблицу: тип K × тип V × prefill/decode × какой
   из ТРЁХ семейств реально исполняется, а для третьего — ещё и какой
   конкретно `best_fattn_kernel` внутри него. Не предполагать по
   чтению одного gate — трассировать `GGML_TURBO_FA_DEBUG` живьём на
   реальных комбинациях, вывод кернеля пишет путь явно
   (`path=fused-mma`/`path=prefill-dequant`/`path=decode-dequant-or-vec`).
3. **Корректность.** Донорский комментарий утверждает
   «correctness-validated (coherent output, KLD == VEC baseline
   0.008396)», но НЕ bit/token-identical с VEC (разный f16-reduction
   order в MMA vs VEC, ~1 токен из 25 на грани). Пересчитать KLD на
   НАШЕЙ сборке/модели — не доверять донорской цифре как факту про нас.
4. **VEC/MMA A/B.** `llama-bench` на прямом сравнении: реальный выигрыш
   в токенах/сек на наших моделях (Qwythos, LFM2.5 если применимо —
   но у LFM2.5 turbo не используется, см. трек сегодняшней сессии про
   `Invalid input batch`, не путать эти два дерева).

## Верификация

- Если после аудита решение «оставить default ON» — зафиксировать в
  DECISIONS.log новым D-номером, с цифрами KLD/A-B, не просто «и так
  работало».
- Если решение «сделать opt-in» — один коммит, инверсия дефолта в
  `fattn.cu:3307-3315`, живой regression-прогон на модели, которая
  сегодня фактически едет на fused-пути (проверить какая — не
  предполагать).
