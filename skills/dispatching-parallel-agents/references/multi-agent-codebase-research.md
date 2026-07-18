# Multi-Agent Codebase Research Pattern

## Overview

A delegation pattern for **parallel codebase pattern extraction** across a large codebase with clear module boundaries. Used when:

- Researching multiple independent subsystems in one codebase
- Each subsystem has distinct crate/module boundaries
- No shared state modifications needed (read-only investigation)
- Structured output format can be defined upfront

## The 5-Agent Architecture (This Session)

| Agent | Scope | Key Files |
|-------|-------|-----------|
| **1. GPUI Core** | `zed/src/main.rs`, `zed/src/zed.rs` | App bootstrap, window creation, entity patterns, async integration |
| **2. Editor** | `editor/`, `multi_buffer/`, `language/` | Tree-sitter, DisplayMap, MultiBuffer, scrolling, decorations |
| **3. Workspace/Panels** | `workspace/`, `panel/` | Dock, PaneGroup, Item system, panel registration |
| **4. AI Agent** | `agent/`, `agent_ui/`, `language_model/` | Streaming, inline assist, context, conversation UI |
| **5. LSP** | `lsp/`, `language/`, `language_tools/` | Server management, completions, diagnostics, navigation |

## Pre-Dispatch Protocol

1. **Map the codebase** — identify independent crate groups
2. **Define output format** — markdown with file:line references
3. **Write self-contained tasks** — each agent gets specific file targets
4. **Dispatch in parallel** — single `delegate_task` call with all 5 tasks

## Task Template (Per Agent)

```markdown
{
  "context": "Researching Zed IDE (Rust+GPUI) for Chronos IDE patterns. Focus on [specific crate paths]",
  "goal": "Find: [specific patterns]. Output: Markdown with pattern descriptions, code examples with file:line refs, Chronos application notes.",
  "role": "leaf"
}
```

## Critical Success Factors

### Clear Domain Boundaries
- Editor: `editor/`, `multi_buffer/`, `language/`, `syntax_theme/`
- Workspace: `workspace/`, `panel/`, `dock.rs`, `pane.rs`
- Agent: `agent/`, `agent_ui/`, `language_model/`, `acp_thread/`
- LSP: `lsp/`, `language/`, `language_tools/`
- Core GPUI: `gpui/`, `zed/`

### Specific File Targets
Don't say "research the editor" — say:
- `crates/editor/src/display_map.rs` — DisplayMap hierarchy
- `crates/multi_buffer/src/multi_buffer.rs` — MultiBuffer + Anchors
- `crates/language/src/syntax_map.rs` — Tree-sitter incremental
- `crates/editor/src/scroll.rs` — ScrollAnchor + OngoingScroll

### Structured Output Format
Each agent returns:
1. Pattern description (what + why)
2. Code examples with `file:line` references
3. Chronos application notes
4. Key files to reference

## Time Comparison

| Approach | Time |
|----------|------|
| Sequential single agent | 90-120 min |
| **5 parallel agents** | **~20 min** |
| Speedup | **4.5-6x** |

## Post-Delegation Synthesis

1. Read all 5 outputs
2. Cross-reference shared types (`Entity<T>`, `Task`, `Subscription`, `cx.spawn`)
3. Synthesize into unified report with consistent formatting
4. Create quick-reference file (`references/zed-gpui-patterns-research.md`)

## When This Pattern Applies

✅ Large codebase with clear module boundaries  
✅ Research/investigation tasks (read-only)  
✅ 3+ independent domains  
✅ Structured output format defined upfront  

❌ Tasks requiring sequential dependencies  
❌ Tasks modifying shared files  
❌ Exploratory debugging (unknown what's broken)

## Reference

- **Session**: 2026-07-06 Zed IDE research for Chronos IDE
- **Full report**: `CHRONOS_ZED_GPUI_RESEARCH.md`
- **Quick reference**: `references/zed-gpui-patterns-research.md`
- **Related pattern**: `references/docs-sync-6-agent-pattern.md` (documentation sync — different use case)