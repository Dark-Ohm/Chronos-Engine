# Uplift Diff

## Pass 2

Measured improvements:
- Added `philip --robot-triage` as a side-effect-free mega-command.
- Output parseability improved for first-contact agents: one JSON object contains command discovery, structured surfaces, artifact-store health, current/latest diff artifact paths, verification commands, recommended next commands, recovery hints, and exit codes.
- Recovery quality improved: unknown `--robot-triage` flags exit 2 on stderr with the exact corrective invocation.
- Regression resistance improved with both Node CLI coverage and an audit shell regression.

No focused surface regressed by more than 50 points.

## Pass 1

Measured improvements:
- Help behavior: command-specific help added; `diff --help` side effect removed.
- Output parseability: `diff --json` and `capabilities --json` added.
- Error pedagogy: unknown commands and flags now include exact corrective commands or flags.
- Intent inference: `dif` suggests `philip diff`; `--jsno` suggests `--json`.
- Regression resistance: focused CLI tests and invalid-confidence fixtures added.

No focused surface regressed by more than 50 points.
