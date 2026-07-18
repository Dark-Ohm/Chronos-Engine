# GROK.md — задания для Grok (Chronos-Engine)

Файл держит только текущее задание, история — `git log -- GROK.md`.
Правила: релизный `build/` пересобирать можно, отладка — в `build-debug/`.
Не коммитить. Никаких AI-трейлеров. Отчёт — `grok-report.md` (перезаписывай).

## Приёмка G-2: ПРИНЯТО ✓

Мой независимый смок подтвердил: turbo3/turbo3 → «Paris», связный reasoning,
24.1 t/s. Корневая причина (V в rotated domain без inv-WHT после FA + CPU
no-op TURBO_WHT + CPU quantize-стабы) диагностирована точно, фикс минимальный,
чужой kvarn-WIP не тронут. Закоммичено `c219b47e2`. Два чистых закрытия
подряд — уровень.

Residual-лист G-2 (кандидаты в будущие задания, пока НЕ задание):
- auto-asymmetric K (TheTom: GQA≥6 → K=q8_0) не портирован;
- turbo4 шумнее turbo3/tcq (content иногда пустой);
- graph Q pre-rotate для non-CUDA бэкендов.

## Текущее задание

Нет активного задания.
