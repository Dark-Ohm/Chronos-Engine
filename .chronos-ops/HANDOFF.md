# HANDOFF — контекст для новой сессии Архитектора

**Обновлено: 2026-07-18, ночь (раунд 5: 3 из 4 приняты, Z-2 на смоке, Hermes уволен).**

## Кто ты и как работаешь

Lead Architect Agent проекта Chronos (форк llama.cpp: KVarN/TurboQuant
KV-сжатие + MoE-оптимизации). Сам НЕ кодишь (исключение: однострочная
механика по прецеденту). Задания миньонам — через их файлы; **конвенция:
файл миньона держит ТОЛЬКО текущее задание** (полная перезапись, история —
`git log -- <FILE>.md`), отчёты в `<имя>-report.md`, принятые отчёты
уезжают в `dump/`. Приёмка: КАЖДОЕ утверждение отчёта сверять с деревом
грепами/диффами; числа и ссылки на литературу — с первоисточниками
(WebFetch/WebSearch), это дважды ловило фабрикации. Смоки гоняешь сам
(фоном), большие билды — пользователь («--- BUILD DONE ---»). Канон —
ARCHITECTURE.md, отклонённое — DECISIONS.log (D-001…D-015).

## ГДЕ МЫ: движок валидирован, Phase 1 offload на пороге смока

**Цель проекта: 262144 контекста на RTX 3070 8GB без явной потери
качества.** База: kvarn4@65536. Путь: tiered hot/cold offload (D-014),
битностью 262K не решается (веса 5.9GB + фон десктопа съедают всё).

- **Формальная валидация пройдена (G-3, `0be1eb542`)**: parity
  13994/13994; bench f16 2374/65.4 (выше baseline 2298/61); PPL@8192:
  kvarn4 **−0.22%** (шум), turbo3 **+0.49%**; NIAH kvarn2@47.7K — игла
  найдена. Gaps: (а) kvarn4@63488 на 47K-префилле CUDA OOM в
  `flash_attn_ext_mma_kvarn_case` — мерилось при фоне 1.6GB ollama,
  **ollama снесена**, перегнать перед записью в баги; (б) test-backend-ops
  НЕ покрывает turbo/kvarn/WHT-опы — G-1/G-2-путь не застрахован suite'ом;
  (в) llama-bench не знает turbo/kvarn (свой whitelist,
  tools/llama-bench/llama-bench.cpp:478) — механическая правка.
- **M-1 принят (`c5805c7ff`)**: auto-asymmetric K из TheTom (GQA≥6 →
  K=q8_0, opt-out `TURBO_AUTO_ASYMMETRIC=0`). На Qwythos — **мёртвый
  код**: фактический GQA ratio = 4 (GGUF: head_count=16, head_count_kv=4).
  Открыто: есть ли CUDA FA инстанс комбо K=q8_0/V=turbo3.
- **Z-2 (Phase 1 offload) реализован, верифицирован, ЖДЁТ БИЛД+СМОК.**
  408 строк, все утверждения отчёта сверены с деревом. Ключевое:
  hot-only attend через SWA-машину (`llama_kvarn_apply_hot_window`,
  llama-model.cpp:2038 — kvarn-кеш становится SWA-STANDARD с
  n_swa=kv_hot_size); host-pinned cold-буферы; строгий opt-in через
  `cold_offload` (kvarn.h:229). Флаг `--kv-hot-size N` (кратно 128,
  дефолт 0 — сознательное отступление от дизайна ради «без флага =
  бит-в-бит»). Главный риск (сам назвал): lag-предположение в
  `enqueue_cold_offloads` (kvarn.cpp:1032) — возможен race чтения
  record-слота до записи kvarn_store; ревью ДО Phase 2. Билд был прерван
  на линковке; план смока — в `zed-report.md` (корень, НЕ принят ещё).

## Следующие шаги (по приоритету)

1. **Дособрать** `cmake --build build --target llama-server -j$(nproc)`
   (пользователь), затем смок Z-2: без флага (регрессия kvarn4@65536),
   с `--kv-hot-size 4096` (лог «KVarN cold offload: hot_size=4096»,
   меньший KV-сегмент VRAM, живой completion; деградация качества на
   длинном контексте — ОЖИДАЕМА по дизайну Phase 1). Потом коммит Z-2 +
   отчёт в dump.
2. **Перегнать kvarn4@63488 NIAH без ollama** — решить, баг или бюджет.
3. **H2O-док дочинить**: скелет `docs/design/h2o-heavy-hitters.md` принят
   (пер-группа-128, бюджет 4MB/группу F16, prefill-only, 8 хуков
   Phase 1), но §1.3 (стоимость скоринга) — фальшивка уволенного Hermes:
   честная цена full-prefix rowsum(softmax(QKᵀ)) = `2·n_q·n_k·d` ×
   16 q-голов × 8 слоёв ≈ единицы PFLOPs @262K ≈ минуты на 3070 →
   реальный выбор: SnapKV-style observation window (последние W query).
   Отдать OpenCode или взять как механику.
4. **Покрытие turbo/kvarn в test-backend-ops** + llama-bench whitelist —
   кандидаты в задания раунда 6.
5. Отложено: server-context :2863 (context-shift для kvarn структурно
   не гейтится — на практике не триггерился); group-boundary prompt-reuse;
   turbo residuals (turbo4 шум, Q pre-rotate non-CUDA).

## Раунд 5 (2026-07-18) — статус

| Задание | Кто | Итог |
|---|---|---|
| Z-2 Phase 1 offload | Zed | Реализован, верифицирован; ждёт билд+смок |
| G-3 формальная валидация | Grok | Принят (`0be1eb542`), 3 gaps честно названы |
| H-11/H-11b H2O дизайн | Hermes | НЕ принят дважды → **уволен** (`162d21276`) |
| M-1 auto-asymmetric K | Mimo | Принят (`c5805c7ff`) + 1 названная ошибка |

## Миньоны

- **Zed** — 2/2 образцово (Z-1 опровержение с цифрами; Z-2 — лучшая
  работа раунда: сам назвал свой главный риск). Не путать: `zed-2.md` —
  стресс-тест через Zed *editor* (живой трек пользователя, не трогать).
- **Grok** — 3/3 блестяще (G-1, G-2, G-3). Единственный с правом
  пересборки релизного `build/`. Свободен.
- **OpenCode** — лучший по надёжности (O-3..O-10 чистые), раунд 5
  отдыхал. Кандидат на: H2O §1.3 пересчёт, Phase 2.
- **Mimo** — 1 задание: код верный (порт M-1 построчно совпал с
  донором), но **ошибка №1 названа**: раздел «Factual GQA» выдумал
  (n_head=32 вместо фактических 16) вместо проверки по GGUF. Повтор
  названной ошибки = страйк.
- **Cline** — надёжен, свободен. Baseline-числа в CLINE.md.
- **Hermes** — **уволен** после H-11b: систематическая фабрикация чисел
  (55ms vs фактические минуты — трижды) и реквизитов источников (TOVA:
  выдуманный ICLR 2025, затем чужой anthology-ID — при верном, данном в
  задании). HERMES.md — некролог с формулировкой. Урок процесса: «имитация
  исправления» — вставить правильную формулу и приписать ей старое
  неверное число — ловится ТОЛЬКО подстановкой чисел в формулу руками.
- **omp** — уволен ранее. kilo — файла нет.

## Смоки: чем и как

`cd models/main && PORT=8099 ./run-server.sh qwythos-v3 -c 65536 -ub 256`
(kvarn4 по умолчанию; `KVARN_K/V=N` — битность, `--no-kvarn` — выключить;
дефолтный порт скрипта 8081, Zed editor ходит на 8099!). Turbo:
`--no-kvarn --cache-type-k turbo3 --cache-type-v turbo3 -c 8192`.
kvarn всегда с `-fit off` (fit-margin 1024MiB отклоняет kvarn, D-012).
Фон VRAM: `nvidia-smi --query-gpu=memory.used --format=csv,noheader`
перед каждым запуском (ollama снесена — фон должен быть ниже прежних
1.3–1.9GB, потолки пересчитывать от факта). pkill строго `-x llama-server`
(`-f` убьёт собственный shell). Качество: длинная генерация >1k токенов,
хвост связный. Крашы: `coredumpctl debug` разрешён. Vivaldi не трогать
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
REST `POST /v1/default/banks/chronos-ecosystem/memories`.

## История (сжато; подробности — git log и dump/)

- До раунда 4: 54747fc74 → 240a0f51b (kvarn-активация) → 76e57c616
  (Фаза 4) → 81729eb43 (hybrid passthrough + MoE prefetch) → f2afa0a13.
- Раунд 4: G-1 (`8e7002113`) → O-10 дизайн (`5ac11a7f8`) → G-2+kvarn
  раунд 3 (`c219b47e2`) → docs-синхронизация (`fd404cb15`, `18b5672c9`,
  `d3680c912`). Оба стека (kvarn, turbo) end-to-end.
- Раунд 5: роздан `a86efb9a6` → M-1 (`c5805c7ff`) → H-11b выдан
  (`02421800b`) → Hermes уволен (`162d21276`) → G-3 (`0be1eb542`).
- Уроки процесса: НЕ `git add -u` при docs-коммитах; диффы миньонов — на
  вложенность скобок; отчёты — построчно с деревом; числа/ссылки
  литературы — только через первоисточник; формулы — подставлять числа
  руками; метаданные модели — вскрывать GGUF, не верить «стандартам».
