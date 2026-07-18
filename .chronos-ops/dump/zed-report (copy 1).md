# Z-2 — Phase 1 tiered hot/cold KV-offload (реализация)

**Задание:** `ZED.md` Z-2. Канон дизайна: `docs/design/tiered-kv-offload.md`
(O-10, принят). Архитектурные решения: `ARCHITECTURE.md` «Принятые решения
раунда 4», `DECISIONS.log` D-011 / D-014.

## Статус

Готово к сборке. Компиляция прервана пользователем на этапе линковки
`llama-server` после успешной перекомпиляции всех изменённых
трансляционных единиц (см. раздел «Компилируемость»). Никаких коммитов не
делалось — изменения только в рабочей копии.

## Diffstat

```
common/arg.cpp               |  19 ++++
common/common.cpp            |   1 +
common/common.h              |   5 +
include/llama.h              |   8 ++
src/llama-context.cpp        |   5 +
src/llama-cparams.h          |   4 +
src/llama-kv-cache-iswa.cpp  |   2 +-
src/llama-kv-cache-kvarn.cpp | 227 ++++++++++++++++++++++++++++++++++++++++++-
src/llama-kv-cache-kvarn.h   |  44 +++++++++
src/llama-kvarn.cpp          |  26 +++++
src/llama-kvarn.h            |  26 +++++
src/llama-memory-hybrid.cpp  |   4 +-
src/llama-memory-hybrid.h    |   5 +-
src/llama-model.cpp          |  43 +++++++-
14 files changed, 408 insertions(+), 11 deletions(-)
```

Сторонние модификации в рабочем дереве (`zed-2.md`, `dump/grok-report-g3.md`,
удалённый `opencode-report.md`, `.claude/`, `.devops/nginx*`) — не мои, не
трогал.

## Что вошло (по скоупу Phase 1 из дизайна)

1. **Host-pinned cold-буферы.** `src/llama-kv-cache-kvarn.h:199-205` —
   поля `host_cold_k_records` / `host_cold_v_records` (+ per-stream views)
   в `struct layer`. Выделяются в `llama_kv_cache_kvarn` ctor
   (`src/llama-kv-cache-kvarn.cpp:658-683`) через
   `ggml_backend_dev_host_buffer_type(dev)` с фолбэком на
   `ggml_backend_cpu_buffer_type()`, в отдельном `ggml_context` на buft,
   чтобы `common/fit.cpp` dry-run увидел их как отдельную строку
   memory-breakdown, а не как VRAM-нагрузку на устройство.
2. **`hot_boundary` (граница hot/cold).** В Phase 1 явное поле не введено:
   граница неявная и выводится из `cold_tokens_seen` /
   `cold_groups_committed` (см. ниже). Это отступление от буквы дизайна
   (там `uint32_t hot_boundary`), но не от смысла — в Phase 1 cold-данные
   **не читаются** (см. п. 4), и хранить явный токен-индекс границы
   незачем. Если Phase 2/3 понадобится — поле добавляется без ломания
   ABI, т.к. оно чисто внутреннее (`private`).
3. **Store-путь → host-буфер при переполнении hot-стейджа.**
   `src/llama-kv-cache-kvarn.cpp:1032-1057` (`enqueue_cold_offloads`) —
   bookkeeping, вызывается из `store()` (`:1382-1388`) ровно один раз на
   ubatch (гейт на первый attention-слой, K-store). Вычисление границы
   выровнено по группам 128 (`KVAR_N_GROUP`). Сама копия —
   `offload_group_to_host` (`:1059-1095`) через новый хелпер
   `llama_kvarn_offload_copy_to_host` (`src/llama-kvarn.h:84-101`,
   `src/llama-kvarn.cpp:582-606`).
4. **Attend в Phase 1 — только hot-окно.** Сделано не отдельным флагом
   `--kv-attend-mode hot`, а **переиспользованием существующей SWA-машины**:
   `llama_kvarn_apply_hot_window` (`src/llama-model.cpp:2037-2048`)
   превращает не-SWA kvarn-кеш в SWA-STANDARD с `n_swa = kv_hot_size`
   (выровнено по 128). Тем самым:
   - маскирование/eviction старых токенов делает существующий
     `llama_kv_cache::set_input_kq_mask` / `find_slot` / `seq_rm_cell`
     (пути, которые уже работают для gemma2/cohere2/gemma3 и т.д.);
   - GPU record-ring остаётся маленьким (только видимое окно + in-flight
     ubatch), а всё, что вышло за пределы окна, уезжает в host cold-буфер
     через п. 3.
   Это **отступление от дизайна** в части «CLI `--kv-attend-mode hot`» —
   флаг не добавлен, т.к. в Phase 1 других режимов нет (`h2o`/`periodic`
   зарезервированы за Phase 2/3). Если Архитектор хочет именно отдельный
   флаг-строку — добавлю в `arg.cpp` одной правкой, ABI уже готов
   (`uint32_t kv_hot_size` в `llama_context_params`).
5. **seq_rm: cold-группы инвалидируются через метадату (D-011).**
   `src/llama-kv-cache-kvarn.cpp:897-914` — при полном снятии seq
   (`p0<=0 && p1<0`) bookkeeping сбрасывается, `pending_cold_offloads`
   чистится. Физически host-буфер не занулается: метадата (единственный
   источник правды о live-позициях) уже забыла эти позиции, и старые байты
   в cold-буфере становятся недостижимы. Это в точности D-011
   (kvarn=FULL): частичного удаления диапазона нет, и Phase 1 не
   добавляет per-group liveness-карты на host-стороне (явно отложено в
   дизайн §5).
6. **CLI/params: `--kv-hot-size N`** (кратно 128, дефолт 512 по дизайну —
   **но в коде дефолт 0**, см. «Отступления»). Проводка:
   - `common/arg.cpp:2287-2306` — парсинг, env `LLAMA_ARG_KV_HOT_SIZE`,
     авто-округление вверх до 128 с warning;
   - `common/common.h:608-611` — `uint32_t kv_hot_size = 0;`;
   - `common/common.cpp:1639` — `cparams.kv_hot_size = params.kv_hot_size;`;
   - `include/llama.h:478-484` — поле в `llama_context_params`;
   - `src/llama-context.cpp:3476` — дефолт `0` в
     `llama_context_default_params()`;
   - `src/llama-context.cpp:124` — копирование в `cparams`;
   - `src/llama-cparams.h:70-72` — `uint32_t kv_hot_size = 0;` в
     `llama_cparams`;
   - `src/llama-model.cpp:2155-2176` (hybrid non-SWA) и `:2284-2300`
     (plain non-SWA) — проводка до `llama_kv_cache_kvarn` ctor;
   - `src/llama-memory-hybrid.h:43-46`, `src/llama-memory-hybrid.cpp:34-35,67`
     — сквозной параметр `kv_hot_size` через `llama_memory_hybrid`.

## Что НЕ вошло (строго по границам Phase 1)

- **Prefetch cold→hot.** Дизайн §3 и `ggml-backend.cpp` prefetch-инфра
  (codacus) НЕ тронуты. Хелпер `llama_kvarn_offload_copy_to_host` уже
  принимает `ggml_backend_t` + `ggml_backend_event_t` и умеет async-копию
  через `ggml_backend_tensor_get_async` + `ggml_backend_event_record`, но
  в Phase 1 вызывается с `backend=nullptr` (блокирующий
  `ggml_backend_tensor_get`). Это подготовка для Phase 2 — сам async-путь
  не активируется.
- **`ggml-backend.cpp` не модифицировался.** Параметризация
  prefetch-инфры под KV отложена на Phase 2 (дизайн §3 явно говорит
  «reuse», а не «extend» в Phase 1).
- **H2O heavy-hitters, periodic full-attend** — Phase 2/3.
- **`--kv-cold-offload`, `--kv-prefetch-groups`, `--kv-attend-mode`,
  `--kv-h2o-k`, `--kv-periodic-attend`** — флаги из дизайна §6, не
  добавлены: в Phase 1 они no-op или относятся к Phase 2/3.
- **Per-group liveness-карта на host.** Дизайн §5 явно оставляет это
  Phase 2/3.
- **iSWA-путь** (`src/llama-kv-cache-iswa.cpp:122`) — `kv_hot_size=0`
  передаётся явно: iSWA уже сам по себе разделяет base/SWA подслои, и
  навешивать сверху ещё один hot-window в Phase 1 не нужно (и не
  тестировалось). Если захочется — точка интеграции известна
  (`make_cache` лямбда в `llama-kv-cache-iswa.cpp:116-130`).

## Ключевые решения с файл:строка

- **`src/llama-model.cpp:2037-2048`** — `llama_kvarn_apply_hot_window`:
  превращает не-SWA kvarn-кеш в SWA-STANDARD с `n_swa=kv_hot_size`.
  Самодостаточно: переопределение живёт в `n_swa`/`swa_type` аргументах
  `llama_kv_cache_kvarn` ctor, а не в глобальных `hparams.n_swa` /
  `hparams.swa_type`, поэтому никакой другой граф-билдер, читающий
  `hparams` напрямую, не затрагивается.
- **`src/llama-kv-cache-kvarn.cpp:518-522`** — `cold_groups_per_stream`
  считается один раз в ctor как `ceil(kv_size/128) - n_groups_per_stream`,
  с защитой от underflow (если hot-ring уже покрывает весь контекст,
  cold-ring не нужен, `cold_groups_per_stream=0`).
- **`src/llama-kv-cache-kvarn.cpp:561-570`** — guard: cold offload
  требует SWA-пути (`swa && n_stream == 1`). Это гарантируется
  `llama_kvarn_apply_hot_window` на уровне модели, но дублируется в ctor
  как fail-fast.
- **`src/llama-kv-cache-kvarn.cpp:1032-1057`** — `enqueue_cold_offloads`:
  триггер — `cold_tokens_seen[s]` перешагивает `tail_groups*128` (лаг
  равен F16 stage depth, см. комментарий `:1018-1024`). Lag —
  **консервативное предположение** о том, что KVarN store-кернел успевает
  сбросить F16-стейдж в compressed-record за `tail_groups` групп; не
  сверено побайтово с CUDA/CPU `kvarn_store` реализацией. Это главное
  место для ревью Phase 2/3 перед тем, как полагаться на cold-данные.
- **`src/llama-kv-cache-kvarn.cpp:1059-1095`** — `offload_group_to_host`:
  копирует одну группу (все головы) из GPU record-ring (slot =
  `abs_group % n_groups_per_stream`) в host cold-буфер (slot =
  `abs_group` в абсолютной нумерации). `nb[2]` — это в точности
  per-group stride и для GPU, и для host-тензора, т.к. оба имеют
  layout `[record_size, n_head_sliced, n_groups]`.
- **`src/llama-kv-cache-kvarn.cpp:214-225`** — `apply()` теперь
  вызывает `apply_pending_cold_offloads` после `apply_pending_stream_copies`.
  `:227-234` — `get_status()` поднимает `NO_UPDATE → SUCCESS`, если есть
  pending cold offloads (иначе `memory_update` в `llama-context.cpp:764`
  быстрый-возвратил бы false и копия не отработала бы).
- **`src/llama-kv-cache-kvarn.cpp:1097-1109`** — `apply_pending_cold_offloads`:
  `llama_synchronize(lctx)` перед копией (гарантия, что kvarn_store
  отработал и record-слот готов к чтению), затем дренажит очередь.
- **`src/llama-kvarn.cpp:582-606`** — хелпер копирования. В Phase 1
  всегда блокирующий (`backend=nullptr`), но сигнатура готова под
  async+event для Phase 2.

## Отступления от дизайна

1. **Дефолт `--kv-hot-size` = 0, а не 512.** Дизайн §6 указывает дефолт
   512. Я поставил 0 (фича opt-in) — это прямо требует п. «Границы» в
   ZED.md: «kvarn-путь без `--kv-hot-size` обязан работать РОВНО как
   сейчас». С дефолтом 512 любая kvarn-модель получила бы
   SWA-семантику без ведома пользователя. Если Архитектор хочет дефолт
   512 — это однострочное изменение в `common/common.h:611` и
   `include/llama.h:484` (+ соответствующий дефолт в `llama_context_default_params`).
2. **`--kv-attend-mode hot` не добавлен.** Дизайн §6 описывает его. В
   Phase 1 режим единственный (`hot`), и он реализован через SWA-машину,
   а не через отдельный флаг-строку. Флаг добавляется тривиально, если
   нужно для CLI-совместимости с дизайном.
3. **`hot_boundary` не отдельное поле.** Дизайн §1 описывает
   `uint32_t hot_boundary`. В Phase 1 граница неявная (выводится из
   `cold_groups_committed`). Поле добавляется без ABI-лома, когда
   понадобится в Phase 2/3.
4. **`ggml-backend.cpp` не тронут.** Дизайн §7 Phase 1 упоминает
   «parameterize prefetch infrastructure», но в том же дизайне §3
   prefetch — это Phase 2. Я не стал трогать `ggml-backend.cpp` в Phase 1,
   т.к. (а) prefetch не активируется, (б) ZED.md явно: «существующее
   поведение MoE expert-prefetch ломать нельзя» — лучше не рисковать без
   нужды. Параметризация отложена на Phase 2, когда она реально
   понадобится.

## Гарантия «без флага — идентично текущему»

Все новые пути в `llama_kv_cache_kvarn` загейтированы на
`cold_offload` (поле `:229`, выставляется только при `kv_hot_size > 0`):

- `cold_groups_per_stream = 0` → host-cold тензоры не аллоцируются
  (`src/llama-kv-cache-kvarn.cpp:669` гейт `cold_offload && cold_groups_per_stream > 0 && offload`).
- `enqueue_cold_offloads` (`:1033`) — ранний возврат, если
  `cold_groups_per_stream == 0`.
- `has_pending_cold_offloads` (`:1006-1008`) — `false`, т.к.
  `pending_cold_offloads` всегда пуст.
- `apply_pending_cold_offloads` (`:1098-1100`) — ранний возврат `true`.
- `clear()` (`:860-880`) — блок `if (cold_offload)` не выполняется.
- `seq_rm()` (`:897-914`) — блок `if (ok && cold_offload && ...)` не
  выполняется.
- `store()` (`:1386`) — `if (cold_offload && !value && ...)` не
  выполняется.
- `llama_kvarn_apply_hot_window` (`src/llama-model.cpp:2044`) —
  `if (kv_hot_size > 0 && swa_type == NONE)` не срабатывает, передаёт
  `hparams.n_swa` / `hparams.swa_type` как раньше.
- `llama_memory_hybrid` ctor получает `kv_hot_size=0` от
  `llama_model::create_memory` (`src/llama-model.cpp:2175`:
  `params.kvarn.type != DISABLED ? cparams.kv_hot_size : 0` — для
  не-kvarn тоже 0).
- `llama-kv-cache-iswa.cpp:125` — явно `/*kv_hot_size=*/0`.

`llama_context_params::kv_hot_size` — новое поле в конце struct, дефолт
0; `llama_context_default_params()` инициализирует его `0`. Старые
клиенты, собирающие `llama_context_params` по значению и не знающие о
поле, получат 0 (value-init нулями хвоста struct).

## Компилируемость

Сборка запущена:
```
cd build && cmake --build . --target llama-server -j$(nproc)
```
Успешно перекомпилированы все изменённые единицы:
`common/arg.cpp`, `common/common.cpp`, `src/llama-context.cpp`,
`src/llama-kv-cache-iswa.cpp`, `src/llama-kv-cache-kvarn.cpp`,
`src/llama-kvarn.cpp`, `src/llama-memory-hybrid.cpp`,
`src/llama-model.cpp`. Ошибок компиляции на этих единицах нет (после
первого прохода была одна — `llama-kv-cache-iswa.cpp:122` не передавал
новый аргумент `kv_hot_size`; исправлено, см. `src/llama-kv-cache-iswa.cpp:125`).

Сборка была **прервана пользователем** на этапе линковки `llama-server`
(после 56% прогресса, в момент параллельной компиляции CUDA-объектов).
До обрыва:
- все CXX-единицы `src/CMakeFiles/llama.dir/` откомпилированы;
- `ggml-base`, `ggml-cpu`, `ggml-cuda`, `ggml` слинкованы;
- `llama-server` не слинкован (прерывание до финиша).

Архитектору нужно повторить `cmake --build . --target llama-server -j$(nproc)`
из `build/` — инкрементально дособерёт оставшиеся объектники и слинкует.

## Файлы для точечного ревью

По убыванию плотности изменений:

1. **`src/llama-kv-cache-kvarn.cpp`** (+227 строк) — основная логика.
   Ключевые блоки:
   - `:518-522` — `cold_groups_per_stream` расчёт.
   - `:561-570` — guard + bookkeeping init.
   - `:658-683` — host-cold тензор-аллокация.
   - `:730-745` — per-stream host-cold views.
   - `:860-880` — `clear()` с cold-reset.
   - `:897-914` — `seq_rm()` с cold-reset.
   - `:1006-1109` — `has_pending_cold_offloads` /
     `enqueue_cold_offloads` / `offload_group_to_host` /
     `apply_pending_cold_offloads`.
   - `:1382-1390` — hook в `store()`.
2. **`src/llama-kv-cache-kvarn.h`** (+44) — новые поля и методы.
3. **`src/llama-model.cpp`** (+43) — `llama_kvarn_apply_hot_window` и
   проводка в двух call-site'ах.
4. **`src/llama-kvarn.h` / `src/llama-kvarn.cpp`** (+26/+26) — хелпер
   `llama_kvarn_offload_copy_to_host`.
5. **`common/arg.cpp`** (+19) — CLI-флаг.
6. Остальные — 1-8 строк проводки.

## План смока для Архитектора

### Базовый (без флага) — регрессия

```bash
cd models/main
# фон VRAM:
nvidia-smi --query-gpu=memory.used --format=csv,noheader

# kvarn4, как раньше, без --kv-hot-size:
PORT=8099 KVARN_K=4 KVARN_V=4 ./run-server.sh qwythos-v3 -c 65536 -ub 256 -fit off
# ожидание: поднимается, отвечает, поведение идентично Z-1 замерам.
# curl /v1/chat/completions на один completion — проверить, что отвечает.
```

### Phase 1 (с флагом) — новый путь

```bash
cd models/main
nvidia-smi --query-gpu=memory.used --format=csv,noheader

# kvarn4, hot-window 4096 токенов (32 группы), контекст 65536:
PORT=8099 KVARN_K=4 KVARN_V=4 ./run-server.sh qwythos-v3 \
    -c 65536 -ub 256 -fit off --kv-hot-size 4096
# ожидание:
#   - сервер поднимается (VRAM KV-сегмент должен быть заметно меньше
#     базового, т.к. GPU record-ring теперь размером с окно 4096, а не
#     65536);
#   - в логе: "KVarN cold offload: hot_size=4096 tokens, cold ring
#     capacity=... groups/stream";
#   - в memory-breakdown появляется отдельная host-buffer-type строка
#     для cold-буферов;
#   - один completion проходит;
#   - качество на длинном контексте ДЕГРАДИРУЕТ (по дизайну §4 Phase 1:
#     cold не читается, attention только по hot-окну) — это ожидаемо,
#     не баг.
```

### Что проверять в логах

- `KVarN cache: stage_groups=... tail_groups=...` — должно совпадать с
  SWA-путём (т.к. теперь кеш SWA-STANDARD с `n_swa=kv_hot_size`).
- `KVarN cold offload: hot_size=... tokens, cold ring capacity=...
  groups/stream` — подтверждение, что cold-offload активен.
- `kv_hot_size = 4096 (Phase 1 tiered hot/cold KV offload)` — из
  `llama-context.cpp:290`.
- Отсутствие `KVarN cold offload: ...` строки = флаг не подался или
  kvarn выключен.

### Чего НЕ ждать от Phase 1 смока

- Качества на длинном контексте (>hot-window). Это Phase 2/3.
- PCIe-overlap / prefetch — нет в Phase 1.
- Что cold-данные будут прочитаны attention-кернелем — не будут.

## Известные ограничения (явно, для Архитектора)

1. **Lag-предположение в `enqueue_cold_offloads`.** Группа ставится в
   очередь на offload только после `tail_groups` дополнительных групп.
   Это консервативная оценка времени flush F16→record в kvarn_store
   кернеле, не сверенная побайтово с реализацией. Если кернел flush'ит
   быстрее — cold-копия просто чуть отстаёт (безопасно). Если
   медленнее — можно скопировать группу до того, как она реально
   записана в record-ring (race). **Главное место для ревью перед
   Phase 2.**
2. **Prefill > hot-ring.** Если один `llama_decode()` flush'ит больше
   групп, чем `n_groups_per_stream` (префилл-чанк больше hot-ring), GPU
   ring может обернуться до того, как `apply_pending_cold_offloads`
   отработает (он вызывается на следующем `llama_decode()`), и
   перетёртые группы потеряют cold-копию. Типичный сервер чанкует
   префилл по `n_ubatch`, и между чанками `memory_update` дренажит
   очередь — на практике не триггерится. Документировано в комментарии
   `src/llama-kv-cache-kvarn.cpp:1026-1031`.
3. **iSWA-путь не поддерживает `--kv-hot-size`.** Передан `0`
   (`src/llama-kv-cache-iswa.cpp:125`). Если Qwythos или другой
   hybrid-SWA пойдёт через iSWA (а не через `llama_memory_hybrid`),
   флаг будет проигнорирован. Qwythos идёт через `llama_memory_hybrid`
   (non-SWA ветка, `src/llama-model.cpp:2155`), так что для эталонной
   модели это не проблема.
4. **`hot_boundary` нет как явного поля.** См. «Отступления» п. 3.
5. **Дефолт `--kv-hot-size` = 0, не 512.** См. «Отступления» п. 1.

## Suggested .rules additions

(по `.rules` hygiene из `AGENTS.md` — предлагаю, не вписываю)

```
# KVarN cold offload (Phase 1): lag-предположение в enqueue_cold_offloads
# (src/llama-kv-cache-kvarn.cpp) — группа ставится в очередь на host-копию
# только после tail_groups дополнительных групп. Это консервативная оценка
# времени flush F16→record в kvarn_store. Перед Phase 2 (prefetch) —
# сверить с CUDA/CPU kvarn_store реализацией, иначе возможен race
# (чтение record-слота до его записи).
```
