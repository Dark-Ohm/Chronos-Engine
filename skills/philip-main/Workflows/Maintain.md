# Maintain Workflow

Use this workflow when the user asks Philip to update docs for a diff, branch, pull request, merge request, or recent change.

Load with `../Writing.md`, `../DocTypes.md`, `../Exploration.md`, and `../OrbitIntegration.md` if Orbit is available.

Maintain mode is surgical. Patch affected sections. Do not turn a one-flag change into a README renovation.

Use diff-scoped Quick exploration from `../Exploration.md`: read the changed
files, extract changed symbols, search docs for those exact names, and stop
when doc impact is proven absent or the affected sections are patched.

## 0. Determine The Diff

Find the comparison range:

```bash
git status --short --branch
git branch --show-current
git remote -v
git diff --stat
git diff --name-status
```

If the work is committed on a branch:

```bash
git merge-base origin/main HEAD
git diff --name-status origin/main...HEAD
git diff --stat origin/main...HEAD
```

If `origin/main` does not exist, inspect branches:

```bash
git branch --all --verbose
```

Then choose the likely base or ask the user.

## 1. Classify Changed Files

Group diff files by documentation impact:

| Change | Doc Impact |
| --- | --- |
| Public API, route, schema, proto, GraphQL | API reference, examples, changelog. |
| CLI command, flag, output, exit code | README, CLI reference, how-to, troubleshooting. |
| Config, env var, defaults, feature flags | Setup, deployment, runbook, troubleshooting. |
| Auth, permissions, security, secrets | Security guide, API docs, runbooks. |
| Build, install, test, packaging | README, setup, contributor guide, CI docs. |
| Database migrations or data model | Architecture, migration guide, runbooks. |
| UI flow or screenshots | User guide, README screenshots, troubleshooting. |
| Internal refactor only | Usually no docs unless architecture changed. |

Useful patterns:

```bash
git diff --name-only origin/main...HEAD
git diff --unified=80 origin/main...HEAD -- package.json pyproject.toml Cargo.toml go.mod
git diff --unified=80 origin/main...HEAD -- 'src/**' 'app/**' 'lib/**' 'packages/**' 'crates/**'
```

## 2. Find Affected Docs

Search for changed names, paths, env vars, commands, and public symbols:

```bash
rg --files -g '*.md' -g '*.mdx' -g 'README*' -g 'docs/**'
rg -n "ChangedCommand|ChangedEnvVar|ChangedEndpoint|ChangedClass|changed-file-name" README* docs *.md
```

Extract changed identifiers from the diff:

```bash
git diff origin/main...HEAD -- '*.ts' '*.tsx' '*.js' '*.py' '*.rs' '*.go' '*.rb' '*.java' '*.kt' '*.swift'
```

Search changed symbols, paths, commands, flags, and env vars exactly before
making broader edits. Preserve maintain mode's small patch surface unless the
diff proves the docs need a larger Rewrite pass.

For Orbit-enabled repos:

- Query neighbors for changed files.
- Find `documented_by` edges from changed definitions.
- Query MR history for related docs.
- Run path finding from affected docs to changed definitions to confirm relevance.

## 3. Decide Whether Docs Must Change

Docs usually need updates when the diff changes:

- User-visible commands, flags, output, errors, or examples.
- Public APIs, schemas, events, or SDK types.
- Required setup, dependencies, config, or secrets.
- Security posture, permissions, auth, data deletion, or retention.
- Operational steps, deployment, rollback, monitoring, or migrations.
- Architecture boundaries that contributors rely on.

Docs may not need updates when the diff is:

- Pure internal refactor with unchanged public behavior.
- Test-only improvement.
- Formatting or dependency lockfile update with no user-visible change.

If no docs need changes, provide evidence and stop.

## 4. Patch Only Affected Sections

For each impacted doc:

1. Read surrounding section.
2. Replace stale lines.
3. Add missing prerequisites or warnings.
4. Update examples to match current code.
5. Preserve headings and anchors when possible.
6. Avoid broad rewrites.

If a new doc is required, keep it focused and link it from the nearest index or README.

## 5. Verify The Patch

Check every changed doc claim:

```bash
rg -n "newCommand|newEnvVar|newEndpoint|newPath|newFlag" .
rg --files new/path
git diff --check
```

Run docs tooling if present:

```bash
rg -n "markdownlint|remark|vale|docs:|lint:docs|check:docs" package.json Makefile justfile Taskfile .github/workflows .gitlab-ci.yml
```

Run safe project checks when the doc examples rely on them:

```bash
pnpm test
cargo test
go test ./...
pytest
```

Mark anything not run.

## 6. Final Response

Use this format:

```markdown
Updated docs for the current diff.

Changed:
- `path/to/doc.md`: [what changed and why]

Evidence checked:
- `path/to/source`: [symbol, command, or config]

Verification:
- [Commands run, or "not run"]

Remaining risk:
- [Only if real]
```

If no docs changed:

```markdown
No docs changes needed for this diff. I checked [files/symbols], and the changes do not alter user-facing behavior, setup, config, API, operations, or architecture docs.
```

## 7. CI Integration Notes

Maintain mode is suitable for post-merge or PR checks:

- **Input**: A diff from `git diff`, `gh pr diff`, CI merge-base variables, or a merge request patch.
- **Output**: Updated doc files committed to the branch, or a report explaining why no docs changed.
- **Exit criteria**: All doc references to changed symbols are updated, or no doc impact is confirmed with evidence.
- **Escalation**: If the change is too large for surgical patching, stop and recommend the Rewrite workflow instead of attempting a partial fix.

Do not let CI mode make broad editorial rewrites. It should patch stale references, add missing warnings, or request a larger docs pass.
