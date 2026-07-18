# Philip CLI Agent-Ergonomics Playbook

Top fixes applied in this pass:

1. Make `--help` side-effect free for `philip diff`.
2. Add command-specific help through `philip help <command>`.
3. Reject unknown flags before command execution.
4. Use exit 2 for user-input errors.
5. Add `philip diff --json` as the parseable result envelope.
6. Enforce the documented `Confidence: High|Medium|Low` audit contract.
7. Add `philip capabilities --json` for machine-readable discovery.
8. Add `philip robot-docs guide` for in-tool agent onboarding.
9. Pin the CLI behavior in `scripts/test-philip-cli.mjs`.
10. Pin invalid confidence validation in both direct linter and CLI coverage.
11. Add `philip --robot-triage` as the one-call JSON status packet for agents.

Deferred:
- No known Pass 2 CLI surface remains deferred. Future passes can add schema docs if external consumers depend on the `philip diff --json` result envelope.
