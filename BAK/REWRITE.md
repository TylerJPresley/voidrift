# TypeScript Rewrite Plan

Full rewrite of VoidRift CLI from Python to TypeScript/Node with Ink TUI.

**Stack:** TypeScript, Bun, Ink (React for CLI), OpenAI SDK, Vitest, tsup/esbuild
**Spec:** REQUIREMENTS.md, ARCHITECTURE.md, Python implementation as reference
**Cutover:** Python stays until TypeScript passes all ACs

## Repo Layout

```
voidrift/
├── src/                    # TypeScript CLI
│   ├── index.ts            # entry point (Click → Commander/yargs)
│   ├── agent/
│   │   ├── loop.ts         # agent loop: API calls, tool dispatch, hooks, retry, streaming
│   │   ├── protocol.ts     # ProtocolAdapter: OpenAI + Anthropic adapters
│   │   ├── stall.ts        # stall detection, nudge logic
│   │   ├── context.ts      # snip_old_tool_results, reactive compaction
│   │   └── budget.ts       # TokenBudget, BudgetExhaustedError
│   ├── commands/
│   │   ├── gather.ts       # gather pipeline (4 stages)
│   │   ├── plan.ts         # plan pipeline (6 stages)
│   │   ├── develop.ts      # develop dispatch loop
│   │   ├── verify.ts       # verify pipeline
│   │   ├── deploy.ts       # deploy pipeline
│   │   └── chat.ts         # chat session, slash command dispatch
│   ├── tools/
│   │   ├── registry.ts     # 10 domain tool schemas
│   │   ├── builder.ts      # build_local_tools, per-command filtering
│   │   ├── filesystem.ts   # WriteContext: read, write, edit, delete, list
│   │   ├── shell.ts        # shell execution, security classification
│   │   ├── http.ts         # HTTP client, SSRF guard, session persistence
│   │   ├── browser.ts      # Playwright browser automation
│   │   ├── process.ts      # subprocess lifecycle
│   │   └── security.ts     # command classification, path sandboxing
│   ├── tui/
│   │   ├── App.tsx         # root Ink component
│   │   ├── Conversation.tsx # scrollable message area
│   │   ├── Footer.tsx      # persistent status bar
│   │   ├── Input.tsx       # input line with placeholder
│   │   ├── Header.tsx      # ASCII art + callout box
│   │   ├── ToolCall.tsx    # tool call display with colored bars
│   │   └── Thinking.tsx    # braille spinner
│   ├── config.ts           # config loading, variable expansion
│   ├── models.ts           # model alias resolution
│   ├── skills.ts           # 3-layer skill resolution
│   ├── manifest.ts         # ManifestManager
│   ├── session.ts          # chat session persistence (JSONL)
│   ├── memory.ts           # two-layer memory system
│   ├── prompts.ts          # prompt loading by section
│   └── utils.ts            # STATE.md, logging, helpers
├── cli/                    # Python CLI (reference — stays until cutover)
├── resources/              # shared prompts, skills, templates
├── tests/
│   ├── agent/
│   ├── commands/
│   ├── tools/
│   └── tui/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── bunfig.toml
├── REQUIREMENTS.md
├── ARCHITECTURE.md
└── README.md
```

## Phases

### Phase 1: Foundation

**Goal:** Project scaffolding, config loading, model resolution, prompt loading. No agent loop yet — just the infrastructure that everything else depends on.

**Files:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`, `bunfig.toml`
- `src/config.ts` — YAML config loading, `${VAR}` expansion, `get_max_tokens`, `get_bash_config`
- `src/models.ts` — `resolve_model`, `ModelConfig`, `ModelInterface`
- `src/prompts.ts` — `load_prompt(command, section)`, `load_template(name)`, `find_skill(name)`
- `src/skills.ts` — 3-layer skill resolution (project → domain → north star)
- `src/utils.ts` — `ensure_voidrift_dir`, `boot_run`, `append_state`, `check_disk_space`

**ACs:**
- `resolve_model("qwen35")` returns a ModelConfig with correct fields
- `load_prompt("plan", "PLAN-ARCH")` returns the section content
- `find_skill("ANALYSIS-REQS")` resolves from north star layer
- Config `${VAR}` expansion works with env vars and defaults
- `get_max_tokens(model, "gather.triage")` returns min(stage_default, model.max_tokens)

**Tests:** Port `test_config.py`, `test_models.py`, `test_skills.py`, `test_utils.py`

### Phase 2: Tool System

**Goal:** 10 domain tools with schemas, handlers, per-command filtering, security.

**Files:**
- `src/tools/registry.ts` — 10 DOMAIN_* schemas
- `src/tools/filesystem.ts` — WriteContext with path sandboxing, pagination, byte guard, snapshots, mtime tracking
- `src/tools/shell.ts` — `create_run_command` factory, `BashConfig`, `classify_command`
- `src/tools/security.ts` — command classification (safe/warn/block)
- `src/tools/http.ts` — SSRF guard, HTTP client, session persistence
- `src/tools/process.ts` — subprocess lifecycle (start, stop, wait_for_ready, read_output)
- `src/tools/browser.ts` — Playwright automation
- `src/tools/builder.ts` — `build_local_tools`, `_narrow_schema_actions`, `validate_schema_handler_contract`

**ACs:**
- `build_local_tools("gather")` returns `file` (read, list) and `analyze`
- `build_local_tools("develop")` returns `file` (all actions) and `shell`
- Path sandboxing blocks `../../etc/passwd`
- Protected paths block writes to `pyproject.toml`
- `classify_command("rm -rf /")` returns `block`
- SSRF guard blocks `169.254.169.254`, allows `localhost`
- Schema-handler contract validation catches missing parameters

**Tests:** Port `test_tool_builder.py`, `test_tools.py`, `test_filesystem.py`, `test_security.py`, `test_ssrf.py`, `test_bash.py`, `test_mtime.py`, `test_snapshot.py`

### Phase 3: Agent Loop

**Goal:** The core agent loop — API calls, tool dispatch, streaming, retry, stall detection, think-tag stripping, hooks, deduplication, batching.

**Files:**
- `src/agent/loop.ts` — `AgentLoop.send()`, `_run_loop`, tool dispatch, hooks
- `src/agent/protocol.ts` — `OpenAIAdapter`, `AnthropicAdapter`, `ProtocolAdapter` interface
- `src/agent/stall.ts` — stall detection, nudge injection, signature comparison
- `src/agent/context.ts` — `snip_old_tool_results`, reactive compaction
- `src/agent/budget.ts` — `TokenBudget`, `BudgetExhaustedError`

**ACs:**
- Agent sends message, receives response, dispatches tool calls, returns text
- Streaming mode delivers tokens via callback
- Stall detection triggers after 2 identical tool call signatures
- Think-tag stripping removes `<think>...</think>` from responses
- Retry with exponential backoff + jitter on 429/5xx
- Reactive compaction on context-length errors
- Max-tokens recovery concatenates truncated responses
- Tool call deduplication reduces N identical calls to 1
- Concurrent read batching via Promise.all
- All hooks (transform_context, before_tool_call, after_tool_call, stop_check, steering, follow_up)
- Anthropic adapter: system extraction, tool_result batching, finish reason mapping

**Tests:** Port `test_agent.py`, `test_agent_context.py`

### Phase 4: Gather + Plan Commands

**Goal:** First two pipeline commands working end-to-end.

**Files:**
- `src/commands/gather.ts` — 4-stage pipeline, triage display, uncategorized assignment
- `src/commands/plan.ts` — 6-stage pipeline, delta analysis, task file generation

**ACs:**
- `voidrift gather --path ./src` produces REQUIREMENTS.md
- Triage displays files grouped by category
- Uncategorized files prompt for assignment
- Analysis cache skips unchanged files
- `voidrift plan` produces ARCHITECTURE.md, arch/*.md, task files, manifest.yml, README.md
- Delta analysis detects implemented requirements
- Skill tag validation with word-overlap resolution

**Tests:** Port `test_gather.py`, `test_plan.py`

### Phase 5: Develop + Verify + Deploy Commands

**Goal:** Remaining pipeline commands.

**Files:**
- `src/commands/develop.ts` — dispatch loop, escalation, done guard, self-review steering
- `src/commands/verify.ts` — doc verification, test planning, concurrent sub-agents
- `src/commands/deploy.ts` — version bump, changelog, git tag
- `src/manifest.ts` — ManifestManager
- `src/git.ts` — git context, diff safety limits, checkpoints

**ACs:**
- Develop dispatches ready tasks concurrently, marks implemented on write
- Escalation consults architect model
- Done guard rejects premature done calls
- Verify produces VERIFY-PLAN.md and VERIFY.md
- Deploy creates annotated git tag with changelog

**Tests:** Port `test_develop.py`, `test_verify.py`, `test_verify_tools.py`

### Phase 6: Ink TUI

**Goal:** Full-screen chat TUI with Ink components.

**Files:**
- `src/tui/App.tsx` — root layout (HSplit equivalent)
- `src/tui/Conversation.tsx` — scrollable message area with role-colored bars
- `src/tui/Footer.tsx` — persistent status bar (model, context %, mode, path, branch)
- `src/tui/Input.tsx` — input line with placeholder, history
- `src/tui/Header.tsx` — ASCII art + callout box
- `src/tui/ToolCall.tsx` — tool call display with colored bars and inline diffs
- `src/tui/Thinking.tsx` — braille spinner
- `src/tui/Message.tsx` — markdown rendering with syntax highlighting

**ACs:**
- Full-screen layout with pinned footer and input
- Text selection works (Ink doesn't capture mouse by default)
- Streaming markdown rendering
- Tool calls with human-friendly names and colored bars
- Thinking indicator during model processing
- Context % in footer with color coding
- Mode indicator shows active command
- PgUp/PgDn scrolling
- /help, /clear, /ask, /compact work

**Tests:** Component tests with ink-testing-library

### Phase 7: Chat Session + Memory + Slash Commands

**Goal:** Session persistence, memory, idea flow, slash commands.

**Files:**
- `src/session.ts` — JSONL session persistence, compaction boundaries
- `src/memory.ts` — two-layer memory (project + global)
- `src/commands/chat.ts` — slash command dispatch, wrap_command harness
- `src/tui/IdeaFlow.tsx` — /idea guided flow

**ACs:**
- Session persists to `.voidrift/chat-session.jsonl` and restores on restart
- /compact summarizes history, restores recent files
- /gather, /plan, /develop, /verify run pipelines via wrap_command
- /idea drives intake → exploration → shaping → summary
- Memory entries persist across sessions
- Session gap marker after 30+ minutes

**Tests:** Port `test_session.py`, `test_memory.py`, `test_chat.py`, `test_chat_commands.py`

### Phase 8: Doctor + CLI Polish

**Goal:** Utility commands, shell completions, error handling.

**Files:**
- `src/commands/doctor.ts` — diagnostic checks
- `src/commands/status.ts` — task status display
- `src/commands/log.ts` — log viewing
- `src/commands/prune.ts` — cleanup
- `src/index.ts` — Commander/yargs CLI with all subcommands

**ACs:**
- `voidrift doctor` checks config, models, skills, disk space
- `voidrift status` shows task counts by lifecycle status
- `voidrift log gather` shows last 200 lines
- `voidrift prune` respects retention limits
- Shell completions for model aliases
- No command ever shows a stack trace to the user

**Tests:** Port `test_doctor.py`, remaining utility tests

### Phase 9: Cutover

**Goal:** TypeScript version passes all ACs. Python version archived.

**Steps:**
1. Run every AC from REQUIREMENTS.md against the TypeScript version
2. Run the full test suite — all tests pass
3. Move `cli/` to `legacy/python/`
4. Move `src/` to root-level TypeScript project
5. Update Makefile, README, ARCHITECTURE.md
6. Tag release

## Dependencies

```
Phase 1 (foundation)
  ↓
Phase 2 (tools) ──→ Phase 3 (agent loop)
                        ↓
                    Phase 4 (gather + plan)
                        ↓
                    Phase 5 (develop + verify + deploy)
                        ↓
Phase 6 (Ink TUI) ──→ Phase 7 (chat + session + slash commands)
                        ↓
                    Phase 8 (doctor + CLI polish)
                        ↓
                    Phase 9 (cutover)
```

Phase 6 (Ink TUI) can start in parallel with Phase 4 — the TUI components don't depend on pipeline logic.

## Key Decisions

- **OpenAI SDK for TypeScript** handles both OpenAI-compatible and native endpoints. Anthropic SDK for native Anthropic protocol.
- **Ink** for TUI — text selection works natively, no mouse capture conflict.
- **Bun** as runtime and package manager — fast, TypeScript-native.
- **tsup** for building the CLI binary.
- **Vitest** for testing — fast, TypeScript-native, compatible with Bun.
- **resources/** directory shared between Python and TypeScript during transition — prompts, skills, and templates are language-agnostic markdown files.
