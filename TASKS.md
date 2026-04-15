# Tasks

Open tasks ordered by dependency. Complete in sequence.

---

## TASK-F20: Consolidate tools — 25 tools → 10 domain tools with action parameters

**Status:** Complete

**Problem:** The tool system has 25 individual tools where the industry standard is one tool per domain with an `action` parameter. Models waste context on 25 tool schemas. Filesystem has 7 tools that could be 1. The name-based domain separation (`read_source_file` vs `read_framework_file`) duplicates logic that the security layer already handles.

**What this changes:**

| Domain | Tool | Actions |
|---|---|---|
| Filesystem | `file` | `read`, `write`, `edit`, `delete`, `list` |
| HTTP | `http` | `get`, `post`, `put`, `delete` |
| Shell | `shell` | single action |
| Browser | `browser` | `navigate`, `screenshot`, `click`, `get_text` |
| Process | `process` | `read_output` |
| Skills | `skill` | `get`, `list` |
| Memory | `memory` | `read`, `write`, `list`, `delete` |
| Session | `session` | `search` |
| Analysis | `analyze` | `code`, `document` |
| Interactive | `ask` | single action |

- Path-based security (REQ-SEC-1) replaces name-based domain separation
- Per-command tool visibility (REQ-ARCH-9) controls which actions are available per command
- `read_document` merges into `file(action="read")` with format auto-detection by extension
- `web_fetch` + `http_request` merge into `http` — GET without session = summarize
- `memory` gains `delete` action

**Affected components:**
- `cli/src/voidrift_cli/tools/registry.py` — new schemas (10 tools, action parameter each)
- `cli/src/voidrift_cli/tools/filesystem.py` — unified handler dispatching on action
- `cli/src/voidrift_cli/tools/tool_builder.py` — updated build_local_tools, per-command action filtering
- `cli/src/voidrift_cli/agent.py` — tool argument normalization for new schema
- All command modules — updated AGENT_TOOLS sets
- `resources/prompts/system.md` — updated tool guidelines
- REQUIREMENTS.md — updated REQ-ARCH-9, REQ-TOOL-3, REQ-FSZ-*

**Design constraint:** Security layer decides what paths/actions are allowed per command. No behavioral changes to what the agent can do — same capabilities, fewer tools.

---

## TASK-F21: TUI tool display — human-friendly names, inline diffs, colored bars

**Status:** Not started
**Depends on:** F20

**Problem:** Tool calls in the TUI show raw tool names (`read_source_file`) with no detail about what happened. Write operations show no diff. The operator can't see what changed without checking git.

**What this changes:**
- Display human-friendly tool names: `Read`, `Write`, `Edit`, `Delete`, `Shell`, `HTTP`
- Show key detail: file path, line range for reads, URL for HTTP, command for shell
- Inline diff after write/edit operations: summary line (`added 3 lines, removed 1 line at L22`) + colored diff (green additions, red deletions, dim context)
- Different colored left bars per tool type (read=blue, write=green, delete=red, shell=yellow)

**Affected components:**
- `cli/src/voidrift_cli/commands/_chat_tui.py` — tool rendering, diff rendering, styles
- `cli/src/voidrift_cli/commands/chat.py` — capture diff data from write/edit tool results
- `cli/src/voidrift_cli/tools/filesystem.py` — return diff data from write/edit handlers

**Design constraint:** Display only in the TUI. The tool handlers return diff data; the TUI renders it. No changes to the agent loop.

---

## TASK-F11: Gather triage display — show full file listing and uncategorized files

**Status:** Complete

**Problem:** The current `voidrift gather` output shows only counts (`source(6), config(4)`) and a vague "8 files not categorized" warning. The operator can't see which files are in each category or which files were dropped. If important source files are uncategorized, the operator has no way to know without digging into logs.

**What this changes:**
- After triage completes, display files grouped by category with full paths.
- List uncategorized files explicitly with their paths.
- This applies to the existing CLI `voidrift gather` command, not just the chat slash command.

**Affected components:**
- `cli/src/voidrift_cli/commands/gather.py` — post-triage display

**Design constraint:** Display only. No behavioral changes to the pipeline. The gather command continues to process categorized files as before. All system output is dim for visual hierarchy.

---

## TASK-F12: Uncategorized file assignment UX

**Status:** Complete
**Depends on:** F11

**Problem:** When triage drops files, they are silently excluded from the entire pipeline. The operator has no way to assign them to categories without re-running gather. Important source files (e.g. `traffic.js`, `drivetime.js`) can be missed entirely.

**What this changes:**
- When uncategorized files exist, prompt the operator with choices: assign each file to a category, skip all, or abort.
- For the existing CLI: add an `--interactive` flag to `voidrift gather` that enables the assignment prompt.
- For the chat slash command: the assignment prompt is always available in `/gather`.

**Affected components:**
- `cli/src/voidrift_cli/commands/gather.py` — `--interactive` flag, assignment prompt

**Design constraint:** Non-interactive mode (default) preserves current behavior — uncategorized files are skipped with a warning. Interactive mode adds the assignment prompt.

---

## TASK-F13: CHAT-ROLE prompt alignment with START.md workflow

**Status:** Complete

**Problem:** The CHAT-ROLE system prompt is 5 loose behavioral sentences. Small models don't follow them reliably. START.md has a clear numbered workflow (diagnose → propose → approve → implement → summarize) that works when followed. The CHAT-ROLE should mirror this structure so the model has a process to follow, not just hints.

**What this changes:**
- Rewrite the CHAT-ROLE section as a numbered workflow matching START.md:
  1. Read relevant files to understand the current state
  2. Propose what you plan to change — list files, describe changes, explain why
  3. Wait for operator confirmation
  4. Make the changes
  5. Summarize what was done — files created, modified, commands run, issues
- List available slash commands so the model can suggest next steps
- Keep the rule: respond with the CLI command when the operator references a framework command

**Affected components:**
- `resources/prompts/system.md` — CHAT-ROLE section

**Design constraint:** Prompt-layer only. The workflow must be concise enough for small models to follow but structured enough to enforce the pattern.

---

## TASK-F14: /gather slash command in chat

**Status:** Complete
**Depends on:** F11, F12, F13

**Problem:** `voidrift gather` is a black-box pipeline. The operator runs it and hopes the output is right. There's no way to review, correct, or steer the process mid-run.

**What this changes:**
- `/gather <path>` slash command in chat runs the gather pipeline interactively.
- Framework orchestrates each stage. Models do leaf work. Operator gets checkpoints.
- Stages: build file tree → triage (show files, assign uncategorized) → context build → source analysis (per-file progress) → consolidation (show stats, confirm before writing).
- Slash command handler runs before `agent.send()` — zero impact on chat context window.
- Errors in slash commands don't crash the chat session.

**Affected components:**
- `cli/src/voidrift_cli/commands/_chat_commands.py` — new module, `/gather` handler
- `cli/src/voidrift_cli/commands/chat.py` — wire slash command dispatcher into loop

**Design constraint:** Reuses existing pipeline functions from `_gather_pipeline.py` and `gather.py`. No changes to pipeline logic. All system output is dim.

---

## TASK-F15: /plan slash command in chat

**Status:** Complete
**Depends on:** F14 (validates the slash command pattern)

**Problem:** `voidrift plan` generates architecture and tasks without operator review. Task quality issues (incomplete ACs, missing details) aren't caught until develop or verify.

**What this changes:**
- `/plan` slash command runs the plan pipeline interactively.
- Stages: architecture (show modules, confirm) → module arch (per-module progress, confirm) → task outlines (show task summary, confirm) → task files (generate, show coverage check) → README.
- Operator can review and abort at each stage.

**Affected components:**
- `cli/src/voidrift_cli/commands/_chat_commands.py` — `/plan` handler

**Design constraint:** Reuses existing pipeline functions from `_plan_pipeline.py`. All system output is dim.

---

## TASK-F16: System prompt — slash command awareness

**Status:** Complete
**Depends on:** F13

**Problem:** The chat model doesn't know slash commands exist. After updating requirements, it offers to draft config files instead of suggesting `/plan`. The model can't recommend the right workflow if it doesn't know the tools available.

**What this changes:**
- CHAT-ROLE section lists available slash commands with one-line descriptions.
- Model suggests the appropriate next command when the logical next step is a framework operation.

**Affected components:**
- `resources/prompts/system.md` — CHAT-ROLE section

**Design constraint:** Prompt-layer only. Keep the list concise — command name and one-line purpose.

---

## TASK-F17: /verify slash command in chat

**Status:** Not started
**Depends on:** F14

**Problem:** `voidrift verify` runs all test cases without operator visibility into what's being tested or why items fail.

**What this changes:**
- `/verify` slash command runs verify interactively.
- Stages: doc verification (show mismatches) → test planning (show test cases) → test execution (show results as they complete) → report (show summary).

**Affected components:**
- `cli/src/voidrift_cli/commands/_chat_commands.py` — `/verify` handler

**Design constraint:** Initial implementation can delegate to `run_verify` with better output. Full interactive mode is a follow-up.

---

## TASK-F18: /develop slash command in chat

**Status:** Not started
**Depends on:** F14

**Problem:** `voidrift develop` executes tasks with limited visibility. The operator sees task completion but not what's happening inside each task.

**What this changes:**
- `/develop` slash command runs develop interactively.
- Shows task list and execution order, per-task progress, self-review results, file list verification.

**Affected components:**
- `cli/src/voidrift_cli/commands/_chat_commands.py` — `/develop` handler

**Design constraint:** Initial implementation can delegate to `run_develop` with better output. Full interactive mode is a follow-up.

---

## TASK-F19: Dim system output across all chat display

**Status:** Not started

**Problem:** System messages in chat are not consistently dim. Some use `style="dim"`, some don't. The operator can't visually distinguish system output from model responses.

**What this changes:**
- Audit all `ui._con.print()` calls in chat-related modules.
- Ensure all framework/system messages use dim styling.
- Operator input and model responses remain normal weight.

**Affected components:**
- `cli/src/voidrift_cli/commands/chat.py`
- `cli/src/voidrift_cli/commands/_chat_display.py`
- `cli/src/voidrift_cli/commands/_chat_commands.py` (when created)

**Design constraint:** Visual change only. No behavioral changes.
