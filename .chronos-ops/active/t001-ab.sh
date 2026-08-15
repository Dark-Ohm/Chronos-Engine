#!/bin/bash
# T001 A/B: fused vs dequant decode. Two parts, both artifacts saved:
#   (1) route proof: short run with GGML_TURBO_FA_DEBUG=1 -> path= per arm.
#   (2) t/s: deterministic --ignore-eos -s <seed>, NO debug (debug perturbs
#       t/s ~5x, see T001-report), 3 seeds x 3 repeats per arm.
# Outputs: .chronos-ops/active/t001-ab/{fused,dequant}-route.log,
#          .chronos-ops/active/t001-ab/{fused,dequant}-s<seed>-<rep>.log,
#          .chronos-ops/active/t001-ab/summary.tsv
set -u
cd "$(dirname "$0")/../.." || exit 1
M="models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf"
BIN="build-debug/bin"
OUT=".chronos-ops/active/t001-ab"
mkdir -p "$OUT"
PROMPT="The capital of France is"
SEEDS="42 43 44"
REPS="1 2 3"

# ---- 1. route proof (short, debug ON; t/s ignored here) ----
for arm in fused dequant; do
  log="$OUT/${arm}-route.log"
  if [ "$arm" = dequant ]; then
    GGML_TURBO_MMA_FUSED=0 GGML_TURBO_FA_DEBUG=1 \
      "$BIN/llama-completion" -m "$M" -p "$PROMPT" -n 8 -c 512 -ngl -1 \
      -fa on -ctk turbo4 -ctv turbo4 -no-cnv -s 42 > "$log" 2>&1
  else
    GGML_TURBO_FA_DEBUG=1 \
      "$BIN/llama-completion" -m "$M" -p "$PROMPT" -n 8 -c 512 -ngl -1 \
      -fa on -ctk turbo4 -ctv turbo4 -no-cnv -s 42 > "$log" 2>&1
  fi
  echo "route[$arm]: $(grep -oE 'path=[a-z0-9_-]+' "$log" | sort -u | tr '\n' ' ')"
done

# ---- 2. t/s (clean, deterministic, 3 seeds x 3 reps) ----
: > "$OUT/summary.tsv"
printf "arm\tseed\trep\trc\truns\ttps\n" > "$OUT/summary.tsv"
for arm in fused dequant; do
  for s in $SEEDS; do
    for r in $REPS; do
      log="$OUT/${arm}-s${s}-${r}.log"
      if [ "$arm" = dequant ]; then
        GGML_TURBO_MMA_FUSED=0 "$BIN/llama-completion" -m "$M" -p "$PROMPT" \
          -n 128 -c 512 -ngl -1 -fa on -ctk turbo4 -ctv turbo4 -no-cnv \
          --ignore-eos -s "$s" > "$log" 2>&1
      else
        "$BIN/llama-completion" -m "$M" -p "$PROMPT" \
          -n 128 -c 512 -ngl -1 -fa on -ctk turbo4 -ctv turbo4 -no-cnv \
          --ignore-eos -s "$s" > "$log" 2>&1
      fi
      rc=$?
      line=$(grep -E "eval time" "$log" | tail -1)
      runs=$(echo "$line" | grep -oE "/ *[0-9]+ runs" | grep -oE "[0-9]+")
      tps=$(echo "$line" | grep -oE "[0-9.]+ tokens per second" | grep -oE "[0-9.]+")
      printf "%s\t%s\t%s\t%s\t%s\t%s\n" "$arm" "$s" "$r" "$rc" "${runs:-0}" "${tps:-0}" >> "$OUT/summary.tsv"
    done
  done
done
echo "=== summary.tsv ==="
cat "$OUT/summary.tsv"
