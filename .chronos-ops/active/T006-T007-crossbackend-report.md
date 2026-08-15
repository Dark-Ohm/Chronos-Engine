# Кросс-бэкенд: закрытие связки T006 + T007

**Дата:** 2026-08-15
**Исполнитель:** Архимаг (GPU только на этой машине)
**Статус:** КРИТЕРИЙ ВЫПОЛНЕН — домены CPU и CUDA совпадают.

## Среда

- HEAD: `e9e4abc6e` (T006), поверх `f040cf113` (T007).
- Билды пересобраны на HEAD: `build-debug` (CUDA, `GGML_CUDA_FA_HALF_QUANTS=ON`,
  Release) и `build-cpu` (`GGML_CUDA=OFF`, Release). Без пересборки проверка
  бессмысленна: старые билды содержат Гауссову QR.
- GPU освобождён: `systemctl --user stop llama-swap.service` (llama-swap держал
  4.1 ГБ из 8). После прогона поднят обратно, Hindsight `/health` = 200.
- Модель/корпус те же, что в T002/T006: Qwythos-9B Q4_K_M,
  `.chronos-ops/active/t002-cpu/corpus.txt`, `-c 128`, `-s 42`.
- Харнесс: `.chronos-ops/active/t006-cross.sh` (fail-closed), артефакты —
  `.chronos-ops/active/t006-cross/`.

## A. PPL turbo4/turbo4 на обоих бэкендах

```
CPU  (build-cpu,   -ngl 0):  PPL = 2.4266
CUDA (build-debug, -ngl -1): PPL = 2.4325
```

Разница 0.24% при CI ±0.26 — один класс. До T007 CPU давал 84.66 на том же
корпусе.

## B. Передача KV-кэша между бэкендами (`--prompt-cache`)

Проверено в обе стороны, оба раза кэш **реально использован** (в логе
`replayed last token from session`, ветка `completion.cpp:389`):

| Направление | Кэш использован | Ошибки | Продолжение (`--temp 0`) |
|---|---|---|---|
| CPU пишет -> CUDA читает | replayed=1, wiped=0 | 0 | `Paris. This fact is universally recognized...` |
| CUDA пишет -> CPU читает | replayed=1, wiped=0 | 0 | `Paris.\nThe capital of France is Paris.` |

Первый токен после replay в обоих направлениях совпадает с однобэкендным
базлайном (`Paris`); дальше тексты расходятся — это численность бэкендов, а
не расхождение доменов. При несовпадении доменов (случай до T007) replayed-KV
даёт мусор сразу, как PPL 95.74 в T002.

**Вывод:** байты turbo4-KV, записанные одним бэкендом, корректно читаются
другим. D-018 подтверждён живьём, связка T006+T007 закрыта.

## Побочная находка (новый тикет)

Первая редакция харнесса использовала `--prompt-cache-all` и дала
ложноположительный результат: лог показывал `session file has exact match for
prompt!` и `errors=0`, но кэш при этом **выбрасывался**. Механика —
`completion.cpp:372-378`: если сохранённых токенов больше, чем совпавших,
вызывается `llama_memory_seq_rm()`, который для turbo-KV возвращает false ->
`llama_memory_clear(mem, true)`, `session_tokens.clear()`, полный пересчёт.
Пользователю печатается только `unable to reuse common prefix (for example,
when the memory is recurrent)` — про turbo там ни слова.

То есть prompt-cache с turbo-KV молча деградирует в полный пересчёт при любом
частичном совпадении промпта. Это третий гэп того же класса, что
`iq4_nl`-whitelist (T001) и llama-bench без turbo. Заведён отдельным тикетом.

В харнессе оставлена явная проверка «кэш использован, а не просто открыт»
(`replayed>=1 && wiped==0`), иначе тест ничего не доказывает.
