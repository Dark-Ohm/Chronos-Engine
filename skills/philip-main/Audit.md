# Audit Engine

Philip's audit engine answers one question: where do the docs diverge from the product a developer actually has to use?

An audit is not a grammar pass. It is a code-evidence review of the documentation system: what exists, what is missing, what lies by being stale, and what blocks users from completing real tasks.

## Evidence Model

Every finding needs at least one evidence source:

- Source code: symbols, imports, routes, CLI commands, public APIs, config defaults.
- Tests: behavior contracts, fixtures, golden outputs, regression names.
- Project metadata: package manifests, lockfiles, build config, Dockerfiles, CI workflows.
- Git history: commits, deleted files, renamed commands, recent feature work.
- Runtime help: `--help`, generated API docs, schema output, OpenAPI specs.
- Orbit: file ownership, dependencies, merge request history, graph neighborhoods.

If a claim cannot be tied to evidence, classify it as "unverified" instead of "wrong."

## What To Check

### Coverage

- Is there a clear entry point: `README.md`, `docs/index.md`, or equivalent?
- Are install, setup, configuration, development, testing, deployment, and troubleshooting covered where relevant?
- Do public APIs, CLIs, services, config files, and extension points have matching docs?
- Are generated or canonical docs identified so humans do not edit the wrong file?
- Are security, auth, data retention, permissions, and destructive operations documented?

Useful inventory patterns:

```bash
rg --files -g '*.md' -g '*.mdx' -g 'README*' -g 'docs/**'
rg --files -g 'package.json' -g 'pyproject.toml' -g 'Cargo.toml' -g 'go.mod' -g 'Dockerfile*' -g '.github/workflows/**' -g '.gitlab-ci.yml'
rg --files -g '*openapi*' -g '*swagger*' -g 'proto/**' -g 'graphql/**'
```

For public product surfaces, build an explicit inventory instead of relying on whichever docs you happened to read first:

```bash
rg -n '"bin"|"files"|"scripts"' package.json
rg -n "program\.command|Command::new|argparse|click\.|cobra\.Command|commander|clap::" .
rg -n "server\.tool|registerTool|McpServer|tools/list|capabilities" .
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[" .
rg -n "husky|pre-commit|lint-staged|\.github/workflows|Makefile|justfile|Taskfile" .
```

Use the inventory to separate:

- **Covered somewhere**: another doc mentions the surface.
- **Complete in this doc**: the current doc explains the surface or explicitly points to the canonical doc for it.

When auditing a design, architecture, README, setup, or product-contract doc, treat doc-local omissions as findings. If the doc names a shipped binary, MCP tool, command, env var, config file, hook, package script, or packaged doc, the doc must close the loop locally with at least a short explanation or a link to the owning doc.

### Accuracy

- Commands in docs match package scripts, CLI parser definitions, Make targets, task runners, or CI steps.
- Environment variables match code reads and config schemas.
- File paths still exist.
- API examples match current request and response types.
- Screenshots and UI descriptions match current routes or component names.
- Version numbers and feature flags match project metadata.

Useful cross-check patterns:

```bash
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[|config\." .
rg -n "program\.command|Command::new|argparse|click\.|cobra\.Command|commander" .
rg -n "npm run|pnpm|yarn|cargo|go test|pytest|docker compose|make " README.md docs
git log --name-status --oneline -- docs README.md
```

### Usability

- A new contributor can get from clone to first successful test without guessing.
- Task docs are ordered by what users need to do, not by internal architecture trivia.
- Error recovery is documented for known failure points.
- Examples include expected output when it helps detect failure.
- Cross-links point to the next useful action, not a documentation maze.

### Freshness

- Docs changed alongside code in recent feature commits.
- Recently renamed files, commands, flags, routes, and config keys are reflected.
- Deprecated behavior is marked with replacement guidance.
- Changelog, README, and API references agree.

Useful freshness patterns:

```bash
git log --since='90 days ago' --name-status --oneline
git diff --name-only origin/main...HEAD
git log --follow --oneline -- path/to/doc.md
```

If the repo has no `origin/main`, detect the base with `git merge-base --fork-point` or ask the user.

## Severity Rubric

Use severity based on user harm, not how annoyed Philip feels.

| Severity | Meaning | Examples |
| --- | --- | --- |
| Critical | Blocks install, build, deploy, auth, data safety, or security-sensitive work. | Setup command no longer exists; a missing prerequisite prevents first run; docs tell users to disable auth; migration instructions lose data. |
| High | Misleads users on common workflows or public contracts. | CLI flags are stale; required env vars are missing; API docs show removed fields; command drift breaks a primary path. |
| Medium | Causes avoidable confusion or incomplete work. | Architecture overview omits a major service; README points at stale paths but the workflow is recoverable; troubleshooting lacks known error recovery. |
| Low | Polish, wording, organization, or minor discoverability issue. | Stale version references that do not change behavior; weak link text; dated screenshots with no behavioral mismatch. |

Calibrate common documentation failures this way:

- Stale paths are High when they block common setup or public API use, Medium when a nearby obvious path works, and Low when only examples or screenshots are affected.
- Stale versions are High when they select incompatible tools or dependencies, Medium when they cause confusion about support, and Low when they are cosmetic release references.
- Missing setup prerequisites are Critical if they block install or first run, High if they affect a common optional path, and Medium if they affect a narrow contributor workflow.
- Command drift is Critical when no documented safe path remains, High when the main command is wrong, and Medium when a secondary command or flag changed.
- Missing architecture coverage is High when it hides a public contract or operational boundary, Medium when it hides an internal subsystem maintainers need, and Low when it is a navigation issue.

## Audit Output

Use this structure unless the user asks for another format:

```markdown
# Documentation Audit

## Executive Summary
[One direct paragraph: health, top risks, likely effort.]

## Findings
### Critical
- [Finding title]
  - Problem: [What is wrong.]
  - Evidence: `path`, symbol, command, commit, or Orbit node.
  - Impact: [Who gets hurt and how.]
  - Fix: [Specific change.]
  - Verification: [verified | not run | not found | partially verified] - [What was checked.]
  - Confidence: [High | Medium | Low and why.]

### High
...

### Medium
...

### Low
...

## Coverage Map
| Area | Existing Docs | Code Evidence | Status |

## Recommended Plan
1. [Smallest high-value fix.]
2. [Next fix.]

## Unknowns
- [Claims not verified and why.]

## Verification Notes
- [Commands run, files checked, or checks intentionally not run.]
- [Orbit used, Orbit unavailable, or Orbit intentionally not checked.]
```

### Required Finding Fields

Every finding must include:

- `Problem`: the precise documentation failure.
- `Evidence`: file path, symbol, command output, git commit, generated schema, or optional Orbit node.
- `Impact`: the user harm or maintenance risk.
- `Fix`: the doc section, file, or new doc type to change.
- `Verification`: one of the approved labels plus the check performed.
- `Confidence`: High, Medium, or Low with a short reason when useful.

Allowed verification labels:

- `verified`: directly checked against local evidence, command output, git history, generated specs, or Orbit.
- `not run`: a command or runtime check was not executed.
- `not found`: expected evidence was searched for and not located.
- `partially verified`: some supporting evidence was checked, but part of the claim remains unverified.

### Scope Honesty

Whole-repo audits must include a coverage map across both documentation types and public product surfaces: README/setup, API/reference, architecture, runbooks, troubleshooting, security, CLIs, routes, SDK exports, config, schemas, services, packages, workflows, or equivalents that apply to the repo.

Sampled audits must explicitly say they were sampled in the Executive Summary, Coverage Map, or Verification Notes. Do not let a sample read like a whole-repo audit.

For single-doc audits, include a doc-local coverage map when the doc presents itself as a design, architecture, product, setup, or public-contract source of truth:

| Named surface | Where named | Local explanation or delegation | Status |
| --- | --- | --- | --- |
| `agent-session-search-doctor` | Product contract list | Not explained in CLI/diagnostic section | Missing |

No finding without evidence. No vague "improve docs" recommendations. The fix should name the doc section or new doc type needed.

### Structure Linter

Run the bundled structure linter while drafting audit reports:

```bash
node scripts/audit-report-lint.mjs path/to/audit.md
```

The linter checks report shape only. Passing it does not mean the code evidence is true, current, or complete.
