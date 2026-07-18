# Phase 0 Scope Decision

Mode: full.
Target: `/Users/ben/code/philip` on current branch `main`.
Audit workspace: `/Users/ben/code/philip/agent_ergonomics_audit/`.

User guardrails:
- Do not create a new branch or sibling workspace.
- Keep the first pass focused on `philip help`, `philip install`, `philip lint-audit`, and `philip diff`.
- Include help behavior, unknown flags, stdout/stderr discipline, exit codes, schema/JSON expectations, and regression tests.
- Explicitly revalidate `philip diff --help` artifact-writing behavior.
- Explicitly revalidate invalid `Confidence` values in `lint-audit`.
- Do not spend time reviewing example HTML reports except as sample artifacts for `philip diff`.
- Use `agent-session-search` instead of CASS; CASS is not functioning on this machine.

Preflight note:
- The skill preflight script reported missing Linux-specific `flock` and `timeout` on macOS. This pass used direct Node/npm validation instead of those wrappers.
