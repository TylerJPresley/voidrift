"""VoidRift CLI — main entry point."""

from __future__ import annotations

import os
import signal
import sys
import logging
import itertools
import threading
import time
from pathlib import Path

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

import click
from rich.prompt import Prompt, IntPrompt

from .models import resolve_model, list_models
from . import ui

HELP_TEXT = """The Agentic Software Engineering Framework.

AI agents reverse-engineer requirements, generate architecture, implement code,
produce infrastructure-as-code, and validate against acceptance criteria.

Getting started:
  voidrift gather <model> --path <dir>     Reverse-engineer requirements
  voidrift chat <model>                   Interactive requirements & planning
  voidrift plan <model>                   Generate architecture and tasks
  voidrift develop <model> [<architect>]  Execute implementation tasks
  voidrift verify <model>                  Requirements-driven acceptance testing

Framework commands:
  gather <model> --path <dir> [--overwrite]
  plan <model> [--overwrite]
  develop <model> [<architect>]              Execute implementation tasks
  deploy <model> [<architect>]
  verify <model>

Utility:
  status                      Show project command status
  chat <model> [--doc <path>] Interactive session with agent tools
  log <command> [--prune] [-f]   View or manage command logs
  prune [--global] [--all]    Clean ephemeral data
  unlock                      Remove develop lock

Run 'voidrift COMMAND --help' for details."""


class OrderedGroup(click.Group):
    """Click group that preserves command insertion order."""

    def list_commands(self, ctx: click.Context) -> list[str]:
        return list(self.commands)


class TopGroup(OrderedGroup):
    """Top-level group with custom help layout."""

    def format_usage(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        formatter.write("Usage: voidrift [COMMAND]\n")

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        self.format_usage(ctx, formatter)
        formatter.write("\n")
        formatter.write(self.help or "")
        formatter.write("\n")


@click.group(cls=TopGroup, invoke_without_command=True, help=HELP_TEXT)
@click.pass_context
def cli(ctx) -> None:
    if ctx.invoked_subcommand is None:
        _interactive_mode()


def _complete_model(ctx, param, incomplete):
    """Shell completion for model aliases."""
    try:
        return [a for a in list_models() if a.startswith(incomplete)]
    except Exception:
        return []


def main() -> None:
    """Entry point with clean error handling."""
    from .utils import setup_system_log, get_system_logger
    setup_system_log()
    log = get_system_logger()
    log.info("invoked: %s", " ".join(sys.argv[1:]))
    try:
        cli(standalone_mode=False)
    except SystemExit:
        raise
    except KeyboardInterrupt:
        sys.exit(130)
    except click.UsageError as e:
        ui.error(e.format_message())
        if e.ctx:
            ui._err.print(e.ctx.get_help())
        sys.exit(2)
    except click.Abort:
        sys.exit(130)
    except Exception as e:
        log.exception("unhandled exception")
        ui.error(str(e))
        sys.exit(1)


def _active_model_alias() -> str | None:
    """Return the alias of the currently running local model, or None (REQ-ARCH-3).

    Reads the active container file (configurable via active_container_file in config.yml,
    default ~/.worker-cli/.active-container) written by worker start.
    Second line of the file is the model alias.
    """
    from .config import load_config
    cfg = load_config()
    p = Path(cfg.get("active_container_file", str(Path.home() / ".worker-cli" / ".active-container")))
    if not p.exists():
        return None
    lines = p.read_text().strip().splitlines()
    return lines[1].strip() if len(lines) > 1 else None


def _interactive_mode():
    """Interactive guided flow when no subcommand given (REQ-ARCH-3)."""
    ui.header("VoidRift — The Agentic Software Engineering Framework")

    actions = ["gather", "plan", "develop", "deploy", "verify", "chat", "status"]
    for i, a in enumerate(actions, 1):
        ui._con.print(f"  {i}. {a}")

    try:
        choice = IntPrompt.ask("\nSelect action", choices=[str(i) for i in range(1, len(actions) + 1)])
        action = actions[choice - 1]
    except (KeyboardInterrupt, EOFError):
        return

    if action == "status":
        _status()
        return

    models = list_models()
    ui._con.print(f"\nAvailable models: {', '.join(models)}")

    # Default to the active local model, or the first configured model (REQ-ARCH-3)
    default_model = _active_model_alias() or (models[0] if models else "")
    try:
        model_name = Prompt.ask("Model", default=default_model) if default_model else Prompt.ask("Model")
    except (KeyboardInterrupt, EOFError):
        return

    # Build and run command
    args = [action, model_name]

    if action == "gather":
        try:
            path = Prompt.ask("Path to analyze", default=".")
            args.append(path)
        except (KeyboardInterrupt, EOFError):
            return

    if action == "develop":
        try:
            arch = Prompt.ask("Architect model (optional, press Enter to skip)", default="")
            if arch:
                args.append(arch)
        except (KeyboardInterrupt, EOFError):
            return

    ctx = cli.make_context("voidrift", args)
    with ctx:
        cli.invoke(ctx)


# ---------------------------------------------------------------------------
# Framework commands
# ---------------------------------------------------------------------------


def _check_setup() -> None:
    """Exit with a setup error if the models file is missing (REQ-CFG-8)."""
    from .config import get_models_file
    models_path = get_models_file()
    if not models_path.exists():
        raise click.ClickException(
            f"Models file not found at {models_path}. Configure 'models_file' in config.yml or set up your model registry."
        )


def _make_budget(max_input_tokens: int | None, max_output_tokens: int | None, mc=None):
    """Create a TokenBudget from CLI flags + model config (REQ-ARCH-13).

    CLI flags override model config values. Returns None if no limits are set.
    """
    from .token_budget import TokenBudget
    inp = max_input_tokens or (mc.max_input_tokens if mc else None)
    out = max_output_tokens or (mc.max_output_tokens if mc else None)
    if inp or out:
        return TokenBudget(max_input_tokens=inp, max_output_tokens=out)
    return None


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.option("--path", type=click.Path(exists=True), help="Path to codebase directory")
@click.option("--idea", type=int, help="Idea ID to generate requirements from")
@click.option("--overwrite", is_flag=True, help="Remove previous gather artifacts and start fresh")
@click.option("--max-input-tokens", type=int, help="Max input tokens for this run")
@click.option("--max-output-tokens", type=int, help="Max output tokens for this run")
def gather(model, path, idea, overwrite, max_input_tokens, max_output_tokens) -> None:
    """Gather: Reverse-engineer requirements from a codebase or idea."""
    if not path and idea is None:
        click.echo("Error: specify --path <dir> or --idea <id>\n")
        click.echo("  voidrift gather <model> --path ./src")
        click.echo("  voidrift gather <model> --idea 3")
        sys.exit(1)
    _check_setup()
    from .commands.gather import run_gather
    mc = resolve_model(model)
    budget = _make_budget(max_input_tokens, max_output_tokens, mc=mc)
    sys.exit(run_gather(mc, from_path=path, idea_id=idea, overwrite=overwrite, token_budget=budget))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.option("--overwrite", is_flag=True, help="Remove previous plan artifacts and start fresh")
@click.option("--idea", type=int, help="Scope planning to a specific idea ID")
def plan(model, overwrite, idea) -> None:
    """Plan: Generate architecture and task breakdown."""
    _check_setup()
    from .commands.plan import run_plan
    mc = resolve_model(model)
    sys.exit(run_plan(mc, overwrite=overwrite, idea_id=idea))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
@click.option("--max-input-tokens", type=int, help="Max input tokens for this run")
@click.option("--max-output-tokens", type=int, help="Max output tokens for this run")
def develop(model, architect, max_input_tokens, max_output_tokens) -> None:
    """Develop: Execute implementation tasks."""
    _check_setup()
    from .commands.develop import run_develop
    mc = resolve_model(model)
    am = resolve_model(architect) if architect else mc
    budget = _make_budget(max_input_tokens, max_output_tokens, mc=mc)
    sys.exit(run_develop(mc, architect=am, token_budget=budget))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
def deploy(model, architect) -> None:
    """Deploy: Generate infrastructure-as-code."""
    _check_setup()
    from .commands.deploy import run_deploy
    mc = resolve_model(model)
    am = resolve_model(architect) if architect else mc
    sys.exit(run_deploy(mc, architect=am))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
def verify(model) -> None:
    """Verify: Requirements-driven acceptance testing."""
    _check_setup()
    from .commands.verify import run_verify
    mc = resolve_model(model)
    sys.exit(run_verify(mc))


# ---------------------------------------------------------------------------
# Utility commands
# ---------------------------------------------------------------------------


def _query_max_context(mc) -> int | None:
    """Query max_model_len from the model's /v1/models endpoint (REQ-MC-3).

    Falls back to mc.max_context (from models.yml) for models that don't
    expose max_model_len on their endpoint.
    """
    try:
        from openai import OpenAI
        kwargs: dict = {"timeout": 5}
        if mc.api_base:
            kwargs["base_url"] = mc.api_base
        if mc.api_key:
            kwargs["api_key"] = mc.api_key
        else:
            kwargs["api_key"] = "no-key"
        client = OpenAI(**kwargs)
        models = client.models.list()
        for m in models.data:
            if hasattr(m, "max_model_len"):
                return m.max_model_len
    except Exception:
        pass
    return mc.max_context


def _interactive_loop(agent, mc, log, title, write_tools=None, extra_header=None, web_fetch_kwargs=None, original_skill=None, session=None, style="verbose"):
    """Shared interactive terminal loop (REQ-UI-1, REQ-UI-2, REQ-UI-4)."""
    from .agent import AgentLoop

    _original_skill = original_skill or ""

    model_label = f"{mc.alias} ({mc.model_id})"
    ui.header(title)
    if extra_header:
        for line in extra_header:
            ui.detail(line)
    ui.detail(f"Log: {log}")
    ui.detail(f"Model: {model_label}")

    # Query context window size from model API (REQ-UI-6)
    max_ctx = _query_max_context(mc)

    def _estimate_tokens(messages):
        """Rough token estimate: chars / 4."""
        return sum(len(m.get("content") or "") for m in messages) // 4

    def _context_prompt():
        """Build colored context percentage prompt (REQ-UI-6)."""
        from prompt_toolkit import ANSI
        mode = ""
        if _idea_state.get("active"):
            idea_id = _idea_state.get("id")
            mode = f" idea:{idea_id}" if idea_id else " idea"
        if not max_ctx:
            if mode:
                return ANSI(f"\n\033[36m[{mode.strip()}]\033[0m > ")
            return ANSI("\n> ")
        pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
        if pct > 80:
            color = "\033[31m"  # red
        elif pct > 60:
            color = "\033[33m"  # yellow
        else:
            color = "\033[37m"  # white
        if mode:
            return ANSI(f"\n{color}[{pct}%\033[36m{mode}{color}]\033[0m > ")
        return ANSI(f"\n{color}[{pct}%]\033[0m > ")

    from rich.console import Group as _RGroup
    from rich.live import Live
    from rich.padding import Padding as _RPadding
    from rich.spinner import Spinner as _RSpinner
    from rich.text import Text as _RText

    # Shared state for Live-based streaming display.
    # Uses a list so closures can mutate without nonlocal declarations.
    _live_holder: list = [None]   # current Live instance
    _live_start: list[float] = [0.0]  # turn start time for elapsed display
    _turn_label: list[str] = [""]     # label fixed per turn so updates stay consistent
    _got_token: list[bool] = [False]  # True once streaming tokens arrive
    _stream_buf: list[str] = []       # accumulated token buffer
    _term_holder: list = [None]       # (termios_module, fd, saved_attr) while raw mode active

    def _thinking_text(elapsed: float = 0.0, tokens_in: int = 0, ctx_pct: int | None = None) -> str:
        """Build thinking spinner text with optional telemetry."""
        parts = [ui.elapsed_str(elapsed)] if elapsed >= 1 else []
        if tokens_in:
            parts.append(f"↓ {ui.token_str(tokens_in)} tokens")
        if ctx_pct is not None:
            parts.append(f"ctx {ctx_pct}%")
        if parts:
            parts.append("thinking")
            return f"  {_turn_label[0]} ({' · '.join(parts)})"
        return f"  {_turn_label[0]}"

    def _thinking() -> _RPadding:
        return _RPadding(_RSpinner("dots", text=_thinking_text(), style="dim"), pad=(1, 0, 0, 0))

    def on_token(token: str) -> None:
        _got_token[0] = True
        _stream_buf.append(token)
        live = _live_holder[0]
        if live is not None:
            # Show a tail window during streaming — keeps display compact and
            # avoids rendering broken partial markdown. Final Rich render
            # (with tables, headers, etc.) happens once the stream ends.
            text = "".join(_stream_buf)
            lines = text.splitlines()
            tail = "\n".join(lines[-5:]) if len(lines) > 5 else text
            live.update(_RPadding(_RText("  " + tail, style="dim"), pad=(1, 0, 0, 0)))

    _stats_parts = []

    def on_complete(stats: dict) -> None:
        nonlocal _stats_parts
        _stats_parts = []
        elapsed = stats.get("elapsed", 0)
        completion_tokens = stats.get("completion_tokens", 0)
        prompt_tokens = stats.get("prompt_tokens", 0)
        ctx_pct = stats.get("ctx_pct")
        if completion_tokens:
            _stats_parts.append(f"↑ {ui.token_str(completion_tokens)} tokens")
        if prompt_tokens:
            _stats_parts.append(f"↓ {ui.token_str(prompt_tokens)} tokens")
        if stats.get("tokens_per_sec"):
            _stats_parts.append(f"{stats['tokens_per_sec']} tok/s")
        if elapsed:
            _stats_parts.append(f"{elapsed}s")
        if ctx_pct is not None:
            _stats_parts.append(f"ctx {ctx_pct}%")

    def on_progress(data: dict) -> None:
        """Update Live thinking spinner with elapsed time while waiting."""
        if _got_token[0]:
            return  # streaming tail is already showing — don't overwrite
        live = _live_holder[0]
        if live is not None and data.get("state") == "thinking":
            elapsed = time.time() - _live_start[0]
            tokens_in = data.get("prompt_tokens", 0)
            ctx_pct = data.get("ctx_pct")
            live.update(_RPadding(
                _RSpinner("dots", text=_thinking_text(elapsed, tokens_in, ctx_pct), style="dim"),
                pad=(1, 0, 0, 0),
            ))

    # Tool call tracking for --style (REQ-UI-12)
    _tool_calls_this_turn: list[str] = []

    def on_tool_call(name: str) -> None:
        _got_token[0] = False  # back to thinking state while tool executes
        _tool_calls_this_turn.append(name)
        if style == "verbose":
            live = _live_holder[0]
            if live is not None:
                live.update(_RPadding(
                    _RText(f"  → {name}", style="dim"), pad=(1, 0, 0, 0),
                ))
                return
        live = _live_holder[0]
        if live is not None:
            live.update(_thinking())

    def on_tool_result(name: str, result: str) -> None:
        _got_token[0] = False  # thinking again while model processes tool result
        live = _live_holder[0]
        if live is not None:
            live.update(_thinking())

    # Rebuild web_fetch handler with a confirm_fn that pauses for the permission
    # prompt, so it renders cleanly within the Live context (REQ-U-8).
    if web_fetch_kwargs:
        import click as _click
        from .tools import make_web_fetch_handler as _make_wf

        def _live_confirm(url: str) -> bool:
            # Stop Live entirely so Click can own the terminal (REQ-UI-9).
            # transient=True on stop clears the Thinking... from the screen;
            # reset to False before restart so the final response persists.
            live = _live_holder[0]
            if live is not None:
                live.transient = True
                live.stop()
                live.transient = False
            # Restore terminal input mode so the prompt is visible and typeable.
            _ts = _term_holder[0]
            if _ts is not None:
                _tm, _fd, _saved = _ts
                try:
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _saved)
                except Exception:
                    pass
            ui._con.print(f"\n[dim]web_fetch →[/dim] [cyan]{url}[/cyan]")
            try:
                allowed = _click.confirm("  Allow fetch?", default=False)
            except _click.Abort:
                allowed = False
            # Re-disable echo and restart Live.
            if _ts is not None:
                try:
                    _raw = _tm.tcgetattr(_fd)
                    _raw[3] &= ~(_tm.ECHO | _tm.ICANON)
                    _tm.tcsetattr(_fd, _tm.TCSANOW, _raw)
                except Exception:
                    pass
            if live is not None:
                live.start()
                live.update(_thinking())
            return allowed

        agent.tool_handlers["web_fetch"] = _make_wf(
            **web_fetch_kwargs, confirm_fn=_live_confirm
        )

    # Wire ask_user_question handler with terminal restoration (TASK-FW-011)
    from .tools import make_ask_user_handler as _make_auh

    def _live_ask(question: str, options: list[str] | None) -> str:
        live = _live_holder[0]
        if live is not None:
            live.transient = True
            live.stop()
            live.transient = False
        _ts = _term_holder[0]
        if _ts is not None:
            _tm, _fd, _saved = _ts
            try:
                _tm.tcsetattr(_fd, _tm.TCSANOW, _saved)
            except Exception:
                pass
        ui._con.print(f"\n[bold yellow]▸ Agent question:[/bold yellow] {question}")
        if options:
            for i, opt in enumerate(options, 1):
                ui._con.print(f"  [cyan]{i}.[/cyan] {opt}")
        try:
            response = input("  > ")
        except (EOFError, KeyboardInterrupt):
            response = "[No response]"
        if _ts is not None:
            try:
                _raw = _tm.tcgetattr(_fd)
                _raw[3] &= ~(_tm.ECHO | _tm.ICANON)
                _tm.tcsetattr(_fd, _tm.TCSANOW, _raw)
            except Exception:
                pass
        if live is not None:
            live.start()
            live.update(_thinking())
        return response

    agent.tool_handlers["ask_user_question"] = _make_auh(ask_fn=_live_ask)

    agent.on_token = on_token
    agent.on_complete = on_complete
    agent.on_tool_call = on_tool_call
    agent.on_tool_result = on_tool_result
    agent.on_progress = on_progress

    from prompt_toolkit import PromptSession
    from prompt_toolkit.key_binding import KeyBindings

    kb = KeyBindings()

    @kb.add("enter")
    def _submit(event):
        buf = event.current_buffer
        # If the current line ends with \, strip it and insert a real newline
        # (matches Claude CLI's universal multiline convention).
        if buf.document.current_line.endswith("\\"):
            buf.delete_before_cursor()  # remove the backslash
            buf.insert_text("\n")
        else:
            buf.validate_and_handle()

    _prompt_session = PromptSession(key_bindings=kb, multiline=True)

    _consecutive_interrupt = 0
    _compact_nudged = False  # inject compact reminder once when context hits 70%
    _compact_failures = 0  # circuit breaker counter (REQ-U-10)
    _auto_compact_disabled = False  # set True after 3 consecutive failures

    def _do_compact() -> bool:
        """Summarize history to free context (REQ-U-7, REQ-U-10, REQ-U-11).

        Returns True on success, False on failure.
        """
        nonlocal _compact_nudged, _compact_failures, _auto_compact_disabled
        ui._con.print()  # blank line after operator input
        if len(agent.messages) <= 1:
            ui.info("Nothing to compact.")
            return True

        target = max_ctx // 10 if max_ctx else 8000
        from . import prompts as _prompts
        compact_prompt = _prompts.load_prompt("chat", "COMPACT").format(
            target_tokens=target,
        )

        # Capture original system prompt and skills for restoration (REQ-U-11).
        original_system = agent.messages[0]["content"]

        # Disable terminal echo and show spinner while the model works.
        _saved_term = None
        try:
            import termios as _termios
            _fd = sys.stdin.fileno()
            _saved_term = _termios.tcgetattr(_fd)
            _raw = _termios.tcgetattr(_fd)
            _raw[3] &= ~(_termios.ECHO | _termios.ICANON)
            _termios.tcsetattr(_fd, _termios.TCSANOW, _raw)
        except Exception:
            pass

        summary = ""
        try:
            _compact_spinner = _RSpinner("dots", text=f"  {ui.random_label()}", style="dim")
            with Live(_compact_spinner, console=ui._con, refresh_per_second=12, transient=True):
                client = agent._get_client()
                resp = client.chat.completions.create(
                    model=agent._model_name(),
                    messages=agent.messages + [{"role": "user", "content": compact_prompt}],
                    max_tokens=target,
                )
                summary = resp.choices[0].message.content or ""
        except Exception as e:
            ui.error(f"Compact failed: {e}")
            _compact_failures += 1
            if _compact_failures >= 3:
                _auto_compact_disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            return False
        finally:
            if _saved_term is not None:
                try:
                    _termios.tcsetattr(_fd, _termios.TCSANOW, _saved_term)
                except Exception:
                    pass

        # Replace history with system prompt + summary.
        sys_content = original_system + f"\n\n[Conversation summary]\n{summary}"
        agent.messages = [{"role": "system", "content": sys_content}]

        # Check if result exceeds 10% cap.
        result_tokens = _estimate_tokens(agent.messages)
        if max_ctx and result_tokens > max_ctx // 10:
            _compact_failures += 1
            if _compact_failures >= 3:
                _auto_compact_disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            ui.warn(f"Compact result still {result_tokens * 100 // max_ctx}% of context.")
            return False

        # Success — reset failure counter.
        _compact_failures = 0

        # Post-compact restoration (REQ-U-11): re-inject recent files and skills.
        from .tools.filesystem import get_read_files as _get_read_files
        restore_parts: list[str] = []
        restore_budget = max_ctx // 5 if max_ctx else 50000  # 20% cap
        restore_used = 0

        # Last 3 unique files, newest first.
        recent = _get_read_files()
        seen: set[str] = set()
        newest_3: list[str] = []
        for p in reversed(recent):
            if p not in seen:
                seen.add(p)
                newest_3.append(p)
                if len(newest_3) == 3:
                    break

        for fpath in newest_3:
            try:
                from pathlib import Path as _Path
                if fpath.startswith(".voidrift/"):
                    full = _Path.cwd() / fpath
                else:
                    full = _Path.cwd() / fpath
                if not full.exists():
                    continue
                content = full.read_text(encoding="utf-8", errors="replace")
                cost = len(content) // 4  # rough token estimate
                if restore_used + cost > restore_budget:
                    break
                restore_parts.append(f"[File: {fpath}]\n{content}")
                restore_used += cost
            except Exception:
                continue

        # Re-inject skills from original system prompt.
        # Skills are delimited by their markdown headers in the system prompt.
        # We stored the skill content at chat init — extract from original_system.
        if _original_skill and restore_used + len(_original_skill) // 4 <= restore_budget:
            restore_parts.append(f"[Skills]\n{_original_skill}")

        if restore_parts:
            agent.messages.append({
                "role": "system",
                "content": "[Restored context]\n\n" + "\n\n".join(restore_parts),
            })

        pct = _estimate_tokens(agent.messages) * 100 // max_ctx if max_ctx else 0
        ui.info(f"Compacted to {pct}% of context window.")
        ui._con.print(ui.render_text(summary), style="dim")
        with open(log, "a") as f:
            f.write(f"\n[COMPACT] {summary}\n")
        # Persist compaction to session JSONL (REQ-U-13)
        if session:
            session.append_compaction(summary)
        _compact_nudged = False
        return True

    # ── Idea refinement state (REQ-IDEA-1 through REQ-IDEA-4) ───────
    _idea_state: dict = {}  # {"active": True, "id": N, "mm": ManifestManager}

    def _handle_idea(agent, log, user_input: str) -> str:
        """Start or resume an idea refinement flow. Returns message to send to agent."""
        from .manifest import ManifestManager
        from . import prompts as _prompts

        arg = user_input.strip()[5:].strip()  # strip "/idea"

        if arg:
            # Load existing idea
            try:
                idea_id = int(arg)
            except ValueError:
                ui.error(f"Invalid idea ID: {arg}")
                return ""
            mm = ManifestManager()
            if mm.exists():
                mm.load()
            content = mm.read_idea(idea_id)
            if not content:
                ui.error(f"IDEA-{idea_id} not found.")
                return ""
            idea_context = f"Existing idea:\n\n{content}"
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            _idea_state.update(active=True, id=idea_id, mm=mm)
            ui.info(f"Loaded IDEA-{idea_id}. Type /done when finished.")
            return f"I've loaded IDEA-{idea_id}. Summarize where we left off and ask what I'd like to refine."
        else:
            # New idea — no ID until /done
            idea_context = "This is a new idea. Start with Stage 1 — Intake."
            overlay = _prompts.load_prompt("chat", "IDEA").format(idea_context=idea_context)
            agent.messages[0]["content"] += f"\n\n{overlay}"
            _idea_state.update(active=True, id=None)
            ui.info("Starting idea refinement. Type /done when finished.")
            return "I want to develop a new idea."

    def _finish_idea(agent, log) -> str:
        """Save the idea and return to normal chat. Returns message to send to agent."""
        from .manifest import ManifestManager

        mm = ManifestManager()
        if mm.exists():
            mm.load()
        mm.ensure_dirs()

        idea_id = _idea_state.get("id")
        is_new = idea_id is None
        if is_new:
            idea_id = mm.next_idea_id

        # Ask operator for category
        ui.info("Categorize this idea:")
        ui._con.print("  [bold]now[/bold] — high priority, work on it soon")
        ui._con.print("  [bold]next[/bold] — upcoming, after current work")
        ui._con.print("  [bold]later[/bold] — parked for future consideration")

        from prompt_toolkit import prompt as _pt_prompt
        while True:
            cat = _pt_prompt("\nCategory (now/next/later): ").strip().lower()
            if cat in ("now", "next", "later"):
                break
            ui.warn("Choose: now, next, or later")

        if is_new:
            mm.add_idea(idea_id, status=cat)
        else:
            mm.set_idea_status(idea_id, cat)

        ui.info(f"IDEA-{idea_id} saved as {cat}.")
        with open(log, "a") as f:
            f.write(f"\n[IDEA] IDEA-{idea_id} saved as {cat}\n")

        msg = (
            f"Write the final structured idea to "
            f"ideas/IDEA-{idea_id}.md using write_framework_file. "
            f"Include: title, user story, context, acceptance criteria, "
            f"affected modules, and affected files (if modifying existing behavior)."
        )
        _idea_state.clear()
        return msg

    try:
        while True:
            try:
                user_input = _prompt_session.prompt(_context_prompt()).strip()
                _consecutive_interrupt = 0
            except KeyboardInterrupt:
                _consecutive_interrupt += 1
                if _consecutive_interrupt >= 2:
                    raise
                ui.info("Press Ctrl+C again to exit.")
                continue
            except EOFError:
                break
            if user_input.lower() in ("quit", "exit", "/quit"):
                break
            if not user_input:
                continue  # ignore accidental Enter pressed during model processing
            _consecutive_interrupt = 0

            # /compact — summarize history to free context (REQ-U-7)
            if user_input.lower().strip() == "/compact":
                _do_compact()
                continue

            # /clear — wipe session and start fresh (REQ-U-13)
            if user_input.lower().strip() == "/clear":
                if session:
                    session.clear()
                # Reset agent to just system prompt
                agent.messages = [agent.messages[0]]
                ui.info("Session cleared.")
                continue

            # /quick — one-shot side question, no history effect (REQ-U-15)
            if user_input.lower().startswith("/quick"):
                _quick_text = user_input[6:].strip()
                if not _quick_text:
                    ui.info("Usage: /quick <question>")
                    continue
                try:
                    _quick_client = agent._get_client()
                    _quick_resp = _quick_client.chat.completions.create(
                        model=agent._model_name(),
                        messages=[
                            {"role": "system", "content": "Answer concisely."},
                            {"role": "user", "content": _quick_text},
                        ],
                        max_tokens=2048,
                    )
                    _quick_answer = _quick_resp.choices[0].message.content or ""
                    ui._con.print()
                    ui._con.print(ui.render_text(_quick_answer) if style != "raw" else f"  {_quick_answer}")
                except Exception as _qe:
                    ui.error(f"Quick answer failed: {_qe}")
                continue

            # /idea — guided idea refinement (REQ-IDEA-1)
            low = user_input.lower().strip()
            if low == "/idea" or low.startswith("/idea "):
                user_input = _handle_idea(agent, log, user_input)
                if not user_input:
                    continue

            # /done — save idea and return to normal chat (REQ-IDEA-3)
            if low == "/done" and _idea_state.get("active"):
                user_input = _finish_idea(agent, log)
                if not user_input:
                    continue

            # /write enables tools for this turn (REQ-UI-3)
            if write_tools is not None:
                low = user_input.lower().strip()
                is_write = low.startswith("/write") or low in {
                    "write", "write it", "go ahead and write",
                    "please write the file now", "please write the file",
                    "write the file", "write the file now",
                }
                if is_write:
                    agent.tools = write_tools
                    # qwen3 ignores enable_thinking:false with tools — drop it
                    agent.extra_body = None
                    if low.startswith("/write"):
                        user_input = user_input[6:].strip() or "Please write the file now."
                else:
                    agent.tools = []
                    agent.extra_body = {"chat_template_kwargs": {"enable_thinking": False}}

            with open(log, "a") as f:
                f.write(f"\n> {user_input}\n")

            _stream_buf.clear()
            _got_token[0] = False
            _turn_label[0] = ui.random_label()
            _msg_snapshot = len(agent.messages)

            # Clear active skill restrictions at start of each turn (REQ-SKL-9)
            from .agent import clear_active_skill
            clear_active_skill()

            # Auto-compact at 80%; nudge once at 70% (REQ-U-10).
            if max_ctx:
                pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
                if pct >= 80 and not _auto_compact_disabled:
                    ui.info("Context window at 80% — auto-compacting...")
                    _do_compact()
                    _compact_nudged = True
                    _msg_snapshot = len(agent.messages)
                elif pct >= 70 and not _compact_nudged:
                    agent.messages.append({
                        "role": "system",
                        "content": (
                            "Context window is over 70% full. "
                            "Remind the operator to run /compact to free space before continuing."
                        ),
                    })
                    _compact_nudged = True
                    _msg_snapshot = len(agent.messages)

            # Disable terminal echo while the model is processing so keystrokes
            # don't appear alongside the Live display output (REQ-UI-9).
            _saved_term = None
            try:
                import termios as _termios
                _fd = sys.stdin.fileno()
                _saved_term = _termios.tcgetattr(_fd)
                _raw = _termios.tcgetattr(_fd)
                _raw[3] &= ~(_termios.ECHO | _termios.ICANON)
                _termios.tcsetattr(_fd, _termios.TCSANOW, _raw)
                _term_holder[0] = (_termios, _fd, _saved_term)
            except Exception:
                pass

            _error = None
            _interrupted = False
            _live_start[0] = time.time()
            if style == "raw":
                try:
                    response = agent.send(user_input)
                    print(f"\n  {response}\n")
                except KeyboardInterrupt:
                    _interrupted = True
                except RuntimeError as e:
                    _error = str(e)
                finally:
                    _term_holder[0] = None
                    if _saved_term is not None:
                        try:
                            _termios.tcsetattr(_fd, _termios.TCSANOW, _saved_term)
                            _termios.tcflush(_fd, _termios.TCIFLUSH)
                        except Exception:
                            pass
            else:
              with Live(_thinking(), console=ui._con, refresh_per_second=12) as _live:
                _live_holder[0] = _live
                try:
                    response = agent.send(user_input)
                    _live.update(ui.render_text(response))
                except KeyboardInterrupt:
                    _interrupted = True
                    _live.transient = True  # erase thinking/streaming from screen
                except RuntimeError as e:
                    _error = str(e)
                finally:
                    _live_holder[0] = None
                    _term_holder[0] = None
                    if _saved_term is not None:
                        try:
                            _termios.tcsetattr(_fd, _termios.TCSANOW, _saved_term)
                            _termios.tcflush(_fd, _termios.TCIFLUSH)
                        except Exception:
                            pass

            if _interrupted:
                # Restore history to pre-send state — interrupt may leave orphaned
                # tool calls, tool results, or partial assistant messages behind.
                agent.messages = agent.messages[:_msg_snapshot]
                ui._con.print()
                ui.info("Interrupted.")
                ui._con.print()
                ui.operator_rule()
                continue

            if _error:
                ui.error(_error)
                continue

            if _stats_parts:
                ui.stats(_stats_parts)

            # Terse tool call summary (REQ-UI-12)
            if style == "terse" and _tool_calls_this_turn:
                from collections import Counter
                counts = Counter(_tool_calls_this_turn)
                summary = ", ".join(f"{n}× {t}" for t, n in counts.most_common())
                ui._con.print(f"  [dim][{len(_tool_calls_this_turn)} tool calls: {summary}][/dim]")
            _tool_calls_this_turn.clear()

            # Persist to session JSONL (REQ-U-13)
            if session:
                session.append_message("user", user_input)
                session.append_message("assistant", response)

            with open(log, "a") as f:
                f.write(f"\n{response}\n")
            ui._con.print()
            ui.operator_rule()
    except KeyboardInterrupt:
        ui.info("Session ended.")
    finally:
        agent.on_token = None
        agent.on_complete = None
        agent.on_tool_call = None
        agent.on_tool_result = None


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.option("--doc", help="Scope conversation to a specific .voidrift/ artifact")
@click.option("--style", type=click.Choice(["verbose", "terse", "raw"]), default="verbose", help="Output style")
@click.option("--bare", is_flag=True, default=False, help="Minimal context — no skills, git, or project state injection")
@click.option("--system-prompt", "system_prompt_path", type=click.Path(exists=True), help="Custom system prompt file (requires --bare)")
def chat(model, doc, style, bare, system_prompt_path) -> None:
    """Interactive session with CLI-native tools for requirements, planning, and refinement."""
    if system_prompt_path and not bare:
        click.echo("Error: --system-prompt requires --bare", err=True)
        sys.exit(1)
    _check_setup()
    mc = resolve_model(model)
    from .agent import AgentLoop, build_local_tools
    from .utils import boot_run
    from . import prompts as _prompts
    from .skills import find_skill

    log, run_id = boot_run("chat")

    tools, handlers = build_local_tools(cmd="chat")

    from .tools.filesystem import configure as _configure_fs
    _configure_fs(max_read_lines=mc.max_read_lines)

    # Override web_fetch placeholder with real implementation (REQ-U-8).
    # confirm_fn is injected by _interactive_loop after spinner functions are defined
    # so that the spinner stops cleanly before the permission prompt appears.
    from .tools import make_web_fetch_handler
    _web_cache: dict = {}
    _web_fetch_kwargs = dict(
        mc=mc,
        log=log,
        web_cache=_web_cache,
    )
    handlers["web_fetch"] = make_web_fetch_handler(**_web_fetch_kwargs)

    # Build system prompt (REQ-U-17: --bare strips framework context)
    from .utils import voidrift_dir
    if system_prompt_path:
        system = Path(system_prompt_path).read_text()
        skill = ""
    elif bare:
        system = _prompts.load_prompt("system", "CONTEXT")
        skill = ""
    else:
        skill = find_skill("ANALYSIS-REQS") or ""
        system_context = _prompts.load_prompt("system", "CONTEXT")
        system_prompt = _prompts.load_prompt("chat", "SYSTEM")

        state_file = voidrift_dir() / "STATE.md"
        project_state = ""
        if state_file.exists():
            project_state = f"**Project state:**\n\n{state_file.read_text()}"

        from .git_context import capture_git_snapshot
        _snap = capture_git_snapshot(str(Path.cwd()))
        _git_block = _snap.to_prompt_block() if _snap else ""

        # Memory index injection (REQ-MEM-1)
        from .memory import MemoryManager
        _mem_block = MemoryManager(str(Path.cwd())).index_prompt_block()

        system = "\n\n".join(p for p in [system_context, skill, system_prompt, project_state, _git_block, _mem_block] if p)

    if doc:
        doc_path = voidrift_dir() / doc
        if doc_path.exists():
            doc_section = _prompts.load_prompt("chat", "DOC").format(
                doc_name=doc, doc_content=doc_path.read_text()
            )
            system += f"\n\n{doc_section}"
        else:
            ui.warn(f"{doc} not found — starting fresh")
            system += f"\n\n{_prompts.load_prompt('chat', 'DOC-NEW').format(doc_name=doc)}"

    agent = AgentLoop(
        model=mc,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=True,
        tool_choice="auto",
        log_path=log,
    )

    # Skill tool restriction hook — checks module-level state set by get_skill (REQ-SKL-9)
    from .agent import _active_skill_allowed_tools
    from .skills import make_skill_tool_guard

    def _skill_guard(name: str, args: str) -> str | None:
        at = _active_skill_allowed_tools["allowed"]
        if at is None:
            return None
        guard = make_skill_tool_guard(at, _active_skill_allowed_tools["name"])
        return guard(name, args) if guard else None

    agent.before_tool_call = _skill_guard

    # Session persistence — auto-resume from project-scoped JSONL (REQ-U-13)
    from .session import ChatSession
    session = ChatSession.load_or_create(voidrift_dir())
    if session.has_messages:
        restored = session.reconstruct_messages()
        # Restore messages after the system prompt (messages[0])
        if restored:
            # Skip any system messages from compaction — they'll be merged with current system
            for m in restored:
                if m["role"] == "system":
                    agent.messages[0]["content"] += f"\n\n[Prior session context]\n{m['content']}"
                else:
                    agent.messages.append(m)
        ts = session.last_timestamp() or ""
        elapsed = ""
        if ts:
            from datetime import datetime, timezone
            try:
                last = datetime.fromisoformat(ts)
                delta = datetime.now(timezone.utc) - last
                if delta.days > 0:
                    elapsed = f", last active {delta.days}d ago"
                elif delta.seconds >= 3600:
                    elapsed = f", last active {delta.seconds // 3600}h ago"
                elif delta.seconds >= 60:
                    elapsed = f", last active {delta.seconds // 60}m ago"
            except Exception:
                pass
        ui.info(f"Resuming session ({session.message_count()} messages{elapsed})")

    title = f"VoidRift Chat — {doc}" if doc else "VoidRift Chat"
    _interactive_loop(agent, mc, log, title, web_fetch_kwargs=_web_fetch_kwargs, original_skill=skill, session=session, style=style)


@cli.command()
def status() -> None:
    """Show project command status."""
    _status()


def _status():
    """Print project status."""
    from .utils import voidrift_dir

    d = voidrift_dir()

    ui.header("VoidRift Status")

    req = d / "REQUIREMENTS.md"
    if req.exists():
        ui._con.print("  ✅ Gather: REQUIREMENTS.md exists")
    else:
        ui._con.print("  ⬜ Gather: Run 'voidrift gather <model>'")

    has_manifest = (d / "tasks" / "manifest.yml").exists()
    has_arch = (d / "ARCHITECTURE.md").exists()
    if has_manifest and has_arch:
        ui._con.print("  ✅ Plan: Tasks and architecture exist")
    elif has_arch:
        ui._con.print("  🔄 Plan: Architecture exists, no tasks")
    else:
        ui._con.print("  ⬜ Plan: Run 'voidrift plan <model>'")

    if has_manifest:
        from .manifest import ManifestManager
        mm = ManifestManager()
        mm.load()
        s = mm.summary()
        total = sum(s.values())
        verified = s.get("verified", 0)
        implemented = s.get("implemented", 0)
        planned = s.get("planned", 0)
        blocked = s.get("blocked", 0)
        failed = s.get("failed", 0)
        if total == 0:
            ui._con.print("  ⬜ Develop: No tasks")
        elif verified == total:
            ui._con.print(f"  ✅ Develop: All {total} tasks verified")
        else:
            parts = []
            if verified: parts.append(f"{verified} verified")
            if implemented: parts.append(f"{implemented} implemented")
            if planned: parts.append(f"{planned} planned")
            if blocked: parts.append(f"{blocked} blocked")
            if failed: parts.append(f"{failed} failed")
            ui._con.print(f"  🔄 Develop: {', '.join(parts)} ({total} total)")
    else:
        ui._con.print("  ⬜ Develop: No tasks")

    from .commands.deploy import _detect_iac
    if _detect_iac():
        ui._con.print("  ✅ Deploy: IaC detected")
    else:
        ui._con.print("  ⬜ Deploy: Run 'voidrift deploy <model>'")

    if (d / "VERIFY.md").exists():
        text = (d / "VERIFY.md").read_text()
        if "PASS" in text:
            ui._con.print("  ✅ Verify: PASS")
        else:
            ui._con.print("  ❌ Verify: FAIL")
    else:
        ui._con.print("  ⬜ Verify: Run 'voidrift verify <model>'")

    spec_dir = d / "spec"
    if spec_dir.is_dir():
        specs = list(spec_dir.glob("*.md"))
        if specs:
            ui._con.print(f"\n  Feature specs ({len(specs)}):")
            for s in sorted(specs):
                ui._con.print(f"    - {s.stem}")


@cli.command()
@click.argument("command", required=False)
@click.option("--prune", is_flag=True, help="Delete log files")
@click.option("--follow", "-f", is_flag=True, help="Tail the log file")
def log(command, prune, follow) -> None:
    """View or manage command log files."""
    from .utils import voidrift_dir

    d = voidrift_dir() / "logs"
    valid_commands = ["gather", "plan", "develop", "deploy", "verify", "chat"]

    if prune:
        pattern = f"{command}-*.log" if command else "*.log"
        logs = sorted(d.glob(pattern))
        for l in logs:
            l.unlink()
        ui.info(f"Deleted {len(logs)} log file(s)" if logs else "No log files to prune")
        return

    if not command:
        ui._con.print("Usage: voidrift log <command> [--prune] [--follow/-f]")
        ui._con.print(f"Commands: {', '.join(valid_commands)}")
        sys.exit(1)

    if command not in valid_commands:
        ui.error(f"Invalid command: {command}. Must be one of: {', '.join(valid_commands)}")
        sys.exit(1)

    logs = sorted(d.glob(f"{command}-*.log"))
    if not logs:
        ui.error(f"No log files found for command: {command}")
        sys.exit(1)

    latest = logs[-1]

    if follow:
        import time as _time
        try:
            with open(latest) as f:
                f.seek(0, 2)  # end of file
                while True:
                    line = f.readline()
                    if line:
                        ui._con.print(line, end="", markup=False)
                    else:
                        _time.sleep(0.3)
        except KeyboardInterrupt:
            return
    else:
        lines = latest.read_text().splitlines()
        for line in lines[-200:]:
            ui._con.print(line, markup=False)


@cli.command()
@click.option("--global", "global_", is_flag=True, help="Prune framework-level data (~/.voidrift)")
@click.option("--all", "all_", is_flag=True, help="Remove all ephemeral data (ignore retention limit)")
def prune(global_: bool, all_: bool) -> None:
    """Clean ephemeral data (logs, stale locks, session DB)."""
    from datetime import datetime, timezone, timedelta
    from .utils import voidrift_dir
    from .config import get_retention, voidrift_home

    if global_:
        log_dir = voidrift_home() / "logs"
        if not log_dir.exists():
            ui.info("No global logs found — nothing to prune")
            return
        if all_:
            import shutil
            shutil.rmtree(log_dir)
            ui.success("Removed all global framework logs")
        else:
            days = get_retention("global")
            cutoff = datetime.now(timezone.utc) - timedelta(days=days)
            logs = sorted(log_dir.glob("*.log*"))
            removed = [f for f in logs if datetime.fromtimestamp(f.stat().st_mtime, tz=timezone.utc) < cutoff]
            for f in removed:
                f.unlink()
            ui.success(f"Pruned {len(removed)} global log(s) older than {days} days")
        return

    d = voidrift_dir()
    if not d.exists():
        ui.error("No .voidrift directory found — nothing to prune")
        sys.exit(1)

    if all_:
        import shutil
        shutil.rmtree(d)
        ui.success("Removed .voidrift/ — clean slate")
        return

    removed_logs = 0
    keep = get_retention("project")
    logs = sorted((d / "logs").glob("*.log"))
    for old in logs[:-keep] if keep else logs:
        old.unlink()
        removed_logs += 1

    lock = d / ".develop.lock"
    stale_lock = False
    if lock.exists():
        try:
            pid = int(lock.read_text().strip().split("\n")[0])
            os.kill(pid, 0)
        except (ProcessLookupError, ValueError, IndexError):
            lock.unlink()
            stale_lock = True

    parts = []
    if removed_logs:
        parts.append(f"{removed_logs} log(s)")
    if stale_lock:
        parts.append("stale lock")

    # Analysis cache pruning (REQ-U-14)
    from .utils import prune_analysis_cache
    from .config import get_cache_config
    cache_cfg = get_cache_config()
    cache_stats = prune_analysis_cache(
        d.parent,
        max_entries=cache_cfg.get("max_entries", 500),
        ttl_days=cache_cfg.get("ttl_days", 30),
    )
    cache_total = cache_stats["stale"] + cache_stats["expired"] + cache_stats["lru"]
    if cache_total:
        freed_kb = cache_stats["bytes_freed"] // 1024
        detail = []
        if cache_stats["stale"]:
            detail.append(f"{cache_stats['stale']} stale")
        if cache_stats["expired"]:
            detail.append(f"{cache_stats['expired']} expired")
        if cache_stats["lru"]:
            detail.append(f"{cache_stats['lru']} LRU")
        parts.append(f"{cache_total} analysis cache ({', '.join(detail)}, {freed_kb}KB freed)")

    ui.success(f"Pruned {', '.join(parts)}" if parts else "Nothing to prune")


@cli.command()
def unlock() -> None:
    """Remove develop lock and kill running process."""
    from .utils import voidrift_dir

    lock = voidrift_dir() / ".develop.lock"
    if not lock.exists():
        ui.info("No lock file found.")
        return

    try:
        parts = lock.read_text().strip().split("\n")
        pid = int(parts[0])
        try:
            os.kill(pid, 0)
            os.kill(pid, signal.SIGTERM)
            import time
            time.sleep(2)
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            ui.info(f"Killed process {pid}")
        except ProcessLookupError:
            ui.info(f"Removed stale lock (PID {pid} not running)")
    except (ValueError, IndexError):
        ui.info("Removed invalid lock file")

    lock.unlink()


from .commands.skills import skills_cmd
cli.add_command(skills_cmd)


@cli.command()
@click.argument("turn", required=False, type=int)
def rollback(turn) -> None:
    """Restore working tree to a develop checkpoint."""
    from .utils import voidrift_dir
    from .git_checkpoint import GitCheckpointManager, Checkpoint

    cp_path = voidrift_dir() / "checkpoints.jsonl"
    cps = GitCheckpointManager.load_checkpoints(cp_path)
    if not cps:
        ui.error("No checkpoints found. Run 'voidrift develop' first.")
        sys.exit(1)

    if turn is None:
        ui.header("Available checkpoints")
        for cp in cps:
            ui.info(f"  turn {cp.turn}  {cp.timestamp[:19]}  {cp.task_id or ''}")
        ui.info("\nUsage: voidrift rollback <turn>")
        return

    match = [cp for cp in cps if cp.turn == turn]
    if not match:
        ui.error(f"No checkpoint for turn {turn}. Available: {', '.join(str(c.turn) for c in cps)}")
        sys.exit(1)

    cp = match[0]
    mgr = GitCheckpointManager(str(Path.cwd()))
    if mgr.restore(cp):
        ui.success(f"Restored working tree to turn {turn} ({cp.task_id or 'unknown task'})")
    else:
        ui.error(f"Failed to restore checkpoint for turn {turn}")
        sys.exit(1)


@cli.command()
@click.option("--fix", is_flag=True, help="Auto-fix where safe")
def doctor(fix) -> None:
    """Run diagnostic checks on VoidRift setup."""
    from .doctor import run_checks

    ui.header("VoidRift Doctor")
    checks = run_checks(fix=fix)

    _ICONS = {"pass": "✓", "warn": "⚠", "fail": "✗"}
    _STYLES = {"pass": "green", "warn": "yellow", "fail": "red bold"}

    for c in checks:
        icon = _ICONS[c.result]
        style = _STYLES[c.result]
        msg = f"  {c.message}" if c.message else ""
        ui._con.print(f"  [{style}]{icon}[/{style}]  {c.name}{msg}")
        if c.fix_hint and c.result != "pass":
            ui._con.print(f"      [dim]{c.fix_hint}[/dim]")

    warns = sum(1 for c in checks if c.result == "warn")
    fails = sum(1 for c in checks if c.result == "fail")
    if fails:
        ui.error(f"{fails} failed, {warns} warnings")
        sys.exit(1)
    elif warns:
        ui.warn(f"{warns} warning(s)")
    else:
        ui.success("All checks passed")


@cli.group()
def memory() -> None:
    """Manage project and global memory entries."""


@memory.command("list")
def memory_list() -> None:
    """List all memory entries grouped by layer."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    entries = mm.list_entries()
    if not entries:
        ui.info("No memory entries.")
        return
    project = [e for e in entries if e.scope == "project"]
    global_ = [e for e in entries if e.scope == "global"]
    if project:
        ui._con.print("\n[bold]Project memory[/bold]")
        for e in project:
            ui._con.print(f"  {e.name} — {e.description}")
    if global_:
        ui._con.print("\n[bold]Global memory[/bold]")
        for e in global_:
            ui._con.print(f"  {e.name} — {e.description}")


@memory.command("show")
@click.argument("name")
def memory_show(name) -> None:
    """Print full content of a memory entry."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    content = mm.read(name)
    if content is None:
        ui.error(f"Memory entry '{name}' not found.")
        sys.exit(1)
    click.echo(content)


@memory.command("delete")
@click.argument("name")
@click.option("--global", "global_", is_flag=True, help="Delete from global memory instead of project")
def memory_delete(name, global_) -> None:
    """Remove a memory entry."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    scope = "global" if global_ else "project"
    if mm.delete(name, scope=scope):
        ui.success(f"Deleted '{name}' from {scope} memory.")
    else:
        ui.error(f"Memory entry '{name}' not found in {scope} memory.")
        sys.exit(1)


@memory.command("export")
def memory_export() -> None:
    """Export all memory entries as a single markdown file."""
    from .memory import MemoryManager
    mm = MemoryManager(str(Path.cwd()))
    entries = mm.list_entries()
    if not entries:
        ui.info("No memory entries to export.")
        return
    for e in entries:
        content = mm.read(e.name) or ""
        click.echo(f"## {e.name} ({e.scope})\n")
        # Strip frontmatter from output
        if content.startswith("---"):
            end = content.find("---", 3)
            if end != -1:
                content = content[end + 3:].strip()
        click.echo(content)
        click.echo()


@cli.command("completions")
@click.argument("shell", type=click.Choice(["bash", "zsh", "fish"]))
def completions_cmd(shell: str) -> None:
    """Generate shell completion script.

    \b
    Install once:
      voidrift completions bash > ~/.local/share/bash-completion/completions/voidrift
      voidrift completions zsh > ~/.zfunc/_voidrift
      voidrift completions fish > ~/.config/fish/completions/voidrift.fish
    """
    import subprocess
    env_var = "_VOIDRIFT_COMPLETE"
    result = subprocess.run(
        ["voidrift"],
        env={**os.environ, env_var: f"{shell}_source"},
        capture_output=True,
        text=True,
    )
    click.echo(result.stdout)


if __name__ == "__main__":
    cli()
