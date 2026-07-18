# Skill Validation

Use this checklist before publishing a Philip release or after changing the
skill's authoring guidance.

## Structure Checks

- `SKILL.md` exists at the skill root.
- The frontmatter `name` is `philip` and matches the folder name.
- The `description` is non-empty, under 1024 characters, and includes what Philip does and when to use it.
- `SKILL.md` stays under 500 lines.
- Supporting files are linked from `SKILL.md` and live one level deep where possible.
- Workflow files in `Workflows/` are referenced from the entrypoint or a directly linked reference.

## Portability Checks

- Base `SKILL.md` uses only portable required fields.
- No required client-specific fields such as `context: fork`, `agent`, dynamic shell injection, or required `allowed-tools`.
- Claude-, Cursor-, GitHub-, or other client-specific metadata is optional and kept out of the portable baseline unless packaged separately.
- Install docs include `.agents/skills` for user-level and project-level installs.
- Agent-specific fallbacks are documented without making them primary.
- Orbit remains optional, read-only supporting evidence and is never required for normal Philip use.

## Forward-Test Prompts

Run Philip against realistic prompts:

```text
Audit the docs for this repo.
```

```text
Write a setup guide for this repo.
```

```text
Rewrite this stale API doc from current route handlers.
```

```text
Update docs for this branch diff.
```

```text
Check this README for unsupported claims and AI filler.
```

## Output Checks

Before accepting a forward-test output:

- Findings cite evidence by file path, symbol, command output, git commit, or optional Orbit node.
- Audit forward-test outputs pass `node scripts/audit-report-lint.mjs path/to/audit.md`, or the final response discloses the structural failures and why they remain.
- Commands and examples are verified or explicitly marked unverified.
- Unsupported claims are removed, corrected, or labeled unknown.
- Public APIs, env vars, paths, and config names match source evidence.
- Design, architecture, README, setup, and product-contract docs pass a doc-local consistency check: every named public surface is explained in that doc or explicitly delegated to another doc.
- The AI-residue pass from `Writing.md` has been run and followed by manual reading.
- Final response says what changed, what was checked, what was not verified, and any remaining risk.

## Audit Linter Regression Checks

Run the dependency-free audit linter fixture suite after changing `Audit.md`,
`Workflows/Audit.md`, `scripts/audit-report-lint.mjs`, or audit report
fixtures:

```bash
npm run test:lint-audit
```

The fixture suite must include:

- A passing audit with required sections, valid finding fields, valid verification labels, coverage map, unknowns, and Orbit fallback disclosure.
- Failing audits for missing coverage map, missing finding fields, invalid verification label, and plan checklist content before preserved audit sections.

Also smoke-test both invocation paths when possible:

```bash
node scripts/audit-report-lint.mjs fixtures/audit-lint/pass.md
node bin/philip.js lint-audit fixtures/audit-lint/pass.md
```

## Optional Tooling

If the Agent Skills validator is available, run it from the skill root:

```bash
skills-ref validate .
```

If the target client has a skill discovery command, run it in that client and
confirm Philip appears. Treat those checks as client-specific smoke tests, not
requirements for the portable baseline.

## npm Packaging Checks

Before publishing the npm package:

- Confirm `package.json` uses the portable package files and does not rely on `postinstall` to copy files into user skill directories without explicit opt-in.
- For the first release only, confirm `@benvenker/philip` exists on npm. If it does not, publish once manually with `npm publish --access public`; npm requires an existing package before trusted publishing can be configured.
- Confirm npm trusted publishing is configured for package `@benvenker/philip`, repository `benvenker/philip`, and workflow `.github/workflows/publish.yml`.
- Run `npm pack --dry-run` and inspect the file list for only the intended skill files, workflows, README, fixtures, package metadata, installer CLI, validation scripts, and postinstall guidance script.
- Run `npx skills@latest add benvenker/philip --list` to confirm the public repo is discoverable by the open Agent Skills installer.
- Run `node bin/philip.js install --dry-run` to confirm the default target is `~/.agents/skills/philip`.
- Run `node bin/philip.js install --project --dry-run` to confirm the project target is `.agents/skills/philip`.
- Run `node scripts/postinstall.js` to confirm the npm install guidance tells users to run `philip install`.
- After publish, run `npx @benvenker/philip install --dry-run` from a temporary directory.
