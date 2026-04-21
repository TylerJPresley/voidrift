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

from .models import resolve_model, list_models, shell_complete_model as _complete_model
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


from .commands.chat import chat
cli.add_command(chat)


# Register utility commands from _main_utils
from ._main_utils import (
    status, log, prune, unlock, rollback, doctor,
    memory, completions_cmd, render_kanban_board,
)
cli.add_command(status)
cli.add_command(log)
cli.add_command(prune)
cli.add_command(unlock)
cli.add_command(rollback)
cli.add_command(doctor)
cli.add_command(memory)
cli.add_command(completions_cmd)

# Register skills command
from .commands.skills import skills_cmd
cli.add_command(skills_cmd)
