"""VoidRift CLI — main entry point."""

from __future__ import annotations

import os
import signal
import sys
import logging
import itertools
import threading
from pathlib import Path

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

import click
from rich.prompt import Prompt, IntPrompt

from .models import resolve_model, list_models
from . import ui

HELP_TEXT = """Local-first Agentic Development Framework.

Getting started:
  voidrift gather <model>                 Gather requirements
  voidrift plan <model>                   Generate architecture and tasks
  voidrift develop <worker> [<architect>] Execute implementation tasks
  voidrift verify <worker> [<architect>]  Run quality checks

Phases:
  gather <model> [<feature>] [--from <path>] [--reference <path>] [--force]
  plan <model> [<feature>] [--fresh-start]
  develop <worker> [<architect>] [--workers <n>]
  automate <worker> [<architect>]
  verify <worker> [<architect>]

Utility:
  status                      Show project phase status
  chat <model>                Interactive chat session
  log <phase> [--prune]       View or manage phase logs
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
        ui.error(str(e))
        sys.exit(1)


def _interactive_mode():
    """Interactive guided flow when no subcommand given (REQ-ARCH-3)."""
    ui.phase("VoidRift — Local-first Agentic Development Framework")

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
    try:
        model_name = Prompt.ask("Model", default="qwen3-coder")
    except (KeyboardInterrupt, EOFError):
        return

    # Build and run command
    args = [action, model_name]

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
# Phase commands
# ---------------------------------------------------------------------------


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("feature", required=False)
@click.option("--from", "from_path", help="Path to existing codebase for reverse engineering")
@click.option("--reference", help="Path to reference codebase for interactive lookup")
@click.option("--force", is_flag=True, help="Overwrite existing requirements when using --from")
def gather(model, feature, from_path, reference, force) -> None:
    """Phase 1: Gather requirements interactively."""
    from .phases.gather import run_gather
    mc = resolve_model(model)
    sys.exit(run_gather(mc, feature=feature, from_path=from_path, reference_path=reference, force=force))


@cli.command()
@click.argument("model", shell_complete=_complete_model)
@click.argument("feature", required=False)
@click.option("--fresh-start", is_flag=True, help="Delete existing planning artifacts")
def plan(model, feature, fresh_start) -> None:
    """Phase 2: Generate architecture and task breakdown."""
    from .phases.plan import run_plan
    mc = resolve_model(model)
    sys.exit(run_plan(mc, feature=feature, fresh_start=fresh_start))


@cli.command()
@click.argument("worker", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
@click.option("--workers", default=1, help="Number of concurrent module workers (0 = one per module)")
def develop(worker, architect, workers) -> None:
    """Phase 3: Execute implementation tasks."""
    from .phases.develop import run_develop
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_develop(wm, architect=am, workers=workers))


@cli.command()
@click.argument("worker", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
def automate(worker, architect) -> None:
    """Phase 4: Generate infrastructure-as-code."""
    from .phases.automate import run_automate
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_automate(wm, architect=am))


@cli.command()
@click.argument("worker", shell_complete=_complete_model)
@click.argument("architect", required=False, shell_complete=_complete_model)
def verify(worker, architect) -> None:
    """Phase 5: Run quality checks and validation."""
    from .phases.verify import run_verify
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_verify(wm, architect=am))


# ---------------------------------------------------------------------------
# Utility commands
# ---------------------------------------------------------------------------


def _interactive_loop(agent, mc, log, title, write_tools=None, extra_header=None):
    """Shared interactive terminal loop (REQ-UI-1, REQ-UI-2, REQ-UI-4)."""
    from .agent import AgentLoop

    model_label = f"{mc.alias} ({mc.model_id})"
    ui.phase(title)
    if extra_header:
        for line in extra_header:
            ui.detail(line)
    ui.detail(f"Log: {log}")
    ui.detail(f"Model: {model_label}")

    _token_handler = ui.make_token_handler()

    def on_token(token):
        _stop_tool_spinner()
        _token_handler(token)

    def on_complete(stats):
        _stop_tool_spinner()
        parts = []
        if stats.get("completion_tokens"):
            parts.append(f"{stats['completion_tokens']} tokens")
        if stats.get("tokens_per_sec"):
            parts.append(f"{stats['tokens_per_sec']} tok/s")
        if stats.get("elapsed"):
            parts.append(f"{stats['elapsed']}s")
        if parts:
            ui.stats(parts)

    _tool_spinner = None
    _tool_stop = None

    def on_tool_call(name):
        nonlocal _tool_spinner, _tool_stop
        if _tool_stop:
            _tool_stop.set()
            _tool_spinner.join()
        ui.tool_start(name)
        _tool_stop = threading.Event()
        def _spin():
            for ch in itertools.cycle("⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"):
                if _tool_stop.wait(0.1):
                    break
                sys.stderr.write(f"\r\033[2m  {ch} working...\033[0m")
                sys.stderr.flush()
            sys.stderr.write("\r\033[K")
            sys.stderr.flush()
        _tool_spinner = threading.Thread(target=_spin, daemon=True)
        _tool_spinner.start()

    def _stop_tool_spinner():
        nonlocal _tool_spinner, _tool_stop
        if _tool_stop:
            _tool_stop.set()
            _tool_spinner.join()
            _tool_stop = None
            _tool_spinner = None

    def on_tool_result(name, result):
        _stop_tool_spinner()
        ui.tool_done(result)

    agent.on_token = on_token
    agent.on_complete = on_complete
    agent.on_tool_call = on_tool_call
    agent.on_tool_result = on_tool_result

    from prompt_toolkit import PromptSession
    from prompt_toolkit.key_binding import KeyBindings

    kb = KeyBindings()

    @kb.add("enter")
    def _submit_or_newline(event):
        buf = event.current_buffer
        text = buf.text.strip()
        # Commands and single-line input: submit immediately
        if not text or text.startswith("/") or buf.document.current_line.strip() == "":
            buf.validate_and_handle()
        else:
            buf.insert_text("\n")

    session = PromptSession(key_bindings=kb, multiline=True)

    try:
        while True:
            try:
                user_input = session.prompt("\n> ").strip()
            except EOFError:
                break
            if not user_input or user_input.lower() in ("quit", "exit", "/quit"):
                break

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

            ui.model_label(mc.alias)
            _token_handler = ui.make_token_handler()  # reset per turn
            try:
                response = agent.send(user_input)
            except RuntimeError as e:
                ui.error(str(e))
                continue

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
def chat(model) -> None:
    """Interactive chat session with a model."""
    mc = resolve_model(model)
    from .agent import AgentLoop, build_mcp_tools

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    agent = AgentLoop(
        model=mc,
        system_prompt="You are a helpful AI assistant. You have MCP tools to read/write project files.",
        tools=tools,
        tool_handlers=handlers,
        stream=True,
    )

    from .utils import log_path
    _interactive_loop(agent, mc, log_path("chat"), "VoidRift Chat")


@cli.command()
def status() -> None:
    """Show project phase status."""
    _status()


def _status():
    """Print project status."""
    from .utils import voidrift_dir, count_tasks

    d = voidrift_dir()

    ui.phase("VoidRift Status")

    req = d / "REQUIREMENTS.md"
    if req.exists():
        ui._con.print("  ✅ Phase 1 (Gather): REQUIREMENTS.md exists")
    else:
        ui._con.print("  ⬜ Phase 1 (Gather): Run 'voidrift gather <model>'")

    has_tasks = (d / "TASKS.md").exists()
    has_arch = (d / "ARCHITECTURE.md").exists()
    if has_tasks and has_arch:
        ui._con.print("  ✅ Phase 2 (Plan): Tasks and architecture exist")
    elif has_tasks:
        ui._con.print("  🔄 Phase 2 (Plan): Tasks exist, no architecture")
    else:
        ui._con.print("  ⬜ Phase 2 (Plan): Run 'voidrift plan <model>'")

    task_file = d / "TASKS.md"
    if task_file.exists():
        done, blocked, total = count_tasks(task_file)
        if done == total and total > 0:
            ui._con.print(f"  ✅ Phase 3 (Develop): All {total} tasks complete")
        elif done > 0 or blocked > 0:
            ui._con.print(f"  🔄 Phase 3 (Develop): {done}/{total} done, {blocked} blocked")
        else:
            ui._con.print(f"  ⬜ Phase 3 (Develop): {total} tasks pending")
    else:
        ui._con.print("  ⬜ Phase 3 (Develop): No tasks")

    from .phases.automate import _detect_iac
    if _detect_iac():
        ui._con.print("  ✅ Phase 4 (Automate): IaC detected")
    else:
        ui._con.print("  ⬜ Phase 4 (Automate): Run 'voidrift automate <model>'")

    if (d / "VERIFY.md").exists():
        text = (d / "VERIFY.md").read_text()
        if "PASS" in text:
            ui._con.print("  ✅ Phase 5 (Verify): PASS")
        else:
            ui._con.print("  ❌ Phase 5 (Verify): FAIL")
    else:
        ui._con.print("  ⬜ Phase 5 (Verify): Run 'voidrift verify <model>'")

    spec_dir = d / "spec"
    if spec_dir.is_dir():
        specs = list(spec_dir.glob("*.md"))
        if specs:
            ui._con.print(f"\n  Feature specs ({len(specs)}):")
            for s in sorted(specs):
                ui._con.print(f"    - {s.stem}")


@cli.command()
@click.argument("phase", required=False)
@click.option("--prune", is_flag=True, help="Delete log files")
def log(phase, prune) -> None:
    """View or manage phase log files."""
    from .utils import voidrift_dir

    d = voidrift_dir() / "logs"
    valid_phases = ["gather", "plan", "develop", "automate", "verify"]

    if prune:
        pattern = f"{phase}-*.log" if phase else "*.log"
        logs = sorted(d.glob(pattern))
        for l in logs:
            l.unlink()
        ui.info(f"Deleted {len(logs)} log file(s)" if logs else "No log files to prune")
        return

    if not phase:
        ui._con.print("Usage: voidrift log <phase> [--prune]")
        ui._con.print(f"Phases: {', '.join(valid_phases)}")
        sys.exit(1)

    if phase not in valid_phases:
        ui.error(f"Invalid phase: {phase}. Must be one of: {', '.join(valid_phases)}")
        sys.exit(1)

    logs = sorted(d.glob(f"{phase}-*.log"))
    if not logs:
        ui.error(f"No log files found for phase: {phase}")
        sys.exit(1)

    latest = logs[-1]
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
        db_path = voidrift_home() / "sessions.db"
        if not db_path.exists():
            ui.info("No session database found — nothing to prune")
            return
        import sqlite3
        conn = sqlite3.connect(str(db_path))
        if all_:
            conn.execute("DELETE FROM context_log")
            conn.execute("DELETE FROM sessions")
            conn.commit()
            ui.success("Deleted all session data")
        else:
            days = get_retention("global")
            cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
            cur = conn.execute("DELETE FROM sessions WHERE started_at < ?", (cutoff,))
            conn.execute("DELETE FROM context_log WHERE session_id NOT IN (SELECT id FROM sessions)")
            conn.commit()
            ui.success(f"Pruned {cur.rowcount} session(s) older than {days} days")
        conn.execute("VACUUM")
        conn.close()
        return

    d = voidrift_dir()
    if not d.exists():
        ui.error("No .voidrift directory found — nothing to prune")
        sys.exit(1)

    removed_logs = 0
    if all_:
        for log_file in (d / "logs").glob("*.log"):
            log_file.unlink()
            removed_logs += 1
    else:
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
    env_var = "_VOIDRIFT_COMPLETE"
    script = os.popen(f"{env_var}={shell}_source voidrift").read()
    click.echo(script)


if __name__ == "__main__":
    cli()
