# Philip

Philip is an AI documentation-writing skill for software projects. It audits, writes, rewrites, and maintains docs by checking claims against code evidence instead of polishing folklore.

## What Philip Does

Philip supports four modes:

| Mode | Use When | Output |
| --- | --- | --- |
| `audit` | "What's wrong with our docs?" | Severity-ranked documentation health report. |
| `write` | "Write docs for X." | New README, guide, API doc, runbook, or reference material. |
| `rewrite` | "Fix these stale docs." | Updated existing docs that match current code. |
| `maintain` | "Update docs for this PR." | Surgical doc patches for the current diff. |

Core rule: every claim in generated docs must trace to local evidence: source code, tests, config, git history, or command output. If GitLab Orbit is available, Philip can use it as additional evidence, but Orbit is never required.

## Install

Install Philip by placing the full directory in a skill location. Do not copy
only `SKILL.md`; Philip uses the root reference files and `Workflows/`.

### Recommended: skills CLI

Use the open Agent Skills installer:

```bash
npx skills@latest add benvenker/philip
```

This is the best path for most users. It finds the `philip` skill from this
repo and guides the user through the target agent and install method.

For a global install:

```bash
npx skills@latest add benvenker/philip -g
```

For a specific agent:

```bash
npx skills@latest add benvenker/philip -a cursor
npx skills@latest add benvenker/philip -a codex
npx skills@latest add benvenker/philip -a claude-code
```

For a non-interactive global install to one agent:

```bash
npx skills@latest add benvenker/philip -g -a cursor -y
```

To confirm Philip is discoverable before installing:

```bash
npx skills@latest add benvenker/philip --list
```

### Direct npm package

Install the helper CLI, then copy Philip into a skill location:

```bash
npm install -g @benvenker/philip
philip install
```

The npm install prints the `philip install` next step so users are not left
guessing. It does not silently write into `~/.agents/skills` during package
install.

For a project-local install:

```bash
npx @benvenker/philip install --project
```

The installer writes the portable skill directory to `~/.agents/skills/philip`
by default. It also supports `--target ~/.claude/skills`, `--target ~/.cursor/skills`,
`--force`, and `--dry-run`.

For an explicit one-command global install:

```bash
PHILIP_AUTO_INSTALL=1 npm install -g @benvenker/philip
```

### Manual install

Recommended shared locations:

```bash
# User-level, shared by Agent Skills clients that support the common path
mkdir -p ~/.agents/skills
cp -R philip ~/.agents/skills/philip

# Project-level, shared with a repository
mkdir -p .agents/skills
cp -R philip .agents/skills/philip
```

Agent-specific fallbacks:

```bash
# Claude Code fallback
mkdir -p ~/.claude/skills
cp -R philip ~/.claude/skills/philip

# Cursor fallback
mkdir -p ~/.cursor/skills
cp -R philip ~/.cursor/skills/philip

# GitHub Copilot project fallback
mkdir -p .github/skills
cp -R philip .github/skills/philip
```

For broader reuse beyond one machine or one repo, package Philip as a plugin
for the target agent ecosystem. Keep the portable skill directory usable on its
own; plugin metadata should not become required for normal use.

## Publishing

This repo can publish the portable skill as `@benvenker/philip` on npm. The
package includes the skill files, the explicit `philip` installer CLI, and a
`postinstall` notice that tells npm users to run `philip install`. It does not
write into user skill folders during npm install unless `PHILIP_AUTO_INSTALL=1`
is set.

Publishing is tag-driven through GitHub Actions and npm trusted publishing.
There is no npm token in this repo.

First-time npm setup is different from later releases because npm requires a
package to exist before trusted publishing can be configured. `@benvenker/philip`
has already been bootstrapped; use this section only if the package is deleted,
renamed, or moved to a new scope.

Bootstrap the package once, then configure trusted publishing:

```bash
npm publish --access public
```

Then on npmjs.com, add a trusted publisher for `@benvenker/philip` using GitHub
Actions, repository `benvenker/philip`, and workflow `.github/workflows/publish.yml`.

After that, future releases are tag-driven and tokenless.

Before cutting a release:

```bash
npm run check
npm pack --dry-run
```

To publish a release:

```bash
npm version patch   # or minor / major
git push origin main --follow-tags
```

The pushed `vX.Y.Z` tag checks that the tag matches `package.json`, publishes
that version to npm, and creates the GitHub Release marked as latest.

After publishing, smoke-test the public package from a temporary directory:

```bash
npx @benvenker/philip install --dry-run
```

Expected structure:

```text
philip/
  SKILL.md
  Audit.md
  Writing.md
  DocTypes.md
  Exploration.md
  OrbitIntegration.md
  Validation.md
  Workflows/
    Audit.md
    Write.md
    Rewrite.md
    Maintain.md
  fixtures/
    audit-lint/
  scripts/
    audit-report-lint.mjs
  README.md
```

## Usage

Ask for the mode naturally:

```text
Use Philip to audit the docs for this repo.
```

```text
Use Philip to write a setup guide for the local development workflow.
```

```text
Use Philip to rewrite docs/api.md so it matches the current route handlers.
```

```text
Use Philip to update docs for the current PR diff.
```

Philip starts by routing through `SKILL.md`, then loads only the needed workflow and reference files. That keeps the active context small while preserving detailed procedures for heavy work.

### Diff Data Layer

Use `philip diff` when a branch needs a bounded evidence packet for review, documentation maintenance, or agent handoff:

```bash
philip diff
philip diff --json
```

On success, Philip writes an **Actionable diff** JSON file and prints its repo-relative path:

```text
Wrote Philip diff data to .philip/artifacts/{workstream}/philip-diff.json
```

Use `--json` when another tool or agent needs to parse the result envelope from stdout:

```json
{
  "ok": true,
  "artifact": {
    "kind": "actionable_diff",
    "path": ".philip/artifacts/{workstream}/philip-diff.json",
    "schemaVersion": 1
  },
  "comparison": {},
  "metrics": {}
}
```

The **Artifact store** is `.philip/artifacts/`. It is generated local output. Users may add it to `.gitignore` if that matches their repo policy, but Philip does not silently edit `.gitignore`.

Workstream names are deterministic:

- Current branch names are sanitized, so `feature/html-artifacts` becomes `feature-html-artifacts`.
- Detached HEAD uses `detached-{shortSha}`.
- Non-Git directories or Git repos without a usable commit use `current`.

`philip-diff.json` is factual input for downstream agents, not a rendered report. The **Diff collector script** records the implemented data contract:

- `repo`, `comparison`, and `provenance` with Git command provenance but no raw command output.
- `changedFiles`, including tracked, untracked, deleted, renamed, additions/deletions where Git provides them, and mechanical surface flags.
- **Diff impact metrics**, **Repo inventory**, and `changedSurfaces` as factual counts and groupings.
- `changedIdentifiers` from changed lines or bounded untracked-file reads.
- `localArtifacts` metadata for plans, investigations, reports, design notes, docs, and HTML files.
- `verification` metadata listing discovered validation commands and changed tests; `philip diff` does not run those commands.

V1 non-goals are explicit: no HTML mode, no deterministic HTML renderer, no automatic Markdown branch report, no full diff hunks, no severity/confidence/risk/importance scoring, no occurrence scan, and no silent `.gitignore` edits.

Example downstream prompt for a Markdown PR brief:

```text
Read .philip/artifacts/{workstream}/philip-diff.json as bounded evidence.
Write a Markdown PR brief that cites changed file paths, verification commands discovered, and any local artifacts referenced in the JSON.
Do not invent severity, risk, confidence, or importance. For claims beyond the JSON, inspect the referenced files or Git commands and cite what you checked.
```

Example downstream prompt for an HTML review artifact:

```text
Use .philip/artifacts/{workstream}/philip-diff.json to create a self-contained HTML artifact for branch review.
Treat the JSON as evidence, not a design mandate. Show changed files, Diff impact metrics, Repo inventory highlights, verification metadata, and local artifacts.
Do not claim Philip generated this HTML automatically, and do not add facts that are not in the JSON unless you inspect and cite the referenced paths or commands.
```

Example downstream prompt for agent handoff:

```text
Use .philip/artifacts/{workstream}/philip-diff.json to prepare a handoff prompt for the next agent.
Summarize the Actionable diff, list the highest-leverage files to inspect, include discovered but not-run verification commands, and state which claims are bounded to the JSON.
For anything beyond the JSON, tell the next agent exactly which paths or Git commands to inspect first.
```

### Audit Report Linter

Philip includes a dependency-free structure linter for audit reports:

```bash
philip lint-audit path/to/audit.md
philip lint-audit path/to/plan.md --format plan
philip lint-audit - --json
```

`Confidence` fields must start with `High`, `Medium`, or `Low`. Invalid
confidence labels are structural lint errors.

### Agent CLI Contract

Philip exposes its machine-readable contract and an agent quick guide in-tool:

```bash
philip --robot-triage
philip capabilities --json
philip robot-docs guide
philip help diff
```

Use `philip --robot-triage` when an agent needs a one-call status packet. It
prints exactly one JSON object to stdout and does not write artifacts. The
object includes the CLI contract version, structured surfaces, `.philip/artifacts/`
health, current and latest `philip-diff.json` paths when present, discovered
verification commands, recommended next commands, recovery hints, and exit
codes.

User-input errors exit 2 and write diagnostics to stderr. Requested JSON goes to
stdout without progress text.

Installed-skill contexts can invoke the script directly when the `philip` CLI is
not on `PATH`:

```bash
node ~/.agents/skills/philip/scripts/audit-report-lint.mjs path/to/audit.md
node scripts/audit-report-lint.mjs --format audit -
```

The linter checks structure only: required sections, finding fields,
verification labels, coverage/scope disclosure, Orbit disclosure, and plan
ordering. It does not verify whether cited code evidence is factually true.

## Modes

### Audit

Philip inventories documentation, explores the codebase, cross-references claims, and produces a severity-ranked report.

Audit checks include:

- Missing setup, API, architecture, operations, security, and troubleshooting docs.
- Commands that no longer exist.
- Environment variables not documented.
- API examples that diverge from handlers, schemas, or tests.
- Recent code changes that did not update docs.
- Undocumented public symbols and high-churn areas.
- Doc-local completeness gaps where a design, architecture, setup, README, or product-contract doc names a public surface but never explains it or delegates it to another doc.

### Write

Philip deep-reads the source, chooses the right doc type, drafts from evidence, removes AI filler, and verifies examples where safe.

Supported doc types include README, setup guide, how-to guide, API reference, architecture guide, runbook, troubleshooting guide, changelog, contributor guide, security guide, migration guide, and glossary.

For design, architecture, README, setup, and product-contract docs, Philip also runs a doc-local consistency pass: every named binary, command, tool, env var, config file, hook, package script, package artifact, or shipped doc must be explained in that doc or explicitly delegated to the owning doc.

### Rewrite

Philip updates existing docs without flattening useful structure. It uses git history to identify renamed commands, deleted paths, changed config, stale examples, and public surfaces that the rewritten doc names but fails to close locally.

Default behavior: keep the good parts, remove the trapdoors.

### Maintain

Philip reads the current diff, classifies user-visible changes, finds affected docs, and patches only the sections that need to change.

This is the mode for PRs and merge requests.

## Validation

Use `Validation.md` before publishing changes to Philip itself. It covers skill
structure, portability, forward-test prompts, and output checks.

## Optional GitLab Orbit Context

Philip does not set up, configure, or require GitLab Orbit. If the user's
project already has Orbit available in their agent environment, Philip can use
it as an additional read-only context source. Otherwise, Philip uses local
filesystem search, `rg`, and git history.

When already available, Orbit can help with:

- File ownership.
- Cross-file dependencies through `File`, `Definition`, and `ImportedSymbol` nodes.
- Merge request history.
- Undocumented hotspots.
- Security context.
- Graph paths between docs and code.

Do not ask users to create GitLab tokens or enable Orbit as part of using this skill.

## Writing Standards

Philip bans common AI tells: overused em dash constructions, "It's not X it's Y", "Here's why", "Let's dive in", "At its core...", "It's worth noting...", marketing adjectives, copula padding like "serves as", vague attribution, forced triples, and generic chatbot conclusions.

The writing style is practical:

- Start with the task.
- Put prerequisites before commands.
- Include verification steps.
- Mark unverified examples.
- Cite code evidence.
- Delete stale claims instead of burying them.

## Quality Bar

Philip is done only when:

- Requested docs are written or the audit report is complete.
- Commands, env vars, paths, APIs, and examples trace to evidence.
- Unsupported claims are removed or marked unknown.
- The final answer states what changed, what was checked, and what remains risky.

If a setup guide has three commands and two are stale, Philip says so. Then he fixes it.
