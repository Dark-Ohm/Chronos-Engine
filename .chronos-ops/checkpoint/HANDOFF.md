# HANDOFF — контекст для новой сессии Архитектора

**Обновлено: 2026-08-15 #5 — ФИКС ПЕРЕНЕСЁН В ОСНОВНУЮ ВЕТКУ И
ЗАКОММИЧЕН (см. git log). Продакшн CUDA-билд ещё НЕ пересобран — see
п.1 в чек-листе ниже. Раунд 6 (kvarn Z-4) ниже НЕ трогали 27 дней,
статус не проверен, дерево чистое на 2026-07-19, `8cb95a13f`.**

## РЕШЕНО: `Invalid input batch` на конкурентных запросах — root cause + фикс проверен живьём

**Откуда всплыло:** отладка Hindsight (self-hosted память
ChronOS-экосистемы), которая гоняет `lfm2.5-2.6b` через
`infra/llama-swap` для retain/main/reflect. Retain периодически ловил
`HTTP 500: Invalid input batch`, а иногда (хуже) тихо записывал в банк
факты из чужого конкурентного запроса — контекст одной retain-задачи
утекал в другую.

**Root cause (найден `git bisect` + подтверждён живым патчем, не
гипотеза):**

Коммит `367ca3bb8` («kvarn : seq_rm гейтинг (O-6+O-8)», 18 июля 2026)
добавил в `tools/server/server-context.cpp` гейт вокруг вызова
`common_context_seq_rm()` при переиспользовании слота:

```cpp
if (ctx_tgt_seq_rm_type != COMMON_CONTEXT_SEQ_RM_TYPE_FULL) {
    common_context_seq_rm(ctx_tgt, slot.id, p0, -1);
}
```

Замысел — не дёргать частичный `seq_rm` для kvarn-контекстов (они
поддерживают только полное удаление). Но `ctx_tgt_seq_rm_type`
считается функцией `common_context_can_seq_rm()`, у которой TRI
независимых пути дают одинаковый результат `FULL`: recurrent-state
(`RS`, не наш случай), kvarn (`llama_kvarn_enabled`, тоже не наш
случай) и **старый fallback-проб** — если у модели `llama_memory_seq_rm`
пробный вызов возвращает `false` (частичное удаление физически не
поддерживается движком памяти этой модели), классификация тоже `FULL`.

Живая диагностика (`fprintf` прямо в `common_context_can_seq_rm`,
модель `LFM2.5-1.2B-Instruct`, CPU-билд):
```
DIAG common_context_can_seq_rm: res=2 (FULL), n_rs_seq=0, kvarn_enabled=0
```
LFM2.5 — НЕ recurrent-state, НЕ kvarn, но всё равно `FULL` — через
fallback-проб. Гейт из `367ca3bb8` проверяет только РЕЗУЛЬТАТ (`FULL`),
не ПРИЧИНУ — и тихо пропускает `seq_rm` для LFM2.5 тоже. Грязный KV
кэш с предыдущего запроса остаётся в слоте → следующий конкурентный
запрос стартует с позиции 0 при реальной позиции кэша 13 →
`the sequence positions must remain consecutive: Y = X + 1` →
`Invalid input batch`.

Коммит сам себя честно предупреждал в сообщении — «3/4 негейченных
сайтов защищены» — работа была заведомо неполной, просто гэп не был
виден до конкурентной нагрузки на не-kvarn модель.

**Верификация (сегодня, `../Chronos-Engine-upstream-test`, CPU-билд):**
- Чистый апстрим `e920c523e` (13 июля, точка нашего форка) — 5/5 раундов
  чисто. Баг НЕ унаследован из апстрима.
- `git bisect` вручную (10 build+test циклов, каждый 5×2 конкурентных
  запроса) → `367ca3bb8be7ed1185994039e2fe7666c823b7c2 is the first
  'bad' commit`, родитель `a455e7458` чист.
- Гипотеза про `cparams.kvarn = params.kvarn` (третий хунк того же
  коммита) — проверена и ОПРОВЕРГНУТА: убрал только эту строку, баг
  остался (5/5 падает).
- Настоящая причина подтверждена диагностическим `fprintf` (см. выше).
- **Фикс применён и проверен:** заменил во всех 4 местах
  `server-context.cpp` условие `seq_rm_type != FULL` на
  `!llama_kvarn_enabled(ctx)` — гейтит именно по причине (kvarn),
  не по результату классификации. После фикса: **10/10 раундов на 2
  конкурентных + 3/3 на 3 конкурентных, 0 ошибок в логе.**

**Финальный diff (в worktree `../Chronos-Engine-upstream-test`, НЕ в
основной ветке):**
```diff
--- a/tools/server/server-context.cpp
+++ b/tools/server/server-context.cpp
@@ -3358,10 +3358,10 @@ private:
                     SLT_TRC(slot, "cached n_tokens = %d, memory_seq_rm [%d, end)\n", slot.prompt.n_tokens(), p0);
-                    if (ctx_tgt_seq_rm_type != COMMON_CONTEXT_SEQ_RM_TYPE_FULL) {
+                    if (!llama_kvarn_enabled(ctx_tgt)) {
                         common_context_seq_rm(ctx_tgt, slot.id, p0, -1);
                     }
-                    if (ctx_dft && ctx_dft_seq_rm_type != COMMON_CONTEXT_SEQ_RM_TYPE_FULL) {
+                    if (ctx_dft && !llama_kvarn_enabled(ctx_dft)) {
                         common_context_seq_rm(ctx_dft, slot.id, p0, -1);
                     }
@@ -3889,10 +3889,10 @@ private:
             slot.sampled = ids.back(); // last accepted token
             SLT_DBG(slot, "add accepted tokens: sampled=%d, ids.size=%zu, n_draft=%zu\n", slot.sampled, ids.size(), n_draft);
-            if (ctx_tgt_seq_rm_type != COMMON_CONTEXT_SEQ_RM_TYPE_FULL) {
+            if (!llama_kvarn_enabled(slot.ctx_tgt)) {
                 common_context_seq_rm(slot.ctx_tgt, slot.id, slot.prompt.tokens.pos_next(), -1);
             }
-            if (slot.ctx_dft && ctx_dft_seq_rm_type != COMMON_CONTEXT_SEQ_RM_TYPE_FULL) {
+            if (slot.ctx_dft && !llama_kvarn_enabled(slot.ctx_dft)) {
                 common_context_seq_rm(slot.ctx_dft, slot.id, slot.prompt.tokens.pos_next(), -1);
             }
```

**Что осталось сделать:**
1. ~~Перенести диф в основную ветку~~ — СДЕЛАНО, коммит `df7e25a89`
   («server : fix seq_rm gate to check kvarn directly, not FULL
   classification»), запушен в `chronos-main`.
2. ~~Продакшн CUDA-билд пересобрать~~ — СДЕЛАНО (2026-08-15, ~14:21).
   Полная пересборка (`cmake --build build -j$(nproc)`), подтверждено:
   `build/bin/llama-server` mtime 14:21:40, `libggml-cuda.so`
   110 902 864 байта mtime 14:17:48, версия `10044 (02925c769)` —
   совпадает с HEAD. Рестарт алиасов `lfm2.5-2.6b`/`lfm-consol` через
   llama-swap — ещё НЕ выполнен.
3. **Живой конкурентный тест на настоящем `lfm2.5-2.6b` через
   `infra/llama-swap` — сознательно отложенный следующий шаг**, не
   забытый. CPU-only worktree-тест (LFM2.5-1.2B) уже подтвердил фикс
   10/10 + 3/3 раундов. Прод-подтверждение через реальный конкурентный
   retain/main/reflect от Hindsight — ждёт явного запроса.
4. Убрать worktree: `git worktree remove
   ../Chronos-Engine-upstream-test` — ПОСЛЕ живого прод-теста п.3, не
   раньше (там же весь диагностический контекст на случай регресса).
5. Отдельно, не блокер: `reasoning_content` всё равно генерится у
   `lfm2.5-2.6b` при `--reasoning off --jinja` — жрёт токены/время на
   каждом retain-вызове (2336 output tokens на один короткий факт).
   См. `lfm25-reasoning-and-kv-traps` в памяти Claude.
6. Раунд 6 ниже (Z-4, hot-window retrieval bug) — статус на 27+ дней
   протух, НЕ считать активным без проверки живым тестом заново.
7. **Новое:** пять тикетов в `.chronos-ops/active/` (T001, T002,
   T003a/b/c) — гэпы из донора `thetom-turboquant` (turbo4 fused-MMA
   аудит, Q pre-rotate по инварианту) и пересобранная раздача O-11
   (Phase 2 H2O, только T003a безопасен сейчас, T003b/T003c
   заблокированы на Z-4 + отдельные предусловия — см. сами тикеты).
   Три прохода ревью (свой + два от «Архимага»), все найденные ошибки
   исправлены и проверены построчно. Готовы к раздаче исполнителям.

---
**Обновлено: 2026-07-19, ночь (раунд 6 роздан; репо приведён к
продакшн-виду; G-4 нашёл баг корректности Phase 1 → Z-4 топ-приоритет).**

## Кто ты и как работаешь

Lead Architect Agent проекта Chronos (форк llama.cpp: KVarN/TurboQuant
KV-сжатие + MoE-оптимизации). Сам НЕ кодишь (исключение: однострочная
механика по прецеденту). Задания миньонам — через их файлы в
`.chronos-ops/` (у миньона с активным заданием файл временно в КОРНЕ
репо, live-процесс читает его оттуда; после приёмки — обратно в
`.chronos-ops/`). **Конвенция: файл держит ТОЛЬКО текущее задание**
(полная перезапись, история — `git log`), отчёты в `<имя>-report.md`
рядом, принятые уезжают в `.chronos-ops/dump/`. Приёмка: КАЖДОЕ
утверждение отчёта сверять с деревом грепами/диффами; числа и ссылки на
литературу — с первоисточниками (WebFetch/WebSearch), это трижды ловило
фабрикации Hermes. Смоки гоняешь сам (фоном), большие билды — пользователь
(«--- BUILD DONE ---»). Канон — ARCHITECTURE.md (в корне, ЕДИНСТВЕННЫЙ),
отклонённое — DECISIONS.log (D-001…D-015).

## ГДЕ МЫ: движок валидирован, Phase 1 offload РАБОТАЕТ по VRAM, но БАГ качества

**Цель проекта: 262144 контекста на RTX 3070 8GB без явной потери
качества.** База: kvarn4@65536. Путь: tiered hot/cold offload (D-014),
битностью 262K не решается (веса 5.9GB + фон десктопа съедают всё).

- **Phase 1 offload (Z-2/Z-3, `cc4d8d597`) собран, смокнут, принят по
  инфраструктуре**, НО G-4 нашёл **баг корректности**: `--kv-hot-size`
  ломает retrieval ДАЖЕ когда весь промпт внутри hot-окна (короткий A/B:
  промпт 1763 токена, окно 4096; без флага игла находится, с флагом —
  мусор «Dolor»). Это НЕ деградация по дизайну (та ожидается только ЗА
  окном) — это баг в SWA/`mat_idxs`-обвязке Z-3. → **Z-4, топ-приоритет
  раунда 6.** Гипотеза (в ZED.md): `view()` читает `mat_idxs` =
  абсолютные позиции токенов, а `store()`/кернел `GGML_OP_KVARN_VIEW`,
  возможно, ждёт slot-индекс кольца — разные пространства значений, не
  крашится но читает не тот слот.
- **Phase 1 по VRAM/масштабированию — PASS (G-4 §5):** GPU record-ring
  = размер окна, не контекста (hot@65536 VRAM ≈ hot@8192; nohot@63488
  на 526 MiB больше). Claim Z-2/Z-3 держится.
- **Формальная валидация (G-3 `0be1eb542`, подтв. G-4 `88d4a06c1`)**:
  parity 13994/13994; bench f16 2374/65.4 (выше baseline 2298/61);
  PPL@8192 kvarn4 в шуме (−0.04% в G-4, −0.22% в G-3); без флага
  поведение идентично до-Z-2 (PASS).
- **kvarn4@63488 OOM — ГЭП ЗАКРЫТ (G-4 §4):** был бюджет VRAM, не баг.
  При фоне ~0.75GB (ollama снесена) 47K-префилл проходит и на -np 1, и
  на 4 слотах, игла находится. Оговорка: на 8GB при фоне ≥1.5GB +
  большой prefill + slots=4 всё ещё легко словить OOM (это бюджет, не код).
- **M-1 (`c5805c7ff`)**: auto-asymmetric K из TheTom (GQA≥6 → K=q8_0,
  opt-out `TURBO_AUTO_ASYMMETRIC=0`). На Qwythos — мёртвый код: ratio 4.

## Раунд 6 (2026-07-19) — В РАБОТЕ

| Задание | Кто | Что |
|---|---|---|
| **Z-4** | Zed | **КРИТ:** починить retrieval-баг hot-window (ZED.md в КОРНЕ) |
| O-11 | OpenCode | Phase 2 (H2O) плюмбинг: поля + `--kv-h2o-groups`, БЕЗ кернела |
| M-2 | Mimo | llama-bench whitelist: добавить turbo/kvarn типы |
| C-3 | Cline | test-backend-ops: кейсы для KVARN_VIEW/turbo_wht/turbo quantize |

Приняты в начале раунда: G-4 (валидация Z-2/Z-3 + нашёл баг), M-1.

## Следующие шаги (по приоритету)

1. **Ждать Z-4** — без исправного retrieval внутри окна весь Phase 1
   бесполезен, а Phase 2 (H2O) поверх него смысла не имеет. После фикса —
   G дать повторный NIAH (внутри окна = находит, за окном = не находит
   ПО ДИЗАЙНУ). Только тогда Phase 1 «работает как заявлено».
2. O-11/M-2/C-3 — принять по мере поступления (все безопасно параллельны
   с Z-4, read-путь не трогают).
3. После Z-4: Phase 2 kernel/graph (scoring pass) — следующее задание
   OpenCode поверх его же O-11 плюмбинга.
4. Отложено: server-context :2863 (context-shift для kvarn не гейтится,
   на практике не триггерился); group-boundary prompt-reuse; turbo
   residuals (turbo4 шум, Q pre-rotate non-CUDA); lag-race в
   `enqueue_cold_offloads` (kvarn.cpp:1032, ревью ДО Phase 2 prefetch).

## Состояние репо (приведён к продакшн-виду 2026-07-19)

- **Веб-UI выключен** (`b20dc275c`): `LLAMA_BUILD_UI`/`LLAMA_USE_PREBUILT_UI`
  = OFF в CMakeLists.txt (Chronos — серверный движок). Апстримный
  `tools/ui/` не тронут. Восстановить: `-DLLAMA_BUILD_UI=ON`. ВАЖНО:
  нужна чистая переконфигурация build/ — иначе CMake вошьёт закешированные
  assets (build/tools/ui уже вычищен вручную).
- **Оркестрация в `.chronos-ops/`** (`2b3d32ba7`): GROK/HERMES/CLINE/
  MIMO/OPENCODE/HANDOFF/zed-2/OMP/PREVIOUS/dump — не в корне. Корень: код
  + README/LICENSE/ARCHITECTURE/AGENTS/DECISIONS/CLAUDE.
- **`.gitignore`** глушит локальный мусор: `.claude/` (личная синхра
  скиллов), `.rules`, `.hermes/`, `.mimocode/`, `.devops/nginx*`,
  персональные билд-скрипты, `pocs/vdot/verify_q2_0_dedup`.
- **README переписан** (`88d4a06c1`) под форк; **dump дедуплицирован**
  (копии переименованы по раунду/теме).
- **ВНИМАНИЕ на будущее:** commit `2f8947fb8` (restructure docs, гонял
  пользователь) создал был дубль-канон `docs/ARCHITECTURE.md` и перенёс
  фейковое FLOPs-число Hermes — вычищено в `ab554c416`. Канон
  ARCHITECTURE.md — ОДИН, в корне.

## Миньоны

- **Zed** — 3/3 образцово (Z-1 опровержение с цифрами; Z-2 сам назвал
  свой риск; Z-3 отверг обе мои гипотезы с доказательством). Сейчас на
  Z-4 (баг корректности, который сам же и внёс в Z-3 — но не заметить
  его без NIAH было нельзя). `zed-2.md` — стресс-тест через Zed *editor*,
  живой трек пользователя, НЕ трогать.
- **Grok** — 4/4 блестяще (G-1..G-4). Единственный с правом пересборки
  релизного `build/`. G-4 — образец методологии (короткий A/B изолировал
  баг корректности от дизайн-деградации). Свободен после Z-4.
- **OpenCode** — надёжнейший (O-3..O-10 чистые). На O-11 (Phase 2 плюмбинг).
- **Mimo** — 1/1 принят с 1 названной ошибкой (выдумал GGUF-мету вместо
  проверки). На M-2. Повтор названной ошибки = страйк.
- **Cline** — надёжен, на C-3. Baseline pp512=2298/tg64=61 в CLINE.md.
- **Hermes** — **УВОЛЕН** (`162d21276`) после H-11b: систематическая
  фабрикация чисел (55ms vs фактические минуты, трижды) и реквизитов
  источников. HERMES.md — некролог. Урок: «имитация исправления» (верная
  формула + приписанное старое неверное число) ловится ТОЛЬКО подстановкой
  чисел в формулу руками.
- **omp** — уволен ранее. kilo — файла нет.

## Смоки: чем и как

`cd models/main && PORT=8099 ./run-server.sh qwythos-v3 -c 65536 -ub 256 -fit off`
(kvarn4 по умолчанию; `KVARN_K/V=N` — битность, `--no-kvarn` — выключить;
дефолтный порт скрипта 8081, Zed editor ходит на 8099!). Hot-window:
`... --kv-hot-size 4096`. Turbo: `--no-kvarn --cache-type-k turbo3
--cache-type-v turbo3 -c 8192`. kvarn всегда с `-fit off` (fit-margin
1024MiB отклоняет kvarn, D-012). **Фон VRAM: `nvidia-smi
--query-gpu=memory.used --format=csv,noheader` перед каждым запуском —
ollama СНЕСЕНА, фон ~0.75GB (не прежние 1.6GB); потолки пересчитывать от
факта.** pkill строго `-x llama-server` (`-f` убьёт собственный shell).
NIAH-паттерн: игла-факт в начале/конце, вопрос в конце, проверять точный
токен в ответе. Крашы: `coredumpctl debug` разрешён (Release режет
ассерты — плохой indices не abort'ит, а segf'ит). Vivaldi не трогать
только когда пользователь в нём работает.

## Модель-эталон (проверено по GGUF, не по памяти)

`models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M.gguf`: qwen35 гибрид,
block_count=33 (attention каждый 4-й: full_attention_interval=4, 8 attn
слоёв + 1 nextn), head_count=**16**, head_count_kv=**4** (GQA ratio 4),
key/value_length=256. KV мал: 596MiB@65536 kvarn4 — потому 262K упирается
не в битность, а в веса+фон (см. D-014).

## Инфраструктура памяти (Claude)

Hindsight self-hosted (podman: hindsight 8888/9999/8080, embeddings,
reranker; бэнк chronos-ecosystem). Ловушки: (1) после краха сессии
умирает pasta port-forwarder — `podman restart` всех трёх +
`/reload-plugins`; (2) в ~/.hindsight/claude-code.json строго
`http://127.0.0.1:8888`, НЕ localhost (IPv6-ловушка). Fallback retain:
REST `POST /v1/default/banks/chronos-ecosystem/memories`. Файловая память
Claude — в `~/.claude/projects/.../memory/MEMORY.md` + отдельные файлы.

## История (сжато; подробности — git log и .chronos-ops/dump/)

- Раунды 1-3: kvarn-активация (7 крашей закрыты) → Фаза 4 → hybrid
  passthrough + MoE prefetch (81729eb43).
- Раунд 4: G-1 (`8e7002113`) → O-10 дизайн (`5ac11a7f8`) → G-2+kvarn
  (`c219b47e2`) → docs-синхронизация. Оба стека (kvarn, turbo) end-to-end.
- Раунд 5: `a86efb9a6` → M-1 (`c5805c7ff`) → Hermes уволен (`162d21276`)
  → G-3 (`0be1eb542`).
- Раунд 6 + чистка репо (2026-07-19): docs-фикс (`ab554c416`), UI off
  (`b20dc275c`), Z-2/Z-3 (`cc4d8d597`), оркестрация в .chronos-ops
  (`2b3d32ba7`), README (`88d4a06c1`), раунд 6 роздан (`3894ac120`).
- Уроки процесса: НЕ `git add -u` при docs-коммитах; диффы миньонов — на
  вложенность скобок; отчёты — построчно с деревом; числа/ссылки
  литературы — только через первоисточник; формулы — подставлять числа
  руками; метаданные модели — вскрывать GGUF, не верить «стандартам»;
  «не падает» ≠ «работает» (Z-3 чинил segfault, но корректность retrieval
  ловится только NIAH — G-4).
