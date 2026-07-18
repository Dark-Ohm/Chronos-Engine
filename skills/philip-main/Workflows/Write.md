# Write Workflow

Use this workflow when the user asks Philip to write new documentation for a feature, module, workflow, API, CLI, setup process, architecture area, or project.

Load with `../Writing.md`, `../DocTypes.md`, `../Exploration.md`, and `../OrbitIntegration.md` if Orbit is available.

## 0. Define The Target

Capture:

- Topic or code area.
- Audience.
- Doc type.
- Destination file if specified.
- Required format or style.
- Verification expectation: run examples, static check only, or mark unverified.

If the doc type is unclear, use `../DocTypes.md` to choose the smallest useful type.

## 1. Find Evidence

Use Quick exploration from `../Exploration.md` when the user names a specific
path, module, or symbol. Use Standard exploration when the request is broad,
the destination doc is unclear, or the doc affects README, setup, API,
architecture, or runbook material.

Start from user-provided paths. If none are given, search:

```bash
rg --files -g 'README*' -g 'docs/**' -g '*.md' -g '*.mdx'
rg --files -g 'src/**' -g 'app/**' -g 'lib/**' -g 'packages/**' -g 'crates/**' -g 'cmd/**'
rg --files -g 'package.json' -g 'pyproject.toml' -g 'Cargo.toml' -g 'go.mod' -g 'Dockerfile*' -g '.github/workflows/**' -g '.gitlab-ci.yml'
```

Then search by feature terms:

```bash
rg -n "FeatureName|command-name|ENV_VAR|route-name|className|functionName" .
```

For Orbit-enabled repos:

- Search for the feature name across `Definition` and `File`.
- Traverse imports and calls to understand dependencies.
- Query neighbors for `tested_by` and `documented_by`.
- Ask for MR history if the feature changed recently.

## 2. Read Deeply

Read enough code to explain behavior, not just enough to sound plausible.

Gather:

- Entry points.
- Public interfaces.
- Public product surfaces: package `bin` entries, MCP tools, CLI commands, config files, environment variables, package scripts, hooks/checks, CI workflows, and packaged docs/artifacts.
- Required config and defaults.
- Error cases.
- Data flow.
- Tests and examples.
- Existing docs and terminology.

Evidence checklist:

```bash
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[" .
rg -n "throw new|raise |panic!|bail!|Result<|Error|Exception" relevant/path
rg -n "describe\(|it\(|test\(|pytest|#[test]|go test|fixture|golden" .
```

## 3. Choose Template

Use `../DocTypes.md`:

- README for project entry point.
- Setup Guide for install and verification.
- How-To Guide for one task.
- API Reference for public contracts.
- Architecture Guide for mental model and change guidance.
- Runbook for operations.
- Troubleshooting Guide for repeated failures.
- Migration Guide for version or data changes.

Do not mix all doc types into one file unless the repo is tiny and the README is the only documentation surface.

## 4. Draft From Evidence

Write in this order:

1. User goal.
2. Prerequisites.
3. Steps or concepts.
4. Verification.
5. Failure modes.
6. Links to deeper references.

Use paths and symbols naturally:

```markdown
The CLI entry point is `src/cli.ts`; the `init` command loads config from `src/config/load.ts`.
```

When a claim is inferred, label it:

```markdown
The docs do not show a production deployment path. CI suggests `pnpm build` is the release verification step.
```

## 5. Verify Examples

Prefer safe verification:

```bash
rg -n "documented-command|ENV_VAR|path/from/docs" .
rg -n '"documented-script"' package.json
rg --files path/from/docs
```

Run examples only when safe and reasonably scoped:

```bash
pnpm test
cargo test
go test ./...
pytest
```

Do not run deploy, publish, migration, delete, or production commands unless explicitly authorized.

If verification cannot be run, write:

```markdown
Examples were checked against source references but not executed in this pass.
```

## 6. De-Slopify

Apply `../Writing.md`:

- Remove filler and banned phrases.
- Replace hype with behavior.
- Delete unsupported claims.
- Prefer active voice.
- Keep the doc skimmable.
- Preserve project terminology.

Before finalizing, search the draft for banned patterns. Treat this as a
detection aid; still read the doc manually for accuracy, stale claims, and
subtle AI residue:

```bash
rg -n "Let's dive in|Let's explore|Here's why|At its core|Fundamentally|It's worth noting|Importantly|In order to|robust|seamless|powerful|pivotal|landscape|underscores|showcases|boasts|serves as|stands as|delve|foster|vibrant|testament|It's not .* it's|not only .* but|I hope this helps|Let me know|Great question" path/to/doc.md
```

## 7. Place The Doc

Follow existing structure:

- If similar docs exist, add the new doc beside them.
- If the README already routes docs, add a link.
- If docs have an index, update it.
- If generated docs exist, avoid editing generated output unless that is the repo's convention.

When unsure, prefer one new focused doc plus a README link.

## 8. Final Check

Confirm:

- The doc answers the user request.
- Commands, paths, env vars, APIs, and symbols are backed by evidence.
- Every product surface named by the doc is explained in the doc or explicitly delegated to another doc.
- Links resolve.
- Unverified examples are marked.
- No stale old section contradicts the new content.

For design, architecture, README, setup, and product-contract docs, run a doc-local consistency pass after drafting:

1. List every named surface: binaries, commands, tools, env vars, config files, hooks, package scripts, package artifacts, and shipped docs.
2. Confirm each surface is either explained locally or linked/delegated to the canonical doc.
3. Ask: "Did I introduce a new omission or contradiction?"

Final response should name the files changed and evidence checked.
