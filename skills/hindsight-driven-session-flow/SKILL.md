---
name: hindsight-driven-session-flow
description: Structured workflow for using all Hindsight memory tools (recall, retain, reflect, documents, directives, mental models) throughout a coding session
---

## Purpose

This skill defines a structured workflow for using the Hindsight memory system (MCP server) throughout a coding session. It ensures the agent loads context before acting, stores durable facts after learning them, and periodically synthesizes knowledge for deeper reasoning.

---

## Core Session Flow

Every task follows this lifecycle:

```
1. RECALL  ->  2. WORK  ->  3. REFLECT  ->  4. RETAIN
```

### Step 1: RECALL (Before acting)

Load relevant context before answering or making changes.

```
recall(query="user's request + relevant keywords", budget="high")
```

- Use `query` as a natural-language search across all stored memories.
- Set `budget` to `high` for the initial call of each task (catches broader context).
- Use `types` parameter to filter: `['world', 'experience', 'observation']`.
- Use `tags` or `tag_groups` to scope results to a specific project, e.g. `tags: ['project:chronos']`.
- Use `min_scores` to filter low-relevance noise when results are noisy.

**Rules:**
- Always call `recall` at the start of every user request.
- If the user mentions a person, project, or concept you might have seen before, include it in the query.
- Ignore recalled facts that are clearly stale or irrelevant; do not repeat them to the user unless asked.

### Step 2: WORK (Do the task)

Execute the coding task using normal tools (`read_file`, `edit_file`, `grep`, `terminal`, etc.).

- While working, note durable facts: user preferences, architectural decisions, bugs discovered, conventions learned.
- Do NOT retain trivial or ephemeral state (e.g. "I just ran `ls`").

### Step 3: REFLECT (After significant work)

Synthesize what you learned into deeper analysis.

```
reflect(query="What patterns emerged in this session?", budget="high")
```

**When to reflect:**
- After completing a non-trivial change.
- When you need to reason across multiple memories to answer a question.
- When the user asks for a recommendation based on past decisions.

**Difference from recall:**
- `recall` = raw fact lookup (fast).
- `reflect` = reasoning across memories (deep analysis).

Use `reflect` for "what should I do?" and `recall` for "what did I say about X?"

### Step 4: RETAIN (After learning something durable)

Store facts that should survive across sessions.

```
retain(
    content="Fact to remember",
    context="work" | "preferences" | "family" | "general",
    tags=["project:alpha"],
    metadata={"source": "code-review"}
)
```

**What to retain:**
- User's coding preferences (language, style, tooling).
- Architectural decisions and rationale.
- Project-specific conventions.
- Bugs discovered and their root causes.
- People, relationships, or roles mentioned.
- Goals, plans, or future intentions.
- Milestones and completed work.

**What NOT to retain:**
- Temporary file contents or shell output.
- Intermediate debugging steps (only the final conclusion).
- Information already captured in a previous retain call.

**Rules:**
- Call `retain` at the end of each session or after significant discoveries.
- Do NOT mention retain/recall/reflect operations to the user unless they ask.

---

## Memory Types

Hindsight stores three types of facts:

| Type | Description | Example |
|------|-------------|---------|
| `world` | Objective facts about the external world | "The project uses C++20" |
| `experience` | User's personal history or events | "User contributed to llama.cpp in Jan 2025" |
| `observation` | Derived insights (auto-generated, not directly stored) | Patterns inferred from world+experience facts |

When using `retain`, the system auto-classifies. You can override with `strategy` if needed.

---

## Document Management

Use documents to group related memories (e.g. per session or per conversation).

```
retain(content="...", document_id="session-2025-01-15")
list_documents(q="session")
get_document(document_id="session-2025-01-15")
delete_document(document_id="session-2025-01-15")
```

---

## Directives

Directives guide how the memory engine processes queries and generates reflections.

```
list_directives()
create_directive(
    name="Focus on performance",
    content="When reflecting, prioritize performance-related trade-offs.",
    priority=10,
    tags=["project:chronos"]
)
delete_directive(directive_id="d-abc123")
```

---

## Mental Models (Pinned Reflections)

Living documents that stay current by periodically re-running a source query through `reflect`.

```
list_mental_models()
create_mental_model(
    name="Coding Preferences",
    source_query="What coding patterns, languages, and tools does the user prefer?",
    tags=["user:preferences"]
)
refresh_mental_model(mental_model_id="coding-preferences")
update_mental_model(
    mental_model_id="coding-preferences",
    name="Updated Name",
    tags=["user:preferences", "project:alpha"]
)
clear_mental_model(mental_model_id="coding-preferences")
delete_mental_model(mental_model_id="coding-preferences")
```

**Best practices:**
- Create mental models for recurring questions: user preferences, project goals, architecture decisions.
- Set `trigger_refresh_after_consolidation: true` on models that auto-update after memory consolidation.
- Keep `source_query` specific enough to produce focused output.

---

## Async Operations

Retain and model refresh run asynchronously:

```
list_operations(status="pending")
get_operation(operation_id="op-xyz")
cancel_operation(operation_id="op-xyz")
```

For blocking operations, use `sync_retain` instead of `retain`.

---

## Bank Configuration

```
get_bank()
update_bank(
    name="New Bank Name",
    config_updates={
        "reflect_mission": "Focus on software architecture",
        "retain_extraction_mode": "verbose",
        "disposition_skepticism": 4
    }
)
delete_bank()
```

---

## Tag Conventions

```
project:<name>    - project-specific memories
user:<id>         - user-specific memories
session:<date>    - session-scoped memories
```

---

## Memory Editing and Lifecycle

```
update_memory(memory_id="m-abc", text="Corrected fact", context="work")
invalidate_memory(memory_id="m-abc", reason="outdated")
invalidate_memory(memory_id="m-abc", restore=True)
clear_memories(type="world")
```

---

## Full Session Example

```
recall(query="user's coding project preferences", budget="high")
recall(query="chronos engine architecture decisions", budget="high")

read_file(path="Chronos-Engine/src/main.cpp")
edit_file(path="Chronos-Engine/src/main.cpp", edits=[...])
terminal(command="cmake --build build", cd="Chronos-Engine")

reflect(query="What architectural patterns does this project follow?", budget="high")

retain(
    content="Chronos-Engine uses CMake with C++20. Build dir is 'build/'",
    context="work",
    tags=["project:chronos"]
)
retain(
    content="User prefers surgical minimal edits over large refactors",
    context="preferences"
)
```

---

## Rules of Thumb

1. Always RECALL first - never answer from scratch when memories might help.
2. RETAIN last - capture what you learned before ending the turn.
3. Use REFLECT for reasoning - not just fact lookup.
4. Do not mention memory operations to the user unless asked.
5. Do not over-retain - one durable fact per topic, not a stream of trivia.
6. Use documents to group session-specific work.
7. Use mental models for recurring synthesis questions.
8. Use directives to steer reflection behavior per project.
9. Check async ops after retain if you need the result immediately (or use `sync_retain`).
10. Prefer structured tags for consistent scoping across all tools.
