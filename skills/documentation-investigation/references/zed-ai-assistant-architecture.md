# Zed AI Assistant Architecture Research Notes

**Session**: Monday, July 06, 2026  
**Scope**: Investigation of Zed's AI assistant system across `crates/agent/`, `crates/agent_ui/`, `crates/copilot*`, `crates/language_model*`

---

## Key Architectural Patterns Discovered

### 1. Entity-Based State Management (GPUI)
All major components are GPUI `Entity<T>` with `Context<T>` for updates:
- `Thread` / `AcpThread` for conversation state
- `BufferCodegen` / `CodegenAlternative` for inline editing
- `InlineAssistant` (global) for multi-editor coordination
- `MessageQueue` for follow-up message handling

### 2. Streaming Architecture
- **Core events**: `LanguageModelCompletionEvent` enum (Text, Thinking, ToolUse, UsageUpdate, Compaction, etc.)
- **Text streaming**: `LanguageModelTextStream` wraps `BoxStream<Result<String>>` with token usage tracking
- **Real-time diffs**: `StreamingDiff` produces `CharOperation` (Insert/Delete/Keep) and `LineOperation` for live editor updates
- **mpsc channels** bridge background streaming to UI thread

### 3. Context Injection Pattern
```rust
LoadedContext { text: String, images: Vec<LanguageModelImage> }
    → add_to_request_message(&mut LanguageModelRequestMessage)
```
User mentions (files, symbols, threads, diagnostics, etc.) collected via `MentionSet`, formatted into structured XML tags (`<files>`, `<symbols>`, `<diagnostics>`, etc.)

### 4. Multi-Alternative Generation
`BufferCodegen` spawns primary + alternative models in parallel:
```rust
alternatives: Vec<Entity<CodegenAlternative>>  // one per model
active_alternative: usize                       // user cycles with Tab/Shift+Tab
```

### 5. Tool Permission System
- `ToolPermissionScope`: ToolInput | SymlinkTarget | AgentSkills
- `PermissionOptions` with `PermissionOptionKind`: AllowOnce | AllowAlways | RejectOnce | RejectAlways
- Shell-aware "always allow" for terminal commands (POSIX chaining detection)

---

## File Reference Map

| Area | Key Files | Description |
|------|-----------|-------------|
| **Agent Core** | `crates/agent/src/thread.rs:8210` | Message types, context building, tool handling |
| | `crates/agent/src/agent.rs:6925` | NativeAgent, session management, model registry |
| **Agent UI** | `crates/agent_ui/src/conversation_view.rs:11136` | Thread management, message queue, conversation state |
| | `crates/agent_ui/src/conversation_view/thread_view.rs:12461` | Rendering, spinners, tool calls, plans, compaction |
| | `crates/agent_ui/src/buffer_codegen.rs:2019` | Inline streaming, diff application, tool handling |
| | `crates/agent_ui/src/inline_assistant.rs:2163` | Multi-editor coordination, block insertion |
| | `crates/agent_ui/src/inline_prompt_editor.rs:1826` | Prompt UI, model selector, completion states |
| | `crates/agent_ui/src/context.rs:62` | LoadedContext, context loading from mentions |
| | `crates/agent_ui/src/message_editor.rs:5766` | Message editor, slash commands, mention handling |
| | `crates/agent_ui/src/conversation_view/message_queue.rs:191` | FIFO queue with ProcessingState (AutoProcess/Paused/AbsorbingCancel) |
| **Language Model** | `crates/language_model/src/language_model.rs:497` | LanguageModel trait, stream_completion, stream_completion_text |
| | `crates/language_model_core/src/language_model_core.rs:699` | LanguageModelCompletionEvent, TokenUsage, StopReason, ToolUse |
| | `crates/language_model_core/src/request.rs:591` | LanguageModelRequest, MessageContent, ToolResult |
| **ACP Thread** | `crates/acp_thread/src/acp_thread.rs:9972` | AcpThread, AgentThreadEntry, ToolCall, ContextCompaction |

---

## Integration Notes for Chronos

### Recommended Adoption

1. **Adopt `LanguageModelCompletionEvent`** as standard streaming event type
2. **Use `LoadedContext` pattern** for context injection — clean separation
3. **Implement `StreamingDiff`** for real-time inline editing diffs
4. **Entity-based architecture** with GPUI Context/Entity for state
5. **Message queue with ProcessingState** for follow-up handling during generation
6. **Multi-alternative generation** pattern for showing users options
7. **Tool permission system** with shell-aware "always allow"

### Key Types to Port/Adapt

```rust
// Streaming
LanguageModelCompletionEvent, LanguageModelTextStream, LanguageModelRequest
Message, UserMessage, AgentMessage, UserMessageContent, AgentMessageContent
LoadedContext, MentionUri, ToolCall, ToolCallStatus

// UI State
CodegenStatus, ProcessingState, CompletionState
GeneratingSpinner / SpinnerVariant

// Editor Integration
BufferCodegen, CodegenAlternative, StreamingDiff, LineOperation
InlineAssistTarget, InlineAssistant, PromptEditor
```