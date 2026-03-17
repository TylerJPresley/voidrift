"""VoidRift CLI — main entry point."""

from __future__ import annotations

import os
import signal
import sys
import logging
from pathlib import Path

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

import click
from rich.console import Console
from rich.prompt import Prompt, IntPrompt

from .models import resolve_model, list_models

console = Console()
err_console = Console(stderr=True)

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
        err_console.print(f"[red]Error: {e.format_message()}[/red]")
        if e.ctx:
            err_console.print(e.ctx.get_help())
        sys.exit(2)
    except click.Abort:
        sys.exit(130)
    except Exception as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


def _interactive_mode():
    """Interactive guided flow when no subcommand given (REQ-ARCH-3)."""
    console.print("[bold cyan]VoidRift[/bold cyan] — Local-first Agentic Development Framework\n")

    actions = ["gather", "plan", "develop", "automate", "verify", "chat", "status"]
    for i, a in enumerate(actions, 1):
        console.print(f"  {i}. {a}")

    try:
        choice = IntPrompt.ask("\nSelect action", choices=[str(i) for i in range(1, len(actions) + 1)])
        action = actions[choice - 1]
    except (KeyboardInterrupt, EOFError):
        return

    if action == "status":
        _status()
        return

    # Model selection
    models = list_models()
    console.print(f"\nAvailable models: {', '.join(models)}")
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
    console.print(f"[dim]{title}[/dim]")
    if extra_header:
        for line in extra_header:
            console.print(f"[dim]{line}[/dim]")
    console.print(f"[dim]Log: {log}[/dim]")
    console.print(f"[dim]Model: {model_label}[/dim]")

    _blue = "\033[38;5;117m"
    _reset = "\033[0m"
    _at_line_start = True

    def on_token(token):
        nonlocal _at_line_start
        out = ""
        for ch in token:
            if _at_line_start:
                out += "  "
                _at_line_start = False
            out += ch
            if ch == "\n":
                _at_line_start = True
        sys.stdout.write(f"{_blue}{out}{_reset}")
        sys.stdout.flush()

    def on_complete(stats):
        parts = []
        if stats.get("completion_tokens"):
            parts.append(f"{stats['completion_tokens']} tokens")
        if stats.get("tokens_per_sec"):
            parts.append(f"{stats['tokens_per_sec']} tok/s")
        if stats.get("elapsed"):
            parts.append(f"{stats['elapsed']}s")
        if parts:
            console.print(f"\n\n[dim]  {' · '.join(parts)}[/dim]")

    def on_tool_call(name):
        console.print(f"\n[dim]  ⚙ {name}()[/dim]")

    agent.on_token = on_token
    agent.on_complete = on_complete
    agent.on_tool_call = on_tool_call

    try:
        while True:
            try:
                user_input = input("\n> ").strip()
            except EOFError:
                break
            if not user_input or user_input.lower() in ("quit", "exit", "/quit"):
                break

            # /write enables tools for this turn (REQ-UI-3)
            if write_tools is not None:
                if user_input.lower().startswith("/write"):
                    agent.tools = write_tools
                    user_input = user_input[6:].strip() or "Please write the file now."
                else:
                    agent.tools = []

            console.rule(style="bright_black")

            with open(log, "a") as f:
                f.write(f"\n> {user_input}\n")

            console.print(f"\n[dim italic]  ◆ {mc.alias}[/dim italic]\n")
            _at_line_start = True
            try:
                response = agent.send(user_input)
            except RuntimeError as e:
                console.print(f"[red]  Error: {e}[/red]")
                continue

            with open(log, "a") as f:
                f.write(f"\n{response}\n")
    except KeyboardInterrupt:
        console.print("\n[dim]Session ended.[/dim]")


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

    console.print("[bold cyan]VoidRift Status[/bold cyan]\n")

    # Phase 1: Gather
    req = d / "REQUIREMENTS.md"
    if req.exists():
        console.print("  ✅ Phase 1 (Gather): REQUIREMENTS.md exists")
    else:
        console.print("  ⬜ Phase 1 (Gather): Run 'voidrift gather <model>'")

    # Phase 2: Plan
    has_tasks = (d / "TASKS.md").exists()
    has_arch = (d / "ARCHITECTURE.md").exists()
    if has_tasks and has_arch:
        console.print("  ✅ Phase 2 (Plan): Tasks and architecture exist")
    elif has_tasks:
        console.print("  🔄 Phase 2 (Plan): Tasks exist, no architecture")
    else:
        console.print("  ⬜ Phase 2 (Plan): Run 'voidrift plan <model>'")

    # Phase 3: Develop
    task_file = d / "TASKS.md"
    if task_file.exists():
        done, blocked, total = count_tasks(task_file)
        if done == total and total > 0:
            console.print(f"  ✅ Phase 3 (Develop): All {total} tasks complete")
        elif done > 0 or blocked > 0:
            console.print(f"  🔄 Phase 3 (Develop): {done}/{total} done, {blocked} blocked")
        else:
            console.print(f"  ⬜ Phase 3 (Develop): {total} tasks pending")
    else:
        console.print("  ⬜ Phase 3 (Develop): No tasks")

    # Phase 4: Automate
    from .phases.automate import _detect_iac
    if _detect_iac():
        console.print("  ✅ Phase 4 (Automate): IaC detected")
    else:
        console.print("  ⬜ Phase 4 (Automate): Run 'voidrift automate <model>'")

    # Phase 5: Verify
    if (d / "VERIFY.md").exists():
        text = (d / "VERIFY.md").read_text()
        if "PASS" in text:
            console.print("  ✅ Phase 5 (Verify): PASS")
        else:
            console.print("  ❌ Phase 5 (Verify): FAIL")
    else:
        console.print("  ⬜ Phase 5 (Verify): Run 'voidrift verify <model>'")

    # Feature specs
    spec_dir = d / "spec"
    if spec_dir.is_dir():
        specs = list(spec_dir.glob("*.md"))
        if specs:
            console.print(f"\n  Feature specs ({len(specs)}):")
            for s in sorted(specs):
                console.print(f"    - {s.stem}")


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
        console.print(f"Deleted {len(logs)} log file(s)" if logs else "No log files to prune")
        return

    if not phase:
        console.print("Usage: voidrift log <phase> [--prune]")
        console.print(f"Phases: {', '.join(valid_phases)}")
        sys.exit(1)

    if phase not in valid_phases:
        err_console.print(f"[red]Invalid phase: {phase}. Must be one of: {', '.join(valid_phases)}[/red]")
        sys.exit(1)

    logs = sorted(d.glob(f"{phase}-*.log"))
    if not logs:
        err_console.print(f"[red]No log files found for phase: {phase}[/red]")
        sys.exit(1)

    latest = logs[-1]
    lines = latest.read_text().splitlines()
    for line in lines[-200:]:
        console.print(line)


@cli.command()
def unlock() -> None:
    """Remove develop lock and kill running process."""
    from .utils import voidrift_dir

    lock = voidrift_dir() / ".develop.lock"
    if not lock.exists():
        console.print("No lock file found.")
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
            console.print(f"Killed process {pid}")
        except ProcessLookupError:
            console.print(f"Removed stale lock (PID {pid} not running)")
    except (ValueError, IndexError):
        console.print("Removed invalid lock file")

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
