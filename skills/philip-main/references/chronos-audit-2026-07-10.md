# Chronos Documentation Audit — 2026-07-10

## Methodology
1. Read all source files (crates/app, crates/services, crates/luau) directly
2. Delegated 3 subagents for exhaustive symbol inventory per crate
3. Ran `git log --format="%h %ad %s" --date=short` for full commit history
4. Cross-referenced each discrepancy against git history using `git log -S` and `git show`

## Findings

### CRITICAL: §8 "LuaU is NEVER in the render path"
- Origin: `2026-07-08-chronos-architecture-design.md` (spec, line 128) — aspirational design
- Contradicted by: commit `d236242` (2026-07-09) — LuaWidgetAdapter added, calls Lua on every render
- Plans confirm: `2026-07-09-luau-plugin-layer.md` line 1192 explicitly designs Lua call per render
- Root cause: Aspirational spec vs intentional implementation plan. Plans and code agree; doc is stale.
- Fix: Rewrite §8 to reflect reality (Lua called every frame via LuaWidgetAdapter)

### HIGH: §3/§12 inotify status stale
- §3 still says "NOT YET IMPLEMENTED" (added by `5921fae` 2026-07-09)
- §9 updated to "implemented" by `d7ab5a7` 2026-07-10, but §3/§12 never updated
- Root cause: Partial update — `d7ab5a7` fixed §9 but missed §3 and §12

### HIGH: §7 Service trait v1 vs v2
- Doc shows v1 (with `dispatch()`, no `get()`, no `type Error`)
- Code is v2 (no `dispatch()` in trait, has `get()`, `type Error: Send + Sync + 'static`)
- Root cause: v1→v2 migration (`7d111a6`) without updating ARCHITECTURE.md §7

### MEDIUM: §8 "< 4ms budget" — no enforcement
### MEDIUM: crates/luau depends on gpui (not mentioned in §3/§5)
### LOW: manager.rs eprintln! debug statements

## Key Technique: Git-History Cross-Reference
When a discrepancy is found, trace it:
```bash
git log --all -p -S "discrepant text" -- <file>  # when introduced
git show <commit> -p -- <file>                    # exact diff
```
Three root causes: aspirational, stale, partial update.
