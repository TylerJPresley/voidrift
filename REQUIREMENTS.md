# Requirements: VoidRift Development Harness

## 1. Introduction

- **Purpose:** A development harness built on `@google/gemini-cli-core` that provides a stable chat interface for interacting with AI models across multiple protocols. Gemini core handles the agentic plumbing — agent loop, tools, scheduler, policy, compression, events. VoidRift builds the development-specific features on top: modes, governance, memory, development commands, and a custom TUI that surfaces all of it natively.
- **Project Scope:** VoidRift provides the TUI, model adapters, governance/modes/memory system, development commands, and configuration. Gemini core is an npm dependency — never modified. AI models are external — the operator provisions endpoints. The harness is model-agnostic: any OpenAI-compatible, Anthropic, or Gemini endpoint works.
- **Foundation Scope:** This specification defines the foundation — a complete chat interface that connects to models, formats output, executes tools, and supports MCP servers. Development commands, modes, governance layers, and workflow objects are out of scope for the foundation and will be added in later iterations.

## 2. User Stories

- **As an** operator, **I want to** use any model (local vLLM, cloud API) with the harness, **so that** I can optimize for cost, speed, or capability per task.
- **As an** operator, **I want to** see streaming responses rendered as markdown in the terminal, **so that** I can read model output formatted correctly.
- **As an** operator, **I want to** execute tools (file reads, writes, shell commands) with confirmation, **so that** I control what the model does.
- **As an** operator, **I want to** connect MCP servers to the agent, **so that** I can provide additional capabilities to the model.
- **As an** operator, **I want to** persist and restore sessions, **so that** I can continue conversations across restarts.
- **As an** operator, **I want to** run any capability headless from the CLI, **so that** I can integrate the harness into CI/automation workflows.

## 3. External Interfaces

- **User Interfaces:** Custom TUI (Ink/React) for interactive use. Headless CLI for automated/CI execution.
- **Software/API Interfaces:**
  - `@google/gemini-cli-core` — npm dependency, public API only
  - OpenAI-compatible chat completions API (via adapter)
  - Anthropic Messages API (via adapter)
  - Gemini native API (via core's built-in ContentGenerator)
  - MCP servers (JSON-RPC protocol)
- **Communication Protocols:** HTTP/HTTPS to model API endpoints. JSON-RPC 2.0 for MCP server communication.

## 4. Core Infrastructure

### 4.1 Path System

- **REQ-PATH-1:** THE SYSTEM SHALL maintain a single source of truth for all directory paths via a centralized path configuration.
  - *Rationale:* Prevents path duplication and inconsistency across subsystems. If the base path changes, every component uses the same configuration.

- **REQ-PATH-2:** THE SYSTEM SHALL store framework metadata in `~/.config/voidrift/`.
  - *Rationale:* Separates framework state from user workspace state. Prevents collision when VoidRift develops VoidRift (self-bootstrap scenario).

- **REQ-PATH-3:** THE SYSTEM SHALL store CLI runtime artifacts in `.voidrift/` within user workspaces.
  - *Rationale:* Keeps per-project state local to the workspace, adhering to standard CLI tool patterns (e.g., `node_modules/`, `.git/`).

- **REQ-PATH-4:** THE SYSTEM SHALL NOT create `.voidrift/` in the framework source tree.
  - *Rationale:* Prevents the self-bootstrap collision where framework metadata collides with runtime artifacts.

- **REQ-PATH-5:** Framework metadata SHALL include ideas, change requests, tasks, and analysis reports.

- **REQ-PATH-6:** CLI runtime artifacts SHALL include model configuration, session data, and cache.

### 4.2 Bootstrap Configuration

- **REQ-BOOT-1:** WHEN the system starts, THE SYSTEM SHALL construct a Gemini core `Config` object from VoidRift's JSON configuration using only core's exported `Config` constructor and public utilities.
  - *Rationale:* Ensures strict dependency boundary. VoidRift never modifies core internals; it consumes only the public API.

- **REQ-BOOT-2:** THE SYSTEM SHALL wire model (via adapter factory), workspace root, session ID, event emitter, tool registry, policy engine, and memory content to the `Config` object.
  - *Rationale:* Decouples the TUI from core. The TUI provides the configuration; core owns the agent loop.

- **REQ-BOOT-3:** Google-specific fields (auth, billing, telemetry) SHALL use safe defaults or be omitted.
  - *Rationale:* Allows VoidRift to run independently of Google infrastructure. The operator provisions their own endpoints, not Google's internal auth.

- **REQ-BOOT-4:** THE SYSTEM SHALL ensure `getBaseLlmClient()` never throws during initialization.

- **REQ-BOOT-5:** THE SYSTEM SHALL inject the `ContentGenerator` into the `Config` object.

- **REQ-BOOT-6:** THE SYSTEM SHALL initialize the `Config` after injection.

### 4.3 Model Adapter Factory

- **REQ-ADAPT-1:** THE SYSTEM SHALL support two model protocols through adapter plugins: OpenAI-compatible and Anthropic. Each adapter SHALL implement Gemini core's `ContentGenerator` interface.
  - *Rationale:* Covers the primary endpoints (local vLLM, cloud APIs) for the foundation. The `ContentGenerator` interface ensures interchangeable adapters.
  - Given a model configured with `protocol: openai`, When the adapter factory resolves it, Then an OpenAI ContentGenerator is returned.
  - Given a model configured with `protocol: anthropic`, When the adapter factory resolves it, Then an Anthropic ContentGenerator is returned.
  - Given any ContentGenerator, When the agent loop calls `generateContentStream`, Then it receives `GenerateContentResponse` objects regardless of the underlying protocol.

- **REQ-ADAPT-2:** THE SYSTEM SHALL provide a factory that resolves the appropriate adapter by `protocol` string.
  - *Rationale:* Decouples protocol selection from the rest of the system. Adding a new protocol requires only a new factory case, not changes to the core logic.
  - Given a model is configured with `protocol: openai`, When the factory is called with `protocol: openai`, Then it returns an OpenAI adapter instance.
  - Given a model is configured with `protocol: anthropic`, When the factory is called with `protocol: anthropic`, Then it returns an Anthropic adapter instance.
  - Given an unknown protocol is requested, When the factory is called, Then it throws a descriptive error.

- **REQ-ADAPT-3:** WHEN translating requests to a provider, THE SYSTEM SHALL translate between provider wire format and `@google/genai` types.
  - *Rationale:* Abstracts provider quirks. Core operates on `@google/genai` types; adapters handle the wire format. This prevents core from depending on specific provider SDKs.
  - Given a Gemini request with system instruction, When translated to OpenAI, Then the OpenAI request has a system message.
  - Given a Gemini request with function call content, When translated to Anthropic, Then the Anthropic request has `tool_use` content blocks.
  - Given a Gemini request with tool result content, When translated to OpenAI, Then the OpenAI request has `tool` role messages.
  - Given a Gemini request with Anthropic function response content, When translated, Then Anthropic receives `tool_result` content blocks.

- **REQ-ADAPT-4:** THE SYSTEM SHALL support streaming responses chunk-by-chunk as an async generator.
  - Given a streaming request, When processed by the adapter, Then chunks are yielded incrementally as `GenerateContentResponse` objects.
  - Given a non-streaming request, When processed by the adapter, Then a single `GenerateContentResponse` is returned.

- **REQ-ADAPT-5:** WHEN tool call arguments arrive as partial JSON fragments across multiple chunks, THE SYSTEM SHALL accumulate and parse them correctly.
  - *Rationale:* Streaming networks can produce malformed JSON across chunks. The adapter must reconstruct the complete tool call before yielding.
  - Given tool call arguments split across 3 chunks, When all chunks arrive, Then the complete parsed arguments are returned.
  - Given interleaved text and tool call deltas in the same stream, When processed, Then text and tool calls are separated correctly.
  - Given malformed JSON in tool call arguments, When parsing fails, Then an error is returned to the agent — not a crash.

- **REQ-ADAPT-6:** THE SYSTEM SHALL estimate token counts for models that do not support a token counting endpoint using character-based estimation.
  - *Rationale:* Some providers do not expose token counts in the API response. Character-based estimation provides a consistent way to track context window usage across all models.
  - Given a request with text content, When `countTokens` is called, Then an estimated token count is returned.

- **REQ-ADAPT-7:** WHEN translating tool definitions from Gemini's `FunctionDeclaration`, THE SYSTEM SHALL convert them to the provider's tool format.
  - Given Gemini tool definitions with JSON Schema parameters, When translated to OpenAI, Then OpenAI function definitions have matching parameter schemas.
  - Given Gemini tool definitions, When translated to Anthropic, Then Anthropic tool definitions have `input_schema` matching the original JSON Schema.

- **REQ-ADAPT-8:** THE SYSTEM SHALL update `usageMetadata` in the response with prompt, completion, and total token counts.
  - Given a provider that returns usage in streaming responses, When the stream completes, Then actual token counts are available in `usageMetadata`.
  - Given a provider that does not return usage, When the stream completes, Then `usageMetadata` reflects the character-based estimate.

### 4.4 Resource Convention

- **REQ-RES-1:** ALL text sent to a model SHALL be loaded from editable resource files in `resources/`. The system SHALL NOT contain hardcoded prompt strings.
  - *Rationale:* Hardcoded strings are difficult to maintain and modify. Loading from files allows operators to customize behavior without modifying source code.

- **REQ-RES-2:** PROMPTS SHALL support template variables resolved at runtime. A missing variable SHALL raise an error.
  - *Rationale:* Template variables allow dynamic content (e.g., file paths, project names) to be injected into prompts. Raising an error on missing variables prevents silent failures where a prompt renders as "undefined."
  - Given a prompt containing `{file_path}`, When resolved with `file_path="src/main.ts"`, Then `{file_path}` is replaced with `src/main.ts`.
  - Given a prompt containing `{missing_var}`, When resolved without that variable, Then an error is raised.

### 4.5 System Boundary

- **REQ-BOUND-1:** THE SYSTEM SHALL use `@google/gemini-cli-core` as an npm dependency installed via `bun add`, consuming only its public API exports. Core source SHALL NOT exist in the project tree — it lives in `node_modules/` like any other dependency.
  - *Rationale:* An npm dependency is a hard boundary — models cannot modify files in `node_modules/`. Pinning to Google's release cadence means VoidRift benefits from upstream improvements without maintaining a fork or submodule.
  - Given `@google/gemini-cli-core` is listed in `package.json`, When VoidRift imports from it, Then only symbols exported from the package's public API are used.
  - Given a new Gemini core version is published, When `bun add @google/gemini-cli-core@latest` is run, Then VoidRift's tests pass without changes to VoidRift source.

- **REQ-BOUND-2:** THE SYSTEM SHALL provide a single executable that serves both interactive TUI and headless command execution. WHEN run with no arguments, THE SYSTEM SHALL open the interactive TUI. WHEN run with a command name and arguments, THE SYSTEM SHALL execute headless and exit with a status code.
  - *Rationale:* One entry point reduces operator cognitive load. Interactive for exploration, headless for CI/automation.
  - Given `voidrift` with no arguments, When executed, Then the interactive TUI opens.
  - Given `voidrift --headless` with a command, When executed, Then it runs headless, writes output, and exits with a code.
  - Given any headless command, When it completes, Then progress goes to stderr and the process exits with a status code.

## 5. TUI & Output

### 5.1 Streaming Interface

- **REQ-TUI-1:** WHEN a model response is received, THE SYSTEM SHALL render streaming model responses as terminal-formatted markdown.
  - *Rationale:* Markdown is the standard format for LLM output. Rendering it properly ensures readability and usability in the terminal.

- **REQ-TUI-2:** CODE BLOCKS SHALL have syntax highlighting using `cli-highlight` or equivalent.
  - *Rationale:* Code is a primary output of the agent. Syntax highlighting makes code blocks readable and distinguishes them from prose.
  - Given a response containing a fenced code block with a language tag, When rendered, Then the code has syntax highlighting.
  - Given a response containing a fenced code block without a language tag, When rendered, Then the code is displayed without highlighting.

- **REQ-TUI-3:** INLINE CODE, BOLD, ITALIC, HEADERS, AND LISTS SHALL render with appropriate terminal formatting.
  - Given a response with `**bold**` and `*italic*`, When rendered, Then bold and italic terminal formatting is applied.
  - Given a response with code fences and inline code, When rendered, Then code is highlighted and inline code is formatted distinctly.
  - Given a response with headers, When rendered, Then H1-H4 headers are styled with increasing weight (bold, italic, underlined).
  - Given a response with lists, When rendered, Then list items are properly indented with bullet or number markers.

- **REQ-TUI-4:** WHEN a model is streaming, THE SYSTEM SHALL display responses token-by-token as they arrive.
  - Given a model is generating text, When tokens arrive, Then each token appears in the TUI incrementally.
  - Given a model is generating text, When tokens arrive, Then the elapsed time and token count update as tokens arrive.

- **REQ-TUI-5:** THE SYSTEM SHALL split streaming content at safe boundaries to prevent visual buffer growth.

- **REQ-TUI-6:** COMPLETED RESPONSES SHALL be rendered via terminal `Static` for efficient re-rendering.
  - *Rationale:* Ink's `Static` component only re-renders once for finalized content. This prevents constant full-terminal redraws when the model is still streaming.

- **REQ-TUI-7:** ACTIVE RESPONSES SHALL be rendered in `pendingHistoryItems` with incremental updates.

- **REQ-TUI-8:** THINKING CONTENT SHALL be suppressed from display but logged.
  - Given a response contains thinking content, When displayed, Then thinking is suppressed and only the final text is shown.
  - Given a response contains thinking content, When logged, Then the thinking content is captured for audit.

- **REQ-TUI-9:** WHEN the response is complete, THE FULL markdown-rendered response SHALL be in the message history.
  - Given the model completes a response, When the stream ends, Then the full markdown-rendered response is in the message history.

### 5.2 Tool Display

- **REQ-TUI-10:** WHEN a tool is called, THE SYSTEM SHALL display tool name, arguments, execution status, and result.
  - *Rationale:* Visibility into tool execution builds trust with the operator. The operator must know what the agent is doing and what it produced.
  - Given the agent calls a tool, When the tool executes, Then the tool name and argument summary are displayed.
  - Given the agent calls a tool, When the tool completes, Then the tool result is displayed.

- **REQ-TUI-11:** MULTIPLE TOOL CALLS IN ONE TURN SHALL be grouped together visually.
  - Given 3 tool calls in one response, When displayed, Then they are grouped together visually with a unified border or section.

- **REQ-TUI-12:** STATUS SHALL show a spinner during execution, checkmark on success, and X on failure.
  - Given a tool is executing, When displayed, Then a spinner is shown next to the tool name.
  - Given a tool succeeds, When displayed, Then a checkmark is shown next to the tool name.
  - Given a tool fails, When displayed, Then an X is shown next to the tool name.

- **REQ-TUI-13:** READ TOOLS SHALL show truncated file content on completion.
  - Given the agent calls `read_file("src/main.ts")`, When displayed, Then it shows the tool name, file path, and truncated content on completion.
  - Given a file is too large to display, When displayed, Then the content is truncated with an ellipsis and line count.

- **REQ-TUI-14:** WRITE/EDIT TOOLS SHALL show a diff of changes on completion.
  - Given the agent calls `edit_file` with a change, When displayed, Then a diff of the change is shown.
  - Given a file has many changes, When displayed, Then the diff is truncated with a line count.

- **REQ-TUI-15:** SHELL TOOLS SHALL show the command and output on completion.
  - Given the agent calls `shell("npm test")`, When displayed, Then the command and its output are shown.

- **REQ-TUI-16:** THE SYSTEM SHALL display a confirmation prompt for tool calls that require approval.
  - Given the agent writes a file, When the confirmation prompt appears, Then it shows the file path, diff preview, and allow/deny/always options.
  - Given the agent runs a shell command, When the confirmation prompt appears, Then it shows the command and allow/deny/always options.
  - Given the operator selects "always" for writes, When the next write occurs, Then it executes without prompting.
  - Given the operator denies a tool, When the tool returns, Then an error message is returned to the agent.
  - Given stdin is not a TTY, When a confirmation would be needed, Then it is auto-denied.

### 5.3 Session Management

- **REQ-TUI-17:** THE SYSTEM SHALL persist chat sessions automatically and restore on next start.
  - *Rationale:* Sessions represent the operator's conversation history. Automatic persistence prevents data loss and reduces friction when resuming work.
  - Given a session with 10 messages, When the TUI closes, Then the session is persisted to disk.
  - Given a session exists on disk, When the TUI starts, Then the session is restored and displayed.
  - Given a session exists with 20 messages, When the TUI starts, Then history is restored and a resume summary is shown.

- **REQ-TUI-18:** UPON RESTORE, THE SYSTEM SHALL display a resume summary (message count, time since last activity).
  - Given a session was last active 2 hours ago, When restored, Then the summary shows the time since last activity.

- **REQ-TUI-19:** THE SYSTEM SHALL track context utilization percentage with color-coded display: green below 50%, yellow below 80%, red at or above 80%.
  - Given a session uses 40% of the context window, When rendered, Then the context % is green.
  - Given a session uses 70% of the context window, When rendered, Then the context % is yellow.
  - Given a session uses 85% of the context window, When rendered, Then the context % is red.
  - Given a session uses 10% of the context window, When rendered, Then the context % is green.

- **REQ-TUI-20:** THE SYSTEM SHALL display a footer with two sections. The left section SHALL show: active mode, product name, active model, context utilization percentage, and governance partition token count. The right section SHALL show: workspace directory and git branch.
  - Given chat mode, model `claude`, 45% context, 4.2k governance tokens, workspace `~/Projects/voidrift`, branch `main`, When the footer renders, Then the left shows `[chat] voidrift · claude · ◎ 45% · 🛡 4.2k` and the right shows `~/Projects/voidrift · (main)`.
  - Given plan mode, When the footer renders, Then the left shows `[plan]` as the mode indicator.

- **REQ-TUI-21:** THE SYSTEM SHALL support input history. UP/DOWN arrow keys SHALL cycle through previous inputs within the session.
  - Given 3 previous inputs, When up arrow is pressed 2 times, Then the second-to-last input is shown.
  - Given the input buffer is at the top of history, When up arrow is pressed, Then the buffer is unchanged.
  - Given the input buffer is at the bottom of history, When down arrow is pressed, Then the buffer is unchanged.

- **REQ-TUI-22:** THE SYSTEM SHALL support generation interruption. WHEN the model is streaming a response, ESC SHALL stop generation immediately. The partial response SHALL be preserved in the message history.
  - Given the model is streaming, When ESC is pressed, Then generation stops and the partial response is kept.
  - Given a partial response is captured, When the session is persisted, Then the partial response is included in the session file.

- **REQ-TUI-23:** THE SYSTEM SHALL display elapsed time and token count during model generation. Elapsed time SHALL update every second. Token count SHALL update as tokens arrive.
  - Given the model is generating for 3 seconds and has received 150 tokens, When displayed, Then the display shows `3s · 150 tokens`.

- **REQ-TUI-24:** THE SYSTEM SHALL display model responses as streaming markdown text with the model name attributed.
  - Given the model streams 50 tokens, When displayed, Then tokens appear incrementally with the model name shown.

- **REQ-TUI-25:** CTRL+C SHALL cancel the current operation (close panel, cancel generation) but SHALL NOT exit the TUI. WHEN there is nothing to cancel, THE SYSTEM SHALL display "Type /exit to exit."
  - Given a panel is open, When Ctrl+C is pressed, Then the panel is closed.
  - Given the model is streaming, When Ctrl+C is pressed, Then generation is cancelled.
  - Given the TUI is idle, When Ctrl+C is pressed, Then "Type /exit to exit" is displayed.

### 5.4 Slash Commands

- **REQ-TUI-26:** THE SYSTEM SHALL support a slash command system. WHEN input starts with `/`, THE SYSTEM SHALL match against registered commands. Tab SHALL complete partial command names. Unknown commands SHALL display an error with available commands.
  - Given `/he` and Tab pressed, When completion runs, Then `/help` is completed.
  - Given `/unknown` entered, When processed, Then an error lists available commands.
  - Given `/` typed alone, When Tab pressed, Then all available commands are listed for completion.

- **REQ-TUI-27:** THE SYSTEM SHALL provide `/help` that lists all available slash commands with descriptions.
  - Given `/help` typed, When processed, Then all commands are listed with descriptions.

- **REQ-TUI-28:** THE SYSTEM SHALL provide `/model [alias]` that switches model. `/model` with no argument SHALL display available models.
  - Given `/model` typed, When the selector displays, Then all configured model aliases are shown.
  - Given `/model claude` typed, When the switch completes, Then subsequent turns use the Anthropic adapter and the footer shows `claude`.

- **REQ-TUI-29:** THE SYSTEM SHALL provide `/stats` that displays in a panel (REQ-TUI-37): session ID, turn count, session duration, performance breakdown (wall time, API time, tool time), tool call summary (success/fail count), and a per-model usage table showing turns, input tokens, output tokens, cache tokens, and tokens/sec for each model used in the session.
  - Given a session with 8 turns across 2 models, When `/stats` is typed, Then each model's token usage is shown in a table with totals and context utilization.

- **REQ-TUI-30:** THE SYSTEM SHALL provide `/tools` that lists all tools available in the current mode with descriptions.
  - Given dev mode with file and shell tools, When `/tools` is typed, Then those tools are listed with descriptions.

- **REQ-TUI-31:** THE SYSTEM SHALL provide `/compact` that summarizes the work layer into a structured summary and replaces the work message history with it.
  - Given a session with 50K tokens of work history, When `/compact` is typed, Then work history is replaced with a summary.
  - Given a session with only the governance layer, When `/compact` is typed, Then "Nothing to compact" is shown.

- **REQ-TUI-32:** THE SYSTEM SHALL provide `/clear` that deletes the session and starts fresh.
  - Given `/clear` typed, When processed, Then the session file is deleted and the agent starts fresh.

- **REQ-TUI-33:** THE SYSTEM SHALL provide `/exit` that exits the TUI.
  - Given `/exit` typed, When processed, Then the TUI exits.

- **REQ-TUI-34:** THE SYSTEM SHALL provide `/exec <cmd>` that runs a development command without consuming chat context tokens. Progress SHALL appear as system messages. Errors SHALL be displayed and the session SHALL remain usable. `/exec` with no arguments SHALL list available commands. An unknown command SHALL display an error.
  - Given `/exec import ./src`, When the pipeline completes, Then an import report is produced and progress appeared as system messages.
  - Given `/exec` with no arguments, When processed, Then available commands are listed.
  - Given a command fails mid-execution, When the error occurs, Then it is displayed and the chat session remains usable.

- **REQ-TUI-35:** THE SYSTEM SHALL provide `/memory` that performs memory operations.
  - Given `/memory list`, When processed, Then all memory entries are listed with names and descriptions.

### 5.5 Welcome Screen

- **REQ-TUI-36:** WHEN the TUI launches, THE SYSTEM SHALL display a welcome header with the VoidRift logo on the left and session info on the right: product name and version, active model and protocol, workspace path, and git branch.
  - Given the TUI starts, When the welcome screen renders, Then the logo is displayed on the left with info stacked to the right.
  - Given the model is `qwen2.5-coder-32b` via OpenAI protocol, When the welcome screen renders, Then it shows `qwen2.5-coder-32b (OpenAI)`.

### 5.6 Panel System

- **REQ-TUI-37:** WHEN a slash command produces structured output, THE SYSTEM SHALL render it in a panel below the input prompt. The panel SHALL be dismissed with Esc. Input SHALL be locked while a panel is open.
  - Given `/stats` is typed, When the panel renders, Then it appears below the input line.
  - Given a panel is open, When the user presses Esc, Then the panel is dismissed and input is unlocked.
  - Given a panel is open, When the user types, Then input is not accepted.

### 5.7 Color Palette

- **REQ-TUI-38:** THE SYSTEM SHALL use a blue synthwave color palette: `#6a7ec8` (primary UI chrome), `#61afef` (accent/tool names), `#5a6aa8` (borders), `#4ec9b0` (teal highlights), `#00d4ff` (bright accents). No purple or magenta SHALL be used in the default theme.

## 6. Tools & MCP

### 6.1 Tool Execution

- **REQ-TOOL-1:** THE SYSTEM SHALL support tool execution for: file read/write, shell commands, and built-in tools from Gemini core.
  - *Rationale:* These are the foundational capabilities an agent needs to interact with the filesystem and shell.

- **REQ-TOOL-2:** WHEN a tool requires confirmation, THE SYSTEM SHALL render a confirmation UI with tool name, arguments, and allow/deny/always options.
  - *Rationale:* Security. The operator must approve destructive actions (file writes, shell commands) before they are executed.
  - Given the agent writes a file in chat mode, When the confirmation prompt appears, Then it shows the file path, diff preview, and allow/deny/always options.
  - Given the agent runs a shell command, When the confirmation prompt appears, Then it shows the command and allow/deny/always options.
  - Given the operator selects "always" for writes, When the next write occurs, Then it executes without prompting.
  - Given the operator denies a tool, When the tool returns, Then an error message is returned to the agent.

- **REQ-TOOL-3:** "ALWAYS" OPTION SHALL grant that tool category for the remainder of the session.

- **REQ-TOOL-4:** DENIAL SHALL return an error to the agent without executing the tool.

- **REQ-TOOL-5:** WHEN stdin is not a TTY, ALL confirmations SHALL be auto-denied.
  - *Rationale:* In headless/CI environments, there is no human to approve tools. Auto-denial prevents the agent from executing arbitrary commands in automated workflows.
  - Given stdin is not a TTY, When a tool requires confirmation, Then it is auto-denied.

- **REQ-TOOL-6:** THE SYSTEM SHALL execute read tools and display truncated file content on completion.

- **REQ-TOOL-7:** THE SYSTEM SHALL execute write/edit tools and display a diff of changes on completion.

- **REQ-TOOL-8:** THE SYSTEM SHALL execute shell commands and display command output on completion.

### 6.2 MCP Integration

- **REQ-MCP-1:** THE SYSTEM SHALL connect to MCP servers via JSON-RPC protocol.
  - *Rationale:* MCP provides a standardized way to expose external tools to agents. Connecting to MCP servers extends the agent's capabilities without modifying the harness.

- **REQ-MCP-2:** THE SYSTEM SHALL expose MCP tools to the agent loop.
  - Given an MCP server is configured, When the system starts, Then MCP tools are registered with the agent loop.
  - Given an MCP tool is called, When the agent loop evaluates it, Then the MCP tool is executed via JSON-RPC.

- **REQ-MCP-3:** THE SYSTEM SHALL display MCP tool results in the TUI.

- **REQ-MCP-4:** MCP tools SHALL appear in the tool list with an "(MCP)" suffix in dim color.
  - Given an MCP tool named `search_files`, When displayed, Then it appears as `search_files (MCP)` in dim color.

- **REQ-MCP-5:** MCP tools SHALL follow the same confirmation flow as built-in tools.
  - Given an MCP tool requires approval, When displayed, Then the same allow/deny/always confirmation is shown.

## 7. Verification

- **REQ-VER-1:** ONE TEST SHALL be written per acceptance criterion.
- **REQ-VER-2:** `bun test` SHALL pass with no failures or warnings.
- **REQ-VER-3:** REQUIREMENTS.md SHALL be updated to reflect behavior that changed during implementation.
- **REQ-VER-4:** ARCHITECTURE.md SHALL be updated to reflect component boundaries, data flows, or decisions that changed during implementation.
- **REQ-VER-5:** README.md SHALL be updated if user-facing behavior changed during implementation.
- **REQ-VER-6:** TUI SHALL start without errors.
- **REQ-VER-7:** FIRST MESSAGE SHALL send successfully.
- **REQ-VER-8:** CONFIDENCE SHALL be ≥ 90% after verification.

## 8. Verification Evidence (V-Entries)

The following entries map acceptance criteria to test evidence. Every V-entry corresponds to a specific test file and class name.

| V-Entry | Requirement | Evidence Type |
|---------|-------------|---------------|
| V-PATH-1 | REQ-PATH-1 to REQ-PATH-6 | Unit tests for path resolution (`tests/paths.test.ts`) |
| V-BOOT-1 | REQ-BOOT-1 to REQ-BOOT-6 | Unit tests for Config construction (`tests/bootstrap.test.ts`) |
| V-ADAPT-1 | REQ-ADAPT-1 to REQ-ADAPT-8 | Unit tests for adapters (`tests/openai-adapter.test.ts`, `tests/anthropic-adapter.test.ts`) |
| V-RES-1 | REQ-RES-1 to REQ-RES-2 | Unit tests for resource loading (`tests/resources.test.ts`) |
| V-BOUND-1 | REQ-BOUND-1 to REQ-BOUND-2 | Integration tests for system boundary (`tests/system.test.ts`) |
| V-TUI-1 | REQ-TUI-1 to REQ-TUI-35 | Integration tests for TUI rendering and streaming (`tests/tui.test.ts`) |
| V-TOOL-1 | REQ-TOOL-1 to REQ-TOOL-8 | Unit tests for tool execution (`tests/tools.test.ts`) |
| V-MCP-1 | REQ-MCP-1 to REQ-MCP-5 | Integration tests for MCP connection (`tests/mcp.test.ts`) |
| V-VER-1 | REQ-VER-1 to REQ-VER-8 | Evidence of test suite and post-flight checklist pass (`tests/verification.test.ts`) |
