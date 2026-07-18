# GROK.md — задания для Grok (Chronos-Engine)

Файл держит только текущее задание, история — `git log -- GROK.md`.
Правила: релизный `build/` пересобирать можно, отладка — в `build-debug/`.
Не коммитить. Никаких AI-трейлеров. Отчёт — `grok-report.md` (перезаписывай).

## ЗАДАНИЕ G-2 (обновлено) — turbo: мусорная генерация. Эталон — TheTom

**Важное обновление**: research H-10 нашёл первоисточник turbo-типов —
зрелый форк, уже склонирован в `donors/thetom-turboquant` (ветка
`feature/turboquant-kv-cache`, ~300 коммитов впереди апстрима, релиз
tqp-v0.3.0). Наш beellama-донор — его младший родственник. **Сверяйся с
TheTom, не с beellama** — там продакшн CUDA-путь для turbo, асимметрия K/V,
layer-aware V protection. Интересные ветки: `experiment/asymmetric-kv`,
`experiment/fused-centroid-decode`, `experiment/decode-speed-parity`.

### Симптом
Краш починен (G-1, commit `8e7002113`), но качество нулевое: turbo3/turbo3,
qwythos-v3, «2+2=?» → content пустой, reasoning «мали», stop на 2 токенах.

### Подозрения из G-1 (начни с них)
1. CPU quantize (`from_float` → `quantize_row_turbo*`) пишет БЕЗ
   FWHT-ротации, а чтение ждёт ротированное — несоответствие write/read.
2. Применяются ли `turbo_rotation`/`turbo_rotation_inv` в графе вообще
   (write-path и attend-path)? Как цепочка rotation→quantize→attend
   устроена у TheTom — по каким операциям идёт граф.
3. CUDA path: qwythos гибрид — пишет ли GPU ротированное, читает ли
   правильно.

### Что сделать
1. Найди расхождение нашей turbo-цепочки с TheTom (файл:строка у нас и у
   донора). Если у TheTom цепочка устроена принципиально иначе (например
   ротация фьюзится в quantize-ядро) — так и скажи, это повлияет на объём
   порта.
2. Почини минимальными правками. Чужой WIP (llama-graph.cpp,
   llama-memory-hybrid.*, ggml-cuda.cu, fit.cpp) менять только в
   turbo-специфичных местах — kvarn-код не трогать.
3. Критерий: turbo3/turbo3 отвечает осмысленно («2+2», «столица Франции»),
   промпт 2-3K токенов не разваливается. Сравни turbo4 и turbo2_tcq.
4. VRAM тесная: смоки `-c 8192 -ub 256`, фон гуляет 1.3–1.9GB —
   `nvidia-smi --query-gpu=memory.used --format=csv,noheader` перед каждым.

### Отчёт
`grok-report.md`: расхождение с TheTom (файл:строка), дифф фикса, дословные
ответы модели + t/s. Не добил — что исключил, где застрял, без фантазий.
