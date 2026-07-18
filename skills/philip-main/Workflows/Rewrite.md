# Rewrite Workflow

Use this workflow when the user asks Philip to fix stale docs, improve existing docs, update a guide, or make a doc match current code.

Load with `../Writing.md`, `../DocTypes.md`, `../Exploration.md`, and `../Audit.md` when findings already exist.

## 0. Identify The Rewrite Contract

Determine:

- Which docs are in scope.
- Whether to preserve structure or redesign it.
- Whether examples must be executed.
- Whether the goal is accuracy, readability, completeness, or all three.

Default: preserve useful structure and rewrite inaccurate sections. Do not rewrite the entire doc to leave your fingerprints on it.

## 1. Read Existing Docs

Use Quick exploration from `../Exploration.md` for one named stale claim,
command, symbol, or section. Use Standard exploration for full-doc rewrites or
when the stale behavior crosses setup, API, architecture, or operations docs.

Inventory the doc before changing it:

```bash
rg -n "^#|TODO|FIXME|deprecated|DEPRECATED|TBD|WIP" path/to/doc.md
rg -n "npm run|pnpm|yarn|cargo|go test|pytest|docker compose|make |curl |kubectl|terraform" path/to/doc.md
rg -n "PORT|TOKEN|SECRET|DATABASE_URL|API_KEY|localhost|127\.0\.0\.1" path/to/doc.md
```

Record:

- Good structure worth keeping.
- Claims requiring verification.
- Commands and examples.
- Public product surfaces named by this doc: binaries, commands, tools, env vars, config files, hooks, package scripts, package artifacts, and shipped docs.
- Links and referenced paths.
- Tone or terminology to preserve.

## 2. Use Git History

Find why the doc became stale:

```bash
git log --follow --name-status --oneline -- path/to/doc.md
git log --since='180 days ago' --name-status --oneline
git diff --name-status origin/main...HEAD
```

If a documented command, file, or symbol is stale, search its history:

```bash
git log --all --name-status -- "**/old-name*"
git log -S"oldCommandOrEnvVar" --all -- .
git log -G"oldCommandOrEnvVar" --all -- .
```

Use history to distinguish removed behavior from renamed behavior. A stale command with no replacement should be removed or marked unsupported, not "updated" by guessing.

## 2.5. Build A Change List

Before editing, turn the evidence into a concrete change list:

| Doc claim | Current code state | Action |
| --- | --- | --- |
| `createUser(name, email)` | Renamed to `createAccount(name, email, role)` | Update signature, add `role` parameter docs |
| Runs on port `3000` | Default changed to `8080` in config | Update port reference and verification step |
| Uses `lodash` for utilities | `lodash` removed from manifests and imports | Remove dependency mention |
| Auth section describes API keys | Auth module now uses OAuth2 | Rewrite the section from current source |

Classify each row:

- **Update**: Small factual correction, such as a renamed symbol or changed default.
- **Rewrite**: Section needs substantial revision because the underlying behavior changed.
- **Delete**: Section documents something that no longer exists.
- **Add**: New behavior exists and the doc has no place for it yet.

## 3. Re-Verify Against Current Code

Check each claim category.

Commands:

```bash
rg -n '"scripts"|"bin"' package.json
rg -n "program\.command|Command::new|argparse|click\.|cobra\.Command|commander|clap::" .
rg -n "Makefile|justfile|Taskfile|\.github/workflows|\.gitlab-ci" .
```

Environment:

```bash
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[" .
rg -n "DATABASE_URL|PORT|TOKEN|SECRET|API_KEY" .
```

APIs:

```bash
rg -n "router\.|app\.(get|post|put|patch|delete)|FastAPI|Controller|Route|Query|Mutation" .
rg --files -g '*openapi*' -g '*swagger*' -g 'proto/**' -g 'graphql/**'
```

Paths:

```bash
rg --files | rg 'exact/path/or/name'
```

If Orbit is available, query neighbors for each public definition mentioned by the doc and compare `documented_by` edges.

## 4. Rewrite With Minimal Damage

Rules:

- Keep accurate headings and sequence.
- Replace stale claims with verified current behavior.
- Delete obsolete sections when no replacement exists.
- Add missing prerequisites before commands.
- Add verification after setup or operational steps.
- Preserve project voice unless it is unclear or misleading.
- Keep link targets and anchors stable when possible.

Rewrite stale sections in place. Move sections only when the current structure blocks comprehension.

## 5. Patch Contradictions

After editing, search for old claims still present:

```bash
rg -n "oldCommand|oldEnvVar|oldPath|oldEndpoint|oldFeatureName" path/to/doc.md docs README.md
```

If multiple docs contradict each other, fix all in-scope docs or report the remaining contradiction.

## 5.5. Run A Doc-Local Consistency Pass

After creating or heavily rewriting a doc, re-audit the changed doc against the public surface inventory. This is narrower than a whole-repo audit and catches omissions introduced by the rewrite.

Ask:

- Which product surfaces does this doc name in headings, overview lists, diagrams, tables, contracts, or examples?
- Is each named surface explained later in this doc?
- If the surface is operational rather than architectural, does the doc at least include one sentence or an explicit pointer to the owning doc?
- Did the rewrite introduce a new omission or contradiction?

Do not waive a gap because README or another doc covers it. When the changed doc presents itself as the design, architecture, setup, or product contract, local completeness matters.

## 6. Verify

Use the safest available checks:

```bash
rg -n "newCommand|newEnvVar|newPath|newEndpoint" .
rg --files new/path
```

Run commands only when safe:

```bash
pnpm test
cargo test
go test ./...
pytest
```

For markdown quality:

```bash
rg -n "Let's dive in|Let's explore|Here's why|At its core|Fundamentally|It's worth noting|Importantly|In order to|robust|seamless|powerful|pivotal|landscape|underscores|showcases|boasts|serves as|stands as|delve|foster|vibrant|testament|It's not .* it's|not only .* but|I hope this helps|Let me know|Great question" path/to/doc.md
rg -n "\]\([^)]*\)" path/to/doc.md
```

Follow links manually or with the repo's docs checker if one exists. Search is
only a detection aid; read the rewritten sections manually to catch subtle
AI-residue, unsupported claims, and contradictions the regex cannot see.

## 7. Final Response

Report:

- What changed.
- Which stale claims were removed or corrected.
- What evidence was used.
- Which commands or examples were run.
- What remains unverified.

If the old guide was actively harmful, say so plainly. Example: "The previous setup section pointed new users at a deleted script; that path is gone now."
