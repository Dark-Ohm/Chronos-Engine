# Documentation Types

Use the smallest doc type that solves the user's problem. Do not create a documentation cathedral when the repo needs a working setup guide.

## Selection Guide

| Need | Doc Type | Use When | Evidence To Gather |
| --- | --- | --- | --- |
| First contact | README | The project lacks a clear entry point or the current README is stale. | Package metadata, main binaries, app routes, CI, tests. |
| Clone to working system | Setup Guide | Users need install, env, local services, or verification steps. | Manifests, Docker Compose, env reads, CI setup, scripts. |
| Common job | How-To Guide | The user wants to complete one practical task. | Code path for the task, required config, tests, examples. |
| Public contract | API Reference | The project exposes HTTP, GraphQL, RPC, SDK, plugin, or CLI interfaces. | Route handlers, schemas, OpenAPI, proto, types, CLI parsers. |
| Understanding | Architecture Guide | Contributors need a map of modules, flows, boundaries, or tradeoffs. | Imports, service boundaries, data stores, diagrams, tests. |
| Operation | Runbook | Humans operate, deploy, rollback, monitor, or recover the system. | CI/CD, infra config, health checks, logs, metrics, incidents. |
| Failure recovery | Troubleshooting | Users hit repeated errors or support questions. | Issue history, test failures, logs, known error strings. |
| Change awareness | Changelog or Release Notes | Users need to know what changed and whether they must act. | Git history, tags, merged PRs, changesets, migrations. |
| Contribution | Contributor Guide | New contributors need workflow, conventions, tests, review rules. | Existing scripts, lint config, test layout, branch rules. |
| Security | Security Guide | Auth, permissions, secrets, data handling, or vulnerability reporting matters. | Auth code, secret reads, policy files, threat boundaries. |
| Migration | Migration Guide | Users must change config, data, APIs, or workflows between versions. | Migrations, compatibility code, deprecations, release commits. |
| Glossary | Glossary | Project terms are domain-specific or overloaded. | Type names, UI labels, schema names, docs usage. |

## README

Purpose: orient readers and route them to the right next step.

Include:

- What the project does, grounded in repo evidence.
- Quick start that reaches a working verification command.
- Common tasks with links.
- Development and test commands.
- Pointers to architecture, API, and operations docs.

Avoid:

- Long architecture essays.
- Full API references.
- Claims not backed by current code.

## Setup Guide

Purpose: get from clone to a verified local or deployed environment.

Include:

- Supported runtimes and package managers.
- Required services and credentials.
- Environment variables with source evidence.
- Install, configure, run, test, and reset steps.
- Troubleshooting for the first likely failures.

Required verification:

```bash
# Example shape only. Replace with the repo's real command.
pnpm test
```

## How-To Guide

Purpose: teach one task end to end.

Use for:

- Adding a provider.
- Creating a migration.
- Running a backfill.
- Adding an integration.
- Debugging a known failure.

Shape:

1. Goal.
2. Prerequisites.
3. Steps.
4. Verify.
5. Rollback or cleanup when relevant.

## API Reference

Purpose: document a public interface precisely.

Include:

- Authentication and authorization.
- Endpoint, method, path, command, or function signature.
- Parameters and config keys.
- Request and response examples.
- Error cases.
- Versioning and compatibility notes.

Evidence must come from schemas, handlers, tests, generated specs, or types. If generated reference exists, link to it and write human usage notes around it.

## Architecture Guide

Purpose: help contributors make correct changes.

Include:

- System map.
- Key modules with paths.
- Request, event, or data flows.
- Persistence and external dependencies.
- Security and trust boundaries.
- Every shipped public binary, CLI command family, MCP tool, config file, environment variable, hook/check, package script, and packaged artifact named by the doc. One sentence is enough for operational surfaces, but a named surface must not disappear after the overview.
- Known constraints and non-goals.

Avoid untraceable claims like "the system is modular." Show modules, imports, and boundaries.

If the architecture guide is also the product or design contract, run a doc-local coverage check before finalizing: every public surface named in an overview/list/table/diagram is either explained in the guide or explicitly delegated to a canonical setup, API, CLI, runbook, or troubleshooting doc.

## Runbook

Purpose: keep production or shared environments alive.

Include:

- Preconditions and permissions.
- Deploy, rollback, restart, and health-check steps.
- Monitoring links or commands.
- Known alerts and recovery actions.
- Data safety warnings.

Runbooks must be conservative. If a command can delete data, stop and label the blast radius.

## Troubleshooting

Purpose: reduce repeated support loops.

For each item:

- Symptom: exact error or observable behavior.
- Cause: code/config evidence.
- Fix: smallest action.
- Verify: command or observable state.

Use `rg -n "exact error text"` to connect symptoms to source.

## Changelog And Release Notes

Purpose: explain shipped changes from the user's point of view.

Gather:

```bash
git log --oneline --decorate --no-merges <last-tag>..HEAD
git diff --name-status <last-tag>..HEAD
```

Group by user impact: breaking changes, features, fixes, docs, internal. Do not dump commit subjects when they do not explain behavior.

## Contributor Guide

Purpose: make contribution workflow explicit.

Include:

- Branch, commit, and PR expectations if visible in repo docs or config.
- Install, test, lint, format, and typecheck commands.
- Directory map.
- Review and release notes.

Do not invent governance. If branch rules or review requirements are not in the repo, mark them unknown.

## Security Guide

Purpose: make trust boundaries visible.

Include:

- Secret storage and required environment variables.
- Auth flow and permission model.
- Data classification and retention if visible.
- Reporting policy.
- Dangerous operations and required safeguards.

Evidence patterns:

```bash
rg -n "auth|authorize|permission|role|token|secret|password|encrypt|decrypt|keychain|vault" .
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[" .
```

## Migration Guide

Purpose: help users safely move between versions or systems.

Include:

- Who needs to migrate.
- Preconditions and backups.
- Step-by-step migration.
- Compatibility window.
- Verification.
- Rollback if possible.

Evidence comes from migrations, compatibility shims, deprecation warnings, changed schemas, and release commits.
