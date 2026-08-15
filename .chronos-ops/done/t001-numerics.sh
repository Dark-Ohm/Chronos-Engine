#!/bin/bash
# T001 numerics: KLD threshold chain + A/B. Outputs saved to EVID (tracked).
# CORPUS is the tracked long corpus (789 words), -c 256 for stable PPL.
set -u
cd "$(dirname "$0")/../.." || exit 1
M="models/main/dence/Qwythos-9B-v3-1M-MTP-Q4_K_M-fixed.gguf"
BIN="build-debug/bin"
CORPUS=".chronos-ops/active/t001-corpus.txt"
EVID=".chronos-ops/active/t001-numerics"
mkdir -p "$EVID"

# 1. f16 baseline logits
"$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk f16 -ctv f16 --save-all-logits /tmp/kld-f16.logits >"$EVID/f16-ppl.txt" 2>&1
echo "f16 ppl: $(grep -oE 'PPL = [0-9.]+' "$EVID/f16-ppl.txt" | head -1)"

# 2. dequant logits (turbo4, MMA_FUSED=0) as the fused-reference
GGML_TURBO_MMA_FUSED=0 "$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 --save-all-logits /tmp/kld-dequant.logits >"$EVID/dequant-ppl.txt" 2>&1
echo "dequant ppl: $(grep -oE 'PPL = [0-9.]+' "$EVID/dequant-ppl.txt" | head -1)"

# 3. fused logits + PPL (the missing artifact)
"$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 --save-all-logits /tmp/kld-fused.logits >"$EVID/fused-ppl.txt" 2>&1
echo "fused ppl: $(grep -oE 'PPL = [0-9.]+' "$EVID/fused-ppl.txt" | head -1)"

# 4. KLD(dequant || f16)  -- quantization noise floor
GGML_TURBO_MMA_FUSED=0 "$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 --kl-divergence --kl-divergence-base /tmp/kld-f16.logits \
  >"$EVID/kld-dequant-vs-f16.txt" 2>&1
echo "KLD(dequant||f16) median: $(grep -oE 'Median +KLD: +[0-9.]+' "$EVID/kld-dequant-vs-f16.txt" | head -1)"

# 5. KLD(fused || f16)
"$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 --kl-divergence --kl-divergence-base /tmp/kld-f16.logits \
  >"$EVID/kld-fused-vs-f16.txt" 2>&1
echo "KLD(fused||f16) median: $(grep -oE 'Median +KLD: +[0-9.]+' "$EVID/kld-fused-vs-f16.txt" | head -1)"

# 6. KLD(fused || dequant)  -- the divergence the audit actually claims
"$BIN/llama-perplexity" -m "$M" -f "$CORPUS" -c 256 -ngl -1 -fa on \
  -ctk turbo4 -ctv turbo4 --kl-divergence --kl-divergence-base /tmp/kld-dequant.logits \
  >"$EVID/kld-fused-vs-dequant.txt" 2>&1
echo "KLD(fused||dequant) median: $(grep -oE 'Median +KLD: +[0-9.]+' "$EVID/kld-fused-vs-dequant.txt" | head -1)"

# 7. A/B: 3 runs each, -c 512 -n 128
: > "$EVID/ab.txt"
for i in 1 2 3; do
  "$BIN/llama-completion" -m "$M" -p "The capital of France is" -n 128 -c 512 \
    -ngl -1 -fa on -ctk turbo4 -ctv turbo4 -no-cnv 2>&1 \
    | grep -E "eval time|tokens per second" | tail -1 >> "$EVID/ab.txt"
done
echo "--- dequant ---" >> "$EVID/ab.txt"
for i in 1 2 3; do
  GGML_TURBO_MMA_FUSED=0 "$BIN/llama-completion" -m "$M" -p "The capital of France is" -n 128 -c 512 \
    -ngl -1 -fa on -ctk turbo4 -ctv turbo4 -no-cnv 2>&1 \
    | grep -E "eval time|tokens per second" | tail -1 >> "$EVID/ab.txt"
done
echo "=== A/B ==="; cat "$EVID/ab.txt"
