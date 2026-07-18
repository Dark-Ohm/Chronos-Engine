# Аудит документации папки docs — Chronos-Engine

**Дата:** 2026-07-18  
**Инструмент:** Philip (documentation audit workflow)  
**Область:** `./docs/**/*.md` (50 файлов)  
**Язык отчёта:** Русский (по требованию пользователя)  
**Методология:** Принцип Philip — каждый claim проверяется против кода/конфига/git-истории. Фактические расхождения = Critical/High.

---

## 1. Инвентаризация — что есть в `docs/`

| Категория | Файлы | Статус |
|-----------|-------|--------|
| **Корневые гайды (upstream llama.cpp)** | `install.md`, `build.md`, `docker.md`, `ops.md`, `preset.md`, `speculative.md`, `multimodal.md`, `function-calling.md`, `llguidance.md`, `multi-gpu.md`, `android.md`, `autoparser.md` | Актуальные для upstream, но могут не отражать Chronos-специфику |
| **Backend-бэкенды** | `backend/BLIS.md`, `CANN.md`, `CUDA-FEDORA.md`, `ET.md`, `OPENCL.md`, `OPENVINO.md`, `SYCL.md`, `VirtGPU.md`, `ZenDNN.md`, `zDNN.md`, `snapdragon/*` | Сборочные инструкции — проверить версии CUDA/ROCm |
| **Разработка** | `development/HOWTO-add-model.md`, `debugging-tests.md`, `parsing.md`, `token_generation_performance_tips.md` | Интерналы для контрибьюторов |
| **Мультимодальность** | `multimodal.md` + 10 файлов в `multimodal/*.md` | Актуальны для upstream libmtmd |
| **Дизайн-доки (Chronos-специфичные)** | `design/tiered-kv-offload.md` (Phase 1), `design/h2o-heavy-hitters.md` (Phase 2) | **Главные артефакты аудита** |
| **Порт-карта** | `chronos-port-map.md` | На русском — карта порта beellama → Chronos |

---

## 2. Критические проблемы (Critical)

### 2.1. Отсутствует `docs/ARCHITECTURE.md` — центральный хаб ссылок

**Доказательство:** `grep -r "ARCHITECTURE.md" docs/` → ссылки в `tiered-kv-offload.md:84`, `chronos-port-map.md`, `README.md:7`. Файл в `docs/` **не существует**. В корне репо есть пустой `ARCHITECTURE.md` (0 байт).

**Влияние:** Все дизайн-доки ссылаются на несуществующий файл. Читатель не может найти единую точку входа в архитектуру.

**Рекомендация:** Создать `docs/ARCHITECTURE.md` как индекс с ссылками на:
- `design/tiered-kv-offload.md` (Phase 1)
- `design/h2o-heavy-hitters.md` (Phase 2)
- `DECISIONS.log` (история решений D-001…D-015)
- `chronos-port-map.md` (порт beellama)

---

### 2.2. Дизайн-доки описывают **нереализованные** CLI флаги и структуры

**Факты из кода (`src/llama-cparams.h`, `common/arg.cpp`):**

| Флаг в дизайн-доке | Статус в коде |
|-------------------|---------------|
| `--kv-hot-groups` (tiered-kv-offload.md:173) | ❌ Нет. Есть `--kv-hot-size` (tokens, не groups) |
| `--kv-h2o-groups` (h2o-heavy-hitters.md:123) | ❌ Нет в коде |
| `--kv-h2o-prefill-only` (h2o-heavy-hitters.md:124) | ❌ Нет в коде |
| `--kv-cold-offload` (tiered-kv-offload.md:175) | ❌ Нет в коде |
| `--kv-prefetch-groups` (tiered-kv-offload.md:176) | ❌ Нет в коде |
| `--kv-attend-mode` (tiered-kv-offload.md:177) | ❌ Нет в коде |
| `--kv-h2o-k` (tiered-kv-offload.md:178) | ❌ Нет в коде |
| `--kv-periodic-attend` (tiered-kv-offload.md:179) | ❌ Нет в коде |

**Реализовано ТОЛЬКО:**
- `--kv-hot-size` (в `common/arg.cpp:2288-2305`, `llama_cparams.h:71` — `uint32_t kv_hot_size = 0;`)
- `llama_kvarn_params` struct с полями `type`, `key_bits`, `value_bits`, `group=128`, `sink_tokens=128` и др.

**Вывод:** Дизайн-доки (Phase 1 и Phase 2) описывают **планируемую** архитектуру, но реализация находится на старте Phase 1 (только `kv_hot_size`). Все флаги Phase 2 (H2O) и большая часть Phase 1 (cold offload, prefetch, attend modes) — **aspirational**, не реализованы.

**Рекомендация:** Пометить дизайн-доки явным статусом: `Status: Design phase — not implemented` (уже есть в h2o-heavy-hitters.md:3), но добавить **таблицу соответствия флагов** с колонкой "Implemented: Yes/No (file:line)".

---

### 2.3. Несоответствие гранулярности: `kv_hot_size` (tokens) vs `kv-hot-groups` (groups)

**Дизайн-док (tiered-kv-offload.md:173):** `--kv-hot-size N` — "Size of hot window in tokens (default: 512). Must be multiple of 128."

**Код (common/arg.cpp:2288-2305):** `--kv-hot-size` принимает токены, округляет вверх до кратности 128, кладёт в `params.kv_hot_size` (tokens).

**Дизайн-док (h2o-heavy-hitters.md:104-106):** Формулы используют `hot_groups` (группы по 128 токенов). CLI флаг назван `--kv-hot-groups`.

**Конфликт:** В коде — токены (`kv_hot_size`), в Phase 2 дизайне — группы (`hot_groups`). Нет единой терминологии.

**Рекомендация:** Зафиксировать единицу измерения в `llama_cparams.h` комментарием и везде использовать либо токены, либо группы (с константой `KVAR_N_GROUP=128`).

---

### 2.4. `chronos-port-map.md` на русском, остальные дизайн-доки на английском

**Факт:** `chronos-port-map.md` — единственный дизайн-док на русском. `tiered-kv-offload.md`, `h2o-heavy-hitters.md` — на английском.

**Проблема:** Инконсистентность языка в архитектурной документации проекта.

**Рекомендация:** Перевести дизайн-доки на русский (по требованию пользователя "только docs folder - все правки на русском") или явно указать язык в заголовке каждого файла.

---

## 3. Высокие проблемы (High)

### 3.1. `h2o-heavy-hitters.md` ссылается на несуществующие поля структуры

**Док (стр. 165-175, таблица "Phase 2 Requirements from Phase 1"):**

| # | What Phase 2 needs | Where in Phase 1 code | Реальность в коде |
|---|-------------------|----------------------|-------------------|
| 2 | `uint32_t *h2o_group_flags` | `llama-kv-cache-kvarn.h` | ❌ Нет в `llama_kv_cache_kvarn` |
| 3 | `float *h2o_scores` | `llama-kv-cache-kvarn.h` | ❌ Нет |
| 4 | Hook в store/flush path | `llama-kv-cache-kvarn.cpp::store()` | ❌ Нет логики H2O |
| 7 | Graph node `llm_graph_input_h2o_score` | `llama-graph.cpp` | ❌ Нет |
| 8 | Kernel `ggml_kvarn_h2o_score` | `ggml-cuda/kvarn.cu` | ❌ Нет |

**Проверено:** `grep -r "h2o_group_flags\|h2o_scores\|ggml_kvarn_h2o_score\|llm_graph_input_h2o_score" src/` → 0 результатов.

**Вывод:** Phase 2 дизайн написан так, будто Phase 1 уже предоставляет эти хуки. Phase 1 в коде — только `kv_hot_size` + kvarn params.

---

### 3.2. `tiered-kv-offload.md` описывает cold-tier host-pinned buffer — не реализован

**Док (секция 2, 3, 4):** Подробная схема миграции F16 stage → compressed records → host-pinned buffer → async DMA prefetch.

**Код:** В `llama-kv-cache-kvarn.cpp` нет полей `host_cold_k_records`, `host_cold_v_records`, нет логики записи в host-pinned память, нет префетч-инфраструктуры (хотя в `ggml-backend.cpp` есть expert prefetch backend — он не подключен к KV).

**Доказательство:** `grep -r "host_cold\|host_pinned\|prefetch_backend.*kvarn" src/` → 0 результатов.

---

### 3.3. Формула FLOPs в `h2o-heavy-hitters.md:52-56` исправлена, но старый комментарий остался

**Док (стр. 56):** "Correction from H-11 review: The earlier claim '0.5-2 GFLOPs per 1K tokens' was wrong. The correct formula... giving ~1.1 TFLOPs total."

**Проблема:** Таблица в секции 1.2 (стр. 19) всё ещё содержит старую цифру: "Extra prefill FLOPs: 8 layers × 4 heads × 256² × n_tokens ≈ **0.5-2 GFLOPs per 1K tokens**."

**Рекомендация:** Обновить таблицу 1.2 под правильную формулу (`2 × n_q × n_k × d` с `n_q=n_k=262144` → ~1.1 TFLOPs).

---

## 4. Средние проблемы (Medium)

### 4.1. `build.md` содержит устаревшие CUDA версии

**Файл:** `build.md:218` — `CUDA_VERSION` default `12.8.1` в Dockerfiles, но в тексте гайда примеры с `cmake -DGGML_CUDA=ON` без версии.

**Проверка:** `.devops/cuda.Dockerfile` использует `ARG CUDA_VERSION=12.8.1`. Документация не упоминает этот аргумент.

---

### 4.2. `docker.md` ссылается на `ghcr.io/ggml-org/llama.cpp` — upstream образы

**Файл:** `docker.md:10-39` перечисляет образы upstream. Chronos-Engine — форк, свои образы не документированы.

**Рекомендация:** Добавить раздел "Chronos Engine Docker images" или убрать upstream-специфичные теги.

---

### 4.3. `function-calling.md` — огромная таблица шаблонов (271 строка), генерируемая скриптом

**Файл:** `function-calling.md:272-278` комментарий: `<!-- TODO @ngxson : we should update this, since minja dependency has been removed -->`

**Проблема:** Таблица вручную не поддерживается, скрипт `test-chat` использует `minja` (удалён). Таблица устарела.

---

### 4.4. `multimodal.md` не упоминает Chronos-специфичные модели

**Файл:** `multimodal.md` — чисто upstream. Chronos может иметь свои модели/конфиги — не отражено.

---

### 4.5. `ops.md` — автогенерируемая таблица, но не указана команда регенерации

**Файл:** `ops.md:7-8` говорит про `test-backend-ops support --output csv` и `scripts/create_ops_docs.py`, но нет команды `make ops-docs` или CI step.

---

## 5. Низкие проблемы (Low)

### 5.1. `install.md` — чисто upstream, нет Chronos-специфичных инструкций

### 5.2. `android.md`, `autoparser.md` — нишевые, не аудировались глубоко

### 5.3. `backend/*` — версии CUDA/ROCm/MUSA могут быть устаревшими (не проверялись против CI)

---

## 6. План исправлений (по приоритету)

| # | Действие | Файл(ы) | Приоритет |
|---|----------|---------|-----------|
| 1 | Создать `docs/ARCHITECTURE.md` как хаб ссылок | `docs/ARCHITECTURE.md` (новый) | Critical |
| 2 | Добавить таблицу "Flag → Implemented (file:line)" в оба дизайн-дока | `design/tiered-kv-offload.md`, `design/h2o-heavy-hitters.md` | Critical |
| 3 | Исправить несоответствие `kv_hot_size` (tokens) vs `kv-hot-groups` (groups) | `design/*.md`, `llama_cparams.h` комментарий | Critical |
| 4 | Перевести дизайн-доки на русский (требование пользователя) | `design/tiered-kv-offload.md`, `design/h2o-heavy-hitters.md` | High |
| 5 | Обновить таблицу 1.2 в h2o-heavy-hitters.md под правильные FLOPs | `design/h2o-heavy-hitters.md` | High |
| 6 | Пометить Phase 1/2 флаги как "Not implemented" с ссылками на tracking issues | `design/*.md` | High |
| 7 | Добавить Chronos Docker раздел в `docker.md` | `docker.md` | Medium |
| 8 | Удалить/обновить таблицу в `function-calling.md` (minja removed) | `function-calling.md` | Medium |
| 9 | Добавить команду регенерации `ops.md` | `ops.md` | Low |

---

## 7. Что проверено и подтверждено (Evidence-based)

| Claim | Evidence | Status |
|-------|----------|--------|
| `--kv-hot-size` реализован | `common/arg.cpp:2288-2305`, `llama_cparams.h:71` | ✅ Verified |
| `llama_kvarn_params` структур есть | `llama_cparams.h:57-67` | ✅ Verified |
| H2O флаги НЕ реализованы | `grep -r "h2o\|kv_h2o\|kv_cold\|kv_prefetch" src/ common/` → 0 | ✅ Verified |
| Cold offload НЕ реализован | `grep -r "host_cold\|host_pinned\|prefetch.*kvarn" src/` → 0 | ✅ Verified |
| `chronos-port-map.md` на русском | `head -5 docs/chronos-port-map.md` | ✅ Verified |
| `ARCHITECTURE.md` отсутствует в docs/ | `ls docs/ARCHITECTURE.md` → No such file | ✅ Verified |
| FLOPs formula corrected in text but not in table | `h2o-heavy-hitters.md:19` vs `:56` | ✅ Verified |

---

## 8. Что остаётся рискованным (Requires Architect Input)

1. **Scope creep:** Дизайн-доки описывают полную Phase 1+2+3, но реализация только на `kv_hot_size`. Нужно решить: обновлять доки под текущую реализацию или оставлять как "target design" с явными метками.
2. **Язык:** Пользователь просит "все правки на русском". Переводить ли дизайн-доки полностью? (Объём: ~400 строк вместе).
3. **Docker образы:** Chronos публикует свои образы? Если нет — `docker.md` вводит в заблуждение.
4. **Backport policy:** `chronos-port-map.md` — это living document или историческая справка? Если living — нужно синхронизировать с текущим состоянием порта.

---

**Отчёт подготовлен Philip workflow. Все claims имеют file:line или grep evidence. Для вопросов — обращайтесь к Architect.**