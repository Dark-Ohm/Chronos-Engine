#!/bin/bash
# T006+T007 cross-backend closure: does a turbo4 KV cache written by one backend
# read correctly on the other? Two independent checks, all artifacts saved.
#   (A) same-corpus PPL on both builds  -> domains agree end-to-end per backend
#   (B) prompt-cache handoff CPU<->CUDA -> the actual cross-read criterion
# Fail-closed: any missing/garbage result sets fail=1.
set -u

cd "$(dirname "$0")/../.." || exit 1
M="models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf"
CPU="build-cpu/bin"
GPU="build-debug/bin"
CORPUS=".chronos-ops/active/t002-cpu/corpus.txt"
OUT=".chronos-ops/active/t006-cross"
PROMPT="The capital of France is"
SEED=42
mkdir -p "$OUT"
fail=0

# ---- A. PPL on both backends, same corpus / -c 128 / -s 42 ----
"$CPU/llama-perplexity" -m "$M" -f "$CORPUS" -c 128 -s "$SEED" \
  -ctk turbo4 -ctv turbo4 -fa on -ngl 0 >"$OUT/ppl-cpu-turbo4.log" 2>&1
"$GPU/llama-perplexity" -m "$M" -f "$CORPUS" -c 128 -s "$SEED" \
  -ctk turbo4 -ctv turbo4 -fa on -ngl -1 >"$OUT/ppl-cuda-turbo4.log" 2>&1

# ---- B. prompt-cache handoff ----
# NOTE: --prompt-cache-all is deliberately NOT used. It stores prompt+generated
# tokens; on read the shorter prompt takes completion.cpp:372, where
# llama_memory_seq_rm() fails for turbo KV -> llama_memory_clear() wipes the
# loaded cache and everything is recomputed, making the test vacuous.
# Saving the prompt only keeps n_match == session_tokens.size() -> the replay
# path at completion.cpp:389 is taken and the loaded KV is actually used.
# B1: CPU writes the cache, CUDA reads it read-only.
rm -f "$OUT/cache-cpu.bin"
"$CPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl 0 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  --prompt-cache "$OUT/cache-cpu.bin" \
  >"$OUT/write-cpu.log" 2>&1
"$GPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  --prompt-cache "$OUT/cache-cpu.bin" --prompt-cache-ro \
  >"$OUT/read-cuda-from-cpu.log" 2>&1

# B2: CUDA writes the cache, CPU reads it read-only.
rm -f "$OUT/cache-cuda.bin"
"$GPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  --prompt-cache "$OUT/cache-cuda.bin" \
  >"$OUT/write-cuda.log" 2>&1
"$CPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl 0 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  --prompt-cache "$OUT/cache-cuda.bin" --prompt-cache-ro \
  >"$OUT/read-cpu-from-cuda.log" 2>&1

# B3: same-backend baselines (no cache) for text comparison.
"$GPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  >"$OUT/base-cuda.log" 2>&1
"$CPU/llama-completion" -m "$M" -p "$PROMPT" -n 16 -c 256 -ngl 0 -fa on \
  -ctk turbo4 -ctv turbo4 -no-cnv -s "$SEED" --ignore-eos \
  >"$OUT/base-cpu.log" 2>&1

echo "=== A. PPL ==="
for f in ppl-cpu-turbo4 ppl-cuda-turbo4; do
  v=$(grep -oE "PPL = [0-9.]+" "$OUT/$f.log" | head -1)
  echo "$f: ${v:-MISSING}"
  [ -n "$v" ] || fail=1
done

echo "=== B. prompt-cache handoff ==="
ls -l "$OUT"/cache-*.bin 2>/dev/null | awk '{print $NF, $5" bytes"}'
for f in write-cpu read-cuda-from-cpu write-cuda read-cpu-from-cuda base-cuda base-cpu; do
  rc_line=$(grep -cE "CUDA error|illegal memory|GGML_ASSERT|GGML_ABORT" "$OUT/$f.log")
  echo "$f: errors=$rc_line"
  [ "$rc_line" -eq 0 ] || fail=1
done

# The cache must be USED, not merely opened: require the replay path and
# reject the wipe path. Without this the whole handoff test is vacuous.
echo "=== B. cache actually used? ==="
for f in read-cuda-from-cpu read-cpu-from-cuda; do
  used=$(grep -c "replayed last token from session" "$OUT/$f.log")
  wiped=$(grep -c "unable to reuse common prefix" "$OUT/$f.log")
  echo "$f: replayed=$used wiped=$wiped"
  { [ "$used" -ge 1 ] && [ "$wiped" -eq 0 ]; } || fail=1
done

echo "=== generated text (for domain comparison) ==="
for f in base-cpu base-cuda read-cuda-from-cpu read-cpu-from-cuda; do
  echo "--- $f"
  grep -A2 "The capital of France is" "$OUT/$f.log" | head -3
done

echo "---"
echo "fail=$fail  out=$OUT"
exit "$fail"
