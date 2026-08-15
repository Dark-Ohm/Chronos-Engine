#!/usr/bin/env python3
"""Generate a short NIAH prompt for the T010 A/B: needle at the start,
a question at the end, filler in between. Target ~1760 tokens for Qwythos
(Qwen3.5 tokenizer, ~1.3 tok/word for english prose)."""
import json
import random
import sys

random.seed(7749)

NEEDLE = "BLUE-ORBIT-7749"
FACT = f"The SECRET_NEEDLE_CODE is {NEEDLE}."

WORDS = (
    "the quick brown fox jumps over a lazy dog near the old wooden bridge "
    "while workers repair the main road through the small village by the river "
    "where children play and farmers harvest the golden wheat fields under "
    "a bright morning sky with scattered clouds drifting slowly across the hills"
).split()


def filler(n_words):
    out = []
    while len(out) < n_words:
        out.extend(WORDS)
    return " ".join(out[:n_words])


def main():
    n_words = int(sys.argv[1]) if len(sys.argv) > 1 else 1350
    fill = filler(n_words)
    # needle right after the opening; question at the very end
    prompt = (
        "You are a helpful assistant. Answer the final question using only "
        "the information in the text below.\n\n"
        "TEXT START\n"
        f"{FACT}\n"
        f"{fill}\n"
        "TEXT END\n\n"
        "Final question: What is the SECRET_NEEDLE_CODE? "
        "Answer with the code only.\n"
    )
    req = {
        "messages": [
            {"role": "user", "content": prompt},
        ],
        "max_tokens": 128,
        "temperature": 0.0,
        "stream": False,
    }
    with open("/tmp/t010-niah.json", "w") as f:
        json.dump(req, f)
    print(f"wrote /tmp/t010-niah.json, prompt chars={len(prompt)}")


if __name__ == "__main__":
    main()
