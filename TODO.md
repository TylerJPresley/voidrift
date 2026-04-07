# TODO — Backlog

Work items, deferred audit tasks, and future ideas. Grouped by area, ordered by
priority within each group.

---

## Audit Remediation

---

- [x] **TODO-01** Fix stale V-entries pointing to deleted `test_new_features.py`
  file: REQUIREMENTS.md
  skills: QUALITY-QA
  reqs: REQ-U-15, REQ-U-17, REQ-UI-12
  Three V-entries still reference the deleted `test_new_features.py` after the
  test-file reorganization. The classes have been moved to `test_chat.py` but
  the V-table was not updated.

  **Changes required (all in REQUIREMENTS.md):**

  | Line | Current | Replace with |
  |------|---------|--------------|
  | 961  | `test_new_features.py::TestQuickCommand` | `test_chat.py::TestQuickCommand` |
  | 963  | `test_new_features.py::TestBareMode` | `test_chat.py::TestBareMode` |
  | 1039 | `test_new_features.py::TestChatStyles` | `test_chat.py::TestChatStyles` |

  **Verification:** `grep "test_new_features" REQUIREMENTS.md` returns no output.

---

- [x] **TODO-02** Remove module-level `_ctx` CWD singleton from `filesystem.py`
  file: cli/src/voidrift_cli/tools/filesystem.py
  skills: RELIABILITY-ENG, BACKEND-ENG
  reqs: REQ-ARCH-9
  **Risk:** Medium — touches every module-level facade function and their callers.

  `_ctx = WriteContext()` at line ~391 binds `Path.cwd()` at Python import time —
  before the project root is known (e.g. during test collection). The `develop`
  command creates its own `WriteContext(project_dir=d.parent)`, making `_ctx`
  dead code in production.

  **Steps:**

  1. Audit all callers of the module-level facade functions:
     ```bash
     grep -rn "from.*filesystem import.*write_source_file\|filesystem\.write_source_file" cli/src/
     grep -rn "from.*filesystem import.*read_source_file\|filesystem\.read_source_file" cli/src/
     ```
  2. Remove `_ctx = WriteContext()` singleton.
  3. For each production caller: update to construct `WriteContext(project_dir=<path>)`
     and call the method on the instance.
  4. If only tests remain as callers, convert facades to test helpers in `conftest.py`.
  5. Update `tools/__init__.py` to stop re-exporting removed functions.

  **Verification:** `make test` passes.
  `python -c "from voidrift_cli.tools.filesystem import WriteContext; print('OK')"` works.

---

- [x] **TODO-03** Move `_COMMAND_TOOLS` ownership to command modules (OCP fix)
  skills: ARCH-DESIGN, BACKEND-ENG
  reqs: REQ-ARCH-9
  **Risk:** Medium — touches `tool_builder.py` + all 6 command modules.

  The `_COMMAND_TOOLS` dict at `tool_builder.py:34–53` and `_bash_descriptions`
  dict at `tool_builder.py:420–439` require editing `tool_builder.py` whenever a
  new command is added — an Open/Closed violation.

  **Design:** Each command module declares a module-level constant:

  ```python
  # commands/gather.py
  AGENT_TOOLS: frozenset[str] = frozenset({
      "read_source_file", "write_framework_file", "read_framework_file",
      "read_document", "code_analysis",
  })

  # commands/develop.py
  AGENT_TOOLS: frozenset[str] = frozenset({
      "read_source_file", "write_source_file", "edit_source_file",
      "read_framework_file", "run_command",
  })
  BASH_DESCRIPTION: tuple[str, list[str]] = (
      "Run build, test, and lint commands to validate written code.",
      ["Run tests after writing code.", "Check exit_code in the result."],
  )
  ```

  `build_local_tools()` resolves the allowed set via dynamic import:
  ```python
  if cmd is not None:
      _cmd_base = cmd.split("-")[0]
      _mod = importlib.import_module(f".commands.{_cmd_base}", package=__package__)
      if cmd == "verify-execute":
          allowed = getattr(_mod, "AGENT_TOOLS_EXECUTE", None)
      elif cmd == "verify-plan":
          allowed = getattr(_mod, "AGENT_TOOLS_PLAN", None)
      else:
          allowed = getattr(_mod, "AGENT_TOOLS", None)
  ```

  Then delete `_COMMAND_TOOLS` and `_bash_descriptions` from `tool_builder.py`.

  **Constants needed per module:**
  - `gather.py`: `AGENT_TOOLS` (5 tools)
  - `plan.py`: `AGENT_TOOLS` (2 tools)
  - `develop.py`: `AGENT_TOOLS` (5 tools) + `BASH_DESCRIPTION`
  - `chat.py`: `AGENT_TOOLS` (16 tools) + `BASH_DESCRIPTION`
  - `verify.py`: `AGENT_TOOLS_PLAN` (3 tools) + `AGENT_TOOLS_EXECUTE` (8 tools) + `BASH_DESCRIPTION`
  - `deploy.py`: no `AGENT_TOOLS` (uses all tools via `build_local_tools()` with no cmd)

  **Verification:** `make test`. Spot-check each command gets correct tool set.

---

- [x] **TODO-04** Fix `_active_skill_allowed_tools` module-level side-channel
  skills: SECURITY-TRUST, WORKFLOW
  reqs: REQ-SKL-9, REQ-ARCH-14
  **Risk:** High — changes inter-module communication pattern.

  `_active_skill_allowed_tools` at `tool_builder.py:15` is a module-level mutable
  dict that acts as a hidden communication channel between the `get_skill` handler
  and the chat command's `before_tool_call` hook. Two concurrent sessions would
  corrupt each other.

  **Design:** Move skill restriction state onto the `AgentLoop` instance:

  1. Add fields to `AgentLoop`:
     ```python
     active_skill_allowed_tools: list[str] | None = None
     active_skill_name: str = ""
     ```

  2. `_get_skill_handler` encodes allowed_tools in the return value:
     ```python
     prefix = f"<!-- SKILL_META:{json.dumps({'_skill_allowed_tools': at, '_skill_name': name})} -->\n"
     return prefix + content
     ```

  3. `_interactive_loop` in `chat.py` uses `after_tool_call` to extract metadata
     and set `agent.active_skill_allowed_tools`. `before_tool_call` reads from the
     agent instance instead of the global dict.

  4. Delete `_active_skill_allowed_tools`, `clear_active_skill()` from
     `tool_builder.py` and their re-exports from `agent.py`.

  **Verification:** `make test -k "test_skills or test_chat"`.
  Verify the global no longer exists: `grep "_active_skill_allowed_tools" cli/src/` returns no output.

---

## Structural Refactors

Each item below requires a requirements update per the START.md workflow before
implementation begins.

---

- [x] **TODO-05** Decompose `_run_loop()` in `agent.py` into focused methods
  file: cli/src/voidrift_cli/agent.py
  skills: ARCH-DESIGN, RELIABILITY-ENG
  reqs: REQ-ARCH-4, REQ-ARCH-14
  `_run_loop()` spans ~300 lines (lines 275–580) and handles API calls, response
  parsing, stall detection, queue draining, and context trimming in a single
  method. Extract `_run_one_turn()`, `_handle_stall()`, and `_drain_queues()`.
  The loop body becomes a dispatcher calling these methods — each handles one
  concern and is independently testable.

---

- [x] **TODO-06** Split `_interactive_loop()` in `commands/chat.py` into focused modules
  file: cli/src/voidrift_cli/commands/chat.py
  skills: ARCH-DESIGN
  reqs: REQ-U-2
  `_interactive_loop()` is ~750 lines (from line 46) mixing terminal state
  management, Rich display callbacks, the `/idea`/`/done` state machine, and
  the readline/prompt-toolkit input loop. Extract terminal state management,
  display callbacks, and the idea state machine into separate concerns.

---

- [x] **TODO-07** Extract `LOCAL_TOOLS`/`LOCAL_HANDLERS` from `filesystem.py` to a registry module
  file: cli/src/voidrift_cli/tools/filesystem.py
  skills: ARCH-DESIGN, BACKEND-ENG
  reqs: REQ-ARCH-9
  `LOCAL_TOOLS` (OpenAI-format tool schema definitions, lines ~485–633) and
  `LOCAL_HANDLERS` (name→function mapping, lines ~633–642) live in `filesystem.py`
  alongside `WriteContext`. Move both to a dedicated `tools/registry.py`. This
  separates "what tools exist" from "how tools work" and reduces `filesystem.py`
  to its core concern.

---

- [x] **TODO-08** Split `commands/gather.py` pipeline stages into named functions
  file: cli/src/voidrift_cli/commands/gather.py
  skills: ARCH-DESIGN
  reqs: REQ-G-8
  The gather pipeline (triage → context build → source analysis → final pass) is
  implemented as one long function from line 264. Each stage has distinct
  inputs/outputs and could be independently testable. Extract 4 pipeline stages
  into named functions or a `GatherPipeline` class.

---

## Future

- [x] **TODO-09** `history.log` rotation strategy
  skills: RELIABILITY-ENG
  reqs: none — requires new REQ
  Rotate on release boundaries rather than size/date. The deploy command reads
  from `history.log` to classify version bumps; rotation at release cuts keeps
  the signal clean between versions.

- [x] **TODO-10** Kanban-style board view for `voidrift status`
  skills: BACKEND-ENG
  reqs: none — requires new REQ
  Rich table grouped by status columns (planned, in-progress, implemented,
  verified, failed/blocked). Data from `manifest.yml`.

- [x] **TODO-11** Progressive skill synthesis (Tier 3)
  skills: WORKFLOW, ARCH-DESIGN
  reqs: none — requires new REQ
  When a task requires a skill that doesn't exist at any layer and word-overlap
  resolution also fails, synthesize a new skill on-the-fly using the
  `skills install` pipeline and write it to `.voidrift/skills/` (project layer).
  Requires: `synthesis_model` configured in `config.yml`, sandboxed synthesis call
  during plan stage 2, operator-approval gate before the skill becomes active.
  Reference: Voyager self-growing skill library pattern.
