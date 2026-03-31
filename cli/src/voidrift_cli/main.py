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

HELP_TEXT = """Local-first Agentic Development Framework.

Getting started:
  voidrift gather <model> <path>          Reverse-engineer requirements
  voidrift chat <model>                   Interactive requirements & planning
  voidrift plan <model>                   Generate architecture and tasks
  voidrift develop <model> [<architect>]  Execute implementation tasks
  voidrift verify <model>                  Requirements-driven acceptance testing

Framework commands:
  gather <model> <path> [--overwrite]
  plan <model> [<feature>] [--overwrite]
  develop <model> [<architect>]              Execute implementation tasks
  automate <model> [<architect>]
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
@click.option("--verbose", "-v", is_flag=True, help="Show token counts and context % in stats")
@click.pass_context
def cli(ctx, verbose) -> None:
    ui.set_verbose(verbose)
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

    Reads ~/.voidrift/.active-container written by worker start.
    Second line of the file is the model alias.
    """
    from .config import voidrift_home
    p = voidrift_home() / ".active-container"
    if not p.exists():
        return None
    lines = p.read_text().strip().splitlines()
    return lines[1].strip() if len(lines) > 1 else None


def _interactive_mode():
    """Interactive guided flow when no subcommand given (REQ-ARCH-3)."""
    ui.header("VoidRift — Local-first Agentic Development Framework")

    actions = ["gather", "plan", "develop", "automate", "verify", "chat", "status"]
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
    """Exit with a setup error if VOIDRIFT_HOME is not initialized (REQ-CFG-8)."""
    from .config import voidrift_home
    home = voidrift_home()
    if not (home / "models.yml").exists():
        raise click.ClickException(
            f"{home} is not initialized. Run 'make setup' to initialize."
        )


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("path", type=click.Path(exists=True))
@click.option("--overwrite", is_flag=True, help="Remove previous gather artifacts and start fresh")
def gather(model, path, overwrite) -> None:
    """Gather: Reverse-engineer requirements from a codebase."""
    _check_setup()
    from .commands.gather import run_gather
    mc = resolve_model(model)
    sys.exit(run_gather(mc, from_path=path, overwrite=overwrite))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("feature", required=False)
@click.option("--overwrite", is_flag=True, help="Remove previous plan artifacts and start fresh")
def plan(model, feature, overwrite) -> None:
    """Plan: Generate architecture and task breakdown."""
    _check_setup()
    from .commands.plan import run_plan
    mc = resolve_model(model)
    sys.exit(run_plan(mc, feature=feature, overwrite=overwrite))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
def develop(model, architect) -> None:
    """Develop: Execute implementation tasks."""
    _check_setup()
    from .commands.develop import run_develop
    mc = resolve_model(model)
    am = resolve_model(architect) if architect else mc
    sys.exit(run_develop(mc, architect=am))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
def automate(model, architect) -> None:
    """Automate: Generate infrastructure-as-code."""
    _check_setup()
    from .commands.automate import run_automate
    mc = resolve_model(model)
    am = resolve_model(architect) if architect else mc
    sys.exit(run_automate(mc, architect=am))


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


def _interactive_loop(agent, mc, log, title, write_tools=None, extra_header=None, web_fetch_kwargs=None):
    """Shared interactive terminal loop (REQ-UI-1, REQ-UI-2, REQ-UI-4)."""
    from .agent import AgentLoop

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
        if not max_ctx:
            return ANSI("\n> ")
        pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
        if pct > 80:
            color = "\033[31m"  # red
        elif pct > 60:
            color = "\033[33m"  # yellow
        else:
            color = "\033[37m"  # white
        return ANSI(f"\n{color}[{pct}%]\033[0m > ")

    from rich.console import Group as _RGroup
    from rich.live import Live
    from rich.padding import Padding as _RPadding
    from rich.spinner import Spinner as _RSpinner
    from rich.text import Text as _RText

    # Shared state for Live-based streaming display.
    # Uses a list so closures can mutate without nonlocal declarations.
    _live_holder: list = [None]   # current Live instance
    _live_start: list[float] = [0.0]  # turn start time for elapsed display (REQ-UI-10)
    _turn_label: list[str] = [""]     # label fixed per turn so updates stay consistent
    _got_token: list[bool] = [False]  # True once streaming tokens arrive
    _stream_buf: list[str] = []       # accumulated token buffer
    _term_holder: list = [None]       # (termios_module, fd, saved_attr) while raw mode active

    def _thinking_text(elapsed: float = 0.0, tokens_in: int = 0, ctx_pct: int | None = None) -> str:
        """Build thinking spinner text with optional telemetry (REQ-UI-10)."""
        parts = [ui.elapsed_str(elapsed)] if elapsed >= 1 else []
        if ui._verbose and tokens_in:
            parts.append(f"↓ {ui.token_str(tokens_in)} tokens")
        if ctx_pct is not None and (ui._verbose or ctx_pct >= 80):
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
        if ui._verbose and completion_tokens:
            _stats_parts.append(f"↑ {ui.token_str(completion_tokens)} tokens")
        if ui._verbose and prompt_tokens:
            _stats_parts.append(f"↓ {ui.token_str(prompt_tokens)} tokens")
        if ui._verbose and stats.get("tokens_per_sec"):
            _stats_parts.append(f"{stats['tokens_per_sec']} tok/s")
        if elapsed:
            _stats_parts.append(f"{elapsed}s")
        if ctx_pct is not None and (ui._verbose or ctx_pct >= 80):
            _stats_parts.append(f"ctx {ctx_pct}%")

    def on_progress(data: dict) -> None:
        """Update Live thinking spinner with elapsed time while waiting (REQ-UI-10)."""
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

    def on_tool_call(name: str) -> None:
        _got_token[0] = False  # back to thinking state while tool executes
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

    session = PromptSession(key_bindings=kb, multiline=True)

    _consecutive_interrupt = 0
    _compact_nudged = False  # inject compact reminder once when context hits 70%

    def _do_compact() -> None:
        """Summarize history to free context. Called by /compact and auto-compact."""
        nonlocal _compact_nudged
        ui._con.print()  # blank line after operator input
        if len(agent.messages) <= 1:
            ui.info("Nothing to compact.")
            return

        target = max_ctx // 10 if max_ctx else 8000
        compact_prompt = (
            "Summarize this conversation concisely. Capture: key decisions made, "
            "artifacts discussed or modified, any pending work or open questions. "
            f"Keep the summary under {target} tokens."
        )

        # Disable terminal echo and show Thinking... spinner while the model works.
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
            return
        finally:
            if _saved_term is not None:
                try:
                    _termios.tcsetattr(_fd, _termios.TCSANOW, _saved_term)
                except Exception:
                    pass

        sys_content = agent.messages[0]["content"] + f"\n\n[Conversation summary]\n{summary}"
        agent.messages = [{"role": "system", "content": sys_content}]
        pct = _estimate_tokens(agent.messages) * 100 // max_ctx if max_ctx else 0
        ui.info(f"Compacted to {pct}% of context window.")
        ui._con.print(ui.render_text(summary), style="dim")
        with open(log, "a") as f:
            f.write(f"\n[COMPACT] {summary}\n")
        _compact_nudged = False  # allow nudge again if context fills back up

    try:
        while True:
            try:
                user_input = session.prompt(_context_prompt()).strip()
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

            # Auto-compact at 95%; nudge once at 70% (REQ-UI-6).
            if max_ctx:
                pct = min(100, _estimate_tokens(agent.messages) * 100 // max_ctx)
                if pct >= 95:
                    ui.info("Context window at 95% — auto-compacting...")
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
def chat(model, doc) -> None:
    """Interactive session with CLI-native tools for requirements, planning, and refinement."""
    _check_setup()
    mc = resolve_model(model)
    from .agent import AgentLoop, build_local_tools
    from .utils import boot_run
    from . import prompts as _prompts
    from .skills import find_skill

    log, run_id = boot_run("chat")

    tools, handlers = build_local_tools(cmd="chat")

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

    skill = find_skill("ANALYSIS-REQS") or ""
    system_context = _prompts.load_prompt("system", "CONTEXT")
    system_prompt = _prompts.load_prompt("chat", "SYSTEM")

    # Load project state for lifecycle awareness (REQ-PS-3)
    from .utils import voidrift_dir
    state_file = voidrift_dir() / "STATE.md"
    project_state = ""
    if state_file.exists():
        project_state = f"**Project state:**\n\n{state_file.read_text()}"

    system = "\n\n".join(p for p in [system_context, skill, system_prompt, project_state] if p)

    if doc:
        from .utils import voidrift_dir
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

    title = f"VoidRift Chat — {doc}" if doc else "VoidRift Chat"
    _interactive_loop(agent, mc, log, title, web_fetch_kwargs=_web_fetch_kwargs)


@cli.command()
def status() -> None:
    """Show project command status."""
    _status()


def _status():
    """Print project status."""
    from .utils import voidrift_dir, count_tasks

    d = voidrift_dir()

    ui.header("VoidRift Status")

    req = d / "REQUIREMENTS.md"
    if req.exists():
        ui._con.print("  ✅ Gather: REQUIREMENTS.md exists")
    else:
        ui._con.print("  ⬜ Gather: Run 'voidrift gather <model>'")

    has_tasks = (d / "TASKS.md").exists()
    has_arch = (d / "ARCHITECTURE.md").exists()
    if has_tasks and has_arch:
        ui._con.print("  ✅ Plan: Tasks and architecture exist")
    elif has_tasks:
        ui._con.print("  🔄 Plan: Tasks exist, no architecture")
    else:
        ui._con.print("  ⬜ Plan: Run 'voidrift plan <model>'")

    task_file = d / "TASKS.md"
    if task_file.exists():
        done, blocked, total = count_tasks(task_file)
        if done == total and total > 0:
            ui._con.print(f"  ✅ Develop: All {total} tasks complete")
        elif done > 0 or blocked > 0:
            ui._con.print(f"  🔄 Develop: {done}/{total} done, {blocked} blocked")
        else:
            ui._con.print(f"  ⬜ Develop: {total} tasks pending")
    else:
        ui._con.print("  ⬜ Develop: No tasks")

    from .commands.automate import _detect_iac
    if _detect_iac():
        ui._con.print("  ✅ Automate: IaC detected")
    else:
        ui._con.print("  ⬜ Automate: Run 'voidrift automate <model>'")

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
    valid_commands = ["gather", "plan", "develop", "automate", "verify", "chat"]

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
                        ui._con.print(line, end="")
                    else:
                        _time.sleep(0.3)
        except KeyboardInterrupt:
            return
    else:
        lines = latest.read_text().splitlines()
        for line in lines[-200:]:
            ui._con.print(line)


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
