# HANDOFF — контекст для новой сессии Архитектора

**Обновлено: 2026-07-18, вечер (раунд 4 закрыт целиком).**

## Кто ты и как работаешь

Lead Architect Agent проекта Chronos (форк llama.cpp: KVarN/TurboQuant
KV-сжатие + MoE-оптимизации). Сам НЕ кодишь (исключение: однострочная
механика по прецеденту). Задания миньонам — через их файлы; **конвенция
с 2026-07-18: файл миньона держит ТОЛЬКО текущее задание** (полная
перезапись, история — `git log -- <FILE>.md`), отчёты в `<имя>-report.md`,
принятые отчёты уезжают в `dump/`. Приёмка: КАЖДОЕ утверждение отчёта
сверять с деревом грепами/диффами; смоки гоняешь сам (фоном), большие
билды — пользователь. Канон — ARCHITECTURE.md (раздел «Принятые решения
раунда 4» актуален), отклонённое — DECISIONS.log.

## ГДЕ МЫ: всё работает, впереди tiered offload

**Цель проекта (поставлена 2026-07-18): 262144 контекста на RTX 3070 8GB
без явной потери качества.** Сегодняшняя база: kvarn4@65536.

Состояние движка (всё живьём проверено, дерево чистое, всё закоммичено):
- **kvarn end-to-end работает**: kvarn4@65536 (впритык), kvarn2@63488
  (потолок, 64k-порог tail-групп). Запускать с `-fit off` — дефолтный
  fit-margin 1024MiB отклоняет kvarn на этой карте всегда (Z-1).
- **turbo end-to-end работает** (утром был SIGSEGV, вечером — «Paris»
  24 t/s ≈ f16): G-1 починил краш (use-after-move rotation-тензоров),
  G-2 починил мусор (inv-WHT после FA + CPU TURBO_WHT + quantize-порт
  с TheTom). Residual в GROK.md (приёмка G-2): auto-asymmetric K,
  turbo4 шумнее, Q pre-rotate для non-CUDA.
- **Grammar-порог 200000** — Zed editor с полной tool-схемой парсится.
- **Новый донор-эталон**: `donors/thetom-turboquant` — первоисточник
  turbo (beellama — производная), при расхождении он прав.

## Следующие шаги (по приоритету)

1. **Phase 1 tiered hot/cold KV-offload** — по принятому дизайну
   `docs/design/tiered-kv-offload.md` (O-10). Кандидат: OpenCode (его
   дизайн). Phase 1 = инфраструктура (hot-only attend — это ЕЩЁ НЕ
   решение 262K); качество закрывают Phase 2 (H2O) / Phase 3 (periodic
   full attend).
2. **Формальная валидация** (параллелится с п.1, файлы не пересекаются):
   test-backend-ops parity (эталон 13994/13994), бенч vs baseline
   (pp512=2298/tg64=61 из CLINE.md), PPL/NIAH на длинном контексте.
3. DECISIONS.log дописать: Q2_1-отклонение от донора (bits=2→Q2_1,
   Q2_0-кернелы не портированы), kvarn seq_rm=FULL, отказ от тихой
   подмены явного `-c` в fit.
4. Отложено: сайт server-context :2863 (context-shift) структурно не
   гейтится для kvarn (rearrange, не restore) — на практике не
   триггерился ни разу; group-boundary-выравнивание prompt-reuse.

## Раунд 4 (2026-07-18) — что сделано, кем

| Задание | Кто | Итог |
|---|---|---|
| O-6+O-8 seq_rm-гейтинг | OpenCode | kvarn=FULL, живой смок 5x cache-reuse без падений (`367ca3bb8`) |
| G-1 turbo SIGSEGV | Grok | use-after-move в ctor kv_cache, 6/6 типов живы (`8e7002113`) |
| Z-1 kvarn fit | Zed | fit честен до MiB; потолки замерены; margin — убийца (`a8a3ca5be` приёмка) |
| H-10 research 262K | Hermes | испытание пройдено; найден TheTom; вывод: только tiered offload (`1ce48e835`) |
| O-10 дизайн offload | OpenCode | дизайн-док принят (`5ac11a7f8`) |
| G-2 turbo-качество | Grok | inv-WHT + CPU-порт, turbo3≈f16 (`c219b47e2`) |

Ключевой инсайт раунда (Z-1+H-10): Qwythos — гибрид, attention всего в
8 слоях из ~33, KV мал (596MiB@65536 kvarn4). 262K не решается битностью:
веса 5.9GB + фон десктопа 1.3–1.9GB съедают всё, kvarn2@262K≈1.3GB не
влезает. Отсюда tiered offload в 64GB DDR4 как единственный путь.

## Миньоны

- **OpenCode** — лучший (O-3..O-10 чистые). Свободен. Кандидат на Phase 1.
- **Grok** — новый, 2/2 блестяще (G-1, G-2: отвергнутая гипотеза с
  доказательством, честные residual). Может пересобирать релизный билд
  (единственный с таким правом). Свободен.
- **Zed** — 1/1 образцово (Z-1: опровержение гипотезы с цифрами).
  Свободен. Не путать: `zed-2.md` — стресс-тест через Zed *editor*.
- **Hermes** — испытание H-10 пройдено, фабрикаций нет. Самообучается:
  «сначала туп, потом умнеет», ошибки приёмки фиксирует в скиллы.
  Мерило страйка: НЕ «ошибся», а «повторил названную ошибку» = увольнение.
  4 ошибки H-10 названы в HERMES.md (история — git log). Свободен.
- **Cline** — надёжен, свободен (2.5 закрыто). Baseline-числа в CLINE.md.
- **omp** — уволен. kilo, mimo — файлы не заведены.

## Смоки: чем и как

`cd models/main && PORT=8099 ./run-server.sh qwythos-v3 -c 65536 -ub 256`
(kvarn4 по умолчанию; `KVARN_K/V=N` — битность, `--no-kvarn` — выключить;
дефолтный порт скрипта 8081, Zed editor ходит на 8099!). Turbo:
`--no-kvarn --cache-type-k turbo3 --cache-type-v turbo3 -c 8192`.
Фон VRAM гуляет 1.3–1.9GB — `nvidia-smi --query-gpu=memory.used
--format=csv,noheader` перед каждым запуском, потолки считать от факта.
pkill строго `-x llama-server` (`-f` убьёт собственный shell). Качество:
длинная генерация >1k токенов, хвост связный. Крашы: `coredumpctl debug`
разрешён. Vivaldi не трогать только когда пользователь в нём работает.

## Инфраструктура памяти (Claude)

Hindsight self-hosted (podman: hindsight 8888/9999/8080, embeddings,
reranker; бэнк chronos-ecosystem). Ловушки: (1) после краха сессии
умирает pasta port-forwarder — `podman restart` всех трёх +
`/reload-plugins`; (2) в ~/.hindsight/claude-code.json строго
`http://127.0.0.1:8888`, НЕ localhost (IPv6-ловушка). Fallback retain:
REST `POST /v1/default/banks/chronos-ecosystem/memories`.

## История (сжато; подробности — git log и dump/)

- До раунда 4: 54747fc74 → 240a0f51b (kvarn-активация) → 76e57c616
  (Фаза 4) → 81729eb43 (hybrid passthrough + MoE prefetch) → f2afa0a13.
  Семь крашей kvarn-активации закрыты (мост cparams.kvarn, fallback-типы,
  dynamic_cast-диспетчеры, CUDA-регистрация, fit-статус, CUDA-граф
  обвязка, seq_rm-гейтинг O-6/O-8).
- Раунд 4: `4474b0f08` (конвенция single-task) → `8e7002113` (G-1) →
  … → `c219b47e2` (kvarn-активация раунда 3 + G-2 одним коммитом) →
  `fd404cb15` (ARCHITECTURE.md раунд 4). Оба стека (kvarn, turbo)
  живые end-to-end.
- Уроки процесса: НЕ `git add -u` при docs-коммитах (утащил весь WIP в
  чужой коммит — пришлось переписывать историю); диффы миньонов — на
  вложенность скобок; отчёты — построчно с деревом; отчёт Hermes про
  «нет tiering у TheTom» и «инфра codacus переиспользуема» — проверены,
  честные.
