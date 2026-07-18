# Issue tracker: Local Markdown + Beads

This repo uses a hybrid planning workflow:

- PRDs, design notes, and plans may live as local Markdown, usually under `docs/plans/` unless the user requests another path.
- Implementation issues live in Beads under `.beads/`, managed with `br`.
- Use `bv --robot-*` for graph-aware triage and planning.
- Do not create GitHub issues unless the user explicitly asks.

## Beads workflow

Use Beads for implementation task graphs:

```bash
br list --json
br ready --json
br blocked --json
br show <id> --json
br create "Title" --type task --priority 1 --description "..."
br dep add <child-id> <parent-id>
br dep cycles
```

Use `bv` only in robot mode:

```bash
bv --robot-plan
bv --robot-insights
bv --robot-triage
bv --robot-next
```

Never run bare `bv`; it launches an interactive TUI.

## When a skill says "publish to the issue tracker"

Create or update Beads with `br`, not GitHub issues.

If the artifact is a PRD or long-form plan, write it as local Markdown at the user-requested path. For durable project plans, prefer `docs/plans/`.

## When a skill says "fetch the relevant ticket"

Use:

```bash
br show <id> --json
```

For graph context, use:

```bash
br dep tree <id>
bv --robot-insights
```

## Beads sync and commit process

`br` never commits for you. After bead mutations:

```bash
br sync --flush-only
git add .beads/
git commit -m "chore(beads): update issues"
```

`.beads/.gitignore` should exclude local runtime state such as:

```text
*.db
*.db-wal
*.lock
.br_history/
last-touched
```

A normal `git add .beads/` should stage only portable bead state, typically:

```text
.beads/.gitignore
.beads/config.yaml
.beads/issues.jsonl
.beads/metadata.json
```

If `git add -n .beads/` shows database, WAL, lock, or history files, stop and inspect `.beads/.gitignore`.

## Husky / pre-commit policy

This repo uses Husky to keep Beads JSONL in sync at commit time.

The pre-commit hook should:

1. Run `br sync --flush-only` when `.beads/` exists.
2. Stage portable `.beads/` files with `git add .beads/`.
3. Fail clearly if `br` is unavailable.
4. Avoid staging unrelated files.

Agents should still run `br sync --flush-only` before committing bead changes. The hook is a safety net, not a replacement for explicit sync discipline.
