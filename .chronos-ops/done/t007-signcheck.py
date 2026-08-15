#!/usr/bin/env python3
import re

def extract(path, name):
    src = open(path).read()
    m = re.search(r'\b' + re.escape(name) + r'\s*\[\d*\]\s*=\s*\{(.*?)\};', src, re.S)
    assert m, f"not found: {name} in {path}"
    nums = re.findall(r'-?\d+\.?\d*(?:[eE][+-]?\d+)?', m.group(1))
    return [float(x) for x in nums]

def eq(a, b, la, lb):
    same = a == b
    print(f"  {la} == {lb}: {'MATCH' if same else 'MISMATCH'} ({len(a)} values)")
    return same

ok = True
cpu_s1 = extract("ggml/src/ggml-turbo-quant.c", "turbo_cpu_s1")
cpu_s2 = extract("ggml/src/ggml-turbo-quant.c", "turbo_cpu_s2")
wht_s1 = extract("ggml/src/ggml-cuda/turbo-wht.cu", "d_turbo_wht_s1")
wht_s2 = extract("ggml/src/ggml-cuda/turbo-wht.cu", "d_turbo_wht_s2")
q_s1   = extract("ggml/src/ggml-cuda/turbo-quant-cuda.cuh", "d_turbo_wht_signs1")
q_s2   = extract("ggml/src/ggml-cuda/turbo-quant-cuda.cuh", "d_turbo_wht_signs2")
f_s1   = extract("ggml/src/ggml-cuda/fattn-common.cuh", "d_turbo_wht_signs1_fattn")
f_s2   = extract("ggml/src/ggml-cuda/fattn-common.cuh", "d_turbo_wht_signs2_fattn")

ok &= eq(cpu_s1, wht_s1, "cpu_s1", "wht_s1")
ok &= eq(cpu_s2, wht_s2, "cpu_s2", "wht_s2")
ok &= eq(cpu_s1, q_s1,   "cpu_s1", "quant_signs1")
ok &= eq(cpu_s2, q_s2,   "cpu_s2", "quant_signs2")
ok &= eq(cpu_s1, f_s1,   "cpu_s1", "fattn_signs1")
ok &= eq(cpu_s2, f_s2,   "cpu_s2", "fattn_signs2")

print("ALL MATCH" if ok else "MISMATCH DETECTED")
raise SystemExit(0 if ok else 1)
