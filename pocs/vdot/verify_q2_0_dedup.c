/*
 * One-off verification: upstream block_q2_0 (ID 42) vs beellama block_q2_0 (ID 53).
 *
 * Verdict: РАЗЛИЧАЮТСЯ.
 *   - QK: 64 (upstream) vs 32 (beellama)
 *   - Block size: 18 vs 10 bytes
 *   - Scale: signed max/-2 vs unsigned amax
 *   - Quant mapping: {0..3} -> {-2,-1,0,1} vs {0..3} -> {-1,0,1,2}
 *   - Bit packing: interleaved planes vs sequential quads
 *
 * Build: cc -o verify_q2_0_dedup verify_q2_0_dedup.c -lm
 * Run:   ./verify_q2_0_dedup
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <math.h>
#include <assert.h>

/* ---------- minimal ggml-half shim ---------- */

typedef uint16_t ggml_half;

static inline float fp16_to_fp32(ggml_half h) {
    /* IEEE 754 half -> float (portable) */
    uint32_t sign = (h >> 15) & 1;
    uint32_t exp  = (h >> 10) & 0x1f;
    uint32_t mant = h & 0x3ff;
    uint32_t f;
    if (exp == 0) {
        if (mant == 0) { f = sign << 31; }
        else { exp = 1; while (!(mant & 0x400)) { mant <<= 1; exp--; } mant &= 0x3ff; f = (sign<<31) | ((exp+127-15)<<23) | (mant<<13); }
    } else if (exp == 31) {
        f = (sign<<31) | 0x7f800000 | (mant<<13);
    } else {
        f = (sign<<31) | ((exp+127-15)<<23) | (mant<<13);
    }
    float r; memcpy(&r, &f, 4); return r;
}

static inline ggml_half fp32_to_fp16(float f) {
    uint32_t x; memcpy(&x, &f, 4);
    uint32_t sign = (x >> 31) & 1;
    int32_t  exp  = ((x >> 23) & 0xff) - 127 + 15;
    uint32_t mant = (x >> 13) & 0x3ff;
    if (exp <= 0)  { mant = ((x & 0x7fffff) | 0x800000) >> (1-exp); exp = 0; mant >>= 13; }
    if (exp >= 31) { exp = 31; mant = 0; }
    return (ggml_half)((sign << 15) | (exp << 10) | mant);
}

/* ========== UPSTREAM block_q2_0 (ID 42) ========== */

#define UP_QK2_0 64

typedef struct {
    ggml_half d;
    uint8_t qs[UP_QK2_0 / 4]; /* 16 bytes */
} up_block_q2_0;

static_assert(sizeof(up_block_q2_0) == 18, "upstream q2_0 block must be 18 bytes");

static void up_quantize_row_q2_0(const float *x, up_block_q2_0 *y, int64_t k) {
    const int qk = UP_QK2_0;
    assert(k % qk == 0);
    const int nb = k / qk;

    for (int i = 0; i < nb; i++) {
        float amax = 0.0f, max = 0.0f;
        for (int j = 0; j < qk; j++) {
            const float v = x[i*qk + j];
            if (amax < fabsf(v)) { amax = fabsf(v); max = v; }
        }
        const float d  = max / -2;
        const float id = d ? 1.0f/d : 0.0f;
        y[i].d = fp32_to_fp16(d);
        memset(y[i].qs, 0, sizeof(y[i].qs));
        for (int j = 0; j < qk; ++j) {
            const float x0 = x[i*qk + j]*id;
            const uint8_t xi0 = (uint8_t)(x0 + 2.5f);
            const uint8_t clamped = xi0 < 3 ? xi0 : 3; /* MIN(3, xi0) */
            y[i].qs[j % (qk/4)] |= (clamped & 0x03) << (2*(j / (qk/4)));
        }
    }
}

static void up_dequantize_row_q2_0(const up_block_q2_0 *x, float *y, int64_t k) {
    const int qk = UP_QK2_0;
    assert(k % qk == 0);
    const int nb = k / qk;

    for (int i = 0; i < nb; i++) {
        const float d = fp16_to_fp32(x[i].d);
        for (int j = 0; j < qk; ++j) {
            const int32_t q = (x[i].qs[j % (qk/4)] >> (2*(j / (qk/4)))) & 0x03;
            y[i*qk + j] = (q - 2)*d;
        }
    }
}

/* ========== BEELLAMA block_q2_0 (ID 53) ========== */

#define BEE_QK2_0 32

typedef struct {
    ggml_half d;
    uint8_t qs[BEE_QK2_0 / 4]; /* 8 bytes */
} bee_block_q2_0;

static_assert(sizeof(bee_block_q2_0) == 10, "beellama q2_0 block must be 10 bytes");

static void bee_quantize_row_q2_0(const float *x, bee_block_q2_0 *y, int64_t k) {
    const int qk = BEE_QK2_0;
    assert(k % qk == 0);
    const int nb = k / qk;

    for (int i = 0; i < nb; i++) {
        float amax = 0.0f;
        for (int j = 0; j < qk; j++) {
            const float a = fabsf(x[i*qk + j]);
            if (a > amax) amax = a;
        }
        const float d  = amax;
        const float id = d > 0.0f ? 1.0f / d : 0.0f;
        y[i].d = fp32_to_fp16(d);
        for (int j = 0; j < qk / 4; ++j) { y[i].qs[j] = 0; }
        for (int j = 0; j < qk; ++j) {
            const float w = x[i*qk + j];
            int q = (int)roundf(w * id) + 1;
            if (q < 0) q = 0;
            if (q > 3) q = 3;
            const int byte_index = j / 4;
            const int bit_offset = (j % 4) * 2;
            y[i].qs[byte_index] |= ((uint8_t)q << bit_offset);
        }
    }
}

static void bee_dequantize_row_q2_0(const bee_block_q2_0 *x, float *y, int64_t k) {
    const int qk = BEE_QK2_0;
    assert(k % qk == 0);
    const int nb = k / qk;

    for (int i = 0; i < nb; i++) {
        const float d = fp16_to_fp32(x[i].d);
        for (int j = 0; j < qk; ++j) {
            const int byte_index = j / 4;
            const int bit_offset = (j % 4) * 2;
            const uint8_t q = (x[i].qs[byte_index] >> bit_offset) & 0x03;
            y[i*qk + j] = ((int)q - 1) * d;
        }
    }
}

/* ========== Deterministic PRNG (seeded) ========== */

static uint32_t rng_state;

static float rand_float(void) {
    /* xorshift32 -> uniform [0,1) */
    rng_state ^= rng_state << 13;
    rng_state ^= rng_state >> 17;
    rng_state ^= rng_state << 5;
    return (float)(rng_state & 0x7fffffff) / (float)0x7fffffff * 2.0f - 1.0f;
}

/* ========== Main ========== */

#define N 256
#define SEED 42

int main(void) {
    /* Deterministic input */
    float input[N];
    rng_state = SEED;
    for (int i = 0; i < N; i++) input[i] = rand_float();

    /* ---- Structure layout comparison ---- */
    printf("=== Struct Layout ===\n");
    printf("Upstream:  QK2_0=%d  sizeof(block_q2_0)=%zu  (d=%zu + qs=%zu)\n",
           UP_QK2_0, sizeof(up_block_q2_0), sizeof(ggml_half), sizeof(((up_block_q2_0*)0)->qs));
    printf("Beellama:  QK2_0=%d  sizeof(block_q2_0)=%zu  (d=%zu + qs=%zu)\n",
           BEE_QK2_0, sizeof(bee_block_q2_0), sizeof(ggml_half), sizeof(((bee_block_q2_0*)0)->qs));

    if (sizeof(up_block_q2_0) != sizeof(bee_block_q2_0) || UP_QK2_0 != BEE_QK2_0) {
        printf("VERDICT: RAZLICHAYUTSYA (struct size / QK differ)\n\n");
    }

    /* ---- Quantize with both ---- */
    up_block_q2_0 up_blocks[N / UP_QK2_0];
    bee_block_q2_0 bee_blocks[N / BEE_QK2_0];

    up_quantize_row_q2_0(input, up_blocks, N);
    bee_quantize_row_q2_0(input, bee_blocks, N);

    /* ---- Hex dump of first block from each ---- */
    printf("=== First Block Hex Dump ===\n");
    printf("Upstream block[0] (%zu bytes): ", sizeof(up_block_q2_0));
    {
        const uint8_t *p = (const uint8_t *)&up_blocks[0];
        for (size_t b = 0; b < sizeof(up_block_q2_0); b++) printf("%02x ", p[b]);
    }
    printf("\n");

    printf("Beellama block[0] (%zu bytes): ", sizeof(bee_block_q2_0));
    {
        const uint8_t *p = (const uint8_t *)&bee_blocks[0];
        for (size_t b = 0; b < sizeof(bee_block_q2_0); b++) printf("%02x ", p[b]);
    }
    printf("\n\n");

    /* ---- Byte-level comparison of first 32 input elements ---- */
    /* upstream processes 64 elements per block, beellama 32.
       Compare the first 32 elements (bee block[0] vs upstream block[0] first half). */
    printf("=== Byte Comparison: first 32 elements ===\n");
    printf("Upstream block[0] qs bytes (first 8 of 16): ");
    for (int b = 0; b < 8; b++) printf("%02x ", up_blocks[0].qs[b]);
    printf("\nBeellama block[0] qs bytes (all 8):        ");
    for (int b = 0; b < 8; b++) printf("%02x ", bee_blocks[0].qs[b]);
    printf("\n");
    int qs_match = memcmp(up_blocks[0].qs, bee_blocks[0].qs, 8) == 0;
    printf("First 8 qs bytes: %s\n\n", qs_match ? "MATCH" : "DIFFER");

    /* ---- Dequantize and compare ---- */
    float up_out[N], bee_out[N];
    up_dequantize_row_q2_0(up_blocks, up_out, N);
    bee_dequantize_row_q2_0(bee_blocks, bee_out, N);

    printf("=== Dequantize Comparison (first 16 elements) ===\n");
    printf("  idx  | input      | upstream    | beellama    | match?\n");
    printf("  -----+------------+-------------+-------------+------\n");
    for (int i = 0; i < 16; i++) {
        int m = (up_out[i] == bee_out[i]);
        printf("  [%2d] | %+10.6f | %+10.6f | %+10.6f | %s\n",
               i, input[i], up_out[i], bee_out[i], m ? "YES" : "NO");
    }

    /* Full-array max abs diff */
    float max_diff = 0.0f;
    int max_diff_idx = 0;
    for (int i = 0; i < N; i++) {
        float diff = fabsf(up_out[i] - bee_out[i]);
        if (diff > max_diff) { max_diff = diff; max_diff_idx = i; }
    }
    printf("\nMax abs diff across %d elements: %e at index %d\n", N, max_diff, max_diff_idx);

    /* ---- Summary ---- */
    printf("\n=== VERDICT ===\n");
    printf("RAZLICHAYUTSYA\n");
    printf("\nDifferences:\n");
    printf("  1. QK: upstream=%d, beellama=%d\n", UP_QK2_0, BEE_QK2_0);
    printf("  2. Block size: upstream=%zu bytes, beellama=%zu bytes\n",
           sizeof(up_block_q2_0), sizeof(bee_block_q2_0));
    printf("  3. Scale: upstream d=max/-2 (signed), beellama d=amax (unsigned)\n");
    printf("  4. Quant map: upstream {0..3}->{-2,-1,0,1}*d, beellama {0..3}->{-1,0,1,2}*d\n");
    printf("  5. Bit packing: upstream interleaved planes (j%%16, j/16), "
           "beellama sequential quads (j/4, (j%%4)*2)\n");
    printf("\nConclusion: bee q2_0(ID=53) CANNOT be deduplicated with upstream Q2_0(ID=42).\n");
    printf("They are incompatible formats. ARCHITECTURE.md D-005 needs revision.\n");

    return 0;
}
