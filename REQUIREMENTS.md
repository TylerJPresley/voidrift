# Requirements: VoidRift — The Agentic Software Engineering Framework

## 1. Introduction

- **Purpose:** A chat-forward agentic software engineering framework. An AI agent works alongside the operator through conversation — building requirements, designing architecture, implementing code, and validating against acceptance criteria. The agent manages the full software engineering lifecycle — requirements, architecture, task planning, implementation, testing, and release — with persistent project artifacts, concurrent multi-model execution, a layered skill system, and cross-session memory. These capabilities are exercised through chat or run headless for CI/automation. Framework artifacts live in `.voidrift/` as readable files the operator can inspect, edit, or hand-author. Any model can fill any role — the framework is model-agnostic, requiring only an OpenAI-compatible or Anthropic-compatible API endpoint.
- **Project Scope:** VoidRift provides the chat interface, headless CLI commands, agent loop, tool system, and framework resource files (skills, prompts, templates). AI models are external — the operator provisions and configures endpoints. Hosting, CI/CD infrastructure, and runtime environments for generated projects are the operator's responsibility.

## 2. User Stories

- **As an** operator, **I want to** converse with an AI agent about my project, **so that** I can build requirements, refine architecture, and direct implementation through natural dialogue.
- **As an** operator, **I want to** capture and refine ideas through a guided flow, **so that** rough concepts become structured, actionable work items.
- **As an** operator, **I want to** build requirements from existing code, ideas, or conversation, **so that** the project has a formal contract regardless of its starting point.
- **As an** operator, **I want to** generate architecture and task breakdowns from requirements, **so that** implementation is pre-planned with atomic, dependency-ordered tasks.
- **As an** operator, **I want to** have the agent implement tasks concurrently with escalation and rollback, **so that** code is written reliably without manual intervention.
- **As an** operator, **I want to** validate the implementation against requirements, **so that** I have evidence the project meets its acceptance criteria.
- **As an** operator, **I want to** prepare releases with versioning, changelog, and tagging, **so that** verified work is packaged for deployment.
- **As an** operator, **I want to** use any model from any provider, **so that** I can optimize for cost, speed, or capability per task.
- **As an** operator, **I want to** persist project knowledge and preferences across sessions, **so that** the agent retains context without re-explaining.
- **As an** operator, **I want to** run any capability headless from the CLI, **so that** I can integrate the framework into CI/automation workflows.

## 3. External Interfaces (IEEE 29148)

- **User Interfaces:** Chat interface (default) for interactive conversation with the agent. Headless CLI for automated/CI execution.
- **Hardware Interfaces:** None. Model inference hardware is the operator's responsibility.
- **Software/API Interfaces:**
  - OpenAI-compatible chat completions API
  - Anthropic Messages API
- **Communication Protocols:** HTTP/HTTPS to model API endpoints.

## 4. Functional Requirements (EARS Notation)

*Use: WHEN [trigger], THE SYSTEM SHALL [result]*

### 4.1 System Architecture

- **REQ-ARCH-1:** The system SHALL provide a single executable that serves both interactive chat and headless command execution, with framework behavior governed by editable resource files (skills, prompts, templates).
  - *Rationale:* One entry point reduces operator cognitive load. Editable resources let operators customize agent behavior without modifying source code.
  - Given the operator runs `voidrift gather --model m --import ./src`, When the command executes, Then it runs headless and exits with a code.
  - Given any headless command, When it runs, Then progress output goes to stderr and the process exits with a status code.
  - Given the operator modifies a skill file in `resources/skills/`, When the next command runs, Then the modified skill content is used.
- **REQ-ARCH-2:** THE SYSTEM SHALL organize capabilities into three tiers: chat (primary interface with slash commands for all framework features), lifecycle commands (headless, for CI/automation), and utility commands (housekeeping, no model required). WHEN an unknown command is given, THE SYSTEM SHALL display the error and available commands. No command SHALL display a raw stack trace to the user.
  - *Rationale:* Three tiers give operators the right interface for each context — conversation for exploration, headless for pipelines, utilities for maintenance.
  - Given the operator types an unknown command, When the CLI processes it, Then an error and the list of valid commands are displayed.
  - Given any command encounters an unhandled exception, When the error propagates, Then a user-friendly message is displayed — not a stack trace.
- **REQ-ARCH-3:** THE SYSTEM SHALL communicate with model endpoints through a standard internal interface. Each protocol SHALL be handled by an adapter that translates between the internal interface and the protocol's wire format. The agent loop SHALL have no knowledge of specific protocols.
  - *Rationale:* A standard interface with protocol adapters means adding a new protocol requires only a new adapter — no changes to the agent loop or any command that uses it.
  - Given a model with a configured protocol, When the agent communicates with it, Then the adapter translates to/from the protocol's wire format transparently.
  - Given a new protocol is needed, When an adapter is written for it, Then the agent loop and all commands work without modification.
- **REQ-ARCH-4:** Automated commands SHALL ensure the model uses tools to produce output — the model SHALL NOT respond with text-only descriptions of what it would do. Interactive commands (chat) SHALL allow the model to decide freely between text responses and tool calls.
  - *Rationale:* Automated commands need deterministic action — a model that describes writing a file instead of writing it produces no output. Chat needs flexibility — forcing tool calls on conversational turns causes loops.
  - Given an automated command with tools available, When the model responds, Then it calls at least one tool before the turn completes.
  - Given a chat session, When the operator sends a message, Then the model may respond with text only or call tools as needed.
  - Given an automated command where the model has completed its work, When it signals completion, Then a final text summary is produced.
- **REQ-ARCH-5:** ALL agent invocations SHALL provide live token telemetry (elapsed time, token counts, context utilization). Interactive commands (chat) SHALL additionally provide token-by-token display and interruptibility.
  - *Rationale:* Operators need visibility into agent progress and cost across all commands. Chat additionally benefits from responsive display and the ability to interrupt generation.
  - Given any agent is running, When it receives a response, Then elapsed time, token counts, and context utilization are displayed.
  - Given a chat session, When the model generates a response, Then tokens are displayed as they arrive.
  - Given a chat session with the model generating, When the operator interrupts, Then generation stops.
  - Given a provider that does not support usage reporting, When the system communicates with it, Then unsupported options are not sent and telemetry fields are omitted gracefully.
  - Given a lifecycle command completes, When the final status is displayed, Then total elapsed time for the entire run is shown.
- **REQ-ARCH-6:** THE SYSTEM SHALL detect when a model is repeating itself and recover automatically. A repeat is defined as a tool call with identical function name AND identical arguments to one made in the previous turn — different arguments constitute new work, not a stall. WHEN a repeat is detected, THE SYSTEM SHALL nudge the model to proceed. WHEN nudging fails after 2 attempts, THE SYSTEM SHALL force the model to produce final output. Stall events SHALL be logged.
  - *Rationale:* Models under stress loop on the same tool calls indefinitely. Exact-match detection avoids false positives on legitimate iterative work (e.g., writing progressively larger files).
  - Given a model calls `file(write, path="main.py", content="A")` then calls `file(write, path="main.py", content="B")`, When stall detection runs, Then no stall is detected — arguments differ.
  - Given a model calls `file(read, path="main.py")` on two consecutive turns with identical arguments, When stall detection runs, Then a stall is detected.
  - Given 2 nudges have failed, When the model repeats again, Then the system forces final output.
  - Given a stall is detected, When recovery runs, Then the event is logged.
- **REQ-ARCH-7:** Automated commands SHALL have all required skills available in context from the start of execution — no tool calls needed to load them. Chat SHALL additionally support on-demand skill discovery during the session.
  - *Rationale:* Pre-loaded skills eliminate per-turn overhead in automated commands. Chat retains dynamic discovery because the model cannot know in advance which skills a free-form conversation will need.
  - Given a gather command requires the ANALYSIS-REQS skill, When the agent starts, Then the skill content is already in context without a tool call.
  - Given a chat session, When the model needs a skill mid-conversation, Then it can load it on demand.
  - Given an automated command, When the agent runs, Then no skill-loading tool is available.
  - Given a referenced skill does not exist, When the command runs, Then a warning is logged and execution continues.
- **REQ-ARCH-8:** Multi-stage commands SHALL isolate each unit of work with a fresh context — no agent SHALL inherit message history from a prior agent. State shared between units of work SHALL be passed explicitly by the orchestrator.
  - *Rationale:* A single agent processing multiple files accumulates raw content until the context window fills. Fresh contexts per unit of work keep each agent small and focused.
  - Given a gather command analyzing 20 files, When the 15th file is analyzed, Then its agent has no message history from the prior 14.
  - Given a plan stage produces architecture, When the task stage runs, Then it receives the architecture as explicit input — not inherited context.
- **REQ-ARCH-9:** THE SYSTEM SHALL suppress model thinking content from user-facing output and message history. Thinking content SHALL be logged for debugging. Models that do not emit thinking content SHALL be unaffected.
  - *Rationale:* Some models emit chain-of-thought reasoning that is valuable for debugging but should not leak into user-facing output or pollute context for subsequent turns.
  - Given a model response containing `<think>reasoning</think>Hello`, When processed, Then the operator sees `Hello` and the log contains the reasoning.
  - Given a model response with no thinking content, When processed, Then the text is returned unchanged.
  - Given a streaming response that begins with thinking content, When tokens arrive, Then thinking is suppressed and only real content is displayed.
  - Given a streaming response with no thinking markers, When tokens arrive, Then content is displayed without delay.
- **REQ-ARCH-10:** Each command SHALL have access only to the tools relevant to its purpose. Adding a new command SHALL NOT require modifying the tool system — the command declares its own tool set. Per-command tool sets:
  - **Gather:** `file` (read, list), `analyze` (code, document).
  - **Plan:** `file` (read, write, edit, list).
  - **Develop:** `file` (read, write, edit, delete, list), `shell`.
  - **Verify:** `file` (read, list, write to `.voidrift/` only), `http`, `process`, `browser`, `shell`.
  - **Chat:** `file`, `http`, `shell`, `skill`, `memory`, `session`, `analyze`, `ask`.
  - *Rationale:* Models waste context calling tools irrelevant to their task. Scoped tool sets keep the model focused. Open/closed design means new commands don't touch shared infrastructure.
  - Given a gather agent, When its tools are inspected, Then only `file` (read, list) and `analyze` are available.
  - Given a develop agent, When its tools are inspected, Then `file` and `shell` are available but `skill` and `memory` are not.
  - Given a new command is added, When it declares its tool set, Then no existing module is modified.
- **REQ-ARCH-11:** THE SYSTEM SHALL recover automatically from API failures without operator intervention. Recovery strategies:
  - **Transient errors** (connection failures, HTTP 5xx, HTTP 429): retry with exponential backoff and jitter. Respect `Retry-After` headers. Non-retryable errors (HTTP 4xx except 429) fail immediately.
  - **Output truncation** (response cut short): request continuation for text, discard and re-request for tool calls. Truncated tool calls SHALL never be executed.
  - **Context overflow** (input exceeds model limit): summarize older messages to free context and retry. Recovery counter resets between agent instances (per REQ-ARCH-8).
  WHEN any recovery strategy is exhausted, the original error SHALL be raised. All recovery events SHALL be logged.
  - *Rationale:* API failures are inevitable in long-running sessions with external model endpoints. Automatic recovery preserves runs that may have taken minutes of work without requiring operator intervention.
  - Given a transient connection error, When the system retries, Then up to 3 attempts are made with increasing delay.
  - Given an HTTP 429 with `Retry-After: 5`, When the system retries, Then it waits at least 5 seconds.
  - Given a model with a configured fallback and retries exhausted on 429/5xx, When recovery is exhausted, Then the fallback model is used. Max one level of fallback.
  - Given a 401 authentication error, When retries are exhausted, Then fallback is NOT activated — the error is raised.
  - Given an HTTP 401, When the error occurs, Then no retry is attempted.
  - Given a text response is truncated, When detected, Then continuation is requested and partials are concatenated.
  - Given a truncated response with tool calls, When detected, Then tool calls are discarded and re-requested.
  - Given a context-length error, When recovery runs, Then old messages are summarized and the call is retried.
  - Given any recovery strategy is exhausted, When the error persists, Then the original error is raised.
- **REQ-ARCH-12:** THE SYSTEM SHALL support optional token budget limits for command runs. WHEN configured (via CLI flags or per-model defaults), THE SYSTEM SHALL track cumulative token usage across all agents in the run and stop execution when a limit is exceeded. CLI flags SHALL override per-model defaults. WHEN no budget is configured, execution runs without limits.
  - *Rationale:* Cloud model sessions can accumulate unbounded cost. Token budgets let the operator cap total consumption per run. A shared budget across agents ensures the cap applies to the entire session, not per-task.
  - Given `--max-output-tokens 10000` and cumulative output reaches 10000, When the next API call would start, Then execution stops with a budget summary.
  - Given a model with `max_output_tokens: 50000` and CLI flag `--max-output-tokens 10000`, When the run starts, Then 10000 is used (CLI overrides).
  - Given no token budget is configured, When the run executes, Then no budget checking occurs.
- **REQ-ARCH-13:** THE SYSTEM SHALL allow commands to customize agent loop behavior without modifying the loop itself. Customization points SHALL include: stopping conditions, message injection between turns, tool call interception, and context transformation. All customizations SHALL be optional — the loop behaves identically when none are configured.
  - *Rationale:* Different commands need different loop behaviors (develop needs write verification, chat needs permission gates) without forking the core loop.
  - Given a command configures a stop condition after 3 turns, When the 3rd turn completes, Then the loop stops with a final summary.
  - Given a command intercepts a tool call, When the tool would execute, Then the intercepted result is used without executing the tool.
  - Given no customizations are configured, When the loop runs, Then behavior is identical to the default.
- **REQ-ARCH-14:** WHEN multiple tool calls arrive in a single response, THE SYSTEM SHALL deduplicate identical calls (same function name and arguments) — executing once and sharing the result across all matching IDs. After deduplication, read-only tool calls SHALL execute concurrently; write operations SHALL execute serially. For tools with mixed read/write actions, concurrency SHALL be determined by the specific action: `file(read/list/stat)` and `http(get)` are concurrent-safe; all write/mutating actions are serialized. Results SHALL be returned in the original call order. Deduplication events SHALL be logged.
  - *Rationale:* Models under stress emit duplicate tool calls that waste context. Concurrent reads reduce latency without sacrificing correctness. Serial writes preserve ordering guarantees.
  - Given 3 identical `file(read, path="foo.js")` calls with different IDs, When executed, Then the file is read once and all 3 IDs receive the same result.
  - Given `[read_A, read_B, write_C, read_D]`, When executed, Then reads A and B run concurrently, write C runs alone, read D runs after.
  - Given all calls are distinct, When executed, Then no deduplication occurs.
- **REQ-ARCH-15:** THE SYSTEM SHALL gracefully handle common model mistakes in tool arguments without failing. Malformed file paths (leading `/` or `./`) SHALL be corrected automatically. Normalization events SHALL be logged.
  - *Rationale:* Models frequently produce paths with leading `/` or `./` that fail against relative-path schemas. Silent correction avoids wasting a tool-call round-trip on a fixable error.
  - Given a tool call with `path="/src/main.py"`, When the tool executes, Then the path is corrected to `src/main.py`.
  - Given a tool call with correctly-formed arguments, When the tool executes, Then no normalization occurs.
- **REQ-ARCH-16:** THE SYSTEM SHALL optimize API costs by enabling provider-supported caching mechanisms when available. Concurrent agents sharing identical system prompts SHALL benefit from cache hits. Non-caching providers SHALL be unaffected.
  - *Rationale:* Commands like gather run 50+ concurrent agents with identical system prompts. Without caching, each pays full input cost. Provider caching can reduce cost by up to 90%.
  - Given 3 concurrent agents with identical system prompts on a caching-capable provider, When the 2nd and 3rd agents run, Then they benefit from cached prompt content.
  - Given a provider that does not support caching, When agents run, Then behavior is unchanged.
- **REQ-ARCH-17:** THE SYSTEM SHALL release network resources after each agent completes, regardless of success or failure. WHEN a model fallback occurs, the previous connection SHALL be released before the new one is used.
  - *Rationale:* Concurrent pipelines run hundreds of agents per command. Without cleanup, connection pools accumulate until file descriptor limits are reached.
  - Given an agent completes normally, When it finishes, Then its network connection is released.
  - Given an agent fails with an exception, When it exits, Then its network connection is still released.
  - Given a long-running command receives Ctrl+C or SIGTERM, When the signal is received, Then the system exits within 5 seconds with all resources cleaned up.
  - Given a first Ctrl+C was received and the system is shutting down, When a second Ctrl+C is received, Then the system exits immediately.
  - Given a model fallback is triggered, When the new connection is created, Then the previous connection is released first.
- **REQ-ARCH-18:** ALL text sent to a model — system prompts, user messages, retry messages, nudge messages — SHALL be loaded from editable resource files. The system SHALL NOT contain hardcoded prompt strings. Prompts SHALL support template variables resolved at runtime. A missing variable SHALL raise an error — no silent substitution.
  - *Rationale:* Editable prompts let operators customize agent behavior without modifying source code. Loud failures on missing variables prevent silent prompt corruption.
  - Given a prompt containing `{group_name}`, When resolved with `group_name="backend"`, Then `{group_name}` is replaced with `backend`.
  - Given a prompt containing `{missing_var}`, When resolved without that variable, Then an error is raised.
- **REQ-ARCH-19:** THE SYSTEM SHALL construct each agent's system prompt as follows. For chat agents: a governance layer containing (1) shared governance content — START.md and CONTRIBUTING.md verbatim; (2) shared framework context — command inventory and artifact ownership boundaries; (3) the active mode's personality prompt; (4) mode-specific skills; (5) memory index and git snapshot. For automated command agents (gather, plan, develop, verify, deploy): the existing 4-layer structure — (1) framework context; (2) methodology skill; (3) stage-specific instructions; (4) injected context. The governance layer is the system prompt — it is never compacted and is re-sent on every API call. Framework context SHALL be loaded once per command run and shared across all agents.
  - *Rationale:* Chat agents need stable governance that survives compaction. Automated agents are short-lived and don't compact — the existing 4-layer structure is sufficient. Separating the two prevents chat governance concerns from complicating automated command prompts.
  - Given chat starts in `/chat` mode, When the system prompt is built, Then it contains START.md + CONTRIBUTING.md + framework context + chat personality + ANALYSIS-REQS + memory index + git snapshot.
  - Given `/plan` mode is activated, When the system prompt is rebuilt, Then START.md and CONTRIBUTING.md remain, personality and skills change.
  - Given an automated command (develop) runs, When its agent is built, Then it uses the existing 4-layer structure with no governance partition.
  - Given `system.md` is updated, When the next command runs, Then all agents see the updated framework context without changes to command prompt files.

### 4.2 Chat Interface

- **REQ-CHAT-1:** WHEN `/gather` is typed in chat, THE SYSTEM SHALL switch to gather mode — setting the agent to a requirements-focused personality for the conversation. The operator drives the conversation; the agent guides toward EARS-notation requirements. WHEN `/exec gather --import <path>` is typed, THE SYSTEM SHALL run the automated requirements pipeline. WHEN `/exec gather --idea <id>` is typed, THE SYSTEM SHALL generate requirements from the idea content.
  - Given `/gather` is typed, When the mode switches, Then the agent operates with a requirements-focused personality and message history is preserved.
  - Given `/exec gather --import ./src`, When the pipeline completes, Then REQUIREMENTS.md is written and progress appeared as system messages.
  - Given `/exec gather --idea 3`, When the pipeline completes, Then requirements are generated from the idea content.
- **REQ-CHAT-2:** Chat is the primary interactive interface and the default command — `voidrift` with no arguments opens chat directly. `--doc <path>` SHALL scope the conversation to a specific `.voidrift/` artifact, loading its content into context. IF the file does not exist, THE SYSTEM SHALL warn and offer to create it. IF a model request fails mid-session, THE SYSTEM SHALL print the error and return to the prompt — not exit. The agent MAY load additional skills on demand during the session.
  - *Rationale:* Chat is where operators iterate on artifacts, debug issues, and refine ideas. Scoping to a document focuses the conversation. Error recovery keeps the session alive through transient failures.
  - Given `--doc REQUIREMENTS.md` and the file exists, When the session starts, Then the system prompt includes the file's content.
  - Given `--doc new-spec.md` and the file does not exist, When the session starts, Then a warning is shown and the agent offers to create it.
  - Given a model API error during a chat turn, When the error occurs, Then it is printed and the prompt reappears.
  - Given the agent is asked about a file, When it responds, Then it reads the file first to understand current state before answering.
  - Given the agent intends to modify files, When it responds, Then it proposes the changes and waits for operator confirmation before writing.
  - Given the agent has made changes, When it responds, Then it summarizes what was created, modified, or run.
- **REQ-CHAT-3:** WHEN the operator types `/compact`, THE SYSTEM SHALL summarize the work layer into a structured summary and replace the work message history with it, preserving the governance layer. The resulting work layer SHALL NOT exceed 10% of the work budget (maxContext minus governance size). Recently accessed files and skills SHALL be automatically restored after compaction.
  - *Rationale:* Long sessions accumulate context from tool results until the work layer fills. Summarization preserves continuity without restarting. The 10% ceiling leaves 90% of the work budget available for the next exchange. The governance layer is never compacted.
  - Given a session with 50K tokens of work history, When `/compact` is typed, Then work history is replaced with a summary under 10% of work budget.
  - Given a session with only the governance layer, When `/compact` is typed, Then "Nothing to compact" is shown.
  - Given work utilization reaches 80% of work budget, When the operator sends the next message, Then auto-compact runs before the message is processed.
  - Given work utilization reaches 70% of work budget, When the operator sends a message, Then a one-time nudge advises `/compact`.
  - Given 3 consecutive compact failures, When the next auto-compact would trigger, Then auto-compact is disabled and the operator is warned to start a new session.
- **REQ-CHAT-4:** Chat sessions SHALL persist automatically and restore on next start, displaying a resume summary (message count, time since last activity). `/clear` SHALL delete the session and start fresh. Session restore SHALL reconstruct only from the last compaction boundary forward. Malformed entries (empty content, orphaned tool calls) SHALL be stripped on restore.
  - *Rationale:* Operators refine artifacts across multiple sittings. Losing context on terminal close forces repetitive setup. Persistence with automatic resume eliminates this friction.
  - Given a session exists with 20 messages, When chat starts, Then the history is restored and a resume summary is shown.
  - Given no session exists, When chat starts, Then a new session is created.
  - Given `/clear` is typed, When the session resets, Then the file is deleted and the agent starts fresh.
  - Given a session with a compaction at message 15, When restored, Then only the compaction summary and messages 16+ are loaded.
  - Given a session is resumed, When restored, Then a resume instruction is injected telling the model to treat history as background context and wait for new instructions.
- **REQ-CHAT-5:** `/ask <question>` SHALL make a one-shot API call that does not affect the session history. The question and response SHALL NOT be appended to the agent's message history or the session file. The response SHALL be displayed inline.
  - *Rationale:* Quick factual questions pollute session context with unrelated exchanges. A one-shot call keeps the main context clean.
  - Given `/ask what is 2+2`, When the call completes, Then the answer is displayed and session history is unchanged.
- **REQ-CHAT-6:** `/bare` SHALL freeze the current agent and start a new agent with no governance layer — no skills, project state, git snapshot, memory, START.md, or CONTRIBUTING.md. The bare agent operates independently with its own message history. Typing any framework mode command (`/chat`, `/plan`, `/gather`, `/idea`) SHALL stop the bare agent and resume the frozen agent in the requested mode.
  - *Rationale:* Operators need raw model access without polluting the main session's context. A separate agent ensures no context bleed between framework-assisted and raw conversations.
  - Given `/bare` is typed from any mode, When the bare agent starts, Then it has no governance layer and the previous agent is frozen.
  - Given `/chat` is typed while bare is active, When the previous agent resumes, Then its context is exactly as it was before `/bare`, in chat mode.
  - Given `/plan` is typed while bare is active, When the previous agent resumes, Then it resumes with plan mode governance.
- **REQ-CHAT-7:** Chat SHALL enforce a session-scoped permission gate on three categories: **writes** (file write/edit), **runs** (shell), and **reads outside the project directory**. WHEN an action requires permission and no session grant exists, THE SYSTEM SHALL display the tool and target, then prompt: allow once / deny / always for this session. "Always" grants that category for the remainder of the session. Denial returns an error to the agent. WHEN stdin is not a TTY, all gated actions are auto-denied. Reads within the project directory are free. This gate applies to chat only — automated commands execute without confirmation.
  - *Rationale:* Prompt instructions alone cannot reliably prevent unsolicited actions across all models. A permission gate gives the operator hard control. Per-category grants preserve usability during directed editing without opening all action types.
  - Given the agent writes a file and no writes grant exists, When the prompt appears, Then the operator can allow once, deny, or always-allow writes.
  - Given the operator selects "always" for writes, When the next write occurs, Then it executes without prompting.
  - Given the operator denies, When the tool returns, Then the file is unchanged and a denial message is returned to the agent.
  - Given stdin is not a TTY, When any gated action is attempted, Then it is auto-denied.
  - Given a read within the project directory, When the agent reads, Then no prompt is shown.
- **REQ-CHAT-8:** `/settings` SHALL list all configuration settings with descriptions. `/settings set <key> <value>` SHALL validate the key exists and the value type matches before writing. Unknown keys and type mismatches SHALL be rejected with an error.
  - Given `/settings` is typed, When the list displays, Then all settings appear with descriptions.
  - Given `/settings set cache.ttl_days 60`, When the value is valid, Then config.yml is updated.
  - Given `/settings set nonexistent.key value`, When the key is unknown, Then an error is displayed.
- **REQ-CHAT-9:** `/model` SHALL switch the active model mid-session. `/model` with no argument SHALL open a model selector. `/model <alias>` SHALL switch directly. The UI SHALL reflect the active model. The selection SHALL persist to configuration.
  - Given `/model claude` is typed, When the switch completes, Then subsequent exchanges use the claude model and the UI reflects it.
  - Given `/model` is typed with no argument, When the selector appears, Then the operator can choose from configured aliases.
- **REQ-CHAT-10:** WHEN chat starts, THE SYSTEM SHALL resolve the active model from configuration (saved current model, or first configured alias). IF the resolved model is unavailable, THE SYSTEM SHALL open chat with a warning prompting the operator to pick a different model via `/model`. Non-model slash commands (/help, /settings, /model, /clear) SHALL remain functional.
  - Given a saved current_model in config, When chat starts, Then that model is used.
  - Given the resolved model is unavailable, When chat starts, Then a warning is shown and `/model` can be used to switch.
- **REQ-CHAT-11:** `/idea` SHALL switch to idea mode, activating the idea refinement personality. `/idea` with no argument SHALL prompt the operator to create a new idea or load an existing one. `/idea <id>` SHALL load and resume an existing idea. Ideas have a lifecycle status: `draft` (in progress), `now` (high priority), `next` (upcoming), `later` (parked), `done` (all derived tasks verified). `/done` SHALL save the idea, return to the previous mode, and restore its governance. All chat tools remain available during the idea flow.
  - *Rationale:* Ideas need structured refinement before becoming requirements. Running the flow inside chat as a mode keeps the operator in context — they can ask questions, look up files, and iterate without losing conversation history.
  - Given `/idea` is typed, When the mode switches, Then the idea personality is active and the operator is prompted to create or load.
  - Given `/idea 3` is typed, When the mode switches, Then idea 3 is loaded and the idea personality drives refinement.
  - Given `/done` is typed during idea mode, When the idea is saved, Then the previous mode's governance is restored.
  - Given the idea flow is active, When the operator calls a file tool, Then the tool executes normally.
  - Given an idea exists with status `now`, When `voidrift plan` is run, Then the idea is not automatically consumed — the operator must act on it explicitly.
- **REQ-CHAT-12:** WHEN a new idea is created, THE SYSTEM SHALL guide the operator through four stages: (1) Intake — describe the idea at a high level; (2) Exploration — clarifying questions, reference existing requirements and architecture, challenge scope and assumptions; (3) Shaping — propose a structured user story, acceptance criteria, and affected modules; (4) Summary — present the complete structured idea for operator review. The agent SHALL drive the conversation — it knows which stage it is in and what to ask next.
  - *Rationale:* Unstructured idea capture produces vague backlog items. A staged flow ensures every idea has a user story, acceptance criteria, and scope before it enters the backlog.
  - Given a new idea is started, When the agent responds, Then it asks the operator to describe the idea (Intake stage).
  - Given the Intake stage is complete, When the agent responds, Then it asks clarifying questions referencing existing requirements and architecture (Exploration stage).
  - Given Exploration is complete, When the agent responds, Then it proposes a user story, ACs, and affected modules (Shaping stage).
  - Given Shaping is complete, When the agent responds, Then it presents the complete structured idea for operator review (Summary stage).
- **REQ-CHAT-13:** WHEN the operator types `/done` during an idea flow, THE SYSTEM SHALL ask the operator to categorize the idea as `now`, `next`, or `later`, write the final structured content to the idea file, register it in the manifest with the chosen category, and return to normal chat.
  - *Rationale:* `/done` is the explicit commit point — the operator confirms the idea is ready to enter the backlog with a priority category. Without it, ideas remain in draft indefinitely.
  - Given an idea flow is active, When the operator types `/done`, Then the agent asks for a category (now/next/later).
  - Given the operator selects a category, When `/done` completes, Then the idea file is written, registered in the manifest, and the session returns to normal chat.
- **REQ-CHAT-14:** WHEN the chat agent constructs a context window, THE SYSTEM SHALL partition it into a governance layer (system prompt, never compacted) and a work layer (message history, compactable). The governance layer SHALL contain: shared governance content (START.md, CONTRIBUTING.md verbatim), mode personality prompt, mode skills, memory index, and git snapshot. Compaction SHALL only target the work layer. Auto-compact thresholds SHALL be calculated relative to the work budget (maxContext minus governance size), not total context. The governance budget SHALL be configurable via `governance_max_tokens` (default 6144 tokens).
  - *Rationale:* Governance documents drift out of context during long sessions because they're compacted with everything else. A dedicated partition ensures behavioral rules are re-sent on every API call and cannot be lost.
  - Given a session with 80% work utilization, When auto-compact triggers, Then the governance layer is untouched and only work messages are summarized.
  - Given governance consumes 5k tokens of a 128k window, When auto-compact thresholds are calculated, Then they use 123k as the work budget.
  - Given the governance layer exceeds the configured governance cap (default 6144 tokens), When the mode is activated, Then a warning is shown and optional content (skills) is trimmed.
  - Given compaction runs, When the result is checked, Then the work layer is ≤10% of the work budget.
  - Given `governance_max_tokens` is set to 8192 in config.yml, When governance size is calculated, Then 8192 is used as the cap instead of the default.
- **REQ-CHAT-15:** WHEN the operator types `/chat`, `/plan`, `/gather`, or `/idea`, THE SYSTEM SHALL rebuild the governance layer with the target mode's personality and skills, inject a one-line steering message into the work layer, and continue with the existing message history. Each mode SHALL define: a personality prompt, a set of skills, and optionally a tool restriction. The default mode on session start SHALL be `/chat`.
  - *Rationale:* Operators need specialized agent behaviors (planning, requirements gathering, idea refinement) without leaving the session or losing conversation context. Mode switching changes who you're talking to without resetting what you've discussed.
  - Given `/plan` is typed, When the mode switches, Then the system prompt contains the plan personality and ARCH-DESIGN skill, and message history is preserved.
  - Given `/chat` is typed after `/plan`, When the mode switches, Then the system prompt reverts to chat personality and ANALYSIS-REQS skill, and history is preserved.
  - Given `/gather` is typed, When the mode switches, Then the system prompt contains the gather/requirements personality.
  - Given `/idea` is typed, When the mode switches, Then the idea refinement flow starts with the idea personality active.
  - Given a mode switch occurs, When the next API call is made, Then a steering message ("Operating as planning agent.") appears in the work layer.
  - Given the session starts, When no mode is specified, Then `/chat` mode is active by default.
- **REQ-CHAT-16:** WHEN the operator types `/exec <command> [args]`, THE SYSTEM SHALL run the corresponding lifecycle pipeline (gather, plan, develop, verify, deploy) without consuming chat context tokens. Progress SHALL appear as system messages. Errors SHALL be displayed and the session SHALL remain usable. `/exec` with no arguments SHALL list available commands. An unknown command SHALL display an error.
  - *Rationale:* Lifecycle pipelines are heavy background operations, not agent personalities. Moving them behind `/exec` frees `/plan`, `/gather`, etc. for mode switching and separates "who I'm talking to" from "run this pipeline."
  - Given `/exec gather --import ./src` is typed, When the pipeline runs, Then REQUIREMENTS.md is written and progress appears as system messages.
  - Given `/exec plan` is typed, When the pipeline runs, Then architecture and tasks are generated.
  - Given `/exec` is typed with no arguments, When the system responds, Then available commands are listed.
  - Given `/exec unknown` is typed, When the system checks, Then an error is displayed.
  - Given `/exec develop` is running, When the operator watches, Then progress appears without consuming chat context.

### 4.3 Lifecycle Commands

#### 4.3.1 Gather

- **REQ-G-1:** WHEN `--import <path>` is specified, THE SYSTEM SHALL run the automated requirements pipeline (triage→analyze→consolidate) against the target path and produce REQUIREMENTS.md. THE SYSTEM SHALL validate the path exists and is a directory before any model calls. WHEN REQUIREMENTS.md already exists and `--overwrite` is not specified, the output SHALL merge new analysis with existing requirements. WHEN `--idea <id>` is specified, THE SYSTEM SHALL generate or update requirements from the idea file and update the idea file with the requirement IDs created or modified and a diff of changes to REQUIREMENTS.md. WHEN `--ref <path>` is specified, THE SYSTEM SHALL load the external codebase at that path as context for the requirements conversation without running the automated pipeline.
  - *Rationale:* Codebases evolve. Re-running gather should refine existing requirements, not replace them wholesale. Path validation prevents wasted model calls on invalid input.
  - Given `--import ./src` and `./src` is a valid directory, When gather runs, Then REQUIREMENTS.md is produced.
  - Given `--import ./nonexistent`, When gather runs, Then the command exits with an error — no model call is made.
  - Given REQUIREMENTS.md exists and `--overwrite` is not specified, When gather runs, Then the output merges new analysis with existing requirements.
  - Given `--overwrite` is specified, When gather runs, Then previous gather artifacts are removed and a fresh analysis starts.
  - Given `--import ./src`, When the pipeline reads files, Then reads are scoped to `./src` — paths outside the import target are blocked.
  - Given gather completes, When the operator checks git, Then no automatic commits were made.
- **REQ-G-2:** THE SYSTEM SHALL reverse-engineer requirements from a codebase in four stages:
  1. **Triage:** Categorize all files into: source, tests, config, infrastructure, documentation, assets, generated. The file tree SHALL respect `.gitignore` and exclude dot-prefixed paths. The model infers categories — the system SHALL NOT hardcode language-specific rules.
  2. **Context Build:** Analyze each non-source file individually. Each produces a category-appropriate summary — behavioral contracts from tests, design intent from docs, deployment constraints from infrastructure, toolchain constraints from config. Generated files are analyzed by filename and path only (contents not read) in a single batched call to infer toolchain context. Results are cached per-file with a content hash; unchanged files skip analysis.
  3. **Source Analysis:** Analyze each source file individually with context summaries available. Each analysis expresses what the file implements as EARS requirements. Source files are analyzed concurrently. Unchanged files (matching content hash) skip analysis entirely. Large files SHALL be chunked rather than truncated.
  4. **Consolidation:** A single agent receives all analyses and produces the final REQUIREMENTS.md — resolving conflicts, identifying gaps, deduplicating, and organizing by functional area.
  Each stage uses isolated agents (per REQ-ARCH-8). The target directory SHALL be read-only.
  - *Rationale:* Source code is the ground truth. Non-source files inform but don't define requirements. Per-file analysis keeps context small. Caching skips unchanged files.
  - Given a project with source, tests, and docs, When the pipeline runs, Then files are categorized, context is summarized, source is analyzed, and REQUIREMENTS.md is produced.
  - Given a triage response with malformed output (control characters, truncated mid-object), When the triage parser runs, Then the system recovers gracefully and preserves available categories.
  - Given triage categorizes 18 of 20 input files, When the check runs, Then a warning reports 2 uncategorized files — the pipeline continues.
  - Given an unchanged source file, When the pipeline runs, Then the cached analysis is used without a model call.
  - Given a source analysis agent, When it runs, Then it receives the file content directly and has no tools — it analyzes what it is given without making additional calls.
  - Given the target directory, When the pipeline runs, Then no files in it are modified.
- **REQ-G-3:** WHEN the gather pipeline encounters a context-length error that cannot be recovered, THE SYSTEM SHALL display a clear error identifying the stage and suggesting a model with a larger context window. The pipeline SHALL NOT silently truncate content to fit.
  - *Rationale:* Silent truncation produces incomplete requirements. A clear error with corrective guidance lets the operator switch models rather than getting bad output.
  - Given a model cannot fit the content, When recovery is exhausted, Then the error identifies the stage and suggests a larger model.
- **REQ-G-4:** WHEN the gather pipeline runs, THE SYSTEM SHALL display per-file analysis status showing whether each file was analyzed fresh or served from cache, with agent stats for fresh analyses. Stage progress SHALL show total files, completion count, and cached vs new breakdown.
  - *Rationale:* The operator needs to see which files were re-analyzed and which were cached to understand what changed and how much work the pipeline did.
  - Given all files are cached, When the listing displays, Then each file shows cached status.
  - Given 4 files are newly analyzed, When the listing displays, Then those files show agent stats.
- **REQ-G-5:** WHEN uncategorized files exist after triage, THE SYSTEM SHALL prompt the operator to assign each file to a category. Options SHALL include: assign to a specific category, skip the file, skip all remaining, or apply the chosen category to all remaining. Assigned files SHALL be included in subsequent pipeline stages.
  - *Rationale:* Uncategorized files are excluded from the entire pipeline. Interactive assignment lets the operator recover important files without re-running gather.
  - Given 2 uncategorized files and the operator assigns both to "source", When assignment completes, Then both are included in source analysis.
  - Given the operator selects "skip all", When assignment completes, Then no uncategorized files are assigned.

#### 4.3.2 Plan

- **REQ-P-1:** THE SYSTEM SHALL generate architecture and task breakdown from requirements in six stages:
  1. **Architecture:** Receive REQUIREMENTS.md. Produce ARCHITECTURE.md — system-level context only: introduction, constraints, module inventory, cross-module API contracts, and cross-cutting concerns. No module-internal design.
  2. **Module Architecture:** One agent per module. Receive ARCHITECTURE.md and the module name. Produce `arch/<module>.md` — module-specific design detail (component internals, data models, internal interfaces, error handling, cross-module interfaces). Module arch files SHALL be concise — interfaces and data models as signatures only.
  3. **Task Outline:** One agent per module. Receive ARCHITECTURE.md and that module's arch file. Produce a lightweight task outline per module with intra-module dependencies only.
  4. **Dependency Resolution:** Receive all task outlines. Resolve cross-module dependencies. Skipped for single-module projects.
  5. **Task Files:** One agent per task. Receive the task's outline entry and module arch. Produce `tasks/active/TASK-N.md`. The manifest (`tasks/manifest.yml`) is built from completed task files.
  6. **README:** Receive REQUIREMENTS.md and ARCHITECTURE.md. Produce README.md — the user manual.
  Each stage's required artifacts SHALL be verified before the next stage begins. IF a stage's artifact is missing after one retry, THE SYSTEM SHALL exit with code 1 and no subsequent stages run.
  - *Rationale:* A single agent writing all artifacts loses coherence over long generations. Scoped agents with verified milestones keep each generation short, focused, and independently recoverable.
  - Given REQUIREMENTS.md exists, When plan completes for a multi-module project, Then ARCHITECTURE.md, `arch/<module>.md` for each module, task files, and README.md exist.
  - Given REQUIREMENTS.md does not exist, When plan is run, Then the command exits with an error prompting the operator to run gather — no model calls are made.
  - Given Stage 1 fails to produce ARCHITECTURE.md after one retry, When the failure is detected, Then the command exits with code 1 and no further stages run.
  - Given ARCHITECTURE.md is produced, When reviewed, Then it contains system-level context only and no module-internal component design.
  - Given ARCHITECTURE.md is produced, When reviewed, Then it follows the arc42 documentation standard with C4 model diagrams (Mermaid).
  - Given a project with a runnable entry point, When ARCHITECTURE.md is produced, Then it includes a startup command so verify can start the system under test.
  - Given authentication requirements exist, When plan runs, Then ARCHITECTURE.md includes test bootstrap metadata and a test harness task is generated so verify has seeded credentials.
  - Given a module arch file is produced, When reviewed, Then it contains module-specific design with interfaces as signatures only.
  - Given a multi-module project, When tasks are generated, Then each file path appears in exactly one module's tasks — no file is modified by tasks in more than one module.
  - Given Stage 3 produces task outlines, When reviewed, Then each contains only a brief description per task — no implementation detail, no acceptance criteria, no code.
  - Given the manifest is built from task files, When plan completes, Then intermediate outline files are removed.
  - Given plan completes, When the operator checks git, Then no automatic commits were made.
- **REQ-P-2:** Task files produced by plan SHALL contain acceptance criteria scoped to the task only. Each AC SHALL be verifiable by examining only the files the task produces. ACs SHALL describe observable behaviors with specific values — not vague descriptions or system-level statements. Task ACs are the develop agent's definition of done.
  - *Rationale:* Tasks with vague or system-level ACs leave the develop agent guessing what "done" looks like. Task-scoped ACs with concrete values give the develop agent a clear, independently verifiable contract.
  - Given a generated task, When its ACs are examined, Then each AC references specific values verifiable in the task's output files.
  - Given a generated task, When its ACs are examined, Then no AC requires examining files outside the task's file list to verify.
- **REQ-P-3:** THE SYSTEM SHALL maintain requirement traceability from REQUIREMENTS.md through to task files. Architecture artifacts SHALL reference REQ IDs inline when describing components and contracts. Module arch files SHALL carry REQ ID references forward. Task files SHALL include the REQ IDs they trace to. AFTER all tasks are generated, THE SYSTEM SHALL warn for any REQ ID in REQUIREMENTS.md not covered by at least one task. The coverage check is a warning only — not a blocker.
  - *Rationale:* If architecture doesn't reference which requirements each component satisfies, the link between requirements and implementation is broken. The coverage check catches requirements that fell through the cracks.
  - Given REQUIREMENTS.md contains REQ-WX-1, When architecture is generated, Then REQ-WX-1 appears inline referencing the component that satisfies it.
  - Given a task traces to REQ-WX-1, When its frontmatter is examined, Then REQ-WX-1 is listed.
  - Given all tasks collectively cover all REQ IDs except REQ-CAL-1, When the coverage check runs, Then a warning names REQ-CAL-1 as uncovered.
- **REQ-P-4:** WHEN `--overwrite` is specified, THE SYSTEM SHALL remove all plan-produced artifacts (`tasks/`, `arch/`, `ARCHITECTURE.md`, `README.md`) before planning. Gather-produced artifacts (REQUIREMENTS.md, analysis/) SHALL be preserved.
  - *Rationale:* Incremental re-planning can accumulate stale artifacts. `--overwrite` guarantees a clean slate without losing the requirements that feed the pipeline.
  - Given a previous plan populated arch/ and tasks/, When `--overwrite` is specified, Then those directories and ARCHITECTURE.md are removed before planning starts.
  - Given `--overwrite` is specified, When plan runs, Then REQUIREMENTS.md and analysis/ are untouched.
- **REQ-P-5:** Each task file SHALL be self-contained — including enough context for a developer agent to implement without cross-referencing requirements. Tasks SHALL include acceptance criteria, expected inputs/outputs, error cases, and the rationale behind the task. Tasks that say only "implement X" without specifying behavior are insufficient.
  - *Rationale:* The developer agent processes one task at a time with limited context. Front-loading detail reduces dependence on loading full requirements, decreasing context usage and improving output quality.
  - Given a task for creating an API endpoint, When reviewed, Then it includes the route, method, request/response shape, error cases, and the user story it satisfies.
  - Given a task creates test files, When reviewed, Then it identifies which acceptance criteria the tests must validate.
  - Given any generated task, When reviewed, Then it describes file content only — no shell commands.
  - Given any generated task, When reviewed, Then it does not target `.voidrift/` paths. Dot-prefixed project files (`.github/`, `.dockerignore`, etc.) are valid targets.
- **REQ-P-6:** WHEN task files are generated, THE SYSTEM SHALL validate skill references against available skills. Invalid references SHALL be corrected to the closest valid match when possible, or stripped when no match exists. Corrections SHALL be logged at info level; removals SHALL be logged as warnings.
  - *Rationale:* Local models invent skill names despite being given the valid list. Post-generation validation recovers skill context that would otherwise be silently lost — a task with no skill is worse than one with an approximate match.
  - Given a task references a skill name similar to a valid skill, When validation runs, Then the reference is corrected and logged.
  - Given a task references a skill with no valid match, When validation runs, Then the reference is stripped and a warning is logged.
- **REQ-P-7:** WHEN plan artifacts already exist and `--overwrite` is not specified, THE SYSTEM SHALL run in update mode. A delta analysis stage SHALL identify which requirements appear satisfied by existing implementation and which have no corresponding source. The pipeline SHALL then focus on unimplemented work. WHEN no plan artifacts exist, THE SYSTEM SHALL run the full pipeline (fresh plan).
  - *Rationale:* Re-running plan after partial implementation should produce tasks for remaining work, not re-plan everything.
  - Given ARCHITECTURE.md and manifest.yml exist, When plan runs without `--overwrite`, Then delta analysis runs and the pipeline focuses on unimplemented requirements.
  - Given no plan artifacts exist, When plan runs, Then the full pipeline runs without delta analysis.
- **REQ-P-8:** WHEN `--idea <id>` is specified, THE SYSTEM SHALL include the idea file as planning context alongside REQUIREMENTS.md. Tasks produced SHALL be tagged with the idea ID. WHEN the idea file has no requirements (not yet run through gather), THE SYSTEM SHALL exit with an error directing the operator to run gather first. WHEN all tasks tagged with the idea ID reach verified status, THE SYSTEM SHALL automatically mark the idea as done and archive it.
  - *Rationale:* Idea-scoped planning keeps the task set focused on a single feature. Auto-archival closes the loop — the operator doesn't need to manually mark ideas done after all work is verified.
  - Given `plan --idea 3` and idea 3 has requirements, When plan runs, Then all produced tasks are tagged with idea 3.
  - Given `plan --idea 3` and idea 3 has no requirements, When plan runs, Then the command exits with an error directing the operator to run gather first.
  - Given all tasks tagged with idea 3 are verified, When the CLI checks, Then idea 3 is marked done and archived.

#### 4.3.3 Develop

- **REQ-D-1:** WHEN the task manifest does not exist, THE SYSTEM SHALL exit with an error prompting the operator to run plan. No model calls SHALL be made. WHEN the manifest contains no dispatchable tasks (all verified, blocked, or empty), THE SYSTEM SHALL exit with "all tasks complete" and return 0.
  - Given no manifest.yml exists, When develop is run, Then the command exits with an error prompting plan.
  - Given all tasks are verified, When develop is run, Then the command exits with code 0 and "all tasks complete."
- **REQ-D-2:** WHEN a develop session starts, THE SYSTEM SHALL acquire an exclusive lock. IF another develop session is already running, THE SYSTEM SHALL exit with an error identifying the active session. Stale locks from dead processes SHALL be recovered automatically.
  - *Rationale:* Concurrent develop sessions would write to the same files and corrupt the manifest.
  - Given no active session, When develop starts, Then the lock is acquired.
  - Given an active session with a live PID, When develop is run, Then it exits with an error.
  - Given a stale lock from a dead process, When develop is run, Then the lock is recovered and the session starts.
  - Given an active develop session, When the process is interrupted or crashes, Then the lock is cleaned up.
- **REQ-D-3:** THE SYSTEM SHALL dispatch tasks based on dependency readiness — a task is dispatchable when its status is planned and all dependencies are implemented or verified. Ready tasks SHALL be dispatched concurrently up to the model's concurrency limit. Each task agent receives the task file as its prompt. WHEN a task agent completes with file writes, THE SYSTEM SHALL mark the task as implemented. WHEN no dispatchable tasks remain, the session exits.
  - *Rationale:* Self-contained task files eliminate context-loading tool calls. The system dispatches at the task level, not the module level — if 4 tasks across 3 modules are all ready, all 4 dispatch concurrently.
  - Given 3 dispatchable tasks and concurrency is 3, When develop runs, Then all 3 are dispatched concurrently.
  - Given concurrency is 1, When develop runs, Then tasks are processed sequentially.
  - Given multiple tasks running concurrently, When git operations are triggered, Then they are serialized to prevent index conflicts.
  - Given a task completes with file writes, When the commit is made, Then the commit message identifies the task.
  - Given concurrent tasks are running, When the operator watches, Then a live table shows per-task progress (status, turn, tokens, context %, elapsed, last tool). Sequential mode uses a single-task spinner.
  - Given a task completes with file writes, When the system checks, Then the task is marked implemented.
  - Given no tasks are dispatchable, When the dispatch loop checks, Then the session exits.
- **REQ-D-4:** THE SYSTEM SHALL verify that each task agent produces at least one file write. WHEN the agent attempts to complete with zero writes, THE SYSTEM SHALL reject the completion and instruct the agent to write files. WHEN the agent responds with text only (no tool calls), THE SYSTEM SHALL nudge it to write files (up to 2 nudges per task). IF a task completes with no writes after these guards, THE SYSTEM SHALL retry once. IF the retry also produces no writes, THE SYSTEM SHALL escalate to the architect. IF git is initialized and writes occurred but `git diff` shows no changes, THE SYSTEM SHALL log a warning.
  - *Rationale:* Small models call done prematurely or exit via text-only responses. Structural guards prevent premature exit regardless of model instruction-following quality.
  - Given a task agent calls done with zero writes, When the system intercepts, Then the completion is rejected and the agent continues.
  - Given a task agent responds with text only, When the system detects it, Then a nudge is injected (up to 2 times).
  - Given a task completes with no writes after guards, When the system checks, Then the task is retried once.
  - Given a retry also produces no writes, When the system checks, Then the task is escalated to the architect.
- **REQ-D-5:** WHEN a task is escalated, THE SYSTEM SHALL consult the architect model with the escalation context and retry the task with the architect's guidance. WHEN only one model is provided, THE SYSTEM SHALL use it for both task execution and escalation. WHEN a task failed verification, the architect SHALL receive the bug report alongside the task ticket.
  - *Rationale:* Any model can fill either role. A single capable model can handle both implementation and design guidance. Bug reports give the architect the failure evidence needed to diagnose root cause rather than guessing.
  - Given a task is escalated, When the architect is consulted, Then it receives the problem description, requirements, architecture, and task text — no source code. The task is then retried with the architect's guidance.
  - Given a task failed verification, When it is re-dispatched, Then the architect receives the bug report and appends guidance to the task file before the agent retries.
  - Given only one model is provided, When escalation occurs, Then the same model serves as architect.
  - Given escalations for a task exceed the limit (default 5), When the next escalation would occur, Then the task is marked blocked and the system continues to the next task.
- **REQ-D-6:** WHEN a task agent fails (exception or exhausted retries), THE SYSTEM SHALL roll back all file changes made by that task — restoring modified files, deleting newly created files, and restoring deleted files. WHEN a task succeeds, writes persist. Each concurrent task's rollback scope SHALL be isolated.
  - *Rationale:* A task that writes 3 of 5 files before failing leaves the project in an inconsistent state. Rollback ensures each task is atomic — either all writes persist or none do.
  - Given a task modifies a file then fails, When rollback runs, Then the file is restored to its pre-task content.
  - Given a task creates a new file then fails, When rollback runs, Then the file is deleted.
  - Given a task deletes a file then fails, When rollback runs, Then the deleted file is restored.
  - Given two concurrent tasks, When one fails, Then rollback affects only that task's files.
- **REQ-D-7:** WHEN a develop session starts, THE SYSTEM SHALL scan the manifest for tasks left in an in-progress state from a previous crashed session. In interactive mode, THE SYSTEM SHALL prompt the operator per orphaned task: reset to planned, skip, or mark failed. In non-interactive mode, THE SYSTEM SHALL auto-reset all orphaned tasks to planned. This recovery SHALL complete before any task is dispatched.
  - *Rationale:* A crashed develop session leaves tasks stuck in-progress. These tasks would never be dispatched (D-3 requires planned status) and would silently block progress without recovery.
  - Given a task is in-progress when develop starts (TTY), When recovery runs, Then the operator is prompted to reset, skip, or fail it.
  - Given a task is in-progress when develop starts (non-TTY), When recovery runs, Then it is automatically reset to planned.
  - Given no in-progress tasks, When develop starts, Then recovery is a no-op and dispatch proceeds normally.
- **REQ-D-8:** WHEN a develop run completes, THE SYSTEM SHALL display a per-task change summary showing files created, modified, or deleted with line deltas, and a total across all tasks.
  - *Rationale:* Operators need to know what actually changed — not just which tasks completed. A diff summary provides a quick sanity check before reviewing or committing.
  - Given a task creates one file and modifies another, When the run completes, Then the summary shows both files with their line deltas.
  - Given multiple tasks complete, When the run ends, Then a total line delta across all tasks is shown.
- **REQ-D-9:** WHEN a task agent attempts to write a file it has already written during the current task AND that file has been externally modified since the last write, THE SYSTEM SHALL warn the agent and refuse the write. The agent MAY override the guard to proceed. Files not previously written by the current task SHALL NOT trigger the check.
  - *Rationale:* Concurrent develop sessions or operator edits during a run can modify files mid-task. Silent overwrites would destroy those changes. Warning the agent gives it a chance to merge or abort rather than blindly overwriting.
  - Given an agent writes a file, then the file is externally modified, When the agent attempts to write it again, Then the write is refused with a warning.
  - Given an agent writes a file with no external modification, When the agent writes it again, Then the write succeeds.
  - Given a file not previously written by the current task, When the agent writes it, Then no external modification check is performed.
- **REQ-D-10:** BEFORE each task executes, THE SYSTEM SHALL create a git checkpoint if the working tree has uncommitted changes. WHEN the working tree is clean, no checkpoint is created. Checkpoints SHALL be persisted and available to `voidrift rollback`.
  - *Rationale:* Develop agents modify files. If a task produces bad output, the operator needs a way to restore the project to its pre-task state without manually reverting each file.
  - Given uncommitted changes before a task, When the task is about to run, Then a checkpoint is created.
  - Given a clean working tree before a task, When the task is about to run, Then no checkpoint is created.
- **REQ-D-11:** AFTER a develop task succeeds, THE SYSTEM SHALL compare the files declared in the task against the files actually written. WHEN a declared file was not written during the task, THE SYSTEM SHALL emit a warning naming the missing file. This check SHALL NOT block the task from being marked implemented.
  - *Rationale:* Tasks declare their intended file scope. A mismatch means the agent skipped work — the operator needs to know so they can investigate or re-run the task.
  - Given a task declares 3 files and the agent writes all 3, When the check runs, Then no warning is emitted.
  - Given a task declares 3 files and the agent writes only 2, When the check runs, Then a warning names the missing file and the task is still marked implemented.
- **REQ-D-12:** AFTER a develop agent writes its first file during a task, THE SYSTEM SHALL inject a one-time steering message instructing the agent to re-read each acceptance criterion, confirm the written code satisfies it, and fix any gaps before completing. The message SHALL be injected once per task only — not on subsequent tool rounds. WHEN the agent has not written any files, no steering message SHALL be injected.
  - *Rationale:* Agents that write code and immediately call done often miss acceptance criteria. A post-write self-review prompt catches gaps while the agent still has context to fix them, without requiring a separate verification pass.
  - Given an agent writes its first file during a task, When the next round begins, Then a steering message prompting AC review is injected.
  - Given the steering message was already injected this task, When subsequent rounds occur, Then no additional steering message is injected.
  - Given an agent has not written any files, When the round completes, Then no steering message is injected.
- **REQ-D-13:** The develop task prompt SHALL instruct the agent to read existing code before writing — specifically files listed in the task's dependencies and any existing files at the target paths. The agent SHALL understand established patterns before producing new code.
  - *Rationale:* Agents that write without reading produce code inconsistent with the existing codebase — wrong naming conventions, duplicated utilities, incompatible interfaces. Reading first is the difference between integration and replacement.
  - Given a task with dependency files, When the agent starts, Then it reads those files before writing.
  - Given a target path already exists, When the agent starts, Then it reads the existing file before writing.

#### 4.3.4 Verify

- **REQ-VF-1:** WHEN verify is run, THE SYSTEM SHALL validate that REQUIREMENTS.md exists before performing any model calls. IF missing, THE SYSTEM SHALL exit with an error prompting the operator to run gather.
  - Given REQUIREMENTS.md does not exist, When verify is run, Then the command exits with an error prompting gather.
- **REQ-VF-2:** THE SYSTEM SHALL perform requirements-driven acceptance testing in three stages:
  1. **Plan:** Read all project documentation (REQUIREMENTS.md, ARCHITECTURE.md, arch files, task files). Produce VERIFY-PLAN.md — one self-contained test case per testable requirement. Each test case includes requirement text, scenario steps, expected result, and evidence collection instructions. Non-testable criteria appear as SKIP items with reason.
  2. **Execute:** One concurrent sub-agent per test case. Each executes its scenario using available tools. On failure, a bug report is written with full evidence (request/response detail, expected vs actual, stack traces, screenshots if applicable).
  3. **Report:** Produce VERIFY.md — summary table (total/passed/failed/skipped), per-item results with evidence or bug report links, and a verdict. Write a STATE.md entry recording the run.
  Verify SHALL NOT modify source files — sub-agents have read-only access to project source.
  - *Rationale:* Self-contained test cases eliminate context assembly in the orchestrator. Full-fidelity bug reports mean no re-running to understand failures. Read-only enforcement ensures verify observes without changing.
  - Given 10 criteria (8 testable, 2 qualitative), When the plan stage completes, Then 8 test cases and 2 SKIP items are produced.
  - Given a scenario fails, When the bug report is written, Then it contains full evidence (request/response, expected vs actual, stack traces).
  - Given verify completes, When the report is written, Then VERIFY.md contains a summary table and per-item results.
  - Given a verify sub-agent runs, When it attempts to write source files, Then the write is blocked.
- **REQ-VF-3:** BEFORE the test planning stage, THE SYSTEM SHALL run a documentation verification stage. An agent SHALL check for mismatches between documented behavior (README.md, ARCHITECTURE.md) and implemented behavior — endpoints, environment variables, configuration keys. Mismatches SHALL produce bug reports in the same format as test failures. Results SHALL appear in the final VERIFY.md summary.
  - *Rationale:* Plan generates README before develop runs. Develop changes interfaces but never updates documentation. Catching stale docs early surfaces the problem without giving develop write access to framework files.
  - Given README documents an endpoint that does not exist in source, When doc verification runs, Then a bug report is written.
  - Given README and source are consistent, When doc verification runs, Then no doc-related bug reports are written.

#### 4.3.5 Deploy

- **REQ-DPL-1:** WHEN deploy is run, THE SYSTEM SHALL determine the version bump type (major, minor, or patch) from verified tasks since the last release tag. New features = minor, breaking changes = major, bug fixes = patch. The operator SHALL be prompted to confirm or override the suggested bump. Versions SHALL follow Semantic Versioning (SemVer).
  - *Rationale:* Automated classification from task content prevents version drift. Operator confirmation prevents incorrect bumps.
  - Given verified feature tasks since the last tag, When deploy runs, Then the system suggests a minor bump and the operator confirms or overrides.
  - Given a verified task that modifies a public API contract, When deploy runs, Then the system suggests a major bump.
  - Given REQUIREMENTS.md or ARCHITECTURE.md is missing, When deploy is run, Then the command exits with an error identifying the missing artifact and which command produces it — no model calls are made.
- **REQ-DPL-2:** Deploy SHALL generate a changelog entry from the task history listing verified tasks since the last release tag, grouped by module, with task summaries. The changelog SHALL be appended to CHANGELOG.md (or created if absent).
  - *Rationale:* The task history is the canonical record of completed work. Generating the changelog from it ensures accuracy and eliminates manual maintenance.
  - Given 5 tasks verified since the last tag, When deploy generates the changelog, Then all 5 appear grouped by module with summaries.
- **REQ-DPL-3:** Deploy SHALL create an annotated git tag (`v{version}`) marking the release. The tag message SHALL contain the changelog entry.
  - *Rationale:* A git tag locks the changeset. The annotated message provides release context without requiring a separate file lookup.
  - Given version 1.2.0 is confirmed, When deploy tags, Then `v1.2.0` is created as an annotated tag with the changelog as the message.
- **REQ-DPL-4:** WHEN ARCHITECTURE.md indicates infrastructure requirements, deploy SHALL generate or update infrastructure-as-code. WHEN no infrastructure sections exist, IaC generation SHALL be skipped.
  - *Rationale:* Not all projects need IaC. Skipping when unnecessary avoids generating empty or irrelevant infrastructure files.
  - Given ARCHITECTURE.md contains infrastructure sections, When deploy runs, Then IaC artifacts are generated.
  - Given ARCHITECTURE.md has no infrastructure sections, When deploy runs, Then IaC generation is skipped.
  - Given IaC files already exist, When deploy updates them, Then existing files are reconciled for consistency — not deleted.
  - Given IaC is generated, When reviewed, Then no hardcoded secrets are present — all sensitive values are parameterized.
  - Given IaC is generated, When reviewed, Then every cloud resource is tagged with project name and environment.
- **REQ-DPL-5:** WHEN a `post_deploy` hook is configured in ARCHITECTURE.md, deploy SHALL execute it as a shell command after tagging. The new version SHALL be available to the command. IF the hook fails, deploy SHALL warn but NOT roll back the tag.
  - *Rationale:* Post-deploy hooks let the operator trigger project-specific actions (CI pipelines, registry pushes, notifications) without deploy prescribing a deployment strategy.
  - Given a post-deploy hook is configured, When deploy completes tagging v1.2.0, Then the hook is executed with the version available.
  - Given the hook fails, When deploy checks, Then a warning is emitted and the tag remains.

### 4.4 Utility Commands

- **REQ-UTIL-1:** `voidrift status` SHALL display command completion status (done, not started, in progress) and task counts grouped by lifecycle status (planned, in-progress, implemented, verified, failed, blocked). Total task count and idea count SHALL be shown. No model required. WHEN no manifest exists, a message SHALL indicate no active project.
  - Given gather and plan have completed but develop has not started, When status is run, Then gather and plan show done, develop shows not started, with task counts by status.
  - Given no manifest exists, When status is run, Then a message indicates no active project.
- **REQ-UTIL-2:** `voidrift log` SHALL show the last 200 lines of the project log (`.voidrift/voidrift.log`). `voidrift log <command>` SHALL extract and show the last 200 lines of the most recent section for that command. `--follow` SHALL tail the log, streaming new lines. `--prune` SHALL delete the project log. `--global` SHALL target the global framework log (`~/.voidrift/logs/voidrift.log`) instead. WHEN no `.voidrift/` directory exists and `--global` is not set, THE SYSTEM SHALL exit with a friendly error.
  - *Rationale:* Operators need to inspect command output after the fact — both project-level agent dialog and global invocation history. Mirroring docker-log ergonomics (tail, follow, filter by command) keeps the interface familiar.
  - Given a gather log exists, When `log gather` is run, Then the last 200 lines of the most recent gather section are shown.
  - Given `--global` is set, When `log` is run from any directory, Then the global framework log is shown.
  - Given no `.voidrift/` exists and `--global` is not set, When `log` is run, Then a friendly error is shown.
- **REQ-UTIL-3:** `voidrift unlock` SHALL remove the develop lock and kill any running develop process.
  - Given a stale lock exists, When unlock is run, Then the lock is removed.
- **REQ-UTIL-4:** `voidrift completions <shell>` SHALL output shell completion scripts. Model alias arguments SHALL complete from configured aliases.
  - Given bash completions are generated, When sourced, Then model aliases complete on tab.
- **REQ-UTIL-5:** `voidrift prune` SHALL remove project-level ephemeral data beyond the configured retention limit. `--all` SHALL remove the entire `.voidrift/` directory. `--global` SHALL prune global framework logs beyond the retention limit. `--global --all` SHALL remove all global logs. WHEN no `.voidrift/` directory exists and `--global` is not set, THE SYSTEM SHALL exit with a friendly error.
  - Given 10 project logs and retention is 5, When prune runs, Then the 5 oldest are removed.
  - Given `--all` is specified, When prune runs, Then the entire `.voidrift/` directory is removed.
  - Given analysis cache entries reference deleted source files, When prune runs, Then stale entries are removed.
  - Given analysis entries older than the configured TTL, When prune runs, Then expired entries are removed.
  - Given entries exceed the configured max after stale/expired removal, When prune runs, Then the oldest are removed by LRU. Prune reports counts per stage and bytes freed.
- **REQ-UTIL-6:** `voidrift doctor` SHALL run diagnostic checks and report pass/warn/fail per check: config file syntax, models file existence and syntax, skill file parseability, log directory writability, and disk space. `--fix` SHALL auto-remediate where safe (create missing directories). The command SHALL NOT require a models file to run — it diagnoses its absence.
  - Given config.yml has a syntax error, When doctor runs, Then it reports fail with the error location.
  - Given `--fix` and a missing log directory, When doctor runs, Then the directory is created.
  - Given an optional tool dependency is not installed, When doctor runs, Then a warn (not fail) is reported with the install command.
  - Given a model entry is missing a required field, When doctor runs, Then a fail is reported identifying the alias and missing field.
- **REQ-UTIL-7:** `voidrift skills` SHALL provide: `search <query>` (query configured repos), `install <name>` (synthesize and install a domain skill as pending), `list` (display all skills by layer), `remove <name>` (remove a domain skill), `approve <name>` (promote pending to active), `review` (display pending skills).
  - Given `skills search typescript`, When repos are queried, Then matching skills are listed with source attribution. Only manifests are queried — full content is not fetched until install.
  - Given `skills install <name>`, When synthesis completes, Then the skill is written as pending — not active until approved.
  - Given `skills list` is run, When skills exist at multiple layers, Then output groups by layer and indicates active vs pending.
- **REQ-UTIL-8:** `voidrift rollback` SHALL list available develop checkpoints. `voidrift rollback <checkpoint>` SHALL restore the working tree to the selected checkpoint. No model required.
  - *Rationale:* Develop agents can produce bad output. Rollback gives the operator a fast recovery path without manually reverting files.
  - Given checkpoints exist, When `voidrift rollback` is run, Then available checkpoints are listed with task ID and timestamp.
  - Given a checkpoint is selected, When `voidrift rollback <checkpoint>` is run, Then the working tree is restored to that checkpoint's state.
- **REQ-UTIL-9:** `voidrift memory` SHALL provide: `list` (display all entries grouped by layer), `show <name>` (print full entry content, searching project then global), `delete <name>` (remove from project memory), `delete <name> --global` (remove from global memory), `export` (export all entries as a single markdown file). No model required.
  - Given entries exist in both layers, When `voidrift memory list` is run, Then entries are displayed grouped by layer.
  - Given `voidrift memory show auth-pattern` and the entry exists in project, When run, Then its full content is printed.
  - Given `voidrift memory delete code-style --global`, When run, Then the global entry is removed.

### 4.5 Cross-cutting Concerns

#### 4.5.1 Configuration

- **REQ-CFG-1:** WHEN a model alias is used, THE SYSTEM SHALL resolve it to connection details (base URL, API key, model ID) from a single models file. The path to this file SHALL be configurable. Each model entry SHALL be self-contained with its own connection details. IF an alias is not found, THE SYSTEM SHALL exit with an error listing all available aliases.
  - *Rationale:* The framework is model-agnostic — one file, one source of truth for all model definitions.
  - Given alias `claude` exists in the models file, When it is resolved, Then connection details are returned.
  - Given alias `foo` does not exist, When resolution is attempted, Then an error lists available aliases.
  - Given a model entry missing a required field (base URL, API key, or model ID), When resolution is attempted, Then an error identifies the alias and missing field, directing the operator to run `voidrift doctor`.
  - Given a model entry with an unrecognized protocol value, When resolution is attempted, Then an error identifies the alias and lists valid protocols.
  - No connection field SHALL be inferred from other fields — the operator explicitly controls every connection detail.
- **REQ-CFG-2:** The models file SHALL support a `defaults:` section specifying fallback values for operational limits. Each model entry inherits defaults and MAY override any field. Supported operational fields: `max_tokens`, `max_context`, `max_read_lines`, `max_input_chars`, `concurrency`. THE SYSTEM SHALL NOT infer operational behavior from model type — all limits are explicit per entry or inherited from defaults.
  - *Rationale:* Different models have different capabilities. Explicit limits with operator-controlled defaults eliminate guessing.
  - Given defaults set `max_tokens: 16384` and a model entry has no `max_tokens`, When resolved, Then `max_tokens` is 16384.
  - Given defaults set `max_tokens: 16384` and a model entry sets `max_tokens: 4096`, When resolved, Then `max_tokens` is 4096.
- **REQ-CFG-3:** All framework configuration SHALL be read from `~/.voidrift/config.yml`. Config values SHALL support variable expansion: `${VAR}` for environment variables, `${VAR:-default}` for environment variables with fallback, and `${section.key}` for cross-referencing within config.yml.
  - Given `api_keys.anthropic: ${ANTHROPIC_API_KEY}`, When config loads, Then the environment variable value is used.
  - Given `${MISSING_VAR:-fallback}`, When config loads, Then "fallback" is used.
  - Given an environment variable containing newline characters, When expanded, Then CR and LF are stripped to prevent log injection.
  - Given a skill file exists in `~/.voidrift/`, When a command loads resources, Then skills, prompts, and templates are read from `~/.voidrift/`.
  - Given `VOIDRIFT_HOME` is set, When the framework resolves paths, Then the override path is used instead of `~/.voidrift/`.
- **REQ-CFG-4:** WHEN any framework command (gather, plan, develop, deploy, verify, chat) is invoked AND the configured models file does not exist, THE SYSTEM SHALL exit with a clear error identifying the missing file. Utility commands (status, doctor, prune, unlock, completions, skills) are exempt — they do not require model resolution.
  - *Rationale:* Without the models file, all model resolution fails with a cryptic empty-list error. A direct error is more actionable.
  - Given the models file does not exist, When a framework command is run, Then an error identifies the missing path.
  - Given the models file does not exist, When `voidrift status` is run, Then it executes normally.
- **REQ-CFG-5:** Output token limits SHALL be configurable per agent stage via config. The effective limit for any stage SHALL be the minimum of the stage's configured limit and the model's `max_tokens`. WHEN no stage-specific config exists, a built-in default SHALL be used. No hardcoded max_tokens values SHALL exist in command code.
  - *Rationale:* Different stages have different output needs — triage returns JSON, consolidation returns a full document. Operators need to tune without editing source.
  - Given a model with max_tokens=4096 and a stage default of 8192, When the limit is resolved, Then 4096 is used (model cap wins).
  - Given a config override for a stage, When the limit is resolved, Then the config value is used (capped by model).

#### 4.5.2 Skills

- **REQ-SKL-1:** THE SYSTEM SHALL maintain three skill layers with distinct purposes:
  - **North star (global):** Universal principles that orient agents across any project. Language-agnostic — describe principles, not syntax. Shipped with the framework.
  - **Domain:** Specific knowledge for a technology, platform, or API. Reusable across projects. Installed via `voidrift skills install`.
  - **Project:** Project-specific overrides. Highest precedence — contain constraints, decisions, and patterns unique to this codebase.
  A project skill with the same name as a domain or north-star skill SHALL fully replace it — no merging. Resolution order: project → domain → north star (first match wins).
  - *Rationale:* Separating layers prevents project constraints from polluting global guidance and domain noise from diluting north-star principles.
  - Given a project skill `QUALITY-QA` exists, When the skill is resolved, Then the project version is used and the north-star version is ignored.
  - Given no project or domain skill for `BACKEND-ENG`, When resolved, Then the north-star version is returned.
  - Given no skill exists at any layer for a requested name, When resolved, Then a warning is logged.
- **REQ-SKL-2:** Skills MAY restrict which tools the agent can use while the skill is active. Restrictions can only reduce the command's tool set, never expand it. WHEN a skill with tool restrictions is active and the agent calls a blocked tool, THE SYSTEM SHALL return an error naming the skill and listing allowed tools. No restrictions means all command tools are available.
  - Given a skill restricts tools to `[file]`, When the agent calls `shell`, Then the call is blocked with an error.
  - Given a skill with no tool restrictions, When the agent calls any tool, Then no restriction is applied.
- **REQ-SKL-3:** WHEN a referenced skill is not found at any layer AND a synthesis model is configured, THE SYSTEM SHALL auto-synthesize the skill and write it as pending. The synthesized skill SHALL NOT be active until approved. WHEN no synthesis model is configured, THE SYSTEM SHALL warn and continue without the skill.
  - *Rationale:* Operators in niche domains encounter missing skills. Auto-synthesis provides a starting point without interrupting the workflow. The approval gate ensures synthesized content is reviewed before influencing agents.
  - Given a missing skill and synthesis_model configured, When a command references it, Then a pending skill is synthesized and a warning is displayed.
  - Given no synthesis_model configured, When a skill is not found, Then a warning is logged and execution continues.

#### 4.5.3 Memory

- **REQ-MEM-1:** THE SYSTEM SHALL maintain a two-layer memory system: project memory (facts, conventions, decisions specific to this project) and global memory (operator preferences shared across all projects). Project entries with the same name as global entries SHALL override the global entry.
  - *Rationale:* Two layers separate project-specific facts from cross-project preferences, matching the skill resolution pattern. Project overrides global so project-specific conventions take precedence.
  - Given a project entry `auth-pattern` and a global entry `auth-pattern`, When memory is resolved, Then the project entry is used.
  - Given a global entry `code-style` with no project override, When memory is resolved, Then the global entry is used.
- **REQ-MEM-2:** WHEN chat starts (non-bare mode), THE SYSTEM SHALL inject a memory index into the agent's system prompt containing the names and descriptions of all memory entries — not full content. Full entry content SHALL be loaded on demand. WHEN `/bare` is active, memory injection SHALL be skipped.
  - *Rationale:* Injecting only the index keeps context consumption minimal. The agent loads full entries when needed, not upfront.
  - Given project and global memory entries exist, When chat starts, Then the system prompt contains entry names and descriptions but not full content.
  - Given `/bare` is active, When the bare agent starts, Then no memory is injected.
- **REQ-MEM-3:** THE SYSTEM SHALL provide memory tools in chat: read an entry by name (searching project first then global), write an entry (defaulting to project scope), and list all entries. Memory tools SHALL be available in chat only.
  - *Rationale:* Agents need to persist and retrieve knowledge across sessions. Chat-only availability matches the memory system's purpose — automated commands don't accumulate knowledge.
  - Given `memory(read, "code-style")` and the entry exists only in global, When called, Then the global entry content is returned.
  - Given `memory(write, "api-notes", "...", scope="project")`, When called, Then the entry is written to project memory.
  - Given `cmd="develop"`, When tools are built, Then memory tools are not present.

#### 4.5.4 Tools

- **REQ-TOOL-1:** THE SYSTEM SHALL handle large content gracefully across all commands — never silently truncating, never crashing. Strategies:
  - **Reads:** WHEN a file exceeds the configured line limit, THE SYSTEM SHALL return a paginated result with a warning header containing total lines, lines returned, and pagination instructions. A secondary byte-count guard SHALL cap results regardless of line count.
  - **Writes:** WHEN content to be written exceeds the configured line limit, THE SYSTEM SHALL reject the write with an error directing the model to decompose into smaller files.
  - **Analysis:** WHEN a file exceeds the model's input size limit during automated analysis, THE SYSTEM SHALL split it into chunks, analyze each separately, and consolidate the results into a single unified output.
  - The system prompt SHALL instruct models to: follow pagination warnings, treat write rejections as decomposition signals, and never truncate content to fit.
  - *Rationale:* Models that read oversized files fill their context with raw code, leaving no room for reasoning. Models that write oversized files create content they cannot read back. Silent truncation destroys content. Explicit limits with clear guidance produce better architecture (decomposition) rather than worse output (truncation).
  - Given a 3000-line file read with a 2000-line limit, When read is called, Then lines 1–2000 are returned with a pagination warning.
  - Given a model attempts to write 2500 lines with a 2000-line limit, When write is called, Then the write is rejected with a decomposition directive.
  - Given a file exceeding the model's input limit during analysis, When analyzed, Then it is chunked and consolidated into one result.
  - Given a file with very long lines whose paginated result exceeds the byte limit, When read is called, Then the result is capped at the byte boundary with a marker.
- **REQ-TOOL-2:** THE SYSTEM SHALL provide a process lifecycle tool that starts long-running processes, returns an opaque handle, and captures stdout/stderr. The tool SHALL support readiness detection via multiple strategies (HTTP health check, port availability, log pattern matching). Timeout SHALL stop the process and raise an error.
  - *Rationale:* Verify sub-agents need to start systems under test and wait for readiness before executing scenarios. An opaque handle avoids exposing OS PIDs and allows centralized lifecycle management.
  - Given a valid command, When process start is called, Then a handle is returned and the process runs with output captured.
  - Given a started process, When readiness is checked via HTTP, Then the tool polls until a 200 response or timeout.
  - Given a started process, When readiness is checked via log pattern, Then the tool scans output until the pattern appears or timeout.
  - Given any verify outcome (success, failure, or exception), When the run completes, Then all started processes are stopped and cleaned up.
  - Given a started process, When output is read, Then up to 500 buffered lines are returned (newest kept on overflow).
- **REQ-TOOL-3:** THE SYSTEM SHALL provide an HTTP tool with per-session cookie and auth header persistence. Multiple named sessions SHALL be supported per agent. Sessions SHALL be scoped to the command run and cleaned up on completion.
  - *Rationale:* Acceptance testing involves authenticated flows across multiple requests. Session persistence eliminates manual cookie and token tracking between steps.
  - Given a login request returns a Set-Cookie header in session "alice", When a subsequent request uses the same session, Then the cookie is sent automatically.
  - Given a command run completes, When cleanup runs, Then all HTTP sessions are discarded.
- **REQ-TOOL-4:** WHEN the chat agent fetches a URL, THE SYSTEM SHALL prompt the operator for confirmation before making the request. Approved fetches SHALL be summarized to a concise result before entering the chat context — raw page content SHALL NOT be injected. Summaries SHALL be cached by URL within the session; repeated fetches return the cache without re-prompting. Fetch failures SHALL return an error description, not propagate exceptions.
  - *Rationale:* Raw page content can be hundreds of KB — injecting it directly would consume most of the context window. Summarization keeps context small. Operator confirmation prevents unwanted network requests.
  - Given a URL, When the agent fetches it, Then the operator is prompted to allow or deny before any connection is made.
  - Given the operator allows, When the fetch completes, Then a concise summary is returned — not raw content.
  - Given the same URL was fetched earlier in the session, When fetched again, Then the cached summary is returned without re-prompting.
  - Given a fetch fails, When the error occurs, Then an error description is returned to the agent.
- **REQ-TOOL-5:** THE SYSTEM SHALL provide an `ask` tool that displays a question to the operator and returns their response. WHEN options are provided, they SHALL be displayed as a numbered list. WHEN stdin is not a TTY, THE SYSTEM SHALL return a fallback message indicating no operator is present. The tool SHALL be available in chat only.
  - *Rationale:* Models encountering genuine ambiguity have no mechanism to ask the operator. A clarifying question tool lets the model resolve ambiguity directly instead of guessing or stalling.
  - Given a chat session, When the agent asks a question with options, Then the operator sees the question with numbered choices and their response is returned.
  - Given stdin is not a TTY, When ask is called, Then a fallback message is returned without blocking.
- **REQ-TOOL-6:** THE SYSTEM SHALL provide a session search tool that searches conversation history by case-insensitive keyword match, including entries before compaction boundaries. Results SHALL be sorted by recency and include timestamp, role, and content (truncated to 2000 characters). Chat-only.
  - *Rationale:* After compaction, specific wording and decisions from earlier turns are lost from the agent's context. Session search recovers them without requiring an embedding model.
  - Given a query matching 3 entries, When session search is called, Then up to 3 matching entries are returned with timestamps and roles.
  - Given no matches, When session search is called, Then a "no matches found" message is returned.
- **REQ-TOOL-7:** THE SYSTEM SHALL provide a document analysis tool that extracts text from binary formats (PDF, DOCX, XLSX) and returns plaintext or markdown. XLSX output SHALL be formatted as markdown tables per sheet. DOCX output SHALL preserve heading hierarchy. Extraction libraries are soft dependencies — WHEN not installed, the tool SHALL return an error naming the missing package. Available in chat and gather only.
  - *Rationale:* Enterprise environments deliver requirements as Word/PDF. Supporting these formats reduces manual conversion. Soft dependencies keep the core CLI lightweight.
  - Given a PDF file and the extraction library is installed, When document analysis is called, Then extracted text is returned.
  - Given a DOCX file, When analyzed, Then heading hierarchy is preserved as markdown.
  - Given a required library is not installed, When the tool is called, Then an error names the missing package.
- **REQ-TOOL-8:** THE SYSTEM SHALL provide a code analysis tool that parses a source file and returns structured metadata: language, line count, imports, exported symbols (with line numbers), and complexity estimate. Language detection SHALL use file extension. Available in chat and gather only.
  - *Rationale:* Machine-parsed facts (imports, symbols, complexity) are more accurate than prompt-based parsing and reduce context consumption for large files.
  - Given a Python file, When code analysis is called, Then structured metadata is returned with imports, symbols, and complexity.
  - Given an unsupported file extension, When code analysis is called, Then an error lists supported languages.
- **REQ-TOOL-9:** THE SYSTEM SHALL provide a file edit tool for surgical modifications. The tool SHALL find an exact match of the target string and replace it. WHEN the target string appears more than once, THE SYSTEM SHALL reject the edit with an error containing the occurrence count and an instruction to add surrounding context for uniqueness. WHEN no exact match is found, THE SYSTEM SHALL attempt a whitespace-normalized match and apply the replacement preserving original indentation. WHEN no match is found after normalization, THE SYSTEM SHALL return an error with the first 3 lines of the target string for debugging. Available in develop and chat.
  - *Rationale:* Full-file writes for one-line changes waste output tokens. Surgical edits reduce cost by 10–50x for modification tasks. Ambiguity rejection prevents silent wrong-location edits.
  - Given `old_str` matches exactly once, When edit is called, Then the replacement succeeds.
  - Given `old_str` appears 3 times, When edit is called, Then an error is returned with the count and uniqueness instruction.
  - Given `old_str` matches only after whitespace normalization, When edit is called, Then the replacement succeeds preserving original indentation.
  - Given no match even after normalization, When edit is called, Then an error is returned with the first 3 lines of `old_str`.
- **REQ-TOOL-10:** Tools MAY carry usage guidelines that are automatically injected into the agent's system prompt. WHEN a tool defines guidelines, THE SYSTEM SHALL include them in the prompt. Tools without guidelines contribute nothing.
  - *Rationale:* Co-locating usage guidance with tool definitions prevents stale documentation in prompt files. When a tool changes, its guidance travels with it.
  - Given a tool with usage guidelines, When the agent is initialized, Then the guidelines appear in the system prompt.
  - Given a tool with no guidelines, When the agent is initialized, Then no guidance is contributed for that tool.

#### 4.5.5 Security

- **REQ-SEC-1:** Shell execution SHALL be configurable per command: enabled/disabled, allowed command patterns (glob), and timeout. Per-command configuration SHALL override global defaults. Per-command patterns can only narrow what is permitted — they cannot widen the global `allowed_commands` list. WHEN shell is disabled for a command, shell tool calls SHALL be rejected. Shell output SHALL be truncated at a configurable line limit with a count of omitted lines.
  - *Rationale:* Different commands need different shell access. Develop agents get a narrow allowlist; chat agents get broader access. Operators control the boundary without editing source. Output truncation prevents shell results from flooding agent context.
  - Given shell is disabled for a command, When the agent calls shell, Then the call is rejected.
  - Given `allowed_patterns: ["make *", "pytest *"]` for develop, When the agent runs `rm -rf /`, Then the call is rejected.
  - Given per-command patterns are set, When evaluated, Then they can only restrict — not expand — the global allowed list.
  - Given shell output exceeds the configured line limit, When the command completes, Then output is truncated with a count of omitted lines.
- **REQ-SEC-2:** File tool operations SHALL be sandboxed to their designated root directory. Agents operating on source files SHALL be restricted to the project directory. Agents operating on framework artifacts SHALL be restricted to `.voidrift/`. Path traversal attempts SHALL be blocked and logged.
  - *Rationale:* Without sandboxing, a compromised or confused agent can read or write files anywhere on the filesystem. Structural enforcement is stronger than prompt-level instructions.
  - Given an agent attempts to read `/etc/passwd`, When the file tool is called, Then the call is blocked and logged.
  - Given an agent attempts to write `../../outside/file.txt`, When the file tool is called, Then the call is blocked and logged.
- **REQ-SEC-3:** THE SYSTEM SHALL support a `protected_paths` list in config. Files in this list SHALL be blocked from agent writes even within the project root. Violations SHALL be logged.
  - *Rationale:* Operators may have critical files (e.g., `Makefile`, `pyproject.toml`) that should never be modified by agents, even when the agent has write access to the project.
  - Given `protected_paths: ["Makefile"]`, When an agent attempts to write `Makefile`, Then the write is blocked and logged.
  - Given a file not in `protected_paths`, When an agent writes it within the project root, Then the write succeeds.
- **REQ-SEC-4:** THE SYSTEM SHALL classify shell commands by risk level before execution. Commands matching known-destructive patterns (e.g., recursive deletes of system paths, disk overwrites, remote code execution piped to shell) SHALL be blocked and return an error without executing. Commands matching warn-level patterns (e.g., force push, hard reset, sudo) SHALL execute but be flagged. `allowed_commands` in config SHALL override classification to safe for matching patterns. All shell executions SHALL be logged with their classification.
  - *Rationale:* Operator-configured allowlists (SEC-1) control what the agent is permitted to run. Framework-level classification provides a second layer blocking known-dangerous patterns even when the operator hasn't explicitly restricted them.
  - Given a command matching a destructive pattern, When the agent calls shell, Then the command is blocked and an error is returned.
  - Given a command in `allowed_commands`, When the agent calls shell, Then it executes regardless of classification.
  - Given any shell execution, When it completes, Then the command and classification are logged.
- **REQ-SEC-5:** WHEN the HTTP tool makes a request, THE SYSTEM SHALL resolve the target hostname and block requests to private, link-local, and cloud metadata IP ranges to prevent SSRF attacks. Loopback addresses SHALL be allowed by default to support local development servers. DNS resolution failure SHALL be treated as a block. Operators MAY configure an `ssrf_allow_list` of hostnames or CIDRs to override blocking for known-safe internal endpoints.
  - *Rationale:* An agent with HTTP access could be directed to probe internal services, cloud metadata endpoints, or private network resources. DNS-based blocking closes this path without requiring operators to enumerate every internal address.
  - Given an HTTP request to `169.254.169.254` (cloud metadata), When the request is made, Then it is blocked.
  - Given an HTTP request to `localhost:8080`, When the request is made, Then it is allowed.
  - Given a hostname in `ssrf_allow_list`, When an HTTP request is made to it, Then it is allowed even if it resolves to a private IP.
  - Given DNS resolution fails for a hostname, When an HTTP request is made, Then it is blocked.

#### 4.5.6 Git

- **REQ-GIT-1:** WHEN any component reads git diff output, THE SYSTEM SHALL apply configurable safety limits: maximum total lines, maximum files, and maximum lines per file. Binary files SHALL be excluded from diff text and listed separately. WHEN any limit is exceeded, the output SHALL include an explicit truncation marker identifying the limit and amount omitted. Git subprocess calls SHALL use timeouts.
  - *Rationale:* Unbounded git diff on large projects can exhaust memory. Binary files produce unreadable diff content. Explicit truncation markers ensure the consumer knows the diff is incomplete.
  - Given a diff exceeding the line limit, When bounded diff runs, Then the result is truncated with a marker showing lines omitted.
  - Given binary files in the diff, When bounded diff runs, Then they are listed separately and excluded from diff text.
  - Given all limits are within bounds, When bounded diff runs, Then no truncation marker is present.
- **REQ-GIT-2:** WHEN develop or chat starts in a git repository, THE SYSTEM SHALL capture a git context snapshot — current branch, recent commits, and uncommitted changes — and inject it into each agent's system prompt. The snapshot SHALL be captured once per run and shared across all agents. WHEN the directory is not a git repository or git is unavailable, THE SYSTEM SHALL skip injection silently.
  - *Rationale:* Without git context, agents may overwrite uncommitted work or duplicate changes already committed. A compact snapshot gives agents enough awareness to avoid these mistakes without consuming significant context.
  - Given a git repo with uncommitted changes, When develop starts, Then each agent's prompt includes branch, recent commits, and changed files.
  - Given the project is not a git repo, When develop starts, Then no git context is injected and no error is raised.

#### 4.5.7 Logging

- **REQ-LOG-1:** All command runs SHALL append to a project-level log file in `.voidrift/`. The log SHALL rotate when it exceeds a configurable size, with a configurable maximum backup count.
  - Given multiple commands run, When the log is checked, Then all runs appear in the same file.
  - Given the log exceeds the size limit, When the next write occurs, Then the log rotates and a new file is created.
- **REQ-LOG-2:** THE SYSTEM SHALL maintain a persistent global framework log at `~/.voidrift/logs/` with file rotation. The framework log records CLI invocations, command outcomes, config errors, and unhandled exceptions across all projects. Each invocation entry SHALL include the working directory, model alias (when applicable), and command arguments. Each outcome entry SHALL include the exit code and elapsed time.
  - Given a command runs in any project, When the framework log is checked, Then the invocation is recorded with cwd and model.
  - Given a command completes, When the framework log is checked, Then the outcome entry includes exit code and elapsed time.
- **REQ-LOG-3:** Both project and framework logs SHALL record: CLI invocations, command outcomes, agent interactions, tool calls with arguments, tool results, and errors. Agent loop iterations SHALL include structured entries explaining why each iteration occurred (tool call, stall recovery, truncation recovery, follow-up) and a summary on loop exit with total turns and token counts.
  - *Rationale:* Structured transition entries enable post-run debugging and cost attribution without inferring causation from message content.
  - Given a 3-turn loop, When the log is read, Then each turn has a structured entry with the iteration reason.
  - Given a chat session with two exchanges, When the session ends, Then the log file contains both operator inputs and both model responses.
- **REQ-LOG-4:** WHEN a command run completes with errors, THE SYSTEM SHALL display an error summary grouped by category (API, tool, filesystem, parse, timeout, budget, context) showing counts and whether errors were recoverable.
  - Given a command encounters 2 API errors and 1 tool error, When it completes, Then the summary shows counts per category.

#### 4.5.8 Project Structure

- **REQ-PS-1:** All framework-generated files SHALL be stored in `.voidrift/` within the target project directory.
  - Given any framework command runs, When it produces artifacts, Then they are written under `.voidrift/`.
  - Given no `.voidrift/` directory exists, When the first command runs, Then it is created automatically.
- **REQ-PS-2:** `.voidrift/STATE.md` SHALL be append-only, written to by every framework command. Each entry records: timestamp, command name, model used, outcome summary, and a file manifest of artifacts created or modified. The chat agent SHALL read STATE.md to understand project lifecycle position.
  - *Rationale:* A single state file provides lifecycle traceability, enables `--undo` and `--overwrite` by tracking what each command produced, and gives the chat agent lifecycle awareness without inferring from file existence.
  - Given gather completes, When STATE.md is checked, Then an entry records the command, model, and files produced.
  - Given the chat agent starts, When it reads STATE.md, Then it knows which commands have run and their outcomes.

#### 4.5.9 Task Management

- **REQ-TM-1:** The task manifest SHALL be owned exclusively by the CLI — no agent tool provides write access to it. The manifest SHALL contain only active work — when a task is archived, it SHALL be removed from the manifest and recorded in history.log.
  - *Rationale:* CLI ownership prevents agents from corrupting the dependency graph or status tracking. Keeping only active work in the manifest keeps it small and fast to read.
  - Given an agent completes a task, When the CLI marks it implemented, Then the manifest is updated by the CLI — not by the agent.
  - Given a task is verified and archived, When the manifest is read, Then the archived task is absent and its record appears in history.log.
- **REQ-TM-2:** Each task SHALL have a lifecycle status with the following valid states and transitions:
  - `planned → in-progress`: develop dispatches the task
  - `in-progress → implemented`: agent completes writes successfully
  - `implemented → verified`: verify passes all ACs
  - `implemented → failed`: verify fails ACs
  - `failed → in-progress`: develop re-dispatches with bug context
  - `planned → blocked`: a dependency is set to failed
  - `blocked → planned`: all dependencies are implemented or verified
  - *Rationale:* Explicit lifecycle states make task progress visible and enable correct dispatch decisions without inference.
  - Given a task is planned with all dependencies verified, When develop runs, Then the task transitions to in-progress.
  - Given a task is implemented, When verify fails its ACs, Then the task transitions to failed.
  - Given a task is failed, When develop re-dispatches it, Then the task transitions to in-progress with bug context appended.
- **REQ-TM-3:** WHEN a task is set to failed, THE SYSTEM SHALL transitively block all dependent tasks. WHEN a failed task is subsequently set to implemented, THE SYSTEM SHALL unblock dependents whose other dependencies are all met.
  - *Rationale:* Dispatching tasks that depend on broken work produces cascading failures. Automatic unblocking resumes work as soon as blockers are resolved without operator intervention.
  - Given task B depends on task A, When task A fails, Then task B is blocked.
  - Given task B is blocked because task A failed, When task A is re-implemented, Then task B is unblocked and becomes dispatchable.
- **REQ-TM-4:** WHEN a task is archived, THE SYSTEM SHALL append an event to `.voidrift/tasks/history.log`. The log SHALL be append-only and never modified. It is used for reporting and deploy changelog generation.
  - *Rationale:* The manifest contains only active work. History.log provides the permanent record of what was done, when, and in what order — needed for changelog generation and audit.
  - Given a task is verified and archived, When history.log is checked, Then an entry records the task ID, status, module, and timestamp.
  - Given history.log exists, When a new task is archived, Then the new entry is appended — no existing entries are modified.
- **REQ-TM-5:** WHEN a task reaches verified status, THE SYSTEM SHALL move the task file from `active/` to `archived/`, remove it from the manifest, and append to history.log. WHEN all tasks referencing a bug are verified, THE SYSTEM SHALL move the bug file to `archived/`.
  - *Rationale:* Keeping only active work in `active/` prevents the directory from accumulating completed tasks. Bug files are retained until all related work is verified — archiving them early would lose context for in-progress tasks.
  - Given a task reaches verified, When archival runs, Then the task file is in `archived/` and absent from the manifest.
  - Given a bug is referenced by two tasks and one is verified, When archival runs, Then the bug file remains in `active/`.
  - Given a bug is referenced by two tasks and both are verified, When archival runs, Then the bug file moves to `archived/`.
- **REQ-TM-6:** WHEN a task fails verification, THE SYSTEM SHALL create a bug file containing the failure evidence and link it to the task. Bug files are independent entities with their own ID sequence. The manifest tracks bug-task references without enforcing a 1:1 relationship.
  - *Rationale:* Bug files decouple failure evidence from task files — a task can accumulate multiple bug reports across re-dispatch cycles without the task file growing unbounded.
  - Given a task fails verification, When the CLI processes the failure, Then a bug file is created with the failure evidence and linked to the task.
  - Given a task has multiple verification failures, When each fails, Then a separate bug file is created for each failure.
- **REQ-TM-7:** WHEN a deploy completes successfully and a version tag is created, THE SYSTEM SHALL rotate history.log — archiving the current log under a version-stamped name and starting a new empty log. The archived log SHALL be preserved permanently. WHEN no history.log exists at rotation time, no rotation occurs and no error is raised.
  - *Rationale:* History.log scoped to a release makes changelog generation unambiguous — only work since the last tag is included. Starting fresh after each release prevents the log from growing unbounded.
  - Given a successful deploy creates a version tag, When rotation runs, Then the current history.log is archived and a new empty log is created.
  - Given no history.log exists at deploy time, When rotation runs, Then no error is raised and no file is created.

### 4.6 User Interface

- **REQ-UI-1:** WHEN an automated lifecycle command runs (gather, plan, develop, verify, deploy), THE SYSTEM SHALL display progress without exposing raw agent dialog. In terminal mode, progress appears as spinners and status lines. In chat (slash commands), progress appears as system messages. Raw agent output is captured in command logs only.
  - *Rationale:* Automated pipelines produce verbose agent dialog that is not actionable for the operator. Progress indicators communicate state without noise. Full output is available in command logs.
  - Given a plan command runs in the terminal, When the operator watches, Then they see spinners and status — not raw model output.
  - Given `/gather` runs inside a chat session, When the operator watches, Then progress appears as system messages in the conversation area.
  - Given a slash command is active in chat, When the operator looks at the UI, Then the active mode is indicated.
  - Given a multi-stage command runs, When the operator watches, Then stage transitions, per-item progress with elapsed time, and a final summary are shown.
  - Given concurrent tasks complete, When the display updates, Then all completed rows persist — no row is duplicated or silently discarded.
- **REQ-UI-2:** The chat welcome box SHALL display on startup and disappear when any content is added to the conversation area. The header and tagline SHALL remain visible. The welcome box SHALL show the active model name, available capabilities, and a command reference. WHEN resuming a prior session, the box SHALL additionally show a resumption note.
  - Given chat starts with no prior session, When the welcome box displays, Then it shows model name, capabilities, and command reference, and disappears on first interaction.
  - Given a resumed session, When the welcome box displays, Then it includes a resumption note.
- **REQ-UI-3:** ALL framework commands SHALL display a command header on startup showing model name, log path, and command-specific context.
  - Given `gather --import ./src` runs, When the header displays, Then it shows the model name, log path, and source path.
- **REQ-UI-4:** The chat input SHALL support multi-line entry: Ctrl+J inserts a newline, backslash at end of line followed by Enter inserts a newline instead of submitting.
  - Given the operator types `\` then Enter, When the input processes, Then a newline is inserted and the message is not submitted.
- **REQ-UI-5:** The chat TUI SHALL render a full-screen layout with a scrollable conversation area and a pinned footer bar and input line. The conversation area SHALL scroll independently; the footer and input SHALL remain visible at all times.
  - *Rationale:* A pinned footer eliminates the scrolling-prompt problem where status information scrolls off screen during long sessions.
  - Given a session with 50 messages, When the operator scrolls up, Then the footer and input remain pinned at the bottom.
  - Given the operator types while the model is processing, When the response completes, Then no stray characters appear in the display.
  - Given a permission or confirmation prompt is needed, When it appears, Then it renders in the conversation area and the operator responds via the input line.
- **REQ-UI-6:** Messages in the conversation area SHALL be visually distinguished by role (operator, model, tool call, system) using color-coded indicators. A streaming cursor SHALL appear while model tokens are arriving.
  - Given an operator message, When rendered, Then it is visually distinct from model and system messages.
  - Given a model response streaming, When tokens arrive, Then a cursor indicates active generation.
  - Given a model response contains markdown, When rendered, Then it is formatted as terminal markdown (headings, code blocks, lists, bold, inline code). Formatting updates progressively during streaming.
- **REQ-UI-7:** WHEN the input is empty and the model is idle, THE SYSTEM SHALL display a placeholder prompting the operator. WHEN the model is processing, the placeholder SHALL indicate the model is working and the operator can type to queue a message. WHEN a message is queued, the input SHALL show the queued text and lock further input until the model finishes.
  - Given the model is idle and input is empty, When the input displays, Then a placeholder prompts the operator.
  - Given the model is processing, When the operator types, Then the message is queued and the input locks.
  - Given a message is queued, When the operator presses Up arrow, Then the queued message is recalled to the input for editing.
  - Given a message is queued, When the agent finishes, Then the queued message auto-dispatches. Only one message can be queued at a time.
- **REQ-UI-8:** Chat SHALL require two consecutive Ctrl+C presses within 4 seconds to exit. The first SHALL display an exit hint. The second SHALL exit cleanly. After 4 seconds without a second press, the hint disappears. WHEN the TUI exits, the terminal SHALL be restored to its pre-TUI state.
  - Given the operator presses Ctrl+C once, When the hint displays, Then a second press within 4 seconds exits.
  - Given the operator presses Ctrl+C once and waits 5 seconds, When the hint disappears, Then the session continues normally.
- **REQ-UI-9:** The chat footer bar SHALL display: model name, context utilization percentage (color-coded by pressure: normal, warning, critical), active tool/mode, project directory, and git branch (omitted if not a git repo). Context utilization SHALL be calculated from message history token count relative to the model's max context window.
  - Given a session using 15K of 65K tokens, When the footer renders, Then context shows ~23% in normal color.
  - Given context exceeds 80%, When the footer renders, Then context shows in critical color.
  - Given the project is not a git repo, When the footer renders, Then the branch field is omitted.
- **REQ-UI-10:** ALL agent stats — both in-progress spinners and completion summaries — SHALL display elapsed time, token counts, context utilization with a visual indicator and color scale, and status. The format SHALL be uniform across all commands (automated and interactive). Fields with no data SHALL be omitted.
  - *Rationale:* Operators need to see cost and context pressure at a glance after every exchange — not just during automated runs. Uniform format means the same mental model applies everywhere.
  - Given any agent completes a response, When the response is displayed, Then a stats line appears in the format `(elapsed · ↓ Nk · ↑ Nk · <icon> N% · status)`.
  - Given context is at 18%, When stats render, Then the pie icon shows `◔` in green.
  - Given context is at 60%, When stats render, Then the pie icon shows `◑` in yellow.
  - Given context is at 85%, When stats render, Then the pie icon shows `◕` in red.
  - Given a field has no data (e.g. no token count yet), When stats render, Then that field is omitted rather than shown as zero.
  - Given a gather stage completes, When the stats line renders, Then it shows elapsed time, tokens, and context %.
  - Given a model returns no usage data, When the stats line renders, Then token fields are omitted.
  - Given an agent is invoked, When progress displays, Then status transitions through queued → thinking → complete or failed. Cached results show cached with no lifecycle transition.
- **REQ-UI-11:** WHILE the model is processing, THE SYSTEM SHALL display a thinking indicator immediately on message submit. The indicator SHALL show a random label and update with elapsed time every second. WHEN token usage data arrives from the API, the indicator SHALL additionally show output token count. WHEN streaming tokens pause for more than 1.5 seconds, the indicator SHALL resume. WHEN the model returns an empty text response after tool calls, THE SYSTEM SHALL display a summary of completed tools. WHEN the model returns an empty response with no tool calls, THE SYSTEM SHALL display "No response from model."
  - Given the operator submits a message, When the model is processing, Then a thinking indicator appears immediately with a random label.
  - Given the model has been processing for 3 seconds, When the indicator updates, Then it shows the label with elapsed time (e.g. `Pondering... · 3s`).
  - Given the API returns token usage during processing, When the indicator updates, Then it additionally shows output tokens (e.g. `Pondering... · 5s · ↑ 48`).
  - Given streaming pauses for 2 seconds, When the pause is detected, Then the thinking indicator resumes.
  - Given the model returns empty text after writing 2 files, When the response displays, Then a tool summary is shown.
- **REQ-UI-12:** WHEN the operator presses Up arrow with an empty input and no pending message, THE SYSTEM SHALL cycle backward through previous inputs. Down arrow SHALL cycle forward. The current input SHALL be saved when entering history and restored when cycling past the newest entry. Pending message recall takes priority over history. Input history is session-scoped.
  - Given 3 previous inputs, When Up is pressed with empty input, Then the most recent input appears.
  - Given a pending queued message, When Up is pressed, Then the queued message is recalled (not history).
- **REQ-UI-13:** WHEN a model response completes in chat, THE SYSTEM SHALL display a completion line using the full stats format: `▸ elapsed · ↓ Nk · ↑ Nk · <icon> N% · ✓ complete`. This is distinct from the inline thinking indicator (REQ-UI-11) which shows only label, elapsed, and output tokens while the model is working.
  - *Rationale:* The thinking indicator is lightweight — just enough to show the model is alive. The completion line is the full accounting: cost, latency, and context pressure. Two levels of detail for two phases of the same exchange.
  - Given a model response completes, When the response is displayed, Then a stats line shows elapsed time, token counts, context %, and `✓ complete`.
  - Given a model response completes with no token data, When the response is displayed, Then the completion line is omitted.

## 5. Non-Functional Requirements

- **Security:** THE SYSTEM SHALL NOT hardcode secrets. All credentials SHALL be sourced from environment variables or the configured models file.
- **Portability:** The framework SHALL run on Linux, macOS, and WSL2.
- **Maintainability:** TypeScript strict mode SHALL be enabled. JSDoc comments and TypeScript types SHALL be used throughout.

## 6. Verification Plan


| ID | Requirement | Method | Evidence |
|----|-------------|--------|----------|
| V-ARCH-1 | REQ-ARCH-1 | Test | `test_cli.ts` — single binary serves both `voidrift` (chat) and `voidrift <command>` (headless); resource files editable without code change |
| V-ARCH-2 | REQ-ARCH-2 | Test | `test_cli.ts` — chat, lifecycle, and utility tiers present; unknown command shows error + available commands; no stack trace in output |
| V-ARCH-3 | REQ-ARCH-3 | Test | `test_agent.ts::TestProtocolAdapter` — OpenAI and Anthropic adapters translate correctly; agent loop has no protocol-specific code |
| V-ARCH-4 | REQ-ARCH-4 | Test | `test_agent.ts::TestToolChoice` — automated commands use `tool_choice: required`; chat uses `tool_choice: auto` |
| V-ARCH-5 | REQ-ARCH-5 | Test | `test_agent.ts::TestTelemetry` — elapsed, token counts, context % present in all agent stats; streaming cursor present in chat |
| V-ARCH-6 | REQ-ARCH-6 | Test | `test_agent.ts::TestStallDetection` — identical function+args triggers nudge; different args do not; 2 failed nudges force final output; stall logged |
| V-ARCH-7 | REQ-ARCH-7 | Test | `test_agent.ts::TestSkillInjection` — automated commands have skills in context at start; chat can load skills on demand via skill tool |
| V-ARCH-8 | REQ-ARCH-8 | Test | `test_agent.ts::TestContextIsolation` — each stage agent starts with empty message history; shared state passed explicitly |
| V-ARCH-9 | REQ-ARCH-9 | Test | `test_agent.ts::TestThinkTagStripping` — think tags absent from output and history; logged as debug |
| V-ARCH-10 | REQ-ARCH-10 | Test | `test_tools.ts::TestCommandToolSets` — gather has file(read/list)+analyze; develop has file+shell; chat has all; new command declares own set without modifying tool system |
| V-ARCH-11 | REQ-ARCH-11 | Test | `test_agent.ts::TestRetry` — connection errors retry with jitter; 429 respects Retry-After; 4xx (not 429) fail immediately; exhaustion triggers fallback; fallback max depth 1 |
| V-ARCH-12 | REQ-ARCH-12 | Test | `test_agent.ts::TestTokenBudget` — budget tracks cumulative usage; stops on limit; CLI flags override config; no-op when unconfigured |
| V-ARCH-13 | REQ-ARCH-13 | Test | `test_agent.ts::TestLoopHooks` — stop condition halts loop; steering message injected; tool call intercepted; context transformed; defaults are no-ops |
| V-ARCH-14 | REQ-ARCH-14 | Test | `test_agent.ts::TestToolDedup` — identical calls execute once, result shared; reads concurrent, writes serial; action-aware for file/http; results in original order; dedup logged |
| V-ARCH-15 | REQ-ARCH-15 | Test | `test_agent.ts::TestPathNormalization` — leading `/` and `./` corrected; normalization logged; correct paths unaffected |
| V-ARCH-16 | REQ-ARCH-16 | Test | `test_agent.ts::TestPromptCaching` — cache headers sent when provider supports it; non-caching providers unaffected |
| V-CHAT-1 | REQ-CHAT-1 | Test | `chat-gather.test.ts` — AC1: /gather mode switch with GATHER personality; AC2: /exec gather --import runs pipeline via runGather; AC3: /exec gather --idea runs pipeline (not steer); routing delegates flags to handleExec; help shows both modes |
| V-CHAT-2 | REQ-CHAT-2 | Test | `test_chat.ts` — `voidrift` with no args opens chat; `--doc` loads artifact into context; missing file warns and offers create; API error returns to prompt; skill loaded on demand |
| V-CHAT-3 | REQ-CHAT-3 | Test | `p0-features.test.ts::ContextCompactor` — compact replaces messages with summary; 10% ceiling drops recent when exceeded; keeps recent when within ceiling; returns unchanged for ≤2 messages; disables after 3 failures; buildRestoration includes skills. `governance.test.ts::ContextCompactor governance partition` — workBudget = maxContext − governanceTokens; shouldAutoCompact at 80% work utilization; shouldNudge at 70%; governance layer preserved during compaction; 10% ceiling against work budget |
| V-CHAT-4 | REQ-CHAT-4 | Test | `test_chat.ts::TestSessionPersistence` — session saved and restored; resume summary shown; `/clear` deletes session; restore from last compaction boundary; malformed entries stripped |
| V-CHAT-5 | REQ-CHAT-5 | Test | `test_chat.ts::TestAskCommand` — `/ask` makes one-shot call; question and response not in history or session file; response displayed inline |
| V-CHAT-6 | REQ-CHAT-6 | Test | `bare-mode.test.ts` — AC1: /bare freezes agent messages, bare agent has framework context only (no governance); AC2: /chat resumes via switchMode→exitBare→rebuildGovernance; AC3: /plan resumes with plan governance; all mode commands use switchMode (bare-aware) |
| V-CHAT-7 | REQ-CHAT-7 | Test | `test_chat.ts::TestPermissionGate` — write prompts before writing; deny returns error to agent; always-allow skips subsequent prompts; non-TTY auto-denies; reads inside project free; automated commands skip gate |
| V-CHAT-8 | REQ-CHAT-8 | Test | `test_chat.ts::TestSettings` — `/settings` lists all keys with descriptions; `/settings set` validates key and type; unknown key rejected; type mismatch rejected |
| V-CHAT-9 | REQ-CHAT-9 | Test | `test_chat.ts::TestModelSwitch` — `/model` opens selector; `/model <alias>` switches directly; footer reflects new model; selection persists to config |
| V-CHAT-10 | REQ-CHAT-10 | Test | `test_chat.ts::TestModelResolution` — resolves from saved current_model then first alias; unavailable model shows warning; non-model slash commands functional without model |
| V-CHAT-11 | REQ-CHAT-11 | Test | `idea-mode.test.ts` — AC1: /idea lists existing ideas and prompts create/load; AC2: /idea <id> loads and activates idea personality; AC3: /done calls restoreMode to restore previous governance; AC4: no tool restrictions in idea mode; AC5: plan requires explicit --idea flag |
| V-CHAT-12 | REQ-CHAT-12 | Test | `idea-flow.test.ts` — AC1: new idea sends Intake prompt to agent; AC2: IDEA prompt describes Exploration with clarifying questions referencing reqs/arch; AC3: Shaping proposes user story/ACs/modules; AC4: Summary presents complete structured idea; agent drives conversation (stages in order, stay in stage, limited questions) |
| V-CHAT-13 | REQ-CHAT-13 | Test | `test_chat.ts::TestDoneCommand` — `/done` prompts for category; idea file written; registered in manifest; session returns to normal chat |
| V-CHAT-14 | REQ-CHAT-14 | Test | `governance.test.ts::ContextCompactor governance partition` — governance untouched during compaction; work budget calculated as maxContext minus governance; budget warning when governance exceeds cap; work layer ≤10% of work budget after compaction; configurable governance_max_tokens |
| V-CHAT-15 | REQ-CHAT-15 | Test | `mode-switching.test.ts` — MODE_DEFS defines 4 modes with correct personality/skills; prompt sections exist in chat.md (SYSTEM, PLAN, GATHER, IDEA); governance rebuild produces different content per mode; steering messages are distinct; default mode is chat; compactor governance tokens update; slash command routing; message history preservation |
| V-CHAT-16 | REQ-CHAT-16 | Test | `exec-gateway.test.ts` — EXEC_COMMANDS defines 5 lifecycle commands; /exec no args lists commands; /exec unknown shows error; /exec routing dispatches via wrapCommand; backward-compatible delegation from /gather /plan /develop /verify /deploy; pipeline progress via system messages not agent.messages; help text shows /exec commands |
| V-G-1 | REQ-G-1 | Test | `gather.test.ts` — `runGather --idea mode` (index.ts parses --idea flag, --ref flag, error lists all flags, help shows all modes); `runChat --ref mode` (chat.ts injects file tree); `runGather --idea implementation` (idea code path with ANALYSIS-REQS/REQUIREMENTS-TEMPLATE, diff summary write-back). Existing `--import` tests in `buildFileTree`, `parseTriage`, `assignUncategorized`, `analysis cache`. |
| V-G-2 | REQ-G-2 | Test | `test_gather.ts::TestPipeline` — 4 stages run in order; triage categorizes files; context build produces per-category summaries; source analysis one agent per file; consolidation produces REQUIREMENTS.md; `.gitignore` respected |
| V-G-3 | REQ-G-3 | Test | `test_gather.ts::TestContextError` — context-length error shows stage name and model suggestion; no silent truncation |
| V-G-4 | REQ-G-4 | Test | `gather-progress.test.ts` — cached files marked with cached status and skip agent; fresh files use trackAgentWithStats; stage summary shows total/fresh/cached breakdown |
| V-G-5 | REQ-G-5 | Test | `test_gather.ts::TestUncategorized` — uncategorized files prompt operator; assign/skip/skip-all/apply-all options work; assigned files included in pipeline |
| V-P-1 | REQ-P-1 | Test | `test_plan.ts::TestPipeline` — 6 stages run in order; each stage artifact verified before next; missing artifact after retry exits with code 1; REQUIREMENTS.md required before start |
| V-P-2 | REQ-P-2 | Test | `plan-task-acs.test.ts` — `validateTaskACs()` checks AC scope (file refs within task files list) and specificity (concrete values via SPECIFIC_VALUE regex); warnings-only; wired after buildTaskFiles in plan pipeline |
| V-P-3 | REQ-P-3 | Test | `test_plan.ts::TestTraceability` — arch files reference REQ IDs; task files include REQ IDs; uncovered REQ IDs produce warning after generation |
| V-P-4 | REQ-P-4 | Test | `test_plan.ts::TestOverwrite` — `--overwrite` removes tasks/, arch/, ARCHITECTURE.md, README.md; REQUIREMENTS.md and analysis/ preserved |
| V-P-5 | REQ-P-5 | Test | `plan-self-containment.test.ts` — `validateTaskSelfContainment()` checks required sections (User Story, Acceptance Criteria, Context), no shell commands in body (SHELL_PATTERN), no `.voidrift/` paths in files frontmatter; wired after validateTaskACs |
| V-P-6 | REQ-P-6 | Test | `test_plan.ts::TestSkillValidation` — invalid skill refs corrected to closest match or stripped; corrections logged info; removals logged warn |
| V-P-7 | REQ-P-7 | Test | `test_plan.ts::TestUpdateMode` — existing artifacts trigger delta analysis; pipeline focuses on unimplemented work; no artifacts triggers full pipeline |
| V-P-8 | REQ-P-8 | Test | `plan-self-containment.test.ts` — `checkIdeaArchival()` wired into `setStatus()` on verified+idea; checks all idea tasks verified; moves idea to archived/. Idea context injection and missing-reqs gate verified in `plan.test.ts` |
| V-D-1 | REQ-D-1 | Test | `test_develop.ts::TestPrerequisites` — missing manifest exits with error; all-verified manifest exits 0 with "all tasks complete" |
| V-D-2 | REQ-D-2 | Test | `test_develop.ts::TestLocking` — lock acquired on start; second session exits with error; stale lock from dead PID recovered; lock cleaned up on abort |
| V-D-3 | REQ-D-3 | Test | `test_develop.ts::TestDispatch` — tasks dispatched when planned + deps met; concurrent up to concurrency limit; sequential when concurrency=1; git ops serialized; task marked implemented on writes; exits when no dispatchable tasks |
| V-D-4 | REQ-D-4 | Test | `develop-guards.test.ts` — zero-write completion rejected (existing); text-only nudge (existing); git diff warning when all stats show 0 added/removed and isGitRepo; warning ordered after computeDiffStats, before clearSnapshots |
| V-D-5 | REQ-D-5 | Test | `test_develop.ts::TestEscalation` — architect receives task + context; single model used for both roles; verify-failed task sends bug report to architect; architect appends guidance; blocked after 5 escalations |
| V-D-6 | REQ-D-6 | Test | `test_develop.ts::TestRollback` — modified files restored on failure; new files deleted on failure; deleted files restored on failure; concurrent task rollback isolated; writes persist on success |
| V-D-7 | REQ-D-7 | Test | `test_develop.ts::TestOrphanRecovery` — in-progress tasks detected on start; TTY prompts per task (reset/skip/fail); non-TTY auto-resets; recovery before first dispatch |
| V-D-8 | REQ-D-8 | Test | `test_develop.ts::TestChangeSummary` — per-task summary shows created/modified/deleted with line deltas; total shown at run end |
| V-D-9 | REQ-D-9 | Test | `test_develop.ts::TestMtimeGuard` — external modification detected and write refused; agent can override; files not previously written by task not checked |
| V-D-10 | REQ-D-10 | Test | `test_develop.ts::TestCheckpoints` — checkpoint created when working tree dirty; no checkpoint when clean; checkpoints persisted and available to rollback |
| V-D-11 | REQ-D-11 | Test | `test_develop.ts::TestFileCoverage` — declared files compared to written; missing file emits warning; task still marked implemented |
| V-D-12 | REQ-D-12 | Test | `test_develop.ts::TestSelfReview` — steering message injected after first write; not re-injected on subsequent rounds; no injection when no files written |
| V-D-13 | REQ-D-13 | Test | `develop-guards.test.ts` — `filesRead` Set tracks reads; `beforeToolCall` intercepts write/edit on existing unread files with error; new files exempt; read-then-write allowed |
| V-VF-1 | REQ-VF-1 | Test | `test_verify.ts::TestPrerequisites` — missing REQUIREMENTS.md exits with error before any model calls |
| V-VF-2 | REQ-VF-2 | Test | `test_verify.ts::TestPipeline` — plan stage produces one test case per testable requirement; execute stage runs concurrent sub-agents; failures produce bug reports with full evidence; report stage produces VERIFY.md with summary table; verify agents cannot write source files |
| V-VF-3 | REQ-VF-3 | Test | `verify-doc.test.ts` — `verify-doc` tool set exports with file: [read, write, list]; builder entries; `_runDocVerify` uses verify-doc (not verify-plan); runs before Stage 1; doc bugs in VERIFY.md and affect verdict |
| V-DPL-1 | REQ-DPL-1 | Test | `test_deploy.ts::TestVersionBump` — major/minor/patch classified from task types; operator prompted to confirm or override; SemVer format enforced |
| V-DPL-2 | REQ-DPL-2 | Test | `test_deploy.ts::TestChangelog` — changelog entry generated from history.log since last tag; grouped by module; appended to CHANGELOG.md |
| V-DPL-3 | REQ-DPL-3 | Test | `test_deploy.ts::TestGitTag` — annotated tag created with version; tag message contains changelog entry |
| V-DPL-4 | REQ-DPL-4 | Test | `test_deploy.ts::TestIaC` — IaC generated when ARCHITECTURE.md has infrastructure sections; skipped when absent; non-destructive; no secrets; resource tagging |
| V-DPL-5 | REQ-DPL-5 | Test | `test_deploy.ts::TestPostDeploy` — hook executed after tagging; version available to hook; failure warns but does not roll back tag |
| V-UTIL-1 | REQ-UTIL-1 | Test | `status.test.ts` — `getCommandStatus()` checks artifact existence for gather/plan/develop/verify/deploy (done/not started/in progress); `countIdeas()` counts IDEA-*.md; task counts by lifecycle status; no manifest shows friendly message |
| V-UTIL-2 | REQ-UTIL-2 | Test | `log.test.ts` — `extractCommandSection()` extracts most recent command section; `lastLines()` returns last N; `runLog()` supports project/global scope, --follow, --prune; CLI wired with -f shorthand; no .voidrift error |
| V-UTIL-3 | REQ-UTIL-3 | Test | `unlock.test.ts` — `runUnlock()` checks lock file, reads PID, kills with SIGTERM if alive, removes lock; handles no-lock gracefully; wired in index.ts |
| V-UTIL-4 | REQ-UTIL-4 | Test | `test_completions.ts` — outputs valid shell completion script; model alias arguments complete from configured aliases |
| V-UTIL-5 | REQ-UTIL-5 | Test | `prune.test.ts` — log backup pruning beyond retention; `--all` removes .voidrift/ via rmSync; stale cache entries (deleted source) removed; TTL-expired entries removed; `--global` prunes global backups; `--global --all` removes all; no .voidrift/ error |
| V-UTIL-6 | REQ-UTIL-6 | Test | `test_doctor.ts` — checks config syntax, models file, skill parseability, log writability, disk space; `--fix` creates missing dirs; runs without models file |
| V-UTIL-7 | REQ-UTIL-7 | Test | `skills-cli.test.ts` — list groups by layer with pending markers; search queries repos with source attribution; install writes pending stub; approve moves pending→active; remove deletes from project/domain/pending; review lists pending |
| V-UTIL-8 | REQ-UTIL-8 | Test | `rollback.test.ts` — loads checkpoints.jsonl, lists with task ID and timestamp; restores via GitCheckpointManager.restore(turn); not-a-git-repo error; no-checkpoints message; wired in index.ts |
| V-UTIL-9 | REQ-UTIL-9 | Test | `test_memory.ts::TestMemoryCLI` — list groups by layer; show searches project then global; delete removes from project; delete --global removes from global; export produces single markdown file; no model required |
| V-CFG-1 | REQ-CFG-1 | Test | `test_config.ts::TestModelResolution` — alias resolves to connection details; unknown alias exits with error listing available aliases |
| V-CFG-2 | REQ-CFG-2 | Test | `test_config.ts::TestModelDefaults` — model entry inherits defaults; per-entry override takes precedence; no type inference |
| V-CFG-3 | REQ-CFG-3 | Test | `config-expansion.test.ts` — `expandCrossRefs()` resolves `${section.key}` via dot-path lookup; called after env expansion in loadConfig; unresolved left unchanged; dot-check gate |
| V-CFG-4 | REQ-CFG-4 | Test | `test_config.ts::TestModelsFileCheck` — lifecycle/chat commands exit with error when models file missing; utility commands exempt |
| V-CFG-5 | REQ-CFG-5 | Test | `config-expansion.test.ts` — `internal.summary` default exists; loop.ts and builder.ts use `getMaxTokens()`; no remaining hardcoded maxTokens: 1024 in command code |
| V-SKL-1 | REQ-SKL-1 | Test | `test_skills.ts::TestLayerResolution` — project overrides domain overrides north-star; first match returned; not-found logs warning |
| V-SKL-2 | REQ-SKL-2 | Test | `skill-allowed-tools.test.ts` — `skillAllowedTools` option on AgentLoop; enforcement before beforeToolCall; error names skill and lists allowed tools; no restriction allows all; develop.ts wires getSkillAllowedTools per task |
| V-SKL-3 | REQ-SKL-3 | Test | `test_skills.ts::TestAutoSynthesis` — missing skill with synthesis_model configured triggers synthesis and writes pending; not active until approved; no synthesis_model → warn and continue |
| V-MEM-1 | REQ-MEM-1 | Test | `test_memory.ts::TestLayerResolution` — project entry overrides global entry with same name; global used when no project override |
| V-MEM-2 | REQ-MEM-2 | Test | `test_memory.ts::TestInjection` — memory index injected into system prompt on chat start; names and descriptions only, not full content; bare mode skips injection |
| V-MEM-3 | REQ-MEM-3 | Test | `test_memory.ts::TestMemoryTools` — read searches project then global; write defaults to project scope; list returns all entries; tools absent from develop |
| V-TOOL-1 | REQ-TOOL-1 | Test | `test_tools.ts::TestLargeContent` — read returns paginated result with warning header; write rejects oversized content with decomposition directive; analysis chunks oversized files; system prompt instructs models on pagination and decomposition |
| V-TOOL-2 | REQ-TOOL-2 | Test | `test_tools.ts::TestProcessTool` — starts process and returns handle; readiness detection via HTTP/port/log-pattern; timeout stops process and raises error; stdout/stderr captured |
| V-TOOL-3 | REQ-TOOL-3 | Test | `test_tools.ts::TestHttpTool` — named sessions persist cookies and auth headers; multiple sessions per agent; sessions cleaned up on completion |
| V-TOOL-4 | REQ-TOOL-4 | Test | `tool-http-fetch.test.ts` — askFn called before fetch with Allow/Deny; deny returns error; `_summarizePage()` extracts title + body (no raw content); cache hit skips re-prompt; fetch failure returns error description |
| V-TOOL-5 | REQ-TOOL-5 | Test | `test_tools.ts::TestAskTool` — question displayed with numbered options; response returned; non-TTY returns fallback message; available in chat only |
| V-TOOL-6 | REQ-TOOL-6 | Test | `test_tools.ts::TestSessionSearch` — case-insensitive keyword search; includes pre-compaction entries; sorted by recency; content truncated at 2000 chars; chat-only |
| V-TOOL-7 | REQ-TOOL-7 | Test | `test_tools.ts::TestDocAnalysis` — PDF extracts text; DOCX preserves heading hierarchy as markdown; XLSX returns markdown tables per sheet; missing library returns install hint |
| V-TOOL-8 | REQ-TOOL-8 | Test | `tool-code-analysis.test.ts` — SUPPORTED_LANGUAGES set (ts, tsx, js, jsx, mjs, cjs, py); unsupported extension returns error listing supported; returns language, line count, imports, symbols with line numbers, complexity |
| V-TOOL-9 | REQ-TOOL-9 | Test | `test_tools.ts::TestFileEdit` — exact match replaced; ambiguous match rejected with count; whitespace-normalized fallback preserves indentation; no match returns first 3 lines of old_str; available in develop and chat |
| V-TOOL-10 | REQ-TOOL-10 | Test | `test_tools.ts::TestToolGuidelines` — tools with guidelines inject into system prompt; tools without guidelines contribute nothing |
| V-SEC-1 | REQ-SEC-1 | Test | `test_security.ts::TestShellConfig` — disabled command rejects shell calls; allowed_patterns restricts commands; per-command patterns narrow global list; output truncated at limit with omitted count |
| V-SEC-2 | REQ-SEC-2 | Test | `test_security.ts::TestPathSandbox` — path traversal outside project root blocked and logged; framework agents restricted to .voidrift/ |
| V-SEC-3 | REQ-SEC-3 | Test | `test_security.ts::TestProtectedPaths` — protected_paths blocks writes within project root; violation logged; unprotected paths write normally |
| V-SEC-4 | REQ-SEC-4 | Test | `test_security.ts::TestCommandClassification` — destructive patterns blocked without executing; warn patterns execute with flag; allowed_commands overrides to safe; all executions logged with classification |
| V-SEC-5 | REQ-SEC-5 | Test | `test_security.ts::TestSSRF` — private/link-local/cloud-metadata IPs blocked; loopback allowed; DNS failure blocked; ssrf_allow_list overrides for configured hosts |
| V-GIT-1 | REQ-GIT-1 | Test | `test_git.ts::TestBoundedDiff` — total lines capped; file count capped; per-file lines capped; binary files excluded and listed separately; truncation marker present when limit exceeded; git calls use timeouts |
| V-GIT-2 | REQ-GIT-2 | Test | `test_git.ts::TestContextInjection` — git snapshot injected into agent prompt in git repos; contains branch, recent commits, uncommitted changes; captured once per run; non-git directory skips silently |
| V-LOG-1 | REQ-LOG-1 | Test | `test_logging.ts::TestProjectLog` — all command runs append to project log; log rotates on size limit; backup count configurable |
| V-LOG-2 | REQ-LOG-2 | Test | `log.test.ts` — startup syslog includes [command] cwd, model, args; exit syslog includes exit code and elapsed; FATAL includes command and elapsed; global log at ~/.voidrift/logs/ with rotation |
| V-LOG-3 | REQ-LOG-3 | Test | `log-iterations.test.ts` — ITERATION entries for all 5 reasons: tool_call, done_tool, follow_up, stall_recovery, truncation_recovery; LOOP_EXIT with turns and token totals |
| V-LOG-4 | REQ-LOG-4 | Test | `error-summary.test.ts` — `formatSummary()` shows counts and recoverability per category; shared tracker via `getSharedTracker()`; AgentLoop records api/tool/context errors; all 5 lifecycle commands wire reset+display |
| V-PS-1 | REQ-PS-1 | Test | `test_structure.ts` — all framework artifacts written under .voidrift/; .voidrift/ created automatically if absent |
| V-PS-2 | REQ-PS-2 | Test | `test_structure.ts::TestStateFile` — every command appends to STATE.md; entry contains timestamp, command, model, outcome, file manifest; chat agent reads STATE.md on start |
| V-TM-1 | REQ-TM-1 | Test | `test_manifest.ts::TestCLIOwnership` — no agent tool provides write access to manifest; archived tasks removed from manifest and recorded in history.log |
| V-TM-2 | REQ-TM-2 | Test | `test_manifest.ts::TestStatusTransitions` — all valid transitions succeed; invalid transitions rejected; each transition produces correct state |
| V-TM-3 | REQ-TM-3 | Test | `test_manifest.ts::TestDependencyBlocking` — failed task transitively blocks dependents; re-implemented task unblocks dependents whose other deps are met |
| V-TM-4 | REQ-TM-4 | Test | `test_manifest.ts::TestHistoryLog` — archived task appends to history.log; log is append-only; used for changelog generation |
| V-TM-5 | REQ-TM-5 | Test | `test_manifest.ts::TestArchival` — verified task moves to archived/; removed from manifest; history.log appended; bug file moves to archived/ when all referencing tasks verified |
| V-TM-6 | REQ-TM-6 | Test | `test_manifest.ts::TestBugFiles` — verify failure creates bug file with evidence; bug linked to task; independent ID sequence; manifest tracks references without 1:1 enforcement |
| V-TM-7 | REQ-TM-7 | Test | `test_manifest.ts::TestHistoryRotation` — successful deploy rotates history.log to versioned archive; new empty log created; archive preserved; no history.log → no error |
| V-UI-1 | REQ-UI-1 | Test | `test_ui.ts::TestProgressDisplay` — automated commands show spinners/status, not raw agent dialog; slash commands show system messages; stage transitions and per-item progress shown; completed rows persist |
| V-UI-2 | REQ-UI-2 | Test | `test_ui.ts::TestWelcomeBox` — welcome box shows on startup; disappears on first content; shows model, capabilities, command reference; resumption note shown when restoring session |
| V-UI-3 | REQ-UI-3 | Test | `test_ui.ts::TestCommandHeader` — all commands display model name, log path, and command context on startup |
| V-UI-4 | REQ-UI-4 | Test | `test_ui.ts::TestMultilineInput` — Ctrl+J inserts newline; backslash+Enter inserts newline; Enter submits |
| V-UI-5 | REQ-UI-5 | Test | `test_ui.ts::TestTUILayout` — full-screen layout with scrollable conversation area; footer and input pinned; conversation scrolls independently |
| V-UI-6 | REQ-UI-6 | Test | `test_ui.ts::TestMessageRoles` — operator/model/tool/system messages visually distinguished by color; streaming cursor visible during token arrival |
| V-UI-7 | REQ-UI-7 | Test | `ui-input-queue.test.ts` — `dispatchPendingMessage()` named function called from finally block; queuing locks input (one message max); Up arrow recalls queued message; InputRegion pendingMessage/setPending |
| V-UI-8 | REQ-UI-8 | Test | `test_ui.ts::TestExitBehavior` — single Ctrl+C shows hint; second within 4s exits cleanly; hint disappears after 4s; terminal restored on exit |
| V-UI-9 | REQ-UI-9 | Test | `footer.test.ts` — footer shows model, context % with ctxIcon/ctxColor, mode, cwd, branch (omitted when empty); 23% → green, 80% → red; icon thresholds ○◔◑◕● verified |
| V-UI-10 | REQ-UI-10 | Test | `ui-stats.test.ts` — colored pie icons via ansiColor+ctxColor in statsStr; thresholds ◔/◑/◕ with green/yellow/red; chat uses statsStr (uniform format); fields omitted when no data; status transitions queued→thinking→complete; cached shows no transition |
| V-UI-11 | REQ-UI-11 | Test | `test_ui.ts::TestThinkingIndicator` — indicator appears immediately on submit; resumes after 1.5s pause; empty response after tool calls shows tool summary; empty response with no tools shows "No response from model" |
| V-UI-12 | REQ-UI-12 | Test | `test_ui.ts::TestInputHistory` — Up arrow cycles backward through history; Down arrow cycles forward; current input saved on enter history; restored when cycling past newest; pending message recall takes priority |
| V-UI-13 | REQ-UI-13 | Test | `test_ui.ts::TestCompletionLine` — dim line with elapsed and token counts appears after model response; omitted when no token data |
| V-NFR-1 | NFR Security | Inspection | Codebase search — no hardcoded API keys, tokens, or credentials; all secrets sourced from env vars or models file |
| V-NFR-2 | NFR Portability | Test | CI matrix — tests pass on Linux, macOS, and WSL2 |
| V-NFR-3 | NFR Maintainability | Inspection | `tsconfig.json` — strict mode enabled; codebase has JSDoc comments and TypeScript types throughout |
| V-ARCH-17 | REQ-ARCH-17 | Test | `test_agent.ts::TestConnectionRelease` — HTTP client released after agent completes; released before fallback switch |
| V-ARCH-18 | REQ-ARCH-18 | Test | `test_prompts.ts` — all prompts loaded from resource files; no hardcoded strings in command code; missing variable raises error |
| V-ARCH-19 | REQ-ARCH-19 | Test | `prompts.test.ts::buildSystemPrompt` — 4-layer structure in order; framework context first; filters empty layers. `prompts.test.ts::framework context loaded once` — gather/plan/develop/verify/deploy load CONTEXT once. `governance.test.ts::buildGovernanceLayer` — assembles START.md + CONTRIBUTING.md + framework + personality + skills + memory + git in order. `mode-switching.test.ts` — mode switch rebuilds governance with different personality/skills |

