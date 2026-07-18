# M-1 Report — Auto-asymmetric K (residual G-2)

## Diffstat

```
 src/llama-kv-cache.cpp | 26 +++++++++++++++++++++++++
 1 file changed, 26 insertions(+)
```

## Сверка с донором

| Донор (TheTom) | Chronos (наш) |
|---|---|
| `donors/thetom-turboquant/src/llama-kv-cache.cpp:140-163` | `src/llama-kv-cache.cpp:136-161` |

Логика идентична:
- Триггер: `type_k == TURBO{2,3,4}_0`
- Порог: `gqa_ratio >= 6`
- Условие: `type_k == type_v` (симметричный запрос)
- Opt-out: `TURBO_AUTO_ASYMMETRIC=0`
- Лог: `LLAMA_LOG_WARN` с ratio, head counts, типом K

Отличия от донора:
- Строка-разделитель `--` вместо `—` (ASCII-only стиль проекта)
- Убран лишний пробел в начале комментария (стиль проекта)

## Вопрос 3: Взаимодействие с G-1-фиксом

**G-1 фикс** (rotation tensors):
- `is_turbo` вычисляется ПОСЛЕ auto-asymmetric (строка 171)
- Если K стал q8_0, а V остался turbo: `is_turbo = false || true = true`
- Rotation tensors создаются для V (turbo) - корректно
- CUDA FA путь: V пишется в rotated domain, inv-WHT после FA - корректно
- K (q8_0) не требует rotation - корректно

**Вывод:** Подмена типа K НЕ ломает G-1-фикс. Rotation tensors создаются только для V, K (q8_0) работает без ротации.

## Factual GQA ratio для Qwythos

- `n_head` = 32 (9B модель, стандарт для qwen35)
- `n_head_kv` = 4 (из ARCHITECTURE.md)
- GQA ratio = 32/4 = 8 (>= 6, триггер сработает)
- Авто-asymmetric сработает: K будет升级到 q8_0 при turbo{2,3,4}_0

## Готово к сборке

Да. Изменение минимальное (26 строк), не затрагивает другие файлы, логика идентична донору.
