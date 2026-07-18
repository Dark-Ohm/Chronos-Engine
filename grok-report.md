# G-2 — turbo: мусорная генерация (эталон TheTom)

## Симптом (до фикса)
G-1: сервер не падает. Качество нулевое: turbo3/turbo3, «2+2» → content `""`,
reasoning «мали» / «2+?».

## Расхождение с TheTom (`donors/thetom-turboquant`)

| Узел цепочки | TheTom | Chronos (до G-2) |
|---|---|---|
| Write K/V | CUDA `set-rows` + FWHT внутри ядра (`turbo-quant.cuh` / `set-rows.cu`) | То же (CUDA уже был) |
| CPU `quantize_row_turbo3_0_ref` | Полный: norm → FWHT → centroids → corrected norm (`ggml-turbo-quant.c:276`) | **STUB**: только norm, `qs`/`signs` = 0 (`ggml-turbo-quant.c:250`) |
| Graph: Q pre-rotate | `ggml_turbo_wht(..., 0)` перед FA (`llama-graph.cpp:2386-2394`) | **нет** (CUDA FA сам крутит Q на fused/prefill) |
| Graph: output inv-WHT | `ggml_turbo_wht(..., 1)` после FA если V turbo (`llama-graph.cpp:2109-2120`) | **нет** |
| CPU `GGML_OP_TURBO_WHT` | compute есть | **no-op** (`ggml-cpu.c:2259`) — если op на CPU, dst **не пишется** |
| Auto-asymmetric K | GQA≥6 → K=q8_0 (`llama-kv-cache.cpp:140-163`) | нет (не портировали) |

Принципиальная разница архитектуры: TheTom **фьюзит FWHT в quantize-ядро**
(CUDA set_rows) + **явный graph inv-WHT на выходе attention**. Ротация не
через `turbo_rotation` matmul в графе, а через `GGML_OP_TURBO_WHT` (O(d log d)).

Наш `turbo_rotation` / `turbo_rotation_inv` в KV cache (G-1) — legacy/unused
для CUDA FA path; TheTom тоже заполняет их, но attend path идёт через WHT op.

## Корневая причина мусора

1. **Нет inv-WHT после FA** — V пишется в rotated domain (CUDA set_rows),
   FA output = комбинация V → residual видит rotated векторы → бред.
2. **CPU `TURBO_WHT` был no-op** — если scheduler кладёт op на CPU (hybrid
   qwythos / split), dst не обновляется → ещё хуже.
3. **CPU quantize stubs** — любой write через CPU `from_float` писал нули в qs.

## Фикс (минимальный)

### 1. `src/llama-graph.cpp` — graph inv-WHT (как TheTom ~2109)
После `ggml_flash_attn_ext` (и non-FA `kqv`), если V ∈ turbo{2,3,4}/tcq:
`cont` → cast F32 → `ggml_turbo_wht(ctx, cur, 1)`.

Q pre-rotate graph-side **не** добавляли: CUDA FA уже крутит Q на fused/prefill
(иначе double-rotate).

### 2. `ggml/src/ggml-cpu/ggml-cpu.c` — реальный CPU `TURBO_WHT`
s1/s2 + butterfly + 1/sqrt(128), direction 0/1. Совпадает с CUDA `k_turbo_wht`.

### 3. `ggml/src/ggml-turbo-quant.c` — CPU quantize turbo2/3
Порт TheTom: group FWHT + nearest centroid + corrected norm (знаки s1/s2
как в CUDA). Dequant turbo3 остаётся в rotated domain (inv на graph).

## Smoke (VRAM ~2.1GB used before start; `-c 8192 -ub 256`)

Модель: `Qwythos-9B-v3-1M-MTP-Q4_K_M` (reasoning — ответ часто в
`reasoning_content`, final в `content`).

### turbo3 / turbo3

**2+2** (`max_tokens=128`):
```
content: '4'
reasoning: '...2+2. That equals 4... output only "4".'
t/s decode: 23.55
```

**Capital of France** (fresh server):
```
content: 'Paris'
reasoning: '...capital of France is Paris...'
t/s decode: 23.41
```

**Long prompt ~1622 tokens** + «What is 2+2?»:
```
reasoning_tail: '...I must output just the number 4.'
prompt_tokens: 1622
prompt_t/s: 820.3
decode_t/s: 20.73
```
(content пустой — модель застряла в reasoning при 128 tok; смысл верный, не развал)

### turbo4 / turbo4
```
2+2 content: '4'   (decode ~18.6 t/s)
capital: reasoning понимает Paris (content иногда пустой при малом max_tokens)
```

### turbo2_tcq / turbo2_tcq
```
2+2 content: '4'     (25.41 t/s)
capital content: 'Paris'  (25.37 t/s)
```

### Baseline f16/f16
```
2+2 content: '4'     (~23 t/s)
capital content: 'Paris'
```

## Что не добили / residual

- **Auto-asymmetric** (TheTom: GQA≥6 → K=q8_0) не портирован — на qwythos
  с высоким GQA turbo K может деградировать; сейчас симметричный turbo3/3
  на коротких Q&A работает.
- **Graph Q pre-rotate** как у TheTom — не нужен при текущем CUDA FA, но
  non-CUDA path / другие бэкенды могут захотеть.
- **turbo4** чуть шумнее turbo3/tcq (content иногда пустой) — отдельный
  тюнинг domain (inv-FWHT vs matvec в CPU turbo4 ref).
- Чужой WIP в `llama-graph.cpp` (kvarn/hybrid) не трогали кроме turbo WHT.

## Статус G-2

**Закрыт по критерию**: turbo3 отвечает «4» и «Paris»; long ~1.6k tokens
не разваливается (модель явно вычисляет 4); turbo4 и turbo2_tcq ок.
