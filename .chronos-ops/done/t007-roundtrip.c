/* t007-roundtrip: measured turbo4 quantize->dequant round-trip on 1000 Gaussian vectors. */
#include <stdio.h>
#include <stdint.h>
#include <math.h>
#include "ggml-quants.h"

extern void quantize_row_turbo4_0_ref(const float * GGML_RESTRICT x, block_turbo4_0 * GGML_RESTRICT y, int64_t k);
extern void dequantize_row_turbo4_0(const block_turbo4_0 * GGML_RESTRICT x, float * GGML_RESTRICT y, int64_t k);

/* Same LCG+Box-Muller as ggml-turbo-quant.c (deterministic across platforms). */
static uint64_t prng_state;
static void prng_seed(uint64_t seed) { prng_state = seed; }
static double prng_normal(void) {
    prng_state = prng_state * 6364136223846793005ULL + 1442695040888963407ULL;
    double u1 = (double)(prng_state >> 11) / (double)(1ULL << 53);
    if (u1 < 1e-15) u1 = 1e-15;
    prng_state = prng_state * 6364136223846793005ULL + 1442695040888963407ULL;
    double u2 = (double)(prng_state >> 11) / (double)(1ULL << 53);
    return sqrt(-2.0 * log(u1)) * cos(2.0 * M_PI * u2);
}

int main(void) {
    const int D = QK_TURBO4; /* 128 */
    const int N = 1000;

    float x[D], recon[D];
    block_turbo4_0 blk[D / QK_TURBO4];

    double glob_max_abs = 0.0;
    double sum_vec_max_abs = 0.0;
    double max_rel_l2 = 0.0;
    double sum_rel_l2 = 0.0;
    double sum_norm_ratio = 0.0;
    double min_norm_ratio = 1e30;
    double max_norm_ratio = 0.0;

    prng_seed(42);
    for (int n = 0; n < N; n++) {
        double xnorm = 0.0;
        for (int i = 0; i < D; i++) {
            x[i] = (float)prng_normal();
            xnorm += (double)x[i] * x[i];
        }
        xnorm = sqrt(xnorm);

        quantize_row_turbo4_0_ref(x, blk, D);
        dequantize_row_turbo4_0(blk, recon, D);

        double vec_max_abs = 0.0, l2 = 0.0, rnorm = 0.0;
        for (int i = 0; i < D; i++) {
            double d = fabs((double)x[i] - recon[i]);
            if (d > vec_max_abs) vec_max_abs = d;
            l2 += d * d;
            rnorm += (double)recon[i] * recon[i];
        }
        double rel_l2 = sqrt(l2) / xnorm;
        double norm_ratio = sqrt(rnorm) / xnorm;

        if (vec_max_abs > glob_max_abs) glob_max_abs = vec_max_abs;
        sum_vec_max_abs += vec_max_abs;
        if (rel_l2 > max_rel_l2) max_rel_l2 = rel_l2;
        sum_rel_l2 += rel_l2;
        sum_norm_ratio += norm_ratio;
        if (norm_ratio < min_norm_ratio) min_norm_ratio = norm_ratio;
        if (norm_ratio > max_norm_ratio) max_norm_ratio = norm_ratio;
    }

    printf("vectors=%d dim=%d\n", N, D);
    printf("max|delta|            global=%.6f  mean-per-vector=%.6f\n", glob_max_abs, sum_vec_max_abs / N);
    printf("rel L2 (||r-x||/||x||) max=%.6f  mean=%.6f\n", max_rel_l2, sum_rel_l2 / N);
    printf("norm ratio (||r||/||x||) mean=%.6f  min=%.6f  max=%.6f\n",
           sum_norm_ratio / N, min_norm_ratio, max_norm_ratio);
    return 0;
}
