# Competitive Feature Comparison

**Date:** 2026-04-21
**Scope:** Feature-by-feature comparison of four open-source AI agent harnesses against VoidRift. Goal: identify what's better elsewhere and what's portable.

**Projects analyzed:**

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Language** | TypeScript | TypeScript | Python | TypeScript |
| **Origin** | Google (original) | Fork of Gemini CLI | Independent (HKUDS) | Independent |
| **License** | Apache-2.0 | Apache-2.0 | MIT | Proprietary |
| **Architecture** | Monorepo (7 packages) | Monorepo (9 packages) | Single package + ohmo | Single package |
| **Primary model** | Gemini native API | Qwen (OpenAI-compat) | Any (OpenAI-compat) | Any (OpenAI/Anthropic) |
| **Core differentiator** | Policy engine + sandbox | Multi-protocol + channels | Swarm + autopilot | Governance layer + lifecycle |

---

## 1. Shell Execution & Safety

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Approach** | Shell AST parser (28k lines) | Inherited from Gemini | Simple subprocess wrapper | Regex pattern classification |
| **Read-only detection** | AST-level: parses pipes, redirects, subshells | Inherited | Not present | Not present |
| **Dangerous command blocking** | Per-platform (macOS/Windows) safety lists + AST | Inherited | Network guard only | Regex block/warn patterns |
| **Background processes** | Full background shell tool with output streaming | Inherited | Via task manager | Not supported |
| **Output handling** | Terminal serializer with ANSI parsing | Inherited | Basic capture | Line-count truncation |
| **Sandbox integration** | Commands run inside platform sandbox | Inherited | Docker backend option | Path sandboxing only |

**Best:** Gemini CLI. The shell AST parser (`shell-utils.ts`) is 28k lines of battle-tested parsing that understands pipes, redirects, command substitution, and subshells. It can determine whether `cat foo | grep bar > out.txt` is read-only (it's not — it has redirection). VoidRift's regex patterns can't distinguish `rm -rf /` from `rm -rf ./build/cache` contextually.

**Portable?** Yes. `shell-utils.ts` is self-contained with no Gemini-specific dependencies. It exports `getCommandRoots`, `parseCommandDetails`, `hasRedirection`, `normalizeCommand`, and `stripShellWrapper`. Could be vendored directly into VoidRift's `tools/security.ts` to replace regex classification.

**Effort:** Medium (2-3 days). The parser depends on the `shell-quote` npm package for tokenization. Integration points: replace `classifyCommand()` in `security.ts`, update `createRunCommand()` in `shell.ts` to use AST-based read-only detection.

---

## 2. Permission & Policy Engine

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Policy format** | TOML rules with priorities | Inherited | YAML agent definitions | YAML config (flat) |
| **Granularity** | Per-tool, per-path, per-MCP-server wildcards | Inherited | Per-agent permission modes | 3 categories: writes/runs/reads-outside |
| **Persistence** | Policy file survives sessions | Inherited | Per-team permission state | Session-scoped (resets on exit) |
| **Approval modes** | default / acceptEdits / bypassPermissions / plan / dontAsk | Inherited | default / acceptEdits / bypassPermissions / plan / dontAsk | Allow once / always this session / deny |
| **MCP tool policies** | Wildcard patterns (`*mcp_serverName_*`) | Inherited | MCP config per agent | Not applicable (no MCP) |
| **Swarm permission sync** | Not present | Not present | File-based + mailbox-based cross-agent sync (37k lines) | Not present |
| **Sandbox policy** | Integrated with per-platform sandbox manager | Inherited | Docker sandbox adapter | Not present |

**Best:** Gemini CLI for single-agent policy. OpenHarness for multi-agent permission coordination.

Gemini's policy engine (`policy-engine.ts`, 945 lines) evaluates TOML rules with priority ordering, wildcard matching, and integration with the sandbox manager. A single rule can say "allow all shell commands matching `npm *` in this workspace" and it persists across sessions. VoidRift's 3-category gate is coarse — you can't allow file writes to `src/` but deny writes to `package.json`.

OpenHarness's permission sync (`permission_sync.py`, 37k lines) solves a problem VoidRift will hit when swarm/multi-agent lands: how do worker agents get permission to write files when only the leader has the operator's trust? Their solution: workers send permission requests via mailbox, the leader prompts the operator, and responses flow back.

**Portable?** Gemini's policy engine: Yes, self-contained. OpenHarness permission sync: concept is portable, implementation is Python-specific.

**Effort:** Gemini policy engine: Medium (3-4 days). Replace VoidRift's `permissions.ts` session gate with a TOML-based rule evaluator. Requires adding `@iarna/toml` or similar parser. OpenHarness permission sync: High (5+ days). Requires VoidRift to have a swarm architecture first.

---

## 3. Context Management

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Governance partition** | No | No | No | **Yes — never-compact layer** |
| **Compression** | LLM-based chat compression | Inherited + microcompaction | Basic compact service | LLM-based with 10% ceiling |
| **Tool output masking** | Saves large outputs to disk, replaces with markers (50k token threshold) | Inherited | Not present | `snipOldToolResults` (basic, 500-char threshold) |
| **Tool output distillation** | LLM-summarizes old tool outputs on demand | Not present | Not present | Not present |
| **Token counting** | Proper tokenizer (`tokenCalculation.ts`) | Inherited | Basic estimation | ~4 chars/token estimate |
| **Auto-compact trigger** | 50% of model token limit | Inherited | Not documented | 80% of work budget |
| **Preserve ratio** | Last 30% of history kept | Inherited | Not documented | Last 4 messages kept |
| **Mode-aware rebuild** | No | No | No | **Yes — governance rebuilds on mode switch** |

**Best:** VoidRift for governance (unique). Gemini CLI for everything else in context management.

VoidRift's governance partition is the standout feature across all four projects. No other harness guarantees that behavioral rules, project conventions, and personality survive compaction. This is VoidRift's moat.

However, Gemini's tool output masking (`toolOutputMaskingService.ts`) and distillation (`toolDistillationService.ts`) are significantly more sophisticated than VoidRift's `snipOldToolResults`. Gemini saves large tool outputs to disk and replaces them with a marker containing the file path — the model can request the full output if needed. Distillation goes further: it uses an LLM to summarize old tool outputs into a structural map, preserving the signal while reducing tokens by 90%+.

Gemini's proper tokenizer (`tokenCalculation.ts`) is also materially better than VoidRift's 4-chars/token estimate, which can be off by 20-40% for code content.

**Portable?** Tool output masking: Yes, self-contained pattern. Tool distillation: Yes but requires an extra LLM call per distillation. Tokenizer: Yes, `tiktoken` or similar can be added as a dependency.

**Effort:** Tool output masking: Low (1-2 days). Extend `snipOldToolResults` to save large outputs to `.voidrift/tool-outputs/` and replace with path markers. Tool distillation: Medium (2-3 days). Requires a summarization call — could reuse the compact prompt infrastructure. Tokenizer: Low (1 day). Add `tiktoken` or `gpt-tokenizer` package, replace `estimateTokens()` in `governance.ts`.

---

## 4. Multi-Agent / Swarm

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Sub-agents** | Yes — agent tool with delegation | Inherited + subagent manager | Full swarm with team lifecycle | Concurrent task dispatch (independent) |
| **Inter-agent messaging** | Not present | Not present | **File-based mailbox with typed messages** | Not present |
| **Permission delegation** | Not present | Not present | **Leader-worker permission sync** | Not present |
| **Worktree isolation** | Git worktree service | Inherited | **Worktree manager with enter/exit tools** | Not present (tasks share working tree) |
| **Agent definitions** | Built-in agent types | Inherited | **YAML-based with Pydantic validation (45k lines)** | Task files as agent prompts |
| **Backends** | In-process only | In-process + tmux + iTerm | **In-process + subprocess + remote** | In-process only |
| **Coordination model** | Parent delegates to child | Inherited | **Leader-worker with mailbox + registry** | Orchestrator dispatches independent tasks |

**Best:** OpenHarness by a wide margin.

OpenHarness's swarm system is the most complete multi-agent implementation across all four projects. Key components:

- **Mailbox** (`mailbox.py`, 18k): File-based async message queue. Each agent has an inbox directory. Messages are typed: `user_message`, `permission_request`, `permission_response`, `shutdown`, `idle_notification`. Atomic writes via `.tmp` + `os.rename`.
- **Permission sync** (`permission_sync.py`, 37k): Workers can't prompt the operator directly. They send permission requests to the leader via mailbox, the leader prompts, and responses flow back. Supports both file-based and mailbox-based flows.
- **Team lifecycle** (`team_lifecycle.py`, 29k): Manages agent spawning, health monitoring, shutdown coordination.
- **Worktree isolation** (`worktree.py`, 10k): Each agent works in its own git worktree. No file conflicts between concurrent agents.

VoidRift's develop command dispatches tasks concurrently but they're independent — no communication, no coordination, shared working tree (serialized git ops to avoid conflicts). This works for the current task model but breaks down when tasks need to coordinate (e.g., "I wrote the interface, you can start the implementation").

**Portable?** The mailbox concept is portable (file-based, no external dependencies). The worktree isolation is portable (git worktree is standard). The permission sync protocol is portable. The implementation is Python — would need a TypeScript rewrite.

**Effort:** High (1-2 weeks). Mailbox: 3-4 days (TypeScript rewrite of file-based message queue). Worktree isolation: 2-3 days (extend `git.ts` with worktree create/delete). Permission sync: 2-3 days (depends on mailbox). Team lifecycle: 3-4 days (extend `develop.ts` dispatch loop).

---

## 5. Tool System & MCP

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Tool registration** | Declarative class-based (`BaseDeclarativeTool`) | Inherited | Base class with `__init_subclass__` auto-registration | Static registry + handler map |
| **Adding a tool** | Create a class, it auto-registers | Inherited | Create a class, it auto-registers | Modify `registry.ts` + `builder.ts` |
| **MCP client** | **Full implementation (2370 lines)** — OAuth, token storage, resource support | Inherited | MCP client with stdio + HTTP transports | Not present |
| **MCP resources** | Read + list MCP resources | Inherited | Read + list MCP resources | Not present |
| **Tool count** | ~20 built-in | ~20 inherited + todoWrite | **43 built-in** | 10 domain tools |
| **Tool visibility** | Config-based per-agent | Inherited | Per-agent via definitions | Per-command hardcoded map |
| **Tool modification** | Modifiable tool wrapper (runtime schema changes) | Inherited | Not present | `narrowSchemaActions()` at build time |

**Best:** Gemini CLI for MCP. OpenHarness for tool count and registration pattern.

Gemini's MCP client (`mcp-client.ts`, 2370 lines) is production-grade: stdio and SSE transports, OAuth 2.0 with PKCE, token storage (keychain + file fallback), automatic reconnection, resource listing and reading. This is the industry-standard way to extend an agent with external tools.

OpenHarness's tool registration pattern is cleaner than all others: tools inherit from a base class and auto-register. Adding a new tool is one file with no modifications to any registry or builder. VoidRift requires touching `registry.ts` (schema) and `builder.ts` (handler wiring) for every new tool.

**Portable?** Gemini MCP client: Yes, but large (2370 lines + token storage + OAuth). The `@modelcontextprotocol/sdk` npm package could be used instead for a lighter integration. OpenHarness registration pattern: The concept is portable — switch from static map to class-based auto-registration. Implementation is Python-specific.

**Effort:** MCP client (using SDK): Medium (3-4 days). Add `@modelcontextprotocol/sdk`, create `tools/mcp-client.ts`, wire into `builder.ts` for chat and verify commands. MCP client (port Gemini's): High (5-7 days). More features but more code to maintain. Tool auto-registration: Medium (2-3 days). Refactor `registry.ts` and `builder.ts` to use a class-based pattern where tools self-register.

---

## 6. Hook / Extension System

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Hook types** | Before/after model, before/after tool, session events, compression | Inherited | **Command, HTTP, prompt, agent** | Agent loop callbacks only |
| **Hook definition** | TOML files in `.gemini/` | Inherited | **YAML files with hot reload** | TypeScript callback fields |
| **External hooks** | Shell commands, HTTP endpoints | Inherited | **Shell commands, HTTP endpoints, LLM prompts, agent delegation** | Not present |
| **Hook planner** | Determines which hooks fire for an event | Inherited | Event-based matching | Manual composition |
| **Hook aggregation** | Combines results from multiple hooks | Inherited | Aggregated results with typed outcomes | Not present |
| **Hot reload** | Not present | Not present | **Yes — file watcher reloads hooks on change** | Not present |
| **Operator extensibility** | Create `.gemini/hooks/` TOML files | Inherited | Create hook YAML files | Modify source code |

**Best:** OpenHarness for hook types and hot reload. Gemini CLI for hook infrastructure maturity.

OpenHarness's hook system (`hooks/executor.py`, 8k) supports four hook types that cover different extension patterns:
- **Command hooks**: Run a shell command, capture stdout as the hook result
- **HTTP hooks**: POST to a URL with the event payload, parse the response
- **Prompt hooks**: Send the event to an LLM with a custom prompt, use the response
- **Agent hooks**: Delegate to a sub-agent for complex decision-making

The hot reload (`hooks/hot_reload.py`) watches hook definition files and reloads them without restarting the session. This means an operator can iterate on hooks while the agent is running.

VoidRift's hook system is internal only — `transform_context`, `before_tool_call`, `after_tool_call`, `stop_check`, `get_steering_messages`. These are powerful for command authors but invisible to operators. An operator can't add a hook that runs a linter after every file write without modifying VoidRift source.

**Portable?** The hook executor pattern (command/HTTP/prompt/agent types) is directly portable. YAML hook definitions could replace or supplement VoidRift's callback fields. Hot reload is a file watcher — trivial to implement.

**Effort:** Medium (3-5 days). Define a hook YAML schema, create a hook loader that reads from `.voidrift/hooks/`, implement command and HTTP executors, wire into the agent loop's existing callback points. Prompt and agent hook types add 1-2 days each.

---

## 7. Memory & Personalization

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Memory storage** | Markdown files in `.gemini/memory/` | Inherited | Markdown files in `.openharness/memory/` | Markdown files in `.voidrift/memory/` |
| **Memory layers** | User + project | Inherited | User + project | Project + global |
| **Auto-extraction** | Not present | **Dream agent + extraction planner (16 files)** | **Personalization extractor with rules** | Not present (manual only) |
| **Relevance scoring** | Not present | **Relevance selector for recall** | Keyword search | Not present |
| **Memory recall** | Full content injection | **Selective recall based on relevance** | Scan + search | Index injection, on-demand full load |
| **Consolidation** | Not present | **Dream agent consolidates memories** | Not present | Not present |
| **Personalization** | Settings-based | Settings-based | **Extractor + rules + session hooks** | Memory entries |

**Best:** Qwen Code for memory depth. OpenHarness for personalization.

Qwen Code's memory system (16 files in `core/src/memory/`) is the most sophisticated:
- **Extraction planner** (`extractionAgentPlanner.ts`): Uses an LLM to decide what's worth remembering from a conversation
- **Dream agent** (`dream.ts`, `dreamAgentPlanner.ts`): Background consolidation — merges related memories, removes contradictions, updates stale entries
- **Relevance selector** (`relevanceSelector.ts`): Scores memories against the current conversation to decide which to inject
- **Recall** (`recall.ts`): Selective memory loading based on relevance, not just name matching

VoidRift's memory is flat: write a markdown file, inject the index on session start, load full content on demand by name. No automatic extraction, no relevance scoring, no consolidation. The operator must explicitly say "remember this."

OpenHarness's personalization (`personalization/extractor.py`) automatically extracts operator preferences from conversation patterns — coding style, preferred tools, communication preferences — and applies them via session hooks.

**Portable?** Qwen Code's extraction planner and relevance selector are conceptually portable but tightly integrated with their memory data model. The dream agent pattern (background consolidation) is a design pattern, not a code dependency. OpenHarness's personalization extractor is a clean pattern: observe conversations → extract rules → apply on future sessions.

**Effort:** Auto-extraction: Medium (3-4 days). Add a post-session hook that sends the conversation to an LLM with an extraction prompt, writes results to memory. Relevance scoring: Medium (2-3 days). Score memory entries against the current user message before injecting. Dream/consolidation: Low priority (2-3 days). Background job that periodically reviews and merges memory entries.

---

## 8. Sandbox & Isolation

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Shell sandbox** | **Per-platform: macOS sandbox-exec, Linux seatbelt, Windows job objects** | Inherited | Docker container backend | Not present |
| **File sandbox** | Sandbox manager with resolved paths, symlink handling, forbidden paths | Inherited | Docker volume mounts + path validator | `path.resolve().startsWith(root)` |
| **Environment sanitization** | Strips sensitive env vars before shell execution | Inherited | Not documented | Not present |
| **Network isolation** | Sandbox-level network restrictions | Inherited | Docker network modes | SSRF guard on HTTP tool only |
| **Operator control** | Sandbox policy in settings + per-command overrides | Inherited | Docker image selection | `protected_paths` config list |

**Best:** Gemini CLI for native sandboxing. OpenHarness for Docker isolation.

Gemini's sandbox manager (`sandboxManager.ts` + `sandbox/` directory) provides OS-level process isolation. On macOS, shell commands run inside `sandbox-exec` with a profile that restricts file access to the workspace. On Linux, seccomp/seatbelt profiles limit syscalls. On Windows, job objects restrict child processes. This is defense-in-depth — even if the model crafts a malicious command that passes the policy engine, the OS sandbox blocks it.

OpenHarness takes a different approach: Docker containers. The sandbox adapter (`sandbox/adapter.py`) runs agent work inside a container with controlled volume mounts. Heavier but more portable and stronger isolation.

VoidRift has path sandboxing (`path.resolve().startsWith(root)`) and `protected_paths` — both are application-level checks that a sufficiently creative shell command could bypass.

**Portable?** Gemini's per-platform sandbox profiles could be vendored. Docker isolation is an architectural choice. Both are additive — they don't conflict with existing VoidRift security.

**Effort:** Gemini sandbox: High (5-7 days). Per-platform sandbox profiles, sandbox manager, environment sanitization. Docker sandbox: Medium (3-4 days). Dockerfile, volume mount configuration, adapter to route shell commands through Docker.

---

## 9. Autopilot / Autonomous Execution

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Autonomous mode** | Not present | Not present | **89k-line autopilot service** | Not present |
| **Task intake** | Not present | Not present | **GitHub issues, PRs, manual ideas, agent candidates** | Manual (operator runs commands) |
| **Prioritization** | Not present | Not present | **Source-based scoring + bug/urgency hints** | Manifest dependency ordering |
| **Execution** | Not present | Not present | **Branch → implement → test → PR (autonomous)** | `develop` command (operator-initiated) |
| **Verification** | Not present | Not present | **Verification policy with steps** | `verify` command (operator-initiated) |
| **Release** | Not present | Not present | **Release policy** | `deploy` command (operator-initiated) |

**Best:** OpenHarness — nobody else has this.

OpenHarness's autopilot (`autopilot/service.py`, 89k lines) is a fully autonomous software engineering service. It maintains a task registry, scores and prioritizes work from multiple sources (GitHub issues, PRs, manual ideas), executes tasks in isolated worktrees, runs verification steps, and opens PRs. It has configurable policies for intake, decision-making, and release.

VoidRift has all the pieces — gather, plan, develop, verify, deploy — but they're operator-initiated commands. The autopilot pattern would chain them: scan repo → gather requirements from issues → plan tasks → develop → verify → deploy. The governance layer would ensure the autonomous agent stays on track.

**Portable?** The autopilot concept maps directly onto VoidRift's lifecycle commands. The implementation is Python-specific and tightly coupled to OpenHarness's swarm system. The policy/registry/scoring patterns are portable as design patterns.

**Effort:** High (2-3 weeks). This is a new command (`voidrift autopilot`) that orchestrates the existing lifecycle. Task intake from GitHub requires API integration. The scoring/prioritization logic is ~2k lines. The execution loop wraps existing `develop` + `verify`. The governance layer is the key advantage — VoidRift's autopilot would maintain behavioral rules that OpenHarness's doesn't.

---

## 10. External Agent Bridge

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Bridge to external agents** | Not present | Not present | **Claude Code + Codex as backends** | Not present |
| **Protocol** | N/A | N/A | Work secrets + session runner | N/A |
| **Use case** | N/A | N/A | Leverage existing subscriptions | N/A |

**Best:** OpenHarness — unique feature.

OpenHarness's bridge (`bridge/`) wraps Claude Code and OpenAI Codex as execution backends. The operator's existing subscription powers the agent — no separate API key needed. The bridge manages session lifecycle, work secrets, and result collection.

This is relevant to VoidRift because it means VoidRift's lifecycle commands could be exposed as tools that any agent harness can call. Instead of VoidRift being the agent, it becomes the process layer that other agents use.

**Portable?** The bridge concept is portable. Exposing VoidRift commands as MCP tools would achieve the same result without a custom bridge protocol.

**Effort:** Low-Medium (2-3 days) if done via MCP. VoidRift lifecycle commands already have clean entry points (`runGather`, `runPlan`, `runDevelop`, `runVerify`, `runDeploy`). Wrapping them as MCP tool handlers is straightforward.

---

## 11. Model Support & Protocol Adapters

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Protocols** | Gemini native only | **OpenAI + Anthropic + Gemini + Qwen-specific** | OpenAI + Copilot + Codex | OpenAI + Anthropic |
| **Streaming** | Gemini streaming API | OpenAI streaming + Anthropic streaming + Gemini streaming | OpenAI streaming | OpenAI streaming + Anthropic streaming |
| **Tool call parsing** | Gemini native (structured) | **Custom streaming tool call parser for OpenAI** | Basic OpenAI parsing | OpenAI + Anthropic adapters |
| **Thinking/reasoning** | Gemini thinking mode | **Qwen thinking mode + generic thinking support** | Not documented | Think-tag stripping |
| **Prompt caching** | Gemini context caching | **OpenAI + Anthropic + Gemini cache headers** | Not present | Anthropic + OpenAI cache headers |
| **Fallback** | Flash model fallback | Inherited | Not present | Single-level model fallback |

**Best:** Qwen Code for protocol breadth. VoidRift is competitive on the protocols it supports.

Qwen Code's `openaiContentGenerator/` package includes a custom streaming tool call parser (`streamingToolCallParser.ts`, 15k lines) that handles the edge cases of OpenAI-compatible streaming — partial JSON in tool call arguments, interleaved text and tool calls, and provider-specific quirks. This is more robust than VoidRift's adapter approach.

VoidRift's protocol adapter pattern (`OpenAIAdapter` + `AnthropicAdapter`) is clean and extensible but covers fewer protocols. Adding Gemini native support would require a third adapter.

**Portable?** Qwen Code's streaming tool call parser could replace VoidRift's OpenAI streaming handling for better reliability with vLLM and other OpenAI-compatible providers. The Gemini content generator could be adapted as a third protocol adapter.

**Effort:** Streaming parser: Medium (2-3 days). Port `streamingToolCallParser.ts` into VoidRift's `agent/protocol.ts`. Gemini adapter: Medium (3-4 days). New `GeminiAdapter` class following the existing pattern.

---

## 12. Frontend / UI

| | Gemini CLI | Qwen Code | OpenHarness | VoidRift |
|---|---|---|---|---|
| **Terminal UI** | Custom renderer (Ink-like) | Inherited | **Textual (Python) + React/Ink terminal** | Ink (React for terminals) |
| **Web UI** | Not present | **WebUI package with Tailwind** | Autopilot dashboard (React + Vite) | Not present |
| **IDE integration** | VS Code companion | VS Code + **Zed extension** | Not present | Not present |
| **SDK** | TypeScript SDK | TypeScript SDK + **Java SDK** | Not present | Not present |
| **Channels** | Not present | **Telegram + DingTalk + WeChat** | **Feishu + Slack + Telegram + Discord** | Not present |
| **Devtools** | **Browser-based devtools for agent inspection** | Not present | Not present | Not present |
| **Themes** | 15+ built-in themes | Inherited | Built-in themes | Single theme (hardcoded colors) |
| **Headless mode** | `-p` flag for non-interactive | Inherited | CLI flags | `--model` flag on lifecycle commands |

**Best:** Qwen Code for breadth. Gemini CLI for devtools. OpenHarness for channels.

VoidRift's Ink TUI is functional but limited to the terminal. No web UI, no IDE integration, no SDK, no channels. The governance layer and lifecycle commands are terminal-only — there's no way to use them from a web interface or IDE.

Gemini's devtools package is unique: a browser-based inspector that shows agent state, conversation history, tool calls, and telemetry in real time. This is invaluable for debugging agent behavior.

**Portable?** Themes: trivial (config file). SDK: Medium (extract core logic from CLI). Web UI: High (new package). IDE integration: High (VS Code extension). Channels: Medium (adapter pattern over existing chat). Devtools: Medium (WebSocket server exposing agent state).

**Effort:** Themes: Low (1 day). SDK: High (1-2 weeks). Web UI: High (1-2 weeks). VS Code: High (1 week). Channels: Medium (3-5 days per channel). Devtools: Medium (3-4 days).

---

## 13. Recommendations & Priority Matrix

Features ranked by impact on VoidRift, integration effort, and maintenance burden.

### P0 — Must Have

| Feature | Source | Impact | Effort | Rationale |
|---|---|---|---|---|
| **MCP client** | Gemini CLI (or SDK) | High | 3-4 days | Industry standard for tool extensibility. Without it, VoidRift is a closed system. |
| **Tool output masking** | Gemini CLI | High | 1-2 days | Current `snipOldToolResults` loses information. Masking preserves it on disk. |
| **Proper tokenizer** | Gemini CLI | Medium | 1 day | 4-chars/token estimate causes premature compaction or overflow. Affects every session. |

### P1 — High Value

| Feature | Source | Impact | Effort | Rationale |
|---|---|---|---|---|
| **Shell AST parser** | Gemini CLI | High | 2-3 days | Regex classification has known gaps. AST parsing is strictly more correct. |
| **Tool auto-registration** | OpenHarness | Medium | 2-3 days | Current pattern requires 2-file edits per tool. Blocks community contributions. |
| **Hook system (command + HTTP)** | OpenHarness | Medium | 3-5 days | Operators can't extend VoidRift without forking. Hooks fix that. |
| **Memory auto-extraction** | Qwen Code | Medium | 3-4 days | Manual "remember this" is friction. Auto-extraction captures what matters. |
| **TOML policy engine** | Gemini CLI | Medium | 3-4 days | 3-category gate is too coarse for real projects. Per-path, per-tool rules needed. |

### P2 — Nice to Have

| Feature | Source | Impact | Effort | Rationale |
|---|---|---|---|---|
| **Tool output distillation** | Gemini CLI | Medium | 2-3 days | LLM-summarized tool outputs preserve signal better than snipping. |
| **Streaming tool call parser** | Qwen Code | Medium | 2-3 days | Better vLLM compatibility. Current adapter works but edge cases exist. |
| **Git worktree isolation** | OpenHarness | Medium | 2-3 days | Concurrent develop tasks would stop sharing the working tree. |
| **Themes** | Gemini CLI | Low | 1 day | Cosmetic but users care. |
| **Devtools** | Gemini CLI | Low | 3-4 days | Debugging aid. Not user-facing. |

### P3 — Future / Strategic

| Feature | Source | Impact | Effort | Rationale |
|---|---|---|---|---|
| **Swarm mailbox** | OpenHarness | High | 1-2 weeks | Prerequisite for coordinated multi-agent work. |
| **Autopilot** | OpenHarness | High | 2-3 weeks | Chains lifecycle commands autonomously. VoidRift's governance layer makes this safer than OpenHarness's version. |
| **Per-platform sandbox** | Gemini CLI | Medium | 5-7 days | OS-level isolation. Defense-in-depth. |
| **Docker sandbox** | OpenHarness | Medium | 3-4 days | Alternative to per-platform sandbox. More portable. |
| **SDK** | Gemini CLI / Qwen Code | Medium | 1-2 weeks | Enables embedding VoidRift in other tools. |
| **VoidRift as MCP server** | Original | High | 2-3 days | Expose lifecycle commands as MCP tools. Any agent harness can use VoidRift's process layer. |
| **Web UI** | Qwen Code | Low | 1-2 weeks | Broader audience but changes the product. |
| **Channels** | OpenHarness | Low | 3-5 days/ea | Slack/Discord integration for ohmo-style personal assistant. |
