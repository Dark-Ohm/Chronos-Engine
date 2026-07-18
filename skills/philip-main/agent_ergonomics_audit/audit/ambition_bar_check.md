# Ambition Bar Check

## Pass 2

Substantive changes shipped: 1 focused mega-command.

Dimensions touched:
- agent_ergonomics
- output_parseability
- self_documentation
- composability
- recovery
- regression_resistance

Required surface types:
- Mega-command: yes, `philip --robot-triage`.
- Capabilities or robot-docs: unchanged from Pass 1.
- `--json` or robot output on read-side: yes, `philip --robot-triage`.
- Error rewrite: yes, unknown `--robot-triage` flags exit 2 with corrective stderr.
- Intent-inference handler: unchanged from Pass 1.

Result:
- The Pass 1 deferred Ambition Bar item is now applied and regression-tested.
- No broader pass was attempted because the user explicitly scoped Pass 2 to the deferred mega-command.

## Pass 1

Substantive changes shipped: 5.

Dimensions touched:
- agent_intuitiveness
- agent_ergonomics
- output_parseability
- error_pedagogy
- intent_inference
- self_documentation
- composability
- regression_resistance

Required surface types:
- Mega-command: deferred. A broader `--robot-triage` would be useful, but this pass stayed focused on the user-requested surfaces.
- Capabilities or robot-docs: yes, both added.
- `--json` or robot output on read-side: yes, `philip diff --json` and `philip capabilities --json`.
- Error rewrite: yes, unknown command/flag diagnostics now include corrective commands.
- Intent-inference handler: yes, near-miss command and `--json` typo suggestions.

Self-prompt round:

> That's it?? I was hoping you would get a lot more practical value out of this skill.
> Where are the dramatic improvements? Re-read the playbook, look at the surfaces still
> scoring below 500 on output_parseability / error_pedagogy / intent_inference /
> self_documentation, and ship a substantially larger batch of high-leverage changes.
> You're allowed to be ambitious. Default to acting, not deliberating.

Result of self-prompt:
- Added capability and robot-doc surfaces rather than stopping at the two prior review fixes.
- Added JSON output for `philip diff`.
- Added typo/intent hints and exit-code discipline for user-input errors.
