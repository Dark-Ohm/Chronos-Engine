# Post-Pass Simulation Summary

Observed after changes:
- `philip diff --help` exits 0, prints help, and writes no artifact.
- `philip diff --bad` exits 2 with stderr diagnostics and writes no artifact.
- `philip diff --json` exits 0 and prints a parseable result envelope.
- Invalid `Confidence` values produce `INVALID_CONFIDENCE_LABEL`.
- `philip help diff`, `philip capabilities --json`, and `philip robot-docs guide` all exit 0.
