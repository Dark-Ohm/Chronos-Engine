# Philip Improvement Report

Date: 2026-05-03

## Executive Takeaway

Philip is already pointed in the right direction: small entrypoint, progressive loading through workflow files, evidence-first documentation, and a strong bias against stale claims. The improvement work should not make Philip bigger for its own sake. It should make Philip easier to install across agents, sharper at detecting AI-style prose, and faster at building a code-evidence map before writing.

The highest-value changes are:

1. Update install and portability docs around `.agents/skills`.
2. Expand the writing rules with the best patterns from local `humanizer` and `de-slopify` skills.
3. Add an explicit codebase exploration ladder for audit, write, rewrite, and maintain workflows.
4. Add a skill validation and forward-testing checklist.
5. Keep Claude-only features optional and out of the portable baseline.

## Evidence Base

### Current web guidance

- Agent Skills specification: `name` and `description` are required, `SKILL.md` should stay under 500 lines, detailed material should move into `references/`, `scripts/`, and `assets/`. The name must match the parent directory.
Source: [https://agentskills.io/specification](https://agentskills.io/specification)
- Claude Code follows the Agent Skills standard but extends it with `context: fork`, `agent`, `when_to_use`, dynamic shell injection, `allowed-tools`, `user-invocable`, and other fields. These are useful, but not portable baseline assumptions.
Source: [https://code.claude.com/docs/en/skills.md](https://code.claude.com/docs/en/skills.md)
- Codex uses `.agents/skills` for repo and user skills. It treats skills as authoring format and plugins as distribution format. It also recommends pairing short `AGENTS.md` rules with richer repo-local skills.
Sources: [https://developers.openai.com/codex/skills](https://developers.openai.com/codex/skills) and [https://developers.openai.com/codex/concepts/customization](https://developers.openai.com/codex/concepts/customization)
- Cursor loads `.agents/skills`, `.cursor/skills`, `~/.agents/skills`, and `~/.cursor/skills`, with compatibility loading from Claude and Codex skill directories. Cursor supports `paths` and `disable-model-invocation`.
Source: [https://cursor.com/docs/skills](https://cursor.com/docs/skills)
- Gemini CLI supports `.agents/skills` as the interoperable alias for user and workspace skills. It gives `.agents/skills` precedence over `.gemini/skills` within the same tier.
Source: [https://geminicli.com/docs/cli/skills/](https://geminicli.com/docs/cli/skills/)
- OpenCode supports `.agents/skills`, `.claude/skills`, and OpenCode-specific paths. It recognizes only standard frontmatter fields and ignores unknown fields.
Source: [https://opencode.ai/docs/skills/](https://opencode.ai/docs/skills/)
- VS Code and GitHub Copilot support `.github/skills`, `.claude/skills`, and `.agents/skills` for project skills. GitHub also supports `gh skill` for skill install/update workflows.
Sources: [https://code.visualstudio.com/docs/copilot/customization/agent-skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) and [https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills](https://docs.github.com/copilot/how-tos/use-copilot-agents/coding-agent/create-skills)

### Local skills audited

- `~/.codex/skills/humanizer/SKILL.md`: best source for AI-writing pattern taxonomy.
- `~/.claude/skills/de-slopify/SKILL.md` and `~/.claude/skills/docs-de-slopify/SKILL.md`: concise anti-slop prompt and manual-review principle.
- `~/.claude/skills/codebase-archaeology/SKILL.md`: best source for "documentation first, entry points outward" exploration.
- `~/.claude/skills/codebase-report/SKILL.md`: useful quick, standard, and deep report modes.
- `~/.claude/skills/research-software/SKILL.md`: useful research output shape and source priority, with code over docs for behavior.
- `~/.cursor/skills-cursor/create-skill/SKILL.md` and `~/.codex/skills/.system/skill-creator/SKILL.md`: best authoring guidance for descriptions, progressive disclosure, validation, and forward-testing.
- `~/.agents/skills/gpt-5-5-prompting/SKILL.md`: useful retrieval budget and validation loop.
- `~/.agents/skills/rp-investigate-cli/SKILL.md`: useful hypothesis and evidence log pattern, but too tool-specific to import directly.
- `~/.agents/skills/gstack-review/SKILL.md` and `~/.agents/skills/gstack-document-release/SKILL.md`: useful ideas for scope drift, doc staleness checks, confidence calibration, and structured doc health summaries. Do not import the generated preamble, telemetry, or auto-commit behavior.

## Current Philip Status

Strengths:

- `SKILL.md` is small and portable. It uses only `name` and `description`.
- Workflows are split into `Workflows/`, which matches progressive disclosure.
- Core rule is strong: every documentation claim must trace to evidence.
- Audit and write modes already search commands, env vars, APIs, architecture, security, freshness, and docs coverage.
- Orbit is optional and correctly treated as read-only supporting evidence.

Gaps:

- `README.md` install guidance under-emphasizes `.agents/skills`, now the best shared path across many agents.
- `README.md` lists `~/.codex/skills`, but current Codex docs emphasize `$HOME/.agents/skills` for user skills and `.agents/skills` for repo skills.
- Project-shared install guidance only shows `.cursor/skills/philip/`, but `.agents/skills/philip/` is the cross-agent default for Cursor, Codex, Gemini, OpenCode, VS Code, and Copilot.
- Anti-slop rules catch the obvious patterns but miss subtler AI artifacts: significance inflation, `-ing` pseudo-depth, vague attribution, copula avoidance, forced triples, over-bolding, chatbot residue, generic conclusions.
- Codebase exploration is present as a list of searches, but not yet a reusable ladder that tells agents where to start, when to stop, and when to escalate to semantic search or subagents.
- There is no explicit skill validation and forward-testing checklist.

## Recommendation 1: Make `.agents/skills` The Shared Default

### Proposed README install rewrite

Use this as the new install guidance:

```markdown
## Install

Install Philip by placing the full directory in a skill location. Do not copy only `SKILL.md`; Philip uses root reference files and `Workflows/`.

Recommended shared locations:

```bash
# User-level, shared by Cursor, Codex, Gemini CLI, OpenCode, VS Code/Copilot, and other Agent Skills clients
mkdir -p ~/.agents/skills
cp -R philip ~/.agents/skills/philip

# Project-level, shared with the repo
mkdir -p .agents/skills
cp -R philip .agents/skills/philip
```

Agent-specific locations:

```bash
# Claude Code
mkdir -p ~/.claude/skills
cp -R philip ~/.claude/skills/philip

# Cursor-only fallback
mkdir -p ~/.cursor/skills
cp -R philip ~/.cursor/skills/philip

# GitHub Copilot project fallback
mkdir -p .github/skills
cp -R philip .github/skills/philip
```

For reusable distribution beyond one repo or one machine, package Philip as a plugin for the target agent ecosystem.
```

### Why this matters

`.agents/skills` is now the best common denominator across current docs for Codex, Cursor, Gemini CLI, OpenCode, VS Code, and GitHub Copilot. Claude Code still primarily documents `.claude/skills`, so the README should present `.claude/skills` as a Claude-specific path, not as the universal path.

### Do not import

Do not add Claude-only dynamic shell injection to Philip's base `SKILL.md`. Some agents ignore it, and some users will disable skill shell execution by policy. Keep command examples as instructions the agent can choose to run.

## Recommendation 2: Keep Philip Portable, Add Optional Extensions Later

Philip's current frontmatter is good:

```yaml
---
name: philip
description: AI documentation writer for software projects. USE WHEN auditing docs, writing new docs, rewriting stale docs, maintaining docs for a PR or diff, improving README/API/setup guides, or checking documentation against source code. Supports GitLab Orbit Knowledge Graph when available.
---
```

Possible improvement:

```yaml
---
name: philip
description: Writes, audits, rewrites, and maintains software documentation from code evidence. Use when auditing docs, writing README/API/setup/architecture/runbook docs, rewriting stale docs, updating docs for a PR or diff, or checking documentation claims against source code, tests, config, git history, command output, or optional GitLab Orbit context.
---
```

Rationale:

- It front-loads the action verbs: writes, audits, rewrites, maintains.
- It includes concrete trigger terms: README, API, setup, architecture, runbook, PR, diff.
- It names the evidence sources.
- It avoids implying Orbit is required.

Do not add `context: fork` to Philip itself. Philip is a general documentation workflow. Forked context is useful for optional deep exploration sub-skills, but making the whole skill forked would hide interactive doc-writing decisions from the parent session in agents that support the field.

## Recommendation 3: Pull In A Stronger Anti-Slop Pass

Philip should keep its current voice, but add a sharper AI-residue checklist from `humanizer`, `de-slopify`, and `gstack` writing rules.

### Ready-to-paste addition for `Writing.md`

Add this after the current banned pattern table:

```markdown
## AI Residue Sweep

After accuracy is settled, read the prose manually. Do not rely only on regex. Rewrite any sentence that carries one of these AI-writing artifacts:

- Significance inflation: "testament", "pivotal", "underscores", "broader landscape", "transformative", "vital role", "focal point".
- Promotional verbs: "showcases", "boasts", "enhances", "fosters", "elevates", "empowers" unless the doc proves the mechanism.
- Copula avoidance: "serves as", "stands as", "functions as" when "is" or "has" is clearer.
- Present-participle padding: trailing phrases like "enabling...", "ensuring...", "highlighting...", "reflecting...", "contributing to..." that add fake depth.
- Vague attribution: "industry observers", "experts say", "best practices recommend" without a named source or local evidence.
- Forced triples: lists of three adjectives or benefits that exist for rhythm rather than information.
- Synonym cycling: switching names for the same thing to avoid repetition. Use the project term consistently.
- False ranges: "from X to Y" when X and Y are not a meaningful scale.
- Chatbot residue: "Of course", "I hope this helps", "Let me know", "Great question", "Here is an overview".
- Generic conclusions: "the future looks bright", "this is a step forward", "exciting times ahead".
- Mechanical formatting: emoji bullets, excessive bold labels, and list items that should be one sentence.

Do not sacrifice technical accuracy for style. Preserve code blocks, commands, paths, API names, error messages, and quoted source text.
```

### Replace current search pattern with a broader check

Current:

```bash
rg -n "Let's dive in|Here's why|At its core|It's worth noting|robust|seamless|powerful|It's not .* it's" path/to/doc.md
```

Recommended:

```bash
rg -n "Let's dive in|Let's explore|Here's why|At its core|Fundamentally|It's worth noting|Importantly|In order to|robust|seamless|powerful|pivotal|landscape|underscores|showcases|boasts|serves as|stands as|delve|foster|vibrant|testament|It's not .* it's|not only .* but|I hope this helps|Let me know|Great question" path/to/doc.md
```

Use this as a detection aid only. The actual fix still requires manual reading.

### Do not import

Do not import the `humanizer` instruction to "add soul" wholesale. That works for essays and opinion writing. Philip writes software docs, where "soul" should usually mean specificity, calm judgment, and the occasional dry line, not first-person reactions or intentional mess.

## Recommendation 4: Add A Codebase Exploration Ladder

Philip's workflows need a reusable exploration sequence that reduces random file reading and gives agents a stop condition.

### Ready-to-paste reference file: `Exploration.md`

Create a new reference file with this structure:

```markdown
# Codebase Exploration

Philip explores codebases to produce documentation, not to admire directory trees.

## Principle

Start with docs and manifests, then follow public entry points outward. Exact search comes before semantic search. Runtime or web research only enters when local evidence is missing, version-sensitive, or dependency-specific.

## Exploration Depth

### Quick

Use when the user names a file, module, or narrow change.

1. Read the named doc or code area.
2. Search exact symbols, commands, env vars, and paths.
3. Check nearby tests and package scripts.
4. Write or report only what this evidence supports.

### Standard

Use for README, setup, API, architecture, rewrite, and whole-doc audits.

1. Read repo guidance and entry docs: `README*`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `CONTRIBUTING*`.
2. Detect manifests and tooling: package, Python, Rust, Go, Docker, CI, Make, task runners.
3. Find public surfaces: CLIs, routes, schemas, SDK exports, config files, migrations, generated specs.
4. Find tests and examples that prove behavior.
5. Build a claim-evidence map before writing.
6. Verify every command, env var, API, path, and public symbol mentioned in the output.

### Deep

Use for large repos, architecture guides, missing-doc audits, or confusing systems.

1. Run the Standard pass.
2. Add git history: recent churn, renamed files, deleted commands, PR/MR scope if available.
3. Trace data flow from entry point to handler, domain logic, storage, and external integrations.
4. Use semantic search or a read-only exploration subagent for broad discovery, then verify important claims locally.
5. Produce a reusable map: entry points, key types, data flow, config, tests, external dependencies, and doc gaps.

## Claim-Evidence Map

Before writing, record claims like this:

| Claim | Evidence | Status |
| --- | --- | --- |
| `pnpm test` verifies setup | `package.json` script, CI workflow | verified |
| `DATABASE_URL` is required | env schema or code read | verified |
| API returns `user.id` | route handler, schema, test | verified |
| Deploy uses Vercel | no repo evidence | unknown |

No published doc claim leaves this table as unknown unless the doc explicitly says it is unknown.
```

### Connect it to current workflows

Update `SKILL.md` load pattern:

```markdown
| "Large repo, architecture, or unclear codebase" | exploration | `Exploration.md` plus the active workflow |
```

Update workflows:

- `Workflows/Audit.md`: use Standard exploration by default, Deep for whole-repo audits.
- `Workflows/Write.md`: use Quick if the user gives a specific path, Standard otherwise.
- `Workflows/Rewrite.md`: use Quick for a named stale claim, Standard for whole-doc rewrites.
- `Workflows/Maintain.md`: use diff-scoped Quick plus changed-symbol searches.

### Exact prompt fragment for optional subagent exploration

Use only when the repo is large or the area is unclear:

```text
Explore this codebase in read-only mode for documentation work.

Return a concise map with:
1. Entry points: CLIs, routes, SDK exports, jobs, services
2. Public contracts: schemas, config, env vars, command flags, generated specs
3. Data flow: input -> handler -> domain logic -> persistence/output
4. Tests/examples that prove behavior
5. Existing docs and likely stale or missing docs
6. Files that need local verification before publication

Do not write docs. Return evidence with file paths and symbols.
```

Important: The parent agent must still verify high-impact claims locally before publishing.

## Recommendation 5: Make Web Research A Narrow Tool, Not A Substitute For Repo Evidence

Philip should use web research only for:

- Current behavior of external tools or agent platforms.
- Version-sensitive docs where local code depends on a library or CLI.
- Public API docs when the repo calls a third-party service.
- Skill portability and install/distribution guidance.

Philip should not use web research to infer what a local project does. Local source, tests, config, generated specs, command output, and git history win.

Ready-to-paste rule:

```markdown
Use web research only when the claim depends on external current behavior: agent platform skill discovery, dependency APIs, hosted service limits, or current CLI flags. Local repo behavior still wins. If web docs and source disagree, document the source behavior and flag the external mismatch.
```

## Recommendation 6: Add Skill Validation And Forward-Testing

Philip should include a validation checklist for itself. This can live in `README.md` or a new `Validation.md`.

### Ready-to-paste validation checklist

```markdown
## Validate Philip As A Skill

Before publishing a Philip release:

1. Validate structure:
   - `SKILL.md` exists at the skill root.
   - `name` is `philip` and matches the folder name.
   - `description` is under 1024 characters and includes what Philip does and when to use it.
   - `SKILL.md` stays under 500 lines.
   - Supporting files are linked from `SKILL.md` and live one level deep where possible.

2. Validate portability:
   - No required frontmatter depends on one agent client.
   - Claude-only fields, if added later, are marked optional.
   - Install docs include `.agents/skills` and agent-specific fallbacks.

3. Forward-test with realistic prompts:
   - "Audit the docs for this repo."
   - "Write a setup guide for this repo."
   - "Rewrite this stale API doc from current route handlers."
   - "Update docs for this branch diff."
   - "Check this README for unsupported claims and AI filler."

4. Check outputs:
   - Findings cite evidence.
   - Commands are verified or marked unverified.
   - Unsupported claims are removed or labeled unknown.
   - No banned AI-residue patterns remain.
   - Final answer names what changed, what was checked, and remaining risk.
```

### Optional tooling

If the `skills-ref` validator is available, run:

```bash
skills-ref validate ./philip
```

If the target client has its own skill list command, also verify discovery:

```bash
# Examples, run only in matching clients
/skills list
gemini skills list
```

## Proposed Implementation Backlog

### Phase 1: Portability docs

Files:

- `README.md`
- optionally `SKILL.md` description

Changes:

- Make `.agents/skills` the recommended shared install path.
- Keep `.claude/skills`, `.cursor/skills`, `.github/skills` as agent-specific fallbacks.
- Add plugin guidance for distribution beyond local/repo use.
- Add `skills-ref validate ./philip` as optional validation.

Acceptance criteria:

- A user can install Philip for Cursor, Codex, Gemini, OpenCode, and Copilot from one install section.
- Claude Code install remains clear.
- No outdated `~/.codex/skills` primary guidance remains.

### Phase 2: Writing quality upgrade

Files:

- `Writing.md`
- `Workflows/Write.md`
- `Workflows/Rewrite.md`
- `README.md` writing standards section

Changes:

- Add AI Residue Sweep.
- Expand banned search pattern.
- Clarify manual review is required after regex checks.
- Keep software-doc accuracy above style.

Acceptance criteria:

- Philip catches the subtle AI patterns from `humanizer` without turning docs into essays.
- Write and rewrite workflows both run the expanded check.

### Phase 3: Exploration system

Files:

- new `Exploration.md`
- `SKILL.md`
- `Workflows/Audit.md`
- `Workflows/Write.md`
- `Workflows/Rewrite.md`
- `Workflows/Maintain.md`

Changes:

- Add Quick, Standard, and Deep exploration modes.
- Add claim-evidence map.
- Add optional subagent exploration prompt.
- Add web-research boundary rule.

Acceptance criteria:

- Another agent can follow Philip without randomly reading files.
- Whole-repo audits have a clear depth target.
- Narrow doc updates remain surgical.

### Phase 4: Skill validation

Files:

- `README.md` or new `Validation.md`

Changes:

- Add validation checklist.
- Add forward-test prompts.
- Add discovery checks for multiple agents.

Acceptance criteria:

- A release reviewer can validate Philip as a skill without reconstructing current Agent Skills rules from web docs.

### Phase 5: Optional future packaging

Files:

- possible plugin manifests outside the portable core

Changes:

- Add Codex `agents/openai.yaml` only if targeting Codex app polish.
- Add Cursor or Claude plugin packaging only if distributing through those ecosystems.

Acceptance criteria:

- Portable skill remains clean.
- Platform-specific metadata does not become a requirement for normal Philip use.

## What Not To Do

- Do not put generated gstack preambles, telemetry, or auto-commit behavior into Philip.
- Do not make Orbit mandatory.
- Do not make web research part of every documentation task.
- Do not add `context: fork` to the main Philip skill unless Philip is split into a separate deep-audit skill.
- Do not move all anti-slop guidance into `SKILL.md`; keep the entrypoint small.
- Do not preserve compatibility with stale install paths as the primary recommendation. Mention fallbacks, but point users at `.agents/skills`.

## Suggested Implementation Plan Prompt

If turning this report into a plan, use:

```text
Create an implementation plan for improving Philip using PHILIP_IMPROVEMENT_REPORT.md.

Group the work into small commits:
1. Update install and portability docs.
2. Add stronger AI-residue writing rules.
3. Add Exploration.md and wire it into workflows.
4. Add validation and forward-testing guidance.

For each commit, list files changed, exact intent, acceptance criteria, and checks to run. Keep Philip portable across Agent Skills clients. Do not add Claude-only frontmatter to the base skill.
```

