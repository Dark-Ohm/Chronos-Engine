# Context Pre-loading for Docs-Sync Delegation

## The Pattern

When delegating documentation-synchronization tasks ("update docs to match code"), **pre-read all source and all docs yourself first**, then embed the summarized source directly in each subagent's context. This ensures:

1. **Ground truth consistency** — every subagent measures docs against the same source summary
2. **Zero file reads for subagents** — they work immediately instead of spending turns reading files
3. **Cross-sectional verification** — you catch discrepancies between what the code does and what the docs claim before any agent writes a line

## Workflow

```
1. Read ALL source files (lib.rs + modules)
2. Read ALL existing doc files (.md)
3. Cross-reference — note gaps
4. Construct delegation with FULL code context
5. Dispatch N parallel agents
6. Each agent reads its context, compares vs actual docs, and fixes discrepancies
7. Each agent commits and reports
```

## Context Structure Template

For each delegation context block:

```
## <crate> context

### Source code summary (GROUND TRUTH)

#### lib.rs
<full public API: all pub fn, pub struct, pub enum, pub trait signatures>

#### module_a.rs
<module purpose, key types, algorithm, edge-cases table>

### Existing docs to check:
- Docs/<crate>/README.md
- Docs/<crate>/MODULE.md

### What to do:
1. Read all existing docs
2. Compare against source above (this is ground truth)
3. Fix discrepancies: wrong APIs, missing params, stale descriptions
4. If a module has no doc → create it following existing style
5. Commit with conventional message (e.g. "docs(crate): synchronize docs with code")
```

## When to Use

- **Docs-sync tasks** — always (orchestrator needs both sides)
- **Multi-module crate audits** — N docs must match M source files
- **Cross-referencing tasks** — subagents would re-discover same facts

## When NOT to Use

- **Simple single-file tasks** — just tell the subagent the file path
- **Code actively changing** — stale context
- **Source is enormous** (>50K chars per module) — summarize APIs instead

## Trade-offs

- **Pros:** Subagents start fast, no redundant reads, consistent ground truth
- **Cons:** You pay token cost to read *and* embed. Only worthwhile for 3+ delegations.
