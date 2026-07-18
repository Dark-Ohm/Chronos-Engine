# 6-Agent Documentation Synchronization Pattern

## Overview

A specialized delegation pattern for **full documentation-to-code synchronization** across a multi-crate workspace. Used when:

- Multiple crates have documentation that has drifted from code
- Cross-references between docs need consistency checking
- Architectural questions (e.g., "does this component exist?") require single source of truth

## The 6-Agent Architecture

| Agent | Scope | Key Verification Targets |
|-------|-------|--------------------------|
| **1. Vessel Core** | `vessel-core/` + LORE Ch1 + BRIEF §1.1/§2 + RFC-001 §2 | TOML registry existence, PyO3 status, API signatures, tier constants, test status |
| **2. Context Engine** | `chronos-ctx-core/` + Docs/Chronos-ctx/* + BRIEF §6.7 | Test counts (cargo test), supported languages, "Layer 2 not started" false claim, edge cases |
| **3. Memory Layer** | `chronos-memory/` + BRIEF §6.1/§6.3 + LORE/VISION/CANONICAL_SLOTS engram refs | **Real** test counts via cargo test, CI status (sqlite-vec), consistent TODO markers for engram-vs-chronos-memory |
| **4. Shell + Agent** | `chronos-shell/` + `chronos-agent/` + LORE Ch2/3 + VISION phases | Shell = Tier Tester only, Agent = empty dir, update all "implemented" claims to reality |
| **5. Cross-doc Consistency** | ALL .md files | Broken wikilinks, stale dates, duplicated TODO phrasing, contradictory claims, orphan refs |
| **6. LORE + VISION Full Sync** | LORE.md + VISION.md + ALL code | Chapter-by-chapter verification with inline status markers (✅/⚠️/🚫), phase status updates |

## Pre-Read Protocol (Critical)

**Before dispatching ANY agents:**
1. Read ALL source code (lib.rs + key modules for each crate)
2. Read ALL existing documentation files
3. Cross-reference mentally — note every discrepancy
4. Embed **full ground truth** in each agent's context

This prevents agents from discovering different "truths" and writing contradictory fixes.

## Context Structure for Each Agent

```markdown
AGENT N - <Scope>

ROOT: /path/to/workspace

Files to read:
- <exact source files>
- <exact doc files>
- <cross-ref docs>

Key discrepancies to check:
1. <specific claim in docs> vs <actual code reality>
2. ...

Verification commands:
- cargo test in <crate> (for REAL counts)
- ls -la <dir> (for existence checks)

Write docs atomically, one file per commit: `docs: sync <file> with <source>`
Insert ⚠️ TODO(Архитектор): for genuinely unresolved questions.
```

## Critical Patterns

### 1. Consistent TODO Markers
When multiple docs reference the same architectural question (e.g., "engram vs chronos-memory"), **every occurrence gets the exact same marker**:

```
> ⚠️ TODO(Архитектор): chronos-memory vs engram — заменяет или сосуществует? (см. также chronos-ctx-core/README#Дальнейшие-слои)
```

### 2. Honest Status Markers in Narrative Docs (LORE/VISION)
For every claim about implementation:
- `✅ verified` — code exists and matches
- `⚠️ mismatch` — code exists but differs (include exact diff)
- `🚫 NOT IMPLEMENTED` — code doesn't exist

Inline: `> ⚠️ STATUS(2026-07-06): <actual state>`

### 3. Phase Status Updates
Update VISION phase tables to reflect reality:
- Phase 0 = vessel-core + chronos-ctx-core = **DONE**
- Phase 1 = Agent + Shell MVP = **NOT STARTED**

### 4. Atomic Commits
Each file = one commit with conventional message. No bundled "docs: sync everything" commits.

## Dispatch Sequence

```text
# All 6 dispatched in SAME response = parallel execution
Agent 1 → Vessel Core
Agent 2 → Context Engine  
Agent 3 → Memory Layer
Agent 4 → Shell + Agent
Agent 5 → Cross-doc Consistency
Agent 6 → LORE + VISION Full Sync
```

## Integration

When agents return:
1. Review each summary for conflicts
2. Check that TODO markers are consistent across files
3. Verify no contradictory claims remain
4. Run any validation (links, cargo test if applicable)

## Real-World Application (This Session)

**Workspace:** Chronos-IDE (Rust/GPUI workspace with 5 crates)
- vessel-core (enforcement, provenance, 72-slot registry)
- chronos-ctx-core (context engine: density, anchor, signatures, cache)
- chronos-memory (FTS5 + sqlite-vec memory layer)
- chronos-shell (GPUI UI — currently only Tier Tester)
- chronos-agent (empty — not implemented)

**Documentation surface:** ~20 .md files across Docs/, manifest/, rfc/, plus root MOC/BRIEF/LORE/VISION/MYTHOS/CANONICAL_SLOTS

**Discrepancies found and assigned:**
- Vessel Core: TOML registry physical existence?, PyO3 removal status?
- Context Engine: "Layer 2 not started" = FALSE, test count claim
- Memory Layer: "38 failing" = stale, CI status, engram vs memory question everywhere
- Shell/Agent: LORE describes full implementation, code = minimal tester + empty dir
- Cross-doc: broken wikilinks, stale dates, duplicated TODOs
- LORE/VISION: every chapter needs status markers

**Expected outcome:** All docs match code reality, consistent TODO register, honest phase status.