---
name: BACKEND-ENG
description: Python backend engineering conventions for the VoidRift framework — Click CLI, agent tools, AgentLoop, pytest patterns.
---

# Domain: Backend Engineering — VoidRift Framework (BACKEND-ENG)

## Core Philosophy
- **Narrow interfaces:** Functions and agents receive only what they need. Avoid passing full config dicts or god objects.
- **Pull over push:** Agents retrieve context on demand via agent tools rather than receiving pre-loaded blobs.
- **Command discipline:** Each framework command exposes only its required agent tool subset via `_COMMAND_TOOLS` in `agent.py`.
- **Test at boundaries:** Write tests for config helpers, prompt loading, and CLI commands. Don't mock what you can call directly.

## Python Conventions
- Always include `from __future__ import annotations` at the top of every module.
- Use `pathlib.Path` everywhere. Never `os.path.join`.
- Type-annotate all public functions: `def foo(x: str) -> int:`.
- Use `lru_cache` for pure, expensive lookups (e.g., `load_config()`). Pair with a `_clear_cache()` test helper.
- Avoid bare `except:` — catch specific exceptions (`ValueError`, `OSError`, `KeyboardInterrupt`).
- `__init__.py` files are for re-exports only, not logic.

## Click CLI Patterns
- Top-level commands registered on the `cli` group in `main.py`.
- Subcommand groups created with `@click.group` and added via `cli.add_command(group)`.
- Use `@click.argument` for required positional inputs; `@click.option` for flags and optional params.
- Shell completion via `shell_complete=_complete_model` for model arguments.
- Exit codes: `sys.exit(0)` success, `sys.exit(1)` failure, `sys.exit(2)` usage error.
- Import command modules lazily inside command handlers (`from .commands.foo import run_foo`).

## Agent Tool Patterns
- Agent tools are CLI-native functions in the `tools/` package (`tools/filesystem.py`, `tools/process_manager.py`, `tools/http_client.py`, `tools/browser.py`), exposed as OpenAI-format tool definitions via `build_local_tools()`. `tools/__init__.py` contains re-exports only; logic lives in named modules.
- Tool handlers receive plain Python arguments; return plain strings.
- Command agent tool subsets are defined in `_COMMAND_TOOLS` in `agent.py` as `set[str]`.
- Never expose task-management tools (`load_tasks`, `get_next_task`, `complete_task`) to per-task developer agents.
- Three-layer skill search: project (`.voidrift/skills/`) → domain (`~/.voidrift/domain-skills/`) → north-star (`~/.voidrift/resources/skills/`).
- Skill files use YAML frontmatter with `name:` and `description:` fields; content follows after the closing `---`.

## AgentLoop Patterns
- Always set `max_tokens` via `get_max_tokens(model.model_type, stage)` — never hardcode.
- Use `stream=False` for all non-interactive (batch) agents.
- Use `tool_choice="required"` for agents that must call tools; `"auto"` for interactive chat.
- Cap file content passed to local agents via `get_max_input_chars(model.model_type)`.
- On 400 "Invalid JSON / EOF while parsing" errors, retry with `max_tokens // 2` and a shorter prompt.

## Prompts and Skills
- Prompts live in `resources/prompts/<cmd>.md` as named `##` sections.
- Load via `get_prompt("cmd", "SECTION")` through the prompt loader.
- Skill files live in `resources/skills/<NAME>.md`; loaded on demand via `get_skill("name")`.
- Analysis/synthesis agents receive only a category lens — not the full ANALYSIS-REQS skill.
- Consolidation agents receive the full ANALYSIS-REQS skill (analyst_role).

## pytest Conventions
- Test files mirror source structure: `cli/tests/test_<module>.py`.
- Name test functions to reference the requirement they validate: `test_req_cfg6_cap_wins_when_lower`.
- Use `@pytest.fixture(autouse=True)` for setup/teardown (e.g., cache clearing).
- Mock `load_config` with `unittest.mock.patch("voidrift_cli.config.load_config", return_value={...})`.
- Prefer `patch` context managers over `monkeypatch` for explicit scoping.
- Assert specific return values — don't use `assert result` for numeric returns that could be 0.
