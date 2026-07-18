# Agent-Ergonomics Scorecard

Current pass: Pass 2.

Scope: Pass 1 surfaces plus the deferred Ambition Bar mega-command, `philip --robot-triage`.

| Surface | Before median | After median | Delta |
| --- | ---: | ---: | ---: |
| `philip help` | 520 | 760 | +240 |
| `philip install` | 620 | 700 | +80 |
| `philip lint-audit` | 650 | 760 | +110 |
| `philip diff` | 520 | 800 | +280 |
| `philip capabilities --json` | 0 | 820 | +820 |
| `philip robot-docs guide` | 0 | 760 | +760 |
| `philip --robot-triage` | 0 | 850 | +850 |

Highest-impact fixes:
- `philip diff --help` no longer writes `.philip/artifacts/main/philip-diff.json`.
- `philip diff --bad` exits 2 and writes diagnostics to stderr instead of producing an artifact.
- `lint-audit` rejects invalid `Confidence` values.
- `philip diff --json` and `philip capabilities --json` are parseable stdout-only surfaces.
- `philip --robot-triage` now gives agents a one-call JSON packet with artifact-store health, latest/current diff artifact paths, discovered verification commands, next commands, recovery hints, and exit codes. It is side-effect free and keeps stdout as JSON data only.
