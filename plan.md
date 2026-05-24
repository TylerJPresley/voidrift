# VoidRift: Foundation Build Plan

## How to Use This Document

Read top-to-bottom. Each section has a distinct role:

| Section | Role | Trust for |
|---------|------|-----------|
| **2. System Behavior** | What the finished system *does* | How to decide what's in scope |
| **3. Quality & Decision Framework** | Standards and decision rules | How to make decisions during implementation |
| **4. Design Targets** | What to build, where it came from, and why | How to implement each subsystem |
| **5. Exclusions** | What was considered but deliberately deferred | What is *not* in scope for the foundation |
| **6. Build Order** | The sequence you execute on | Just order — nothing here adds or removes requirements |

### Rules

1. **The milestones are build order, not scope.** The requirements in Section 2 are the source of truth. If a milestone conflicts with a requirement, the requirement wins.
2. **Exclusions are not TODOs.** They are deliberate scope boundaries. Moving something from Exclusions to Build Order requires a deliberate scope discussion.
3. **Design targets are the target, not a constraint.** If an approach differs from the target, note why — don't quietly diverge.
4. **Never edit Section 2 or 3 without discussion.** These are the steering. Everything else flows from them.

---

## 1. Vision & Scope

**Goal:** Build a minimal, stable VoidRift development harness capable of serving as a framework for other projects. Self-bootstrap is explicitly excluded from this scope until the foundation is verified stable.

**Core Principle:** Start completely fresh. Do not patch existing broken code. Design and build each component from the ground up using `@google/gemini-cli-core` and the Gemini CLI as architectural references.

---

## 2. System Behavior

The system is a CLI/TUI development harness. It is designed as a scaffold for the agentic loop, where the intelligence (Gemini Core) is the engine and VoidRift is the steering and dashboard.

The foundation scope is a **working chat loop**: user types → model responds → response streams → tool calls execute with confirmation → session persists. Everything else is deferred to Phase 5+.

### 2.1 Model Connection

- The system connects to any OpenAI-compatible, Anthropic, or Gemini-compatible endpoint via the standard `ContentGenerator` interface.
- No code changes are needed when switching endpoints.
- The model endpoint configuration lives in `~/.voidrift/config.json` with bundled defaults as fallback.
- The system supports both single-shot requests (`generateContent`) and streaming responses (`generateContentStream`).
- Token counting is available for context window management.

### 2.2 Tool Execution

- The system can call tools during model generation and receive results back.
- Tool calls appear in the TUI with status indicators (pending → executing → success/error).
- The user can confirm, deny, or permanently approve tools via keyboard-navigable overlays.
- The system handles multiple tool calls per response with queue progress.
- Tool execution follows the full loop: model proposes tool → TUI shows confirmation → user approves → tool executes → result flows back to model → model continues.

### 2.3 Chat Loop

- A user inputs text and sees the model's response stream in real-time.
- Completed messages are retained in session history.
- The system supports both a full TUI and headless mode (`voidrift --headless "message"`).
- In headless mode, output goes to stdout.

### 2.4 Session Management

- Conversation history is maintained per session.
- Sessions persist across restarts as JSON files.
- On launch, the system offers to resume the previous session or start a new one.
- The system tracks context window usage with color-coded percentage display.

### 2.5 Error Handling

- If the model endpoint is unreachable, the TUI shows a clear error state.
- The system handles generation interruptions (Ctrl+C) gracefully.
- Partial or truncated responses are handled without crashing the UI.

### 2.6 Architecture

The system has four strict layers:

1. **Operator** (TUI or headless CLI)
2. **VoidRift Harness** (core, adapters, tui, governance, modes, memory, commands)
3. **gemini-cli-core** (npm dependency — agent loop, tools, scheduler, policy, compression, events)
4. **Model Endpoints** (external — local vLLM, Ollama, or cloud APIs)

VoidRift owns layer 2. Nothing in layer 2 modifies layer 3 or 4.

**Complete package map:**

| Package | Type | Depends On | Purpose |
|---------|------|------------|---------|
| `@voidrift/core` | Infrastructure | gemini-cli-core | Config bridge, workflow objects, adapter factory |
| `@voidrift/openai-adapter` | Adapter | gemini-cli-core, openai | OpenAI ContentGenerator |
| `@voidrift/anthropic-adapter` | Adapter | gemini-cli-core, @anthropic-ai/sdk | Anthropic ContentGenerator |
| `@voidrift/tui` | Frontend | core, governance, modes, memory | Ink terminal UI |
| `@voidrift/governance` | System | gemini-cli-core | Context window partition |
| `@voidrift/modes` | System | governance | Built-in mode cycling |
| `@voidrift/memory` | System | governance | Persistent memory operations |
| `@voidrift/commands` | System | core, modes | Development command pipeline |
| `@voidrift/cli` | Entry | core, tui, commands | CLI entry point and launcher |

**Foundation scope** (what's built now):

| Package | Type | Depends On | Purpose |
|---------|------|------------|---------|
| `@voidrift/core` | Infrastructure | gemini-cli-core | Config bridge, adapter factory, tool registry, session manager |
| `@voidrift/openai-adapter` | Adapter | gemini-cli-core, openai | OpenAI ContentGenerator (streaming) |
| `@voidrift/anthropic-adapter` | Adapter | gemini-cli-core, @anthropic-ai/sdk | Anthropic ContentGenerator (streaming) |
| `@voidrift/tui` | Frontend | core | Ink terminal UI with streaming, tool display, session history |
| `@voidrift/cli` | Entry | core, tui | CLI entry point, session launch, TUI bootstrap |

**Deferred from foundation scope:** `modes`, `memory`, `commands`, `governance` — not needed to get chat working.

The adapter contract defines the boundary between VoidRift and model endpoints:

```typescript
interface ContentGenerator {
  generateContent(request, promptId, role): Promise<GenerateContentResponse>
  generateContentStream(request, promptId, role): Promise<AsyncGenerator<GenerateContentResponse>>
  countTokens(request): Promise<CountTokensResponse>
  embedContent(request): Promise<EmbedContentResponse>
}
```

Any adapter implementing this interface is a valid model connection. No code changes to core are needed to add a new endpoint.

**Integration flow:**

```
CLI (voidrift)
  → Config loading (~/.voidrift/config.json, bundled defaults)
  → Adapter factory (model → ContentGenerator)
  → Session manager (create, hold history)
  → TUI launch (Ink App)
       │
       ├─ MessageInput ──→ submit ──→ session.sendMessage()
       │                                                    │
       ├─ ContentGenerator.stream(request) ──→ chunks ──→│
       │                                                    │
       └─ TUI render loop: pendingHistoryItems (live) + Static (completed)
```

**Key interfaces:**

1. `session.sendMessage(text: string)` — accepts text, calls model, returns when generation is complete
2. `ContentGenerator.stream(request)` — yields chunks as they arrive, fires events for tool calls
3. `TUI.submit(text)` → renders user message → streams response in `pendingHistoryItems` → moves to static on completion

### 2.7 Quality Goals

| Priority | Quality Attribute | Scenario |
|----------|------------------|----------|
| 1 | Extensibility | Adding a new development command requires only a new package — no changes to core, TUI, or other commands. |
| 2 | Model Agnosticism | Any OpenAI-compatible, Anthropic, or Gemini endpoint works without code changes. |
| 3 | Governance Integrity | Governance content survives context compaction across arbitrarily long sessions. |

### 2.8 Constraints

- **Resource-First:** Everything (prompts, templates, configuration) must be a resource. Hardcoded strings in source code are a violation.
- **Resource Convention:** Each package owns its resources: `*-prompt.md` for agent instructions, `*-template.md` for output formats. Resolution order: `~/.voidrift/resources/<package>/<file>` overrides bundled defaults.
- **Event-Driven:** State changes must be driven by explicit lifecycle events. No "fire-and-forget" sends.
- **Event Flow:**
  ```
  AgentSession.send(message)
    → core streams GenerateContentResponse chunks
    → coreEvents emits: UserFeedback, ModelChanged, RetryAttempt
    → TUI subscribes and renders

  Tool call in response
    → core's Scheduler evaluates policy
    → MessageBus emits TOOL_CONFIRMATION_REQUEST
    → TUI renders confirmation prompt
    → TUI sends TOOL_CONFIRMATION_RESPONSE
    → core executes or denies tool
  ```

---

## 3. Quality & Decision Framework

This section defines the quality standards and decision-making rules that apply while building the foundation. It sits between the "what" (Section 2) and the "where from" (Section 3).

### 3.1 Quality Principles (from START.md)

**Design:**
- **SOLID** — single responsibility, clear abstractions
- **DRY** — shared logic lives in one place
- **KISS** — simplest solution that works

**Implementation:**
- Fix upstream contracts (prompts, schemas, formats) before adding code complexity
- Remove dead code and its tests
- Write tests for every new public function, class, and module
- Tests in `tests/` matching source structure (`core/loop.ts` → `tests/loop.test.ts`)
- One test per acceptance criterion minimum

**Safety:**
- Require confirmation before running destructive commands (force push, rm -rf, clean -fd, branch -D)
- "Should work" is not evidence. Run the command. Read the output.
- Every task completion must provide logs, test results, or git diff as proof of success.

### 3.2 Living Artifacts

ARCHITECTURE.md, REQUIREMENTS.md, and README.md are half the solution — not supplementary. Every code change updates the affected documents.

- **REQUIREMENTS.md** — the contract. What the system does, why, and acceptance criteria.
- **ARCHITECTURE.md** — the blueprint. Component design, data flows, key decisions.
- **README.md** — the user manual. How to install, configure, and use the project.

If a document doesn't exist yet, create it when the project needs it. If a component boundary shifts, update the architecture *now*, not later.

### 3.3 Decision Rules

When a design choice is unclear, apply these tiebreakers in order:

1. **Constraints beat design targets.** If a design target conflicts with a constraint (resource-first, protocol-agnostic, public API only, no stubs), the constraint wins.
2. **Design targets beat milestones.** A milestone says "build X." The design target says *how* to build X. If the milestone approach diverges from the target, follow the target.
3. **Milestones are build order, not scope.** Nothing in the build order section adds or removes requirements.
4. **No hardcoded strings.** Resource-first means every prompt, template, and configuration string lives in a file. Source code is a routing layer, not a content layer.
5. **No modifying layer 3 or 4.** gemini-cli-core is an npm dependency. Only its public exports are consumed. If you need more, write an adapter or extension — don't modify the dependency.
6. **Evidence over assertion.** "Should work" is not evidence. Run the test. Read the output.

### 3.4 Quality Gates

Every change passes through domain-specific quality gates. These are not optional — they define the quality standards for each change area.

| Change area | Quality gates |
|-------------|---------------|
| **Any change** | Post-flight checklist (tests, docs, ACs), requirements format validation |
| **Agent loop** (`agent/`) | Workflow patterns, reliability engineering |
| **Tools** (`tools/`) | Security trust, backend engineering standards |
| **Commands** (`commands/`) | Backend engineering, systems engineering |
| **CLI entry / headless** (`index.ts`) | Systems engineering |
| **TUI** (`tui/`) | Backend engineering standards |
| **Architecture / design** | Design architecture standards |

### 3.5 Change Workflow (from CONTRIBUTING.md)

Every change follows this pipeline. No exceptions:

```
Diagnose → Propose → [operator approval]
              │
              ▼
       Write Requirements → [operator approval]
              │
              ▼
         Implement → Verify → Document → Self-Review
              │
              ▼
         Commit → Summarize
```

**Pre-flight:** Root cause traced. Solution proposed and operator approved. Requirement exists with EARS notation and BDD acceptance criteria. Architecture reflects the component being changed.

**Post-flight:** All ACs satisfied. Tests pass. REQUIREMENTS.md, ARCHITECTURE.md, and README.md updated. Confidence ≥ 90%.

**Commit convention:** Reference AC IDs in messages. Stage specific files — no `git add .`.


---

## 4. Design Targets

Every subsystem has a design target. The reference architecture is `@google/gemini-cli-core` — the shared core that both Qwen Code and Gemini CLI derive from. Qwen Code extends the core with additional features. Claude Code deviates from the core with its own approach.

Design targets are annotated with their origin:

- **Gemini Core** — the standard. All tools that share this pattern derive it.
- **Gemini Core + Qwen** — the core with Qwen's extension on top.
- **Deviation** — a departure from the Gemini Core standard. Noted for awareness, not adopted.

When Gemini CLI and Qwen Code both implement the same pattern, it confirms the pattern is part of the core standard. When only Claude Code does something differently, it's a deviation — not a shared target.

### 4.1 Tool System

The tool system is the bridge between the model's output and the harness's actions. It's the most complex part of the foundation because it has the most feedback loops.

**Source:** Gemini Core's `ToolRegistry` and `ToolConfirmationQueue` (shared by both Gemini CLI and Qwen Code).

#### 4.1.1 Tool Registry

Tools are registered in core via `ToolRegistry`. Each tool has:

| Field | Type | Purpose |
|-------|------|---------|
| `name` | `string` | Unique identifier, used in tool calls |
| `description` | `string` | Prompt-level description the model uses to decide whether to call the tool |
| `parameters` | `Record<string, Schema>` | JSON Schema object describing the tool's input. The model generates these arguments. |
| `executes` | `(args, context) => Promise<string>` | The actual implementation. Takes parsed arguments and session context, returns output as a string. |

Registration pattern:

```typescript
registry.register({
  name: 'bash',
  description: 'Execute a shell command...',
  parameters: {
    command: { type: 'string', description: 'The command to execute' },
  },
  execute: (args) => { ... }
})
```

Tools are discovered by the model via the `tool_call` schema in the model response. The model does not know about tools until the registry tells it what's available.

#### 4.1.2 Built-in Tools (Foundation Scope)

Tools match Claude Code's actual tool set — Gemini Core doesn't prescribe specific tools, only the registry interface. Claude Code's five-tool set is the right default: bash for everything else, specialized tools when the model benefits from structured input.

**Foundation tools (implemented now):**

| Name | Description | JSON Schema Parameters | Auto-approve? |
|------|-------------|----------------------|---------------|
| `bash` | Execute shell commands. Captures stdout, stderr, exit code. Timeout and size limits enforced. | `{ "command": { "type": "string", "description": "The shell command to execute" } }` | No — always confirmed |
| `read` | Read a file at the given path. Supports read ranges. | `{ "path": { "type": "string", "description": "Path to the file to read" } }` | Yes — read-only |
| `write` | Overwrite a file at the given path. Creates parent directories if needed. | `{ "path": { "type": "string", "description": "Path to the file to write" }, "content": { "type": "string", "description": "The content to write" } }` | No — always confirmed |
| `edit` | Make surgical edits to a file. Replaces exact text with new text at a specified location. | `{ "path": { "type": "string", "description": "Path to the file" }, "old_text": { "type": "string", "description": "Exact text to find and replace" }, "new_text": { "type": "string", "description": "Replacement text" } }` | No — always confirmed |
| `glob` | Find files matching a glob pattern. | `{ "pattern": { "type": "string", "description": "The glob pattern to match" } }` | Yes — read-only |

**Rationale:** These 5 tools give the model full filesystem access through bash, plus structured operations (read, write, edit, glob) when precision matters. The model chooses which tool to use — it can read a file with `bash: cat file` or with the `read` tool. No more or fewer tools.

**Deferred tools (Phase 5+):**

| Name | Description |
|------|-------------|
| `web_fetch` | Fetch a URL and return the content |
| `web_search` | Search the web and return results |
| `ask_user` | Ask the user a question, wait for response |
| `think` | Show thinking/reasoning content (collapsed by default) |

These are not in the foundation because they don't make the chat loop work. They become visible once chat works end-to-end.

#### 4.1.3 Tool Execution Flow

The full loop is multi-step and asynchronous:

```
1. Model responds with tool_calls in the response
2. Core detects tool_calls, creates ToolCallState for each
3. Core fires TOOL_CALL_EVENTS to TUI
4. TUI renders tool group with status: Pending → Confirming → Executing → (Success | Error)
5. If confirmed (or auto-approved for safe commands):
   a. ToolExecutor executes the tool with parsed arguments
   b. Result is collected as ToolResult (stdout/stderr/exitCode or error)
   c. Core fires TOOL_RESULT_EVENT back to TUI (result rendered)
   d. Core sends all ToolResult objects back to the model as input
   e. Model continues generating with the results
6. If denied, ToolResult contains an error, Core sends to model, model continues
7. Loop repeats until the model returns text_only (no tool_calls) — generation complete
```

**Concurrency (Gemini Core):** Tools declare `concurrency: 'concurrent' | 'exclusive'`. Concurrent-safe tools run in parallel; exclusive tools serialize. When an exclusive tool errors, pending siblings are cancelled. Progress messages are streamed before full results.

**The key insight:** `session.sendMessage()` doesn't return until the *entire loop* completes (steps 1–7 repeat until no more tool_calls). Each iteration is a separate API call.

#### 4.1.4 Tool Call Data Structure

```typescript
interface ToolCall {
  id: string          // Unique within this response
  name: string        // Registered tool name
  args: Record<string, unknown> // Parsed arguments
  state: ToolCallState // Pending | Confirming | Executing | Success | Error | Denied
}

interface ToolResult {
  toolCallId: string
  content: string     // Serialized tool output
  isError: boolean
}
```

A single model response can contain multiple `tool_call` entries. Each is tracked independently with its own state. When the loop continues, all pending ToolResults are bundled and sent to the model as a single batch.

#### 4.1.5 Tool Grouping in the UI

Tools are rendered in the TUI as a single group (bordered container) with individual tool status inside. Tool calls from the same model response are grouped together. Tool calls from later iterations (after results were sent back) are shown after the completed group.

**Source:** Gemini Core's `ToolConfirmationQueue` with multi-tool queue progress. Qwen extends this with compact mode (single-line summary). The foundation uses expanded mode by default.

#### 4.1.6 Tool Confirmation Policy

Tools require user confirmation before executing. Gemini Core's model is simpler than Claude Code's — user approval with no auto-approval for dangerous tools. The structure supports future expansion to racing approvals.

**Confirmation rules:**

| Tool | Confirmation mode | Rationale |
|------|-------------------|-----------|
| `bash` | Always confirmed | Execution of arbitrary commands |
| `write` | Always confirmed | File modification |
| `edit` | Always confirmed | File modification |
| `read` | Auto-approved | Read-only operation |
| `glob` | Auto-approved | Read-only operation |

**Confirmation overlay behavior:**
1. **Confirming state** — tool is ready to execute, waiting for user approval
2. **Options:** "Allow once" (approve just this one), "Allow always" (never ask for this tool again), "Deny" (reject)
3. **Multi-tool queue** — when multiple tools need confirmation simultaneously, only the first Confirming tool gets keyboard focus. Subsequent Confirming tools are in queue and shown in order.
4. **Auto-approval** — safe tools (read, glob) execute without showing the overlay

**Qwen extension:** "Modify with external editor" as an additional confirmation option. Not in foundation.

**Claude deviation:** Racing approval mechanism where multiple sources compete (user, preToolUse hooks, bash classifier). Folder-level and session-level persistence. The foundation starts with Gemini Core's simpler confirmation flow — user-only approval with "allow always" option.

#### 4.1.7 Tool Display (Result Rendering)

After a tool executes, its result is rendered in the TUI as part of the message history. The tool result appears within the assistant's response bubble — the user sees: model text → tool call → tool result → model continues. All in the same message flow.

**Source for display:** Gemini Core's result classification — tool output is classified into rendering strategies based on content type.

**Result classification and rendering:**

| Classification | When it applies | How it renders |
|----------------|-----------------|-----------------|
| **plain** | Tool output is short text (< 50 chars) or simple stdout | Rendered as plain text, inline with the tool name |
| **markdown** | Output contains markdown formatting | Parsed and rendered with the same markdown parser as assistant text |
| **code** | Output is code-like (bash output, file contents) | Rendered in a code block with syntax highlighting if applicable |
| **diff** | Output contains diff-like text (from `write` tool) | Rendered as a diff view with +/- highlighting |
| **shell** | Tool output is terminal-like (bash with ANSI codes, progress indicators) | Rendered with shell output styling, stats bar showing duration and size |
| **truncated** | Output exceeds display limits (> 500 lines or > 100KB) | Shows first 50 lines, truncated indicator ("... showing 50 of 200 lines"), expandable |

**Status indicators per tool:**
- **Pending** (yellow) — tool has been called but not yet confirmed/executing
- **Executing** (yellow spinner) — tool is running
- **Success** (green checkmark) — tool completed successfully
- **Error** (red X) — tool failed with an error

Each tool status row shows:
- Status icon (check/spinner/X)
- Tool name
- Elapsed time (e.g., "0.2s")
- Status label (Success/Error/Executing)

**Compact vs expanded mode:**
- **Expanded (default)** — full tool name, command/arguments, result content rendered inline
- **Compact** — single-line summary: `✓ bash (0.2s)` or `✗ write (error: permission denied)`

The foundation uses expanded mode by default. Compact mode is deferred to Phase 5+ as a Qwen extension.

**Tool results in message history:**
Tool results are appended to the message history as part of the assistant's turn. The structure is:

```
Assistant: "I'll read the file and make changes..."
  → Tool: read (path: src/main.ts)
  → Result: [file content]
Assistant: "I'll update the file now..."
  → Tool: edit (path: src/main.ts, old/new text)
  → Result: File edited successfully
Assistant: "Done!"
```

Each tool/result pair is visible in the message history. The user can scroll through the full conversation to see what tools were called and what they returned. This is how the user verifies the model is doing what they expect.

### 4.11 Streaming Markdown (Target: Claude Code — Deviation)

**Source:** `tui.md` — Claude Code's stable/unstable split. **Not Gemini Core.**

**Target behavior:** Only the unstable (growing) tail is re-parsed on each stream event. The stable prefix is memoized. This preserves markdown structure (unclosed code fences, incomplete lists) correctly.

**Why this source:** Claude Code's approach is more sophisticated than Gemini Core's "split at code block boundaries" because it preserves markdown structure at token boundaries instead of text boundaries. **Adopted despite being a deviation because it's objectively better.** Gemini Core's split is simpler but produces incorrect results for unclosed code fences and incomplete lists.

**Status:** The foundation adopts this approach even though it deviates from Gemini Core. Gemini Core's approach (split at safe text boundaries) is the baseline — this is a deliberate improvement over the core.

### 4.12 Streaming State Machine (Target: Gemini Core)

**Source:** Gemini Core's `StreamingContext` — shared by both Gemini CLI and Qwen Code identically.

**Target behavior:** Three-state model: `Idle` → `Responding` → `WaitingForConfirmation`. Transitions driven by events from core.

**Status:** **Core standard.** Both Gemini CLI and Qwen Code use this identical pattern. No deviation.

### 4.13 Pending vs Static Split (Target: Gemini Core)

**Source:** Gemini Core's use of Ink `<Static>` — shared by both Gemini CLI and Qwen Code identically.

**Target behavior:** Completed history renders via Ink `<Static>` for one re-render of all items. Live content stays in `pendingHistoryItems` and re-renders on each update.

**Status:** **Core standard.** Both implementations share this exact pattern. No deviation.

### 4.14 Tool Confirmation (Target: Gemini Core — ToolConfirmationQueue)

**Source:** Gemini Core's `ToolConfirmationQueue` — shared by both Gemini CLI and Qwen Code.

**Target behavior:** Shows tool name, description, diff preview, and options. Handles shell, edit, sandbox expansion, ask_user, and MCP tools. Supports permanent approval for trusted folders, session-level approval, and tool-specific approval for MCP. Multi-tool queue with "N of M" progress.

**Status:** **Core standard.** Both Gemini CLI and Qwen Code share this pattern. The queue management is core functionality.

### 4.15 Diff Rendering (Target: Gemini Core)

**Source:** Gemini Core's `DiffRenderer` component — shared by both Gemini CLI and Qwen Code.

**Target behavior:** Unified diff view with "Allow once", "Allow for session", "Allow permanently", "No, suggest changes".

**Status:** **Core standard.** Both implementations share this exact component.

### 4.16 Markdown Rendering (Target: Gemini Core — hand-written parser)

**Source:** Gemini Core's hand-written markdown parser with `lowlight` + `highlight.js` for code syntax highlighting — shared by both Gemini CLI and Qwen Code.

**Target behavior:** Headers, code blocks, tables, lists, inline formatting. Code syntax highlighting with `lowlight` + `highlight.js`. Theme-aware colorization via `resolveColor()`.

**Status:** **Core standard.** Gemini CLI and Qwen Code both use this hand-written parser. Claude Code uses `marked` + `cli-highlight` (hybrid) — a different approach but equally valid. Both work.

### 4.17 Session Persistence (Target: Gemini Core)

**Source:** Gemini Core's session persistence — shared by both Gemini CLI and Qwen Code.

**Target behavior:** Sessions stored as JSON chat records. Full session persistence with resume capability.

**Status:** **Core standard.** Both implementations converge on JSON persistence. No deviation.

### 4.18 Input System (Target: Gemini Core)

**Source:** Gemini Core's `InputPrompt` — shared by both Gemini CLI and Qwen Code with identical structure.

**Target behavior:** `InputTextBuffer` with cursor tracking, line-based storage, vim-mode, history, and shell-mode. Both have 20+ slash commands. @-file references for file content injection.

**Status:** **Core standard.** Gemini CLI and Qwen Code share nearly identical input architecture. Qwen adds follow-up suggestions (Phase 5+). Start with core.

### 4.19 Footer / Status Line (Target: Claude Code — Deviation)

**Source:** `tui.md` — Claude Code's `StatusLine` component, debounced 300ms. **Not Gemini Core.**

**Target behavior:** A full-width horizontal rule separates the footer from the content area. Below it, a left/right split:
- **Left:** `[mode] voidrift · model · ◎ context% · 🛡 governance_tokens`
- **Right:** `~/workspace · branch`

Context utilization is color-coded (green < 50%, yellow < 80%, red ≥ 80%). A blank line separates the footer from the input prompt below.

**Why this source:** Claude Code's footer is the most information-dense while remaining readable. Context visualization grid is deferred, but the status line itself is the target.

**Status:** **Deviation adopted.** Gemini Core has a simpler footer. Claude Code's is richer. Adopt the Claude Code version for the foundation with the left/right layout defined above.

### 4.20 Message History Navigation (Target: Gemini Core)

**Source:** Gemini Core — both Gemini CLI and Qwen Code support scrolling through message history.

**Target behavior:** Arrow key navigation between messages. Page-up/page-down through history. G/g for top/bottom. Scroll back during streaming (before response completes). The completed messages in `<Static>` are scrollable but don't re-render on each stream tick.

**Status:** **Core standard.** Both implementations converge on this pattern. It's the minimum viable history for a usable chat UI — without it, you're locked at the bottom.

### 4.21 Submit/Cancel Flow (Target: Gemini Core)

**Source:** Gemini Core's `InputPrompt` — input handling for both Gemini CLI and Qwen Code.

**Target behavior:** Enter → submit message to model. Ctrl+C → abort generation, return to idle. Escape → cancel input (restore previously submitted message). Shell mode (! prefix) → background PTY process. @-file references → inject file content into message. Submission undo: if user submits then immediately presses Escape, restore the message to the input buffer.

**Status:** **Core standard.** Both implementations share this pattern. Submission undo is a Gemini Core feature.

### 4.22 Error State (Target: Gemini Core)

**Source:** Gemini Core — both Gemini CLI and Qwen Code handle API errors during streaming identically.

**Target behavior:** Error path in the TUI state machine. Clear error display when API returns an error (connection refused, rate limit, model unavailable). Disconnected state when the model endpoint goes down mid-stream. "Model changed" state when switching endpoints mid-session.

**Status:** **Core standard.** Both implementations converge on error display in the TUI. Without it, a failed request leaves the user stuck in "Responding" state.

---

## 5. Exclusions

These build on the foundation but are not needed to get chat working. They move to the Phase 5+ backlog once the foundation is stable.

**Deferred from architecture:**
- `modes` (built-in mode cycling)
- `memory` (persistent memory operations)
- `commands` (development command pipeline)
- `governance` (context window partition)

**Deferred features (nice-to-haves):**
- Session browser (full list editor with search, sort, pagination)
- Session history UI (resume picker, search)
- Themes (semantic colors, theme-manager)
- Vim mode (full state machine in input)
- Follow-up suggestions (AI-predicted prompts when idle)
- Multi-agent / arena mode
- Context visualization (/context breakdown)
- Clipboard / image paste

**Considered but rejected for foundation:**
- Claude Code's Ink fork (vendored fork with cell-level blitting) — over-engineered for foundation, Ink + hooks is sufficient
- Gemini's session browser — useful but not needed to get chat working
- Qwen's multi-agent architecture — useful but not needed to get chat working

The foundation is complete when the chat loop works end-to-end. Everything else is a Phase 5+ feature.

---

## 6. Build Order

The milestones are build order. Nothing here adds or removes requirements from Section 2.

### 6.1 Phase 1: Workspace Setup (DONE)

Clean root directory, three-package workspace (core/, tui/, cli/), 31 passing tests (scaffold verification only).

### 6.2 Phase 2: Core Infrastructure — Model Connection

**Goal:** Core can connect to a model and get back structured content. No TUI yet.

| # | Milestone | What's built | How we verify it |
|---|-----------|--------------|-----------------|
| 2.1 | **Config bridge** | `Config` resolves from `~/.voidrift/config.json` → fallback defaults. Model endpoint, API key, model name all loadable. | `bun test` reads config, verifies all fields resolved |
| 2.2 | **Adapter factory** | `AdapterFactory.create(type)` returns a live `ContentGenerator` connected to the real endpoint (local vLLM or cloud). No stubs. | Unit test creates adapter, calls `countTokens()` on a known string, gets back a real count |
| 2.3 | **Streaming adapter** | `ContentGenerator.stream()` yields chunks in real-time. Handles `GenerateContentResponse` → chunk transformation. | Integration test sends a short prompt, asserts first chunk arrives within N seconds |
| 2.4 | **Tool registry** | Tools registered in core. `ToolExecutor` can invoke built-in tools (exec, read, write) and return results to the model. | Test registers a tool, sends a prompt that triggers it, verifies result is returned |
| 2.5 | **Session manager** | `Session` holds conversation history (messages array), knows which model/adapters to use. `sendMessage(text)` runs the full loop: send → stream response → handle tool calls → return complete result. | Test sends a message, gets a response back. Asserts history has 2 entries (user + assistant) |

**Definition of "done" — Phase 2:**
- All 5 milestones pass `bun test`
- `tsc --noEmit` zero errors
- No stubbed functions remain
- Integration tests 2.3 and 2.5 hit real endpoints (not mocks)

### 6.3 Phase 3: TUI Streaming — Text Appears

**Goal:** User types in TUI → model responds → response streams visibly in the terminal.

| # | Milestone | What's built | How we verify it |
|---|-----------|--------------|-----------------|
| 3.1 | **Streaming state machine** | Three-state TUI state: `Idle` → `Responding` → `WaitingForConfirmation`. Transitions driven by events from core. | Unit test fires stream events, asserts state transitions |
| 3.2 | **Pending/static split** | `pendingHistoryItems` for live text, `Static` for completed messages. Safe markdown boundary detection (`findLastSafeSplitPoint` equivalent). | Integration test streams 50 lines of text, asserts first 30 appear in pending, completed blocks move to static |
| 3.3 | **Markdown rendering** | Hand-written markdown parser: headers, code blocks, lists, inline formatting, code syntax highlighting (lowlight + highlight.js). | Snapshot test renders markdown, asserts Ink component output matches expected structure |
| 3.4 | **User message → model → TUI loop** | `MessageInput` submits text → TUI calls `session.sendMessage()` → streaming response renders in real-time | End-to-end test (mock model) sends text, verifies response appears in TUI DOM |
| 3.5 | **Streaming status line** | Footer shows: elapsed time, token count (if available), model name, streaming indicator (spinner/cycling phrase). Debounced 300ms updates. | Integration test asserts status line updates during streaming, stops after completion |

**Definition of "done" — Phase 3:**
- User can open TUI, type a message, and see the model's response stream in real-time
- Streaming status line updates during generation
- Completed messages render as static content (no flicker on re-render)
- All tests pass, zero TypeScript errors

### 6.4 Phase 4: TUI Tool Flow & CLI Entry — Chat is Complete

**Goal:** Tools execute, get confirmed, return results to the model. CLI launches the full app.

| # | Milestone | What's built | How we verify it |
|---|-----------|--------------|-----------------|
| 4.1 | **Tool execution → TUI** | Tool call from model → TUI renders tool group with status indicators (pending → executing → success/error) → user confirms/denies → result flows back to model | Integration test: model calls a tool, TUI renders it, user approves, result returned to model |
| 4.2 | **Confirmation overlay** | Modal overlay shows tool details + options (allow once, allow always, deny). Keyboard-navigable (arrow keys, Enter, Escape). | Unit test renders overlay, verifies focus management, keybinding behavior |
| 4.3 | **Session persistence** | Session history saved as JSON on session end. "Welcome back" prompt on next launch offering to resume. | Test saves session, reloads, asserts history is restored with all messages |
| 4.4 | **CLI entry point** | `voidrift` binary initializes config, creates session, launches TUI. Signal handling (Ctrl+C to abort generation). | Manual test: run `voidrift`, TUI appears, Ctrl+C stops generation |
| 4.5 | **Headless mode** | Same pipeline but without TUI — raw output to stdout. `voidrift --headless "message"` | Test runs headless, asserts stdout contains response text |

**Definition of "done" — Phase 4:**
- `voidrift` command launches a usable chat app
- Full loop works: user message → model response → tool execution → user confirmation → result → model continues
- Session persists across restarts
- Zero TypeScript errors, all tests pass
- **Confidence ≥ 90%**

---

## 7. Quality Criteria

- **TypeScript:** Zero errors (`tsc --noEmit`)
- **Tests:** All pass (`bun test`)
- **Confidence Threshold:** ≥ 90% before considering foundation stable
- **No Stubs:** Every exported function has real implementation
- **No TODOs:** No placeholder implementations left in source
- **Review Gates:** Each phase requires review before advancing

---

## 8. Current Status

| Status | Task | Notes |
|--------|------|-------|
| ✅ | Clean root directory | Moved old code to _BAK/ |
| ✅ | Extracted foundational constraints | Into plan.md |
| ✅ | Deferred ideas moved to `ideas/` | 14 ideas tracked |
| ✅ | Updated target architecture | Three-package structure |
| ✅ | Removed TODO.md | Simplified ARCHITECTURE.md, README.md |
| ✅ | Analyzed all three TUI implementations | `tui-analysis.md` — shared foundation confirmed |
| ✅ | Created workspace structure | core/, tui/, cli/ with package.json |
| 🔄 | Fix workspace imports | Using package names instead of relative paths |
| ⬚ | **Phase 2.1** Config bridge | `~/.voidrift/config.json` → defaults |
| ⬚ | **Phase 2.2** Adapter factory | `AdapterFactory.create()` → live ContentGenerator |
| ⬚ | **Phase 2.3** Streaming adapter | `stream()` yields chunks from real endpoint |
| ⬚ | **Phase 2.4** Tool registry | Built-in tools + ToolExecutor |
| ⬚ | **Phase 2.5** Session manager | Full send → stream → tool handle → return loop |
| ⬚ | **Phase 3.1** Streaming state machine | Idle → Responding → WaitingForConfirmation |
| ⬚ | **Phase 3.2** Pending/static split | Live text → pendingHistoryItems, completed → Static |
| ⬚ | **Phase 3.3** Markdown rendering | Parser + syntax highlighting (lowlight) |
| ⬚ | **Phase 3.4** User message → TUI loop | End-to-end message rendering |
| ⬚ | **Phase 3.5** Streaming status line | Footer with elapsed time, model, indicator |
| ⬚ | **Phase 4.1** Tool execution → TUI | Tool call renders as group with status |
| ⬚ | **Phase 4.2** Confirmation overlay | Keyboard-navigable modal |
| ⬚ | **Phase 4.3** Session persistence | JSON save/restore |
| ⬚ | **Phase 4.4** CLI entry point | `voidrift` launches TUI + signal handling |
| ⬚ | **Phase 4.5** Headless mode | Raw stdout output mode |
| ⬚ | Final verification | Confidence ≥ 90%, zero TS errors |

---

## 9. Notes

- **Runtime:** Bun (not node)
- **Build:** esbuild
- **Tests:** Vitest
- **Config:** JSON only
- **Framework:** Ink (React-in-terminal)
- **Core dependency:** `@google/gemini-cli-core` via npm (never modified)
- **Path separation:** Framework metadata → `~/.config/voidrift/`, CLI runtime → `.voidrift/`
- **Skills path:** `.voidrift/resources/skills/` — 18 skills map to change areas
- **Model adapter:** OpenAI + Anthropic adapters, Gemini via core's built-in ContentGenerator
- **Testing:** 31 tests pass (bun test), but only verify scaffolding — not actual model wiring or behavior
