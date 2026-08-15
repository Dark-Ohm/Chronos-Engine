#!/bin/bash
# T001 matrix harness - fail-closed, raw logs + machine-readable summary persisted.
# Classification is STRICT: only rc==0 AND a recognized FA path is "ok".
# Anything else (TIMEOUT / FAIL / CRASH / NOT-COMPILED / NO-FA) sets fail=1,
# so the harness exits non-zero if any combo does not route through FA.
# Raw logs -> RAW_DIR (kept). Machine-readable rows -> SUMMARY (TSV).
set -u

cd "$(dirname "$0")/../.." || exit 1
M="models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf"
BIN="build-debug/bin/llama-completion"
RAW_DIR=".chronos-ops/active/t001-matrix-raw"
SUMMARY=".chronos-ops/active/t001-matrix-summary.tsv"
mkdir -p "$RAW_DIR"
: > "$SUMMARY"
printf 'K\tV\trc\tstatus\tfused\tprefill\tdecode\tkernel\n' >> "$SUMMARY"

TURBO="turbo2 turbo3 turbo4 turbo2_tcq turbo3_tcq turbo4_tcq"
CLASSIC="f32 f16 bf16 q8_0 q4_0 q4_1 q5_0 q5_1 iq4_nl"

combos=()
for k in $TURBO; do for v in $TURBO; do combos+=("$k|$v"); done; done
for t in $TURBO; do for c in $CLASSIC; do combos+=("$t|$c" "$c|$t"); done; done

fail=0
n=0
total=${#combos[@]}
for c in "${combos[@]}"; do
  K="${c%%|*}"; V="${c##*|}"
  LOG="$RAW_DIR/${K}__${V}.log"
  n=$((n+1))
  GGML_TURBO_FA_DEBUG=1 GGML_CUDA_FA_ROUTE_DEBUG=1 timeout 25 "$BIN" \
    -m "$M" -p "The capital of France is" -n 2 -c 256 -ngl -1 -fa on \
    -ctk "$K" -ctv "$V" -no-cnv >"$LOG" 2>&1
  rc=$?

  if [ "$rc" -ne 0 ]; then
    if [ "$rc" -eq 124 ]; then ST="TIMEOUT"
    elif grep -qE "illegal memory access|CUDA error" "$LOG"; then ST="CRASH"
    else ST="FAIL(rc=$rc)"; fi
  else
    if grep -q "illegal memory access\|CUDA error" "$LOG"; then ST="CRASH"
    elif grep -qE "not compiled" "$LOG"; then ST="NOT-COMPILED"
    elif ! grep -q "path=" "$LOG"; then ST="NO-FA"
    else ST="ok"; fi
  fi
  # fail-closed: any non-ok row fails the harness
  [ "$ST" = ok ] || fail=1

  fused=$(grep -c "path=fused-mma" "$LOG")
  prefd=$(grep -c "path=prefill-dequant" "$LOG")
  ddec=$(grep -c "path=decode-dequant-or-vec" "$LOG")
  kern=$(grep -oE "kernel=[A-Z_0-9]+" "$LOG" | sort | uniq -c | tr '\n' ';')
  echo "[$n/$total] [$K $V] rc=$rc fused=$fused prefill=$prefd decode=$ddec | $kern | $ST"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$K" "$V" "$rc" "$ST" "$fused" "$prefd" "$ddec" "$kern" >> "$SUMMARY"
done

echo "---"
echo "combos=$n  failing=$fail  raw=$RAW_DIR  summary=$SUMMARY"
exit "$fail"
