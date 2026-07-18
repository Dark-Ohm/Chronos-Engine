# Agent-Ergonomics Pass 2 Handoff

Target: `/Users/ben/code/philip` on `main`.
Workspace: `/Users/ben/code/philip/agent_ergonomics_audit/`.

Implemented:
- Pass 2: `philip --robot-triage` mega-command.
- The command prints one parseable JSON object on stdout and writes no diagnostics on success.
- The payload includes tool/version/contract version, commands, structured surfaces, `.philip/artifacts/` health, latest/current diff artifact paths, discovered verification commands, recommended next commands, recovery hints, and exit codes.
- The command is side-effect free and does not create `.philip/artifacts/` when absent.
- Unknown `--robot-triage` flags exit 2 with corrective stderr.
- Focused regression coverage added in `scripts/test-philip-cli.mjs` and `audit/regression_tests/R-006__robot_triage.test.sh`.
- README Agent CLI Contract updated with the mega-command.
- Pass 1:
- Command-specific help for `install`, `lint-audit`, `diff`, `capabilities`, and `robot-docs`.
- `philip diff --help` is side-effect free.
- `philip diff --json` emits a parseable result envelope.
- Unknown commands and options exit 2 with corrective diagnostics on stderr.
- `lint-audit` rejects invalid `Confidence` labels.
- `philip capabilities --json` exposes the CLI contract.
- `philip robot-docs guide` exposes an agent quick guide.
- Regression coverage added in `scripts/test-philip-cli.mjs` and `scripts/test-audit-report-lint.mjs`.

Explicit revalidation:
- `philip diff --help`: fixed. It prints help and does not write an artifact.
- Invalid `Confidence`: fixed. It produces `INVALID_CONFIDENCE_LABEL`.
- `philip --robot-triage`: added. It is JSON-only on stdout, side-effect free, and reports existing `.philip/artifacts/main/philip-diff.json` without creating artifacts.

Deferred:
- Consider schema docs for the `philip diff --json` result envelope if external consumers grow.

Validation to rerun:
- `npm run check`
- `npm run test:cli`
- `npm run test:lint-audit`
- `npm run test:diff`
- `for t in agent_ergonomics_audit/audit/regression_tests/*.test.sh; do sh "$t"; done`
