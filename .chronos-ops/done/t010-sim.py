#!/usr/bin/env python3
"""T010 simulation: KVarN SWA ring store/view consistency for --kv-hot-size.

Replicates the exact index math from:
- store: kvarn_store_kernel_headwide (ggml/src/ggml-cuda/kvarn.cu)
- view/read: ggml_cuda_fattn_kvarn_load_rotated + mma_plan_tile +
  swa_group_from_record (ggml-cuda/fattn-mma-kvarn-*.cuh, fattn-kvarn-vec.cuh)
- live_group: ggml_cuda_fattn_kvarn_live_group_for_thread (fattn.cu)

Config mirrors G-4 short A/B: --kv-hot-size 4096, -c 8192, -ub 256.
tail_groups=2, stage_groups=2, groups_per_stream=32.
"""

KVAR_N_GROUP = 128
TAIL = 2
STAGE = 2
GPS = 32  # groups_per_stream (SWA ring capacity)


class Store:
    """Replicates the store kernel: writes tokens in order, flushes when a
    group's pos-0 token arrives (group >= TAIL)."""

    def __init__(self):
        # stage[pos] = value; record[slot] = dict(group -> 128 values)
        self.stage = {}
        self.records = {}
        self.log = []

    def store_token(self, abs_pos, tag):
        group = abs_pos // KVAR_N_GROUP
        pos = abs_pos % KVAR_N_GROUP
        if pos == 0 and group >= TAIL:
            flush_group = group - TAIL
            flush_ring = flush_group % GPS
            # quantize stage slot for flush_group
            slot = flush_group % STAGE
            vals = self.stage.pop(slot, None)
            if vals is not None and vals[0] != flush_group:
                # mismatch: the slot does not hold what we think
                self.log.append(
                    f"FLUSH MISMATCH at pos {abs_pos}: slot {slot} holds group "
                    f"{vals[0]} but flush expects {flush_group}")
            self.records[flush_ring] = flush_group
        slot = group % STAGE
        self.stage[slot] = (group, pos)
        return group, pos, slot

    def stage_groups(self):
        return {s: v[0] for s, v in self.stage.items()}

    def record_groups(self):
        return {s: g for s, g in self.records.items()}


def swa_group_from_record(live_group, group):
    if group < 0:
        return False
    distance = live_group - group
    return distance >= TAIL and distance < GPS + TAIL


def read_resolve(live_group, abs_pos):
    """Replicates ggml_cuda_fattn_kvarn_load_rotated / vec_resolve."""
    if abs_pos < 0:
        return None, None, None
    group = abs_pos // KVAR_N_GROUP
    pos = abs_pos % KVAR_N_GROUP
    stage_begin = live_group - (TAIL - 1) if live_group >= TAIL - 1 else 0
    from_stage = stage_begin <= group <= live_group
    if from_stage:
        return "stage", (group % STAGE), pos
    if swa_group_from_record(live_group, group):
        return "record", (group % GPS), pos
    return "invalid", None, None


def run(prefill_len, ubatch=256, label=""):
    s = Store()
    failures = []

    # prefill in ubatches, mirroring llama.cpp: each ubatch stores then attends
    n = 0
    pos = 0
    while pos < prefill_len:
        n_cur = min(ubatch, prefill_len - pos)
        # store the ubatch
        for i in range(n_cur):
            s.store_token(pos + i, "prefill")
        # attention for this ubatch: n_kv = PAD(pos+n_cur, 256)
        n_kv = ((pos + n_cur + 255) // 256) * 256
        cells = list(range(0, n_kv))  # identity cell->pos for the short case
        live_group = max((c // KVAR_N_GROUP) for c in cells if c < pos + n_cur) \
            if pos + n_cur > 0 else 0
        # check every cell read resolves to a slot that holds that group
        for cell in range(n_kv):
            abs_pos = cell if cell < pos + n_cur else -1
            src, idx, p = read_resolve(live_group, abs_pos)
            group = abs_pos // KVAR_N_GROUP if abs_pos >= 0 else None
            if abs_pos < 0:
                continue
            if src == "stage":
                got = s.stage_groups().get(idx)
                if got != group:
                    failures.append(
                        f"cell {cell} pos {abs_pos}: stage slot {idx} holds "
                        f"group {got}, want {group} (live_group {live_group})")
            elif src == "record":
                got = s.record_groups().get(idx)
                if got != group:
                    failures.append(
                        f"cell {cell} pos {abs_pos}: record slot {idx} holds "
                        f"group {got}, want {group} (live_group {live_group})")
            else:
                failures.append(
                    f"cell {cell} pos {abs_pos}: INVALID source "
                    f"(live_group {live_group})")
        pos += n_cur
        n += 1

    print(f"=== {label}: prefill {prefill_len} in {n} ubatches ===")
    print(f"store log mismatches: {len([l for l in s.log if 'MISMATCH' in l])}")
    print(f"read failures: {len(failures)}")
    for f in failures[:12]:
        print("  ", f)
    if not failures and not s.log:
        print("  -> consistent")


if __name__ == "__main__":
    run(1763, label="short A/B (1763)")
    run(8192, label="full 8192")
    # wrapped case: 50K tokens with n_swa=4096, c=65536. Cells wrap in metadata.
    # simulate the last 4096-token window after 50K tokens with ring reuse.
    run(65536 - 4096, ubatch=256, label="50K prefix")
