---
name: documentation-investigation
description: Systematic methodology for investigating, extracting, and organizing technical documentation across software projects. Provides comprehensive research, API specification discovery, and documentation analysis workflows.
---

# Documentation Investigation Skill

## Purpose

This skill provides systematic methodology for investigating, extracting, and organizing technical documentation across software projects. It's designed for comprehensive research, API specification discovery, and documentation analysis.

## When to Use

Use this skill when you need to:

- Investigate technical documentation for software projects
- Extract API specifications and interface details
- Analyze project architectures and design patterns
- Compare competing tools or implementations
- Identify documentation gaps or inconsistencies
- Conduct comprehensive technical research workflows
- Understand project documentation for onboarding or maintenance

## Investigation Workflow

### Phase 1: Discovery

1. **Multi-source Information Gathering**
   - Official documentation and specifications
   - Community discussions and forums
   - GitHub repositories and source code
   - Technical blogs and articles
   - User testimonials and reviews

2. **Pattern Recognition**
   - Identify recurring architectural patterns
   - Recognize common design solutions
   - Document decision rationales
   - Create taxonomy of findings

3. **Cross-Verification**
   - Validate information across multiple sources
   - Check for inconsistencies and contradictions
   - Verify against working implementations

### Phase 2: Analysis

1. **Technical Architecture Investigation**
   - Component identification and relationships
   - Data flow analysis
   - Dependency mapping
   - Performance considerations

2. **API Specification Extraction**
   - Endpoint discovery and documentation
   - Method signatures and return types
   - Parameter validation rules
   - Authentication patterns

3. **Competitive Analysis**
   - Tool feature comparison
   - Performance benchmarking
   - Compatibility assessment

### Phase 3: Synthesis

1. **Documentation Organization**
   - Create logical hierarchy and structure
   - Apply consistent formatting
   - Establish cross-references
   - Document assumptions

2. **Knowledge Extraction**
   - Pull actionable insights
   - Summarize key findings
   - Identify trends
   - Distill complex information

## Quality Assurance
   - Verify accuracy and completeness
   - Check for clarity and readability
   - Ensure consistency
   - Validate against sources

### Documentation–Code Synchronization (Doc Audit)

A specialized quality-assurance workflow for keeping documentation files in sync with actual source code. This applies when the project has both `.md` documentation describing internals (API signatures, architecture, edge-cases, test counts) and a living codebase that drifts from the docs over time.

**When to use**: The user asks you to "sync docs with code", "verify docs are correct", "check if docs match source", or "update stale documentation". Also applicable on doc-targeted PRs where you need to audit what changed.

**Workflow**:

```
Read All Docs → Read All Source → Cross-Reference → Update → Verify → Commit
```

**Step 1: Read all documentation files**
   - Read every `.md` file under the doc directory. Note the full scope upfront — you cannot cross-reference what you haven't read.
   - Pay special attention to: API/function signatures, struct/enum definitions, test counts, edge-case tables, architecture claims, and any `pub fn`/`pub struct`/`pub enum` listings in prose.

**Step 2: Read all source files**
   - Read every source file (`src/*.rs`, `*.py`, etc.) that corresponds to the docs.
   - For Rust projects, `lib.rs` is the module map — start there to confirm the module structure.

**Step 3: Cross-reference across these dimensions:**

   | Dimension | What to check | How |
   |---|---|---|
   | **API signatures** | Every `pub fn`, `pub struct`, `pub enum` mentioned in docs | Match parameter types, return types, field names exactly against the source |
   | **Test counts** | Numbers like "16 tests", "23 tests" in docs | `grep -c '#\[test\]' src/*.rs` or `cargo test -p <crate> 2>&1 \| tail -5` for the real count |
   | **Edge-case tables** | Each row in a documented edge-case table | Trace the code path that handles each case; confirm the stated behavior matches `if/else` branches, `match` arms, or test assertions |
   | **Descriptions** | Module-level doc comments, algorithm descriptions | Compare the doc's prose against the actual implementation logic — e.g. does `split_lines` really return `(&'static str, bool)`? |
   | **Architecture claims** | Module dependencies, pure vs stateful claims | Check `use` statements, `pub(crate)` visibility, and `#[cfg(test)]` isolation |
   | **Code comments vs doc text** | Doc comments (`//!` / `///`) in source vs prose in `.md` | Read the source comment and the doc side-by-side on key sections |

**Step 4: Validate with the test runner**
   - Run `cargo test -p <crate>` to confirm the actual test count.
   - Cross-check the per-module breakouts: count `#[test]` annotations per file or run the test runner and observe per-module totals.
   - A discrepancy in count (doc says 23, source has 21) is the most common doc-code mismatch.

**Step 5: Fix discrepancies**
   - Use `patch` for targeted edits — one fix per call.
   - Prefer updating the DOC to match the code, not vice versa (unless documentation described a planned feature that was intentionally not built).
   - After each fix, re-read the affected section to verify coherence.

**Step 6: Verify and commit**
   - Run `git diff --stat` to preview the change set before committing.
   - Use a conventional commit message: `docs(<crate>): <description>`
   - Confirm the tests still pass with `cargo test`.

**Common pitfalls:**
   - A doc that says "23 tests" that splits into "5-6 per language" — the per-language count may be approximate (e.g. "5-6 each") while the total must be exact. Always compute the actual total from the source, don't assume the doc's total is correct and the per-language is wrong.
   - Historical (pre-implementation) design documents are explicitly labelled as such and should only be updated if they contain concrete factual errors about what was built, not to retrofit implementation details that were post-hoc decisions.
   - `str::lines()` does not produce an extra empty final line from a trailing `\n` — any doc describing line splitting semantics should be checked against this behavior.
   - After fixing a test count, re-check all other docs that mention it (e.g. a README that totals module counts) — fixing one may cascade to others.
   - Edge-case tables in docs often duplicate the test list. If the doc claims N edge-cases are "covered by tests", verify by grep-ing the test module for those specific scenarios.

## Key Investigation Categories

### Technical Architecture
- System component discovery and mapping
- Architecture pattern identification
- Design decision documentation
- Integration point analysis
- Performance considerations

### API Specifications
- Endpoint discovery and documentation
- Method signatures and return types
- Parameter definitions and validation
- Authentication and security patterns
- Error handling and logging

### Competitive Analysis
- Tool comparison matrices
- Performance benchmarks
- Compatibility testing
- Market positioning

## Investigation Process

### Systematic Investigation Steps

1. **Define Scope**
   - What needs to be discovered
   - Success criteria
   - Resource constraints

2. **Multi-source Research**
   - Official documentation
   - Community sources
   - Comparative analysis

3. **Cross-Verification**
   - Validate findings
   - Check for contradictions
   - Test implementations

4. **Documentation Synthesis**
   - Organize findings
   - Extract insights
   - Ensure consistency

### Quality Checkpoints

- Accuracy verification
- Completeness assessment
- Clarity evaluation
- Consistency validation

## Investigation Examples

### Example 1: Zed AI Assistant Architecture Investigation

**Investigation Findings**:

1. **Entity-Based State Management (GPUI)**
   - All major components are GPUI `Entity<T>` with `Context<T>` for updates
   - `Thread` / `AcpThread` for conversation state
   - `BufferCodegen` / `CodegenAlternative` for inline editing
   - `InlineAssistant` (global) for multi-editor coordination

2. **Streaming Architecture**
   - Core events: `LanguageModelCompletionEvent` enum (Text, Thinking, ToolUse, UsageUpdate, Compaction)
   - Text streaming: `LanguageModelTextStream` wraps `BoxStream<Result<String>>`
   - Real-time diffs: `StreamingDiff` produces `CharOperation` and `LineOperation`
   - mpsc channels bridge background streaming to UI thread

3. **Context Injection Pattern**
   - `LoadedContext` built from `MentionSet` (user-attached files/symbols/threads/diagnostics)
   - Formatted into structured XML tags (`<files>`, `<symbols>`, `<diagnostics>`, etc.)

4. **Multi-Alternative Generation**
   - `BufferCodegen` spawns primary + alternative models in parallel
   - User cycles through alternatives with Tab/Shift+Tab

5. **Tool Permission System**
   - `ToolPermissionScope`: ToolInput | SymlinkTarget | AgentSkills
   - `PermissionOptions` with `PermissionOptionKind`: AllowOnce | AllowAlways | RejectOnce | RejectAlways
   - Shell-aware "always allow" for terminal commands

**Reference**: See `references/zed-ai-assistant-architecture.md` for detailed file map and integration notes.

---

### Example 2: Chronos-IDE Investigation

**Investigation Findings**:

1. **Architecture Documentation**: Partial completeness
   - Found: README.md overview
   - Missing: API specifications
   - Issue: Component interactions undocumented

2. **Tool Competition**: Critical competition identified
   - ⚠️ LeanCTX `ctx_refactor` MCP tool competes with native LSP refactoring
   - Status: Requires explicit documentation
   - Impact: Potential integration conflicts

3. **External MCP Integrations**: 3 systems found
   - LeanCTX: LSP/IDE refactoring service
   - Engram: Event/provenance system
   - codebase-tools: Codebase indexing service
   - Status: Documentation organization needed

### Investigation Checklist

```
□ Review official documentation sources
□ Check community discussions and forums
□ Analyze GitHub repositories and issues
□ Collect technical blog and article insights
□ Cross-reference information for accuracy
□ Identify architectural patterns
□ Extract API specifications
□ Compare competing solutions
□ Document assumptions and limitations
□ Organize findings systematically
□ Validate completeness
□ Prepare recommendations
```

## Investigation Best Practices

### Planning

1. **Clear Objectives**
   - Define what to discover
   - Set success criteria
   - Consider constraints

2. **Appropriate Methods**
   - Multi-source gathering
   - Cross-verification
   - Systematic analysis

3. **Quality Criteria**
   - Accuracy thresholds
   - Completeness requirements
   - Documentation standards

### Execution

1. **Systematic Documentation**
   - Record all sources
   - Track investigation process
   - Document assumptions

2. **Structured Approach**
   - Follow systematic methodology
   - Apply consistent analysis
   - Document findings comprehensively

3. **Verification Process**
   - Cross-reference sources
   - Test with implementations
   - Document validated findings

## Investigation Success Indicators

### Quality Measures

- **Completeness**: 90%+ coverage of critical aspects
- **Accuracy**: All findings verified
- **Clarity**: Documentation easily understandable
- **Consistency**: Uniform format and structure

### Effectiveness Indicators

- **Efficiency**: Investigation completed within timeframe
- **Effectiveness**: All objectives achieved
- **Utility**: Results useful for intended purposes
- **Sustainability**: Documentation maintained over time

## Integration with Other Skills

### Complementary Skills

- **philip-main**: Audits/rewrites docs from code evidence — pair with investigation when docs need fixing
- **writing-plans**: Uses investigation findings to structure the implementation plan
- **executing-plans**: Executes the plan that investigation informed
- **systematic-debugging**: Provides context for investigation before debugging
- **brainstorming**: Uses investigation to guide brainstorming outcomes

### Workflow Integration

```
1. brainstorming: Identify investigation questions and scope
2. writing-plans: Structure investigation objectives and timeline into a plan
3. documentation-investigation: Conduct thorough investigation
4. systematic-debugging: Use investigation findings to inform debugging approach
```

## Investigation Templates

### Investigation Report Template

```
# Technical Investigation Report

## Executive Summary
- Investigation scope
- Key findings summary
- Critical recommendations

## Technical Architecture
### System Components
- Component details
- Integration points

## API Specifications
### Endpoints
- Endpoint specifications
- Parameter details

## Competitive Analysis
### Tool Comparison
- Features and capabilities
- Performance benchmarks

## Investigation Findings
### Finding Category
- Finding description
- Source attribution
- Impact assessment
- Verification status

## Recommendations
### Immediate Actions
- Action items
- Implementation steps

### Long-term Improvements
- Strategic recommendations
- Future considerations
```

## Investigation Challenges

### Common Pitfalls

1. **Information Overload**
   - Strategy: Systematic filtering
   - Technique: Prioritize and categorize

2. **Verification Difficulty**
   - Strategy: Cross-reference validation
   - Technique: Multiple source verification

3. **Documentation Inconsistency**
   - Strategy: Identify and document discrepancies
   - Technique: Track source versions

## Success Criteria

### Documentation Quality

- Completeness: 90%+ coverage of critical aspects
- Accuracy: All findings verified against sources
- Clarity: Easily understandable documentation
- Consistency: Uniform format and structure

### Investigation Effectiveness

- Efficiency: Investigation completed within timeframe
- Effectiveness: All objectives achieved
- Utility: Documentation useful for intended purposes
- Sustainability: Documentation maintained over time

---
**References**: Based on best practices for technical documentation investigation and systematic research methodologies.
**Last Updated**: Current investigation methodologies and techniques.
