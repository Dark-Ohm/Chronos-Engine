---
name: writing-plans
description: Use when you have a spec or requirements for a multi-step task, before touching code
---

# Writing Plans

## Overview

Write comprehensive implementation plans assuming the engineer has zero context for our codebase and questionable taste. Document everything they need to know: which files to touch for each task, code, testing, docs they might need to check, how to test it. Give them the whole plan as bite-sized tasks. DRY. YAGNI. TDD. Frequent commits.

Assume they are a skilled developer, but know almost nothing about our toolset or problem domain. Assume they don't know good test design very well.

**Announce at start:** "I'm using the writing-plans skill to create the implementation plan."

**Context:** If working in an isolated worktree, it should have been created via the `superpowers:using-git-worktrees` skill at execution time.

**Save plans to:** `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md`
- (User preferences for plan location override this default)

## Scope Check

If the spec covers multiple independent subsystems, it should have been broken into sub-project specs during brainstorming. If it wasn't, suggest breaking this into separate plans — one per subsystem. Each plan should produce working, testable software on its own.

## File Structure

Before defining tasks, map out which files will be created or modified and what each one is responsible for. This is where decomposition decisions get locked in.

- Design units with clear boundaries and well-defined interfaces. Each file should have one clear responsibility.
- You reason best about code you can hold in context at once, and your edits are more reliable when files are focused. Prefer smaller, focused files over large ones that do too much.
- Files that change together should live together. Split by responsibility, not by technical layer.
- In existing codebases, follow established patterns. If the codebase uses large files, don't unilaterally restructure - but if a file you're modifying has grown unwieldy, including a split in the plan is reasonable.

This structure informs the task decomposition. Each task should produce self-contained changes that make sense independently.

## Task Right-Sizing

A task is the smallest unit that carries its own test cycle and is worth a
fresh reviewer's gate. When drawing task boundaries: fold setup,
configuration, scaffolding, and documentation steps into the task whose
deliverable needs them; split only where a reviewer could meaningfully
reject one task while approving its neighbor. Each task ends with an
independently testable deliverable.

## Bite-Sized Task Granularity

**Each step is one action (2-5 minutes):**
- "Write the failing test" - step
- "Run it to make sure it fails" - step
- "Implement the minimal code to make the test pass" - step
- "Run the tests and make sure they pass" - step
- "Commit" - step

## Plan Document Header

**Every plan MUST start with this header:**

```markdown
# [Feature Name] Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** [One sentence describing what this builds]

**Architecture:** [2-3 sentences about approach]

**Tech Stack:** [Key technologies/libraries]

## Global Constraints

[The spec's project-wide requirements — version floors, dependency limits,
naming and copy rules, platform requirements — one line each, with exact
values copied verbatim from the spec. Every task's requirements implicitly
include this section.]

---
```

## Task Structure

````markdown
### Task N: [Component Name]

**Files:**
- Create: `exact/path/to/file.py`
- Modify: `exact/path/to/existing.py:123-145`
- Test: `tests/exact/path/to/test.py`

**Interfaces:**
- Consumes: [what this task uses from earlier tasks — exact signatures]
- Produces: [what later tasks rely on — exact function names, parameter
  and return types. A task's implementer sees only their own task; this
  block is how they learn the names and types neighboring tasks use.]

- [ ] **Step 1: Write the failing test**

```python
def test_specific_behavior():
    result = function(input)
    assert result == expected
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/path/test.py::test_name -v`
Expected: FAIL with "function not defined"

- [ ] **Step 3: Write minimal implementation**

```python
def function(input):
    return expected
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/path/test.py::test_name -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/path/test.py src/path/file.py
git commit -m "feat: add specific feature"
```
````

## No Placeholders

Every step must contain the actual content an engineer needs. These are **plan failures** — never write them:
- "TBD", "TODO", "implement later", "fill in details"
- "Add appropriate error handling" / "add validation" / "handle edge cases"
- "Write tests for the above" (without actual test code)
- "Similar to Task N" (repeat the code — the engineer may be reading tasks out of order)
- Steps that describe what to do without showing how (code blocks required for code steps)
- References to types, functions, or methods not defined in any task

## Remember
- Exact file paths always
- Complete code in every step — if a step changes code, show the code
- Exact commands with expected output
- DRY, YAGNI, TDD, frequent commits

## Self-Review

After writing the complete plan, look at the spec with fresh eyes and check the plan against it. This is a checklist you run yourself — not a subagent dispatch.

**1. Spec coverage:** Skim each section/requirement in the spec. Can you point to a task that implements it? List any gaps.

**2. Placeholder scan:** Search your plan for red flags — any of the patterns from the "No Placeholders" section above. Fix them.

**3. Type consistency:** Do the types, method signatures, and property names you used in later tasks match what you defined in earlier tasks? A function called `clearLayers()` in Task 3 but `clearFullLayers()` in Task 7 is a bug.

If you find issues, fix them inline. No need to re-review — just fix and move on. If you find a spec requirement with no task, add the task.

## Implementation Handoff

After saving the plan, offer execution choice:

**"Plan complete and saved to `docs/superpowers/plans/<filename>.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?"

## Documentation Project Execution Strategy

**For documentation projects specifically (like Chronos documentation refresh):**

### When executing plans for documentation projects:

1. **If Inline Execution chosen:**
   - **REQUIRED SUB-SKILL:** Use `superpowers:executing-plans`
   - Set `deliver=''` to avoid delivery delays during iterative documentation reviews
   - Use the documentation project execution strategy below

2. **If Subagent-Driven chosen:**
   - For each critical overlap documentation task, assign to specialized subagent
   - Each subagent should use `writing-plans` for their subtask
   - Review complete documentation project as cohesive unit

**Documentation Project Execution Strategy for Inline Execution:**

When using `executing-plans` for documentation refresh:

1. **Phase 1: Preservation Tasks (preserve files)**
   - Mark tasks for items that need only lorar documentation preservation
   - Create checkboxes for "examine file content", "identify lore elements", "preserve structure"
   - Document any footnotes/clarifications needed (e.g., "add footnote about Vessel Engine clarification")

2. **Phase 2: Rewrite Tasks (rewrite files)**
   - Mark tasks for comprehensive document rewrites
   - Focus on maintaining structure while updating technical accuracy
   - Include verifications for content accuracy and style consistency

3. **Phase 3: Creation Tasks (create new files)**
   - Mark tasks for new document creation
   - Use established templates where available
   - Include verifications for completeness and compliance

4. **Critical Overlap Resolution**
   - Prioritize critical overlap tasks to resolve or mark as open questions early
   - Document all overlaps with clear resolution requirements
   - Use each resolved overlap to improve overall documentation

**Critical Overlap Execution for Documentation Projects:**

For critical overlaps like the LeanCTX `ctx_refactor` vs Chronos's LSP refactoring:

1. **Add to Global Constraints:**
```markdown
- Critical overlap: LeanCTX `ctx_refactor` vs Chronos's LSP refactoring - document clear distinction or mark as open question
- Supervision strategy: Document LSP server failure handling for multi-process documentation workflows
```

2. **In Task Requirements:**
```markdown
- Handle critical overlaps by either explicit documentation of distinctions or marking as open questions for resolution
- Document supervision strategies for maintaining documentation integrity across process failures
```

3. **For each overlap:**
   - Document the competing concepts clearly
   - Identify resolution approach (distinction vs. open question)
   - Add to verification checklist
   - If marked as open question, create task to resolve or clarify

**Verification for Documentation Projects:**

Each plan should include these verification tasks:
- [ ] Verify all files properly categorized (preserve/rewrite/create)
- [ ] Verify critical overlaps resolved or marked appropriately
- [ ] Verify documentation project structure maintained
- [ ] Verify style and formatting consistency
- [ ] Verify master brief §5 compliance
- [ ] Verify migration strategy validation complete
- [ ] Verify preservation requirements met
- [ ] Verify critical overlap resolution documentation complete

**Example Task for Critical Overlap:**

```markdown
### Task X: Critical Overlap Resolution - LeanCTX `ctx_refactor` vs Chronos LSP Refactoring

**Files:**
- Create: `docs/superpowers/plans/critical-overlaps/leanctx-refactor-analysis.md`
- Modify: `docs/brief/IMPLEMENTATION-PLAN.md:45-52`

**Interfaces:**
- Consumes: Task 1 (existing documentation analysis)
- Produces: Documentation showing clear distinction between tools or open question resolution

- [ ] **Step 1: Analyze LeanCTX `ctx_refactor` documentation**
  - Read relevant LeanCTX documentation to understand scope and capabilities
  - Document tool purpose, features, and limitations

- [ ] **Step 2: Analyze Chronos native LSP refactoring**
  - Review Chronos's LSP implementation and documentation
  - Document tool scope, approach, and distinguishing features

- [ ] **Step 3: Compare and identify overlaps**
  - Create comparison matrix showing functional similarities
  - Identify specific overlaps in problem domain, solution approach, capabilities

- [ ] **Step 4: Determine resolution approach**
  - Document whether clear distinction is possible
  - If clear distinction: Document explicit differences in documentation
  - If unclear distinctions: Mark as open question for clarification

- [ ] **Step 5: Document resolution**
  - Update implementation plan with resolution approach
  - Create documentation showing clear distinctions or open question status

- [ ] **Step 6: Verification**
  - Verify documentation clearly distinguishes between tools
  - Verify critical overlap appropriately marked as resolved or open question
```

**If Subagent-Driven chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:subagent-driven-development
- Fresh subagent per task + two-stage review

**If Inline Execution chosen:**
- **REQUIRED SUB-SKILL:** Use superpowers:executing-plans
- Batch execution with checkpoints for review

## Critical Overlap Handling for Documentation Projects

**For projects with significant architectural changes or competing tools/concepts:**

### Important: Before you start work, identify critical overlaps early:

**1. For documentation projects (like Chronos documentation refresh):**

**A. Add to Global Constraints:**
```markdown
- Critical overlap detection:
  - Tools competing with native implementations (LeanCTX `ctx_refactor` vs Chronos's LSP refactoring)
  - Supervision strategy conflicts (LSP server failures across monorepos)
  - Architectural terminology disambiguation (metaphor vs. literal concepts)
  - Preserve existing documentation structure while updating technical accuracy
  - Handle competing tools by either clear distinction via explicit documentation or by marking as open questions for resolution
  - Documentation project structure and categorization patterns
  - Migration strategy validation and verification procedures
  - Documentation project compliance with master brief §5 requirements
  - Preserve existing lore while implementing architectural changes
  - Ensure consistent style and formatting across all documentation files
  - Verify all native vs. external tool overlaps are resolved or documented as open questions
  - Validate migration strategy through comprehensive verification checks
```

**B. Add to task requirements:**
```markdown
- Review existing documentation for critical overlaps (conflicting tools, supervision concerns)
- Document critical overlaps with clear distinction or resolution requirements
- Update documentation to reflect architectural changes while preserving conceptual intent
- Implement supervision strategies that maintain documentation integrity across process failures
- Validate documentation project structure and organization approach
- Execute migration strategy with verification of all changes
- Ensure proper categorization of files (preserve/rewrite/create)
- Complete all master brief §5 compliance requirements
- Verify preservation requirements for existing documentation
- Validate critical overlap resolution strategies
- Execute comprehensive verification checklist for all changes
```

**2. Documentation Project Classification Strategy:**

**A. Three-Phase Classification Approach:**

**Phase 1: Files to Preserve (Lore-only Investigation)
- Review existing documentation structure and content
- Identify files that contain essential lore, concepts, or historical information
- Preserve original wording and structure where architectural accuracy is not required
- Document preservation requirements and footnotes
- Example: README.md lore preservation with Vessel Engine clarification

**Phase 2: Files Requiring Rewrite (Architecture Updates)
- Identify all files needing complete architectural updates
- Determine scope of changes based on master brief §5 requirements
- Document rewrite requirements and migration strategy
- Example: _index.md complete rewrite, Arсhitecture.md selective updates

**Phase 3: Files Requiring Creation (New Concepts)
- Document all required new concept files from master brief §5
- Define specific requirements and content for each new file
- Example: All 7 new concept files (Workspace-модель.md through LLM-Backend.md)

**B. Critical Overlap Detection Methodology:**

**1. Native vs. External Tool Competition Analysis:**
- Compare Chronos's native tools with external MCP servers
- Identify direct competitors (like LeanCTX `ctx_refactor` vs Chronos's LSP refactoring)
- Determine approach: explicit documentation of distinctions or open question resolution

**2. Supervision Strategy Conflicts:**
- Analyze process management and failure handling across different tools
- Document supervision patterns and resilience requirements
- Identify potential conflicts in multi-process workflows

**3. Architectural Terminology Resolution:**
- Clarify metaphorical vs. literal architectural concepts
- Standardize terminology across documentation
- Resolve terminology conflicts through explicit documentation

**3. Migration Strategy Validation:**

**A. Comprehensive Verification:**
- Document all verification procedures and checkpoints
- Include verification in each task's requirements
- Define success criteria for each migration phase
- Example: Implementation plan verification script

**B. Quality Assurance:**
- Document verification tools and procedures
- Define quality metrics and acceptance criteria
- Include automated verification where possible
- Example: All checks pass validation

**C. Integration and Testing:**
- Define integration testing requirements
- Document regression testing procedures
- Include edge case testing and error handling
- Example: All critical overlaps resolved or marked as open questions

**4. Documentation Project Templates:**

**A. Archive Template for Documentation Projects:**
```markdown
## Global Constraints

- Preserve existing documentation lore but clarify [Concept] is [Architecture] — not a metaphor
- Follow existing Obsidian style: frontmatter, wikilinks, wikilink sections
- Russian for conceptual/lor docs, English for RFC documentation
- Keep Mermaid diagrams, tables for classification
- Preserve :eagle: icons and aphorisms from [SOURCE]
- Maintain [EXISTING MODEL] semantics but adapt to new architectural model
- Update from Python/Rust PyO3 architecture to pure Rust architecture
- Rewrite for native (C/C++) self-improvement with tier 1 GRANT registration
- Preserve existing classifications but adapt to source-based tier model
- Preserve [EXISTING ROLE] as first tool/bot
- Keep self-improving self-improving capabilities
- Ensure new documentation supports both [EXISTING SYSTEM] and [NEW SYSTEM]
- Implement workspace specialization ([AREA1]/[AREA2]/[AREA3])
- Ensure new documentation mentions both existing Schema specifications and new [NEW FEATURE] modifications
- Ensure implementation builds to rust using miri for testing
- Update to explicit use of `sync`-read and `async`-write for write lock model
- Include new internal tools for auditing and provenance
- Preserve engram/leanctx/language integration but clarify new tier model
- Add new files for new concepts: [NEW CONCEPTS LIST]
- Document critical overlaps (native vs. external tools, supervision strategies)
- Validate migration strategy through comprehensive verification
- Ensure all master brief §5 compliance requirements are met
```

**2. Generic Critical Overlap Pattern (for any complex project):**

**A. Add to Global Constraints:**
```markdown
- Identify and document critical overlaps between tools/concepts, marking them as open questions for clarification
- Document supervision strategies for multi-process workflows (clear separation of concerns)
- Clarify architectural terminology and concept boundaries
```

**B. Add to task requirements:**
```markdown
- Handle critical overlaps by either: (a) explicitly distinguishing between competing approaches via clear documentation, or (b) marking them as open questions for resolution
- Implement supervision strategies that maintain system integrity across process failures
- Update documentation/concepts to reflect new architecture while preserving essential intent
```

### Implementation Tips:

**For documentation refresh projects specifically:**

**1. Common Critical Overlaps to Watch For:**

**A. Native vs. External Tools:**
- Chronos's native LSP refactoring vs. LeanCTX `ctx_refactor`
- Internal tool vs. external MCP server capability overlap
- Custom implementation vs. library/alternative choice

**B. Supervision conflicts:**
- Process management conflicts in multi-author or multi-process workflows
- Failure handling across distributed systems
- Resource contention between competing tools

**C. Terminology conflicts:**
- Metaphorical vs. literal architectural concepts
- Competing naming conventions for similar features
- Ambiguous conceptual boundaries

**2. Documentation Project Templates:**

**A. Archive Template for New Projects:**
```markdown
## Global Constraints

- Preserve existing [DOCUMENTATION TYPE] lore but clarify [Concept X] is [Architecture Y]
- Follow existing [DOCUMENTATION FORMAT] style: frontmatter, wikilinks, wikilink sections
- Russian for conceptual/lor docs, English for technical/rfc documentation
- Keep Mermaid diagrams, tables for classification
- Preserve :eagle: icons and aphorisms from [SOURCE]
- Maintain [EXISTING MODEL] semantics but adapt to new model
- Update from [OLD ARCHITECTURE] to new architecture
- Replace [OLIVE COMPONENT] with new architecture
- Rewrite for [NEW TECHNOLOGY] with [NEW PATTERN] registration
- Preserve existing classifications but adapt to [NEW CLASSIFICATION MODEL]
- Preserve [EXISTING ROLE] role
- Keep self-improving capabilities
- Ensure new documentation supports both [EXISTING SYSTEM] and [NEW SYSTEM]
- Implement workspace specialization ([AREA1]/[AREA2]/[AREA3])
- Ensure new documentation mentions both existing Schema specifications and new [NEW FEATURE] modifications
- Ensure implementation builds to [TECH_REQUIREMENT]
- Update to explicit use of `sync`-read and `async`-write for write lock model
- Include new internal tools for auditing and provenance
- Preserve [EXISTING INTEGRATION] but clarify new tier model
- Add new files for new concepts: [NEW CONCEPTS LIST]

## Critical Overlap Detection

### Documentation Projects with Competing Tools/Concepts

- Add to Global Constraints: "Identify and document critical overlaps between tools/concepts, marking them as open questions for clarification"
- Add to task requirements: "Handle critical overlaps by either: (a) explicitly distinguishing between competing approaches via clear documentation, or (bition (RFC-002 §7 as open question (Tier-2 watcher overhead on large monorepos) - with LSP this will be felt earlier and more severely than with ordinary file operations because LSP servers are themselves heavyweight processes."

## Implementation Pattern:

1. **Documentation Phase Checklist:**
   - Phase 1: Files to preserve (lore-only investigation)
   - Phase 2: Complete rewriting of core architecture documents
   - Phase 3: RFC documentation rewriting
   - Phase 6: New concept documentation

2. **Critical Overlap Documentation Requirements:**
   - Document native vs. external tool overlaps
   - Document supervision strategy conflicts
   - Document architectural terminology ambiguities

3. **Verification Criteria:**
   - ✅ All files requiring preservation → marked for Phase 1
   - ✅ All files requiring rewriting → assigned to Phase 2-3
   - ✅ All new files required → documented in Phase 6
   - ✅ All critical overlaps addressed
   - ✅ Global constraints and style guides integrated

## Key Deliverables:

**A. Implementation Plan Documentation:**
- Comprehensive implementation plan with architecture changes
- Phase 6: New Concept Documentation (all required files)
- Critical Overlap issues (identification, resolution strategy)
- Preservation requirements for existing lore/structure
- Master brief §5 compliance (new architecture, tier model, components)

**B. Documentation Project Patterns:**
- Global Constraints templates for projects with competing tools
- Critical overlap detection strategies
- Supervision strategy documentation patterns
- Documentation preservation requirements
- Example patterns from Chronos documentation refresh

**C. Quality Assurance:**
- Verification script that checks all critical requirements
- Critical overlap documentation validation
- Architecture compliance verification
- Style and formatting validation

## Project-Specific Considerations:

**For projects following master brief patterns:**
- Use Phase headings in Task Structure to organize by preservation/rewrite/create categories
- Document critical overlaps as part of deliverables
- Include supervision strategies in documentation
- Follow established patterns from similar projects

**For projects with native/external tool competition:**
- Implement clear distinction via documentation
- Mark unresolved overlaps as open questions
- Document supervision strategies for process failures
- Preserve existing functionality while introducing new approaches

## Success Criteria:

**A. Implementation Requirements Met:**
- All files properly categorized (preserve/rewrite/create)
- Critical overlaps documented and addressed
- New architectural concepts thoroughly documented
- Existing functionality preserved where required

**B. Quality Metrics:**
- Complete implementation plan with all required sections
- Critical overlap detection and resolution strategy
- Architecture compliance verification
- Style and format consistency with existing documentation

**C. Verification:**
- All verification checks pass
- Critical overlap resolution documented
- Implementation meets master brief requirements
- Documentation quality standards met

## Next Steps:

1. **Add critical overlap detection to Global Constraints** for the specific project
2. **Include critical overlap documentation in task requirements**
3. **Implement documentation patterns for the project type**
4. **Include verification scripts** to validate critical requirements
5. **Document supervision strategies** for multi-process workflows
6. **Include references** to similar project patterns and implementation guidance

This ensures that critical overlaps are identified early, well-documented, and either resolved through clear distinction or marked as open questions for resolution later in the project lifecycle.

## Critical Overlap Handling for Documentation Projects

**For documentation projects with competing tools/concepts:**
- Add to Global Constraints: "Identify and document critical overlaps between tools/concepts, marking them as open questions for clarification"
- Add to task requirements: "Handle critical overlaps by either: (a) explicitly distinguishing between competing approaches via clear documentation, or (b) marking them as open questions for resolution"

**Supervision strategy documentation:**
- Add to Global Constraints: "Document supervision strategies for multi-process documentation workflows (e.g., 'Each LSP/IDE process is an independent stateful worker; system should handle partial process failures')"
- Include supervision patterns as part of deliverables: "Implement supervision strategies that maintain documentation integrity across process failures"

**Implementation tip:** In documentation refresh projects, critical overlaps often emerge between:
- Native documentation tools and external MCP documentation servers
- Supervision strategies for multi-author or multi-process documentation workflows
- Architectural concepts with competing terminology or mental models

**Template update for critical overlap detection:**
- Add "Review existing documentation for critical overlaps (conflicting tools, supervision concerns)" to task requirements
- Add "Document critical overlaps with clear distinction or resolution requirements" as part of deliverables

For example, in the Chronos documentation refresh, critical overlaps included:
- LeanCTX `ctx_refactor` competing with Chronos's native LSP refactoring
- Supervision strategy for maintaining documentation integrity across LSP process failures
- Architectural terminology conflicts (e.g., "Vessel Engine" as body concept)

Always document critical overlaps explicitly in the implementation plan and include them in deliverables as either resolved distinctions or open questions for resolution.
