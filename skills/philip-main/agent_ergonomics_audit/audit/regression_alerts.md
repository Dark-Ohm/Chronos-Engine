# Regression Alerts

No regressions found in the focused pass.

Validated areas:
- Existing `test:lint-audit` coverage.
- Existing `test:diff` coverage.
- New `test:cli` coverage.
- Manual CLI checks for `diff --help`, `diff --bad`, `diff --json`, `capabilities --json`, and invalid `Confidence`.
- Pass 2 `--robot-triage` JSON-only stdout, side-effect-free artifact inspection, unknown-flag exit 2 behavior, and shell regression.
