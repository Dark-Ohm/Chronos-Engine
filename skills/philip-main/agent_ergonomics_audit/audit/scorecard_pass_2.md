# Agent-Ergonomics Scorecard Pass 2

Target commit baseline: `61924f1` (Pass 1 complete).
Scope: deferred Ambition Bar item, `philip --robot-triage`.

| Surface | Before median | After median | Delta |
| --- | ---: | ---: | ---: |
| `philip --robot-triage` | 0 | 850 | +850 |
| Artifact-store discovery | 350 | 820 | +470 |
| Verification command discovery | 450 | 780 | +330 |
| Recovery hints / exit-code lookup | 620 | 800 | +180 |

Evidence:
- `philip --robot-triage` prints one JSON object to stdout and no diagnostics on success.
- The command is side-effect free; it does not create `.philip/artifacts/` when the store is absent.
- Unknown `--robot-triage` flags exit 2 with corrective stderr.
- The payload includes `tool`, `version`, `contractVersion`, `commands`, `structuredSurfaces`, `artifactStore`, `currentDiffArtifactPath`, `latestDiffArtifactPath`, `verification`, `recommendedNextCommands`, `recoveryHints`, and `exitCodes`.
- Regression coverage lives in `scripts/test-philip-cli.mjs` and `audit/regression_tests/R-006__robot_triage.test.sh`.
