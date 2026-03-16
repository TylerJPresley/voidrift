"""VoidRift CLI — main entry point (AC-CLI1, AC-CLI2)."""

from __future__ import annotations

import os
import signal
import sys
from pathlib import Path

import click
from rich.console import Console
from rich.prompt import Prompt, IntPrompt

from .models import resolve_model, is_local_model, is_kiro_model, CLOUD_MODELS, KIRO_MODELS, load_worker_models

console = Console()
err_console = Console(stderr=True)


def _all_model_names() -> list[str]:
    """List all available model aliases."""
    config = load_worker_models()
    local = list(config.get("models", {}).keys())
    cloud = list(CLOUD_MODELS.keys())
    kiro = list(KIRO_MODELS.keys())
    return sorted(local + cloud + kiro)


@click.group(invoke_without_command=True)
@click.pass_context
def cli(ctx) -> None:
    """VoidRift — Local-first Agentic Development Framework.

    Five phases: gather → plan → develop → automate → verify
    """
    if ctx.invoked_subcommand is None:
        _interactive_mode()


def _interactive_mode():
    """Interactive guided flow when no subcommand given (AC-CLI2)."""
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
    models = _all_model_names()
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

    # Invoke the subcommand
    ctx = cli.make_context("voidrift", args)
    with ctx:
        cli.invoke(ctx)


# ---------------------------------------------------------------------------
# Phase commands
# ---------------------------------------------------------------------------


@cli.command()
@click.argument("model")
@click.argument("feature", required=False)
@click.option("--from", "from_path", help="Path to existing codebase for reverse engineering")
@click.option("--reference", help="Path to reference codebase for interactive lookup")
@click.option("--force", is_flag=True, help="Overwrite existing requirements when using --from")
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def gather(model, feature, from_path, reference, force, refresh) -> None:
    """Phase 1: Gather requirements interactively."""
    from .phases.gather import run_gather
    mc = resolve_model(model)
    sys.exit(run_gather(mc, feature=feature, from_path=from_path, reference_path=reference, force=force))


@cli.command()
@click.argument("model")
@click.argument("feature", required=False)
@click.option("--fresh-start", is_flag=True, help="Delete existing planning artifacts")
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def plan(model, feature, fresh_start, refresh) -> None:
    """Phase 2: Generate architecture and task breakdown."""
    from .phases.plan import run_plan
    mc = resolve_model(model)
    sys.exit(run_plan(mc, feature=feature, fresh_start=fresh_start))


@cli.command()
@click.argument("worker")
@click.argument("architect", required=False)
@click.option("--workers", default=1, help="Number of concurrent module workers (0 = one per module)")
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def develop(worker, architect, workers, refresh) -> None:
    """Phase 3: Execute implementation tasks."""
    from .phases.develop import run_develop
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_develop(wm, architect=am, workers=workers))


@cli.command()
@click.argument("worker")
@click.argument("architect", required=False)
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def automate(worker, architect, refresh) -> None:
    """Phase 4: Generate infrastructure-as-code."""
    from .phases.automate import run_automate
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_automate(wm, architect=am))


@cli.command()
@click.argument("worker")
@click.argument("architect", required=False)
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def verify(worker, architect, refresh) -> None:
    """Phase 5: Run quality checks and validation."""
    from .phases.verify import run_verify
    wm = resolve_model(worker)
    am = resolve_model(architect) if architect else None
    sys.exit(run_verify(wm, architect=am))


# ---------------------------------------------------------------------------
# Utility commands
# ---------------------------------------------------------------------------


@cli.command()
@click.argument("model")
@click.option("--refresh", is_flag=True, help="Force local model container recreation")
def chat(model, refresh) -> None:
    """Interactive chat session with a model (AC-U3)."""
    from .phases.gather import run_gather
    mc = resolve_model(model)
    # Chat is basically gather without requirements constraints
    from .agent import AgentLoop, build_mcp_tools
    from .models import ensure_model_ready, cleanup_model

    try:
        ensure_model_ready(mc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)

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

    console.print(f"[bold cyan]VoidRift Chat[/bold cyan] — {mc.alias}")
    console.print("[dim]Type 'quit' or Ctrl+C to exit[/dim]\n")

    try:
        while True:
            try:
                user_input = input("\n> ").strip()
            except EOFError:
                break
            if not user_input or user_input.lower() in ("quit", "exit", "/quit"):
                break
            agent.send(user_input)
    except KeyboardInterrupt:
        console.print("\n[dim]Session ended.[/dim]")
    finally:
        cleanup_model(mc)


@cli.command()
def status() -> None:
    """Show project phase status (AC-U1)."""
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
    has_adr = (d / "adr").is_dir() and list((d / "adr").glob("*.md"))
    if has_tasks and has_adr:
        console.print("  ✅ Phase 2 (Plan): Tasks and ADRs exist")
    elif has_tasks:
        console.print("  🔄 Phase 2 (Plan): Tasks exist, no ADRs")
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

    # Feature specs (AC-U2)
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
    """View or manage phase log files (AC-U4b)."""
    from .utils import voidrift_dir

    d = voidrift_dir()
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
    """Remove develop lock and kill running process (AC-U4a)."""
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
            # Process alive — kill it
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


@cli.command()
@click.argument("num_prompts", default=100, type=int)
@click.argument("req_rate", default=0, type=float)
def bench(num_prompts, req_rate) -> None:
    """Benchmark the active worker model (AC-U4)."""
    import subprocess

    worker_usr = os.environ.get("WORKER_USR", "")
    worker_ip = os.environ.get("WORKER_IP", "")
    if not worker_usr or not worker_ip:
        err_console.print("[red]WORKER_USR and WORKER_IP must be set[/red]")
        sys.exit(1)

    console.print(f"[bold cyan]VoidRift Bench[/bold cyan] — {num_prompts} prompts")

    try:
        # Find active container
        r = subprocess.run(
            ["ssh", f"{worker_usr}@{worker_ip}", "docker ps --filter 'name=worker-' --format '{{.Names}}'"],
            capture_output=True, text=True, timeout=10,
        )
        container = r.stdout.strip().split("\n")[0]
        if not container:
            err_console.print("[red]No active worker container found[/red]")
            sys.exit(1)

        console.print(f"Container: {container}")

        # Get model name
        r = subprocess.run(
            ["ssh", f"{worker_usr}@{worker_ip}", f"curl -s http://localhost:8000/v1/models"],
            capture_output=True, text=True, timeout=10,
        )
        console.print(f"Models API: {r.stdout[:200]}")

        # Run benchmark
        rate_arg = f"--request-rate {req_rate}" if req_rate > 0 else "--request-rate inf"
        bench_cmd = (
            f"docker exec {container} python -m vllm.entrypoints.openai.api_server "
            f"--benchmark --num-prompts {num_prompts} {rate_arg}"
        )
        console.print(f"[dim]Running benchmark...[/dim]")
        subprocess.run(
            ["ssh", f"{worker_usr}@{worker_ip}", bench_cmd],
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        err_console.print("[red]Benchmark timed out[/red]")
        sys.exit(1)
    except (subprocess.SubprocessError, OSError) as e:
        err_console.print(f"[red]Benchmark failed: {e}[/red]")
        sys.exit(1)


if __name__ == "__main__":
    cli()
