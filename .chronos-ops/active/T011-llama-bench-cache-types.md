# T011 — llama-bench: turbo/kvarn в `-ctk`/`-ctv`

**Роль:** `tools/llama-bench/llama-bench.cpp` (`ggml_type_from_name`).
**Приоритет:** P3 — без этого нельзя честно сравнить turbo/kvarn с f16
тем же инструментом; обход через server-timings уже делали в G-3.
**Источник:** выписано из `.chronos-ops/agents/MIMO.md` (задание M-2).
Тот же гэп перечислен в хвостах T001 (`T001-report.md`).
**Зависимости:** нет. С T004/T005/T008 не пересекается по файлам.

## Что есть сейчас

`ggml_type_from_name` (`llama-bench.cpp:478`) знает только
`f16,bf16,q8_0,q4_0,q4_1,q5_0,q5_1,iq4_nl`. Неизвестное ->
`GGML_TYPE_COUNT`.

`common/arg.cpp` `kv_cache_types` (строки 301-321) уже принимает
turbo2/3/4_0 и turbo2/3/4_tcq. `kvarn2..8` — **псевдотипы**, не
`ggml_type`: парсятся отдельно (`kvarn_bits_from_cache_type`), в enum
их нет.

## Что сделать

1. Сверить список с `common/arg.cpp` по факту, не по памяти.
2. Добавить в `ggml_type_from_name` недостающие **настоящие** ggml-типы
   из whitelist (`turbo2`/`turbo3`/`turbo4` и `_tcq` — точные строки
   как возвращает `ggml_type_name`, не выдумывать алиасы).
3. `kvarn*` в этот `if (s == ...)` пихать нельзя: не `ggml_type`. Либо
   отдельный парсер по образцу `arg.cpp` (если bench вообще умеет
   выставить kvarn-кэш), либо в отчёте явно: «kvarn в bench не
   поддерживается, только turbo-типы» + почему. Не маскировать kvarn
   чужим enum-значением.
4. Скоуп — только `-ctk`/`-ctv` в этом файле. `common/arg.cpp` не трогать.

## Границы

Только `tools/llama-bench/llama-bench.cpp`.

## Верификация

- `llama-bench -ctk turbo4 -ctv turbo4 ...` парсит тип и стартует
  (не «unknown type»). Живой прогон на Qwythos не обязателен для
  приёмки парсера; если гоняется — числа в отчёт.
- Старые типы (`f16`, `q8_0`) не сломаны.
- Попытка `-ctk kvarn4`: либо честный путь, либо понятная ошибка, не
  тихий `GGML_TYPE_COUNT`.
