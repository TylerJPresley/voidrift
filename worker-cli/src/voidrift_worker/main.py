"""Worker CLI — manage local model containers and Kiro Gateway."""

from __future__ import annotations

import subprocess
import sys

import click
from rich.console import Console

from .models import (
    cache_clear,
    get_gateway_status,
    get_status,
    images_list,
    images_pull,
    models_add,
    models_check,
    models_list,
    models_remove,
    ssh_cmd,
    ssh_stream,
    start_gateway,
    start_model,
    stop_gateway,
    stop_model,
    worker_check,
    worker_info,
    _list_containers,
    worker_logs,
)

console = Console()
err_console = Console(stderr=True)


def _complete_alias(ctx, param, incomplete):
    """Shell completion for model aliases."""
    try:
        from .models import list_models
        return [a for a in list_models() if a.startswith(incomplete)]
    except Exception:
        return []


HELP_TEXT = """Manage local model containers, images, and Kiro Gateway.

Getting started:
  worker check                    Verify worker node is ready
  worker models list              See available models
  worker start <alias>            Start serving a model
  worker status                   Confirm it's running

Commands:
  start <alias> [--refresh]   Start a model container
  stop                        Stop the active container
  status                      Show what's running
  logs [-f]                   View container output
  check                       Verify prerequisites
  info                        GPU, disk, memory
  bench [<num>] [<rate>]      Run vLLM benchmark

Models:
  models list                 Configured + cached models
  models add <alias> <repo>   Add and download a model
  models remove <alias>       Remove model and free disk
  models check [--prune]      Audit and fix missing weights

Docker Images:
  images pull [<image>]       Pull vLLM image
  images list                 List images

Kernel Caches:
  cache clear                 Wipe flashinfer/vllm caches

Kiro Gateway:
  kiro start                  Start gateway
  kiro stop                   Stop gateway
  kiro status                 Health check

Configuration:
  ~/.voidrift/config.yml      Worker, Kiro, and API key settings
  completions <shell>         Generate shell completions (bash/zsh/fish)

Run 'worker COMMAND --help' for details."""


class OrderedGroup(click.Group):
    """Click group that preserves command insertion order."""

    def list_commands(self, ctx: click.Context) -> list[str]:
        return list(self.commands)


class TopGroup(OrderedGroup):
    """Top-level group with custom help layout."""

    def format_usage(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        formatter.write("Usage: worker [COMMAND]\n")

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        self.format_usage(ctx, formatter)
        formatter.write("\n")
        formatter.write(self.help or "")
        formatter.write("\n")


@click.group(cls=TopGroup, invoke_without_command=True, help=HELP_TEXT)
@click.pass_context
def cli(ctx: click.Context) -> None:
    if ctx.invoked_subcommand is None:
        click.echo(ctx.get_help())


def main() -> None:
    """Entry point with clean error handling."""
    try:
        cli(standalone_mode=False)
    except SystemExit:
        raise
    except (RuntimeError, OSError) as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)
    except click.Abort:
        sys.exit(130)


@cli.command("completions")
@click.argument("shell", type=click.Choice(["bash", "zsh", "fish"]))
def completions_cmd(shell: str) -> None:
    """Generate shell completion script.

    \b
    Install once:
      worker completions bash > ~/.local/share/bash-completion/completions/worker
      worker completions zsh > ~/.zfunc/_worker
      worker completions fish > ~/.config/fish/completions/worker.fish
    """
    import os
    env_var = "_WORKER_COMPLETE"
    script = os.popen(f"{env_var}={shell}_source worker").read()
    click.echo(script)


# --- Container lifecycle ---


@cli.command()
@click.argument("alias", shell_complete=_complete_alias)
@click.option("--refresh", is_flag=True, help="Force-restart even if already running.")
def start(alias: str, refresh: bool) -> None:
    """Start a model container.

    ALIAS is the model name from worker-models.yml.
    Use --refresh to force-restart if the container is already running.
    """
    try:
        console.print(f"Starting {alias}...")
        start_model(alias, refresh=refresh)
        status = get_status()
        console.print(f"✅ {alias} ready at {status['url']}")
    except (RuntimeError, ValueError) as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@cli.command()
def stop() -> None:
    """Stop the active model container."""
    try:
        status = get_status()
        if not status["active"]:
            console.print("No active model container.")
            return
        console.print(f"Stopping {status['container']}...")
        stop_model()
        console.print("✅ Stopped.")
    except (RuntimeError, OSError) as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@cli.command()
def status() -> None:
    """Show what's running — active model, endpoint, and gateway."""
    s = get_status()
    if s["active"]:
        console.print(f"Model:     {s['model']}")
        console.print(f"Container: {s['container']}")
        console.print(f"Endpoint:  {s['url']}")
    else:
        console.print("No active model container.")

    gw = get_gateway_status()
    if gw["active"]:
        console.print(f"Gateway:   {gw['url']}")
    else:
        console.print("Gateway:   not running")


@cli.command()
@click.option("--follow", "-f", is_flag=True, help="Stream logs continuously.")
def logs(follow: bool) -> None:
    """View container output. Shows last 200 lines, or stream with -f."""
    try:
        containers = _list_containers()
        if not containers:
            err_console.print("[red]No model containers found.[/red]")
            sys.exit(1)

        s = get_status()
        active_name = s["container"] if s["active"] else None

        console.print("Containers:")
        for i, c in enumerate(containers, 1):
            marker = " ✅ active" if c["name"] == active_name else ""
            console.print(f"  {i}. {c['name']}  ({c['status']}){marker}")

        choice = click.prompt("Select", type=click.IntRange(1, len(containers)), default=1)
        selected = containers[choice - 1]["name"]
        rc = worker_logs(follow=follow, container=selected)
        sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]{e}[/red]")
        sys.exit(1)


@cli.command()
@click.argument("num_prompts", default=100, type=int)
@click.argument("req_rate", default=0, type=float)
def bench(num_prompts: int, req_rate: float) -> None:
    """Run vLLM benchmark. Default: 100 prompts at max rate.

    \b
    Examples:
      worker bench              # 100 prompts, max rate
      worker bench 100 1        # 100 prompts, 1 req/s
    """
    s = get_status()
    if not s["active"]:
        err_console.print("[red]No active container. Run 'worker start <alias>' first.[/red]")
        sys.exit(1)

    console.print(f"[bold cyan]Worker Bench[/bold cyan] — {num_prompts} prompts")
    console.print(f"Container: {s['container']}")

    try:
        config = load_worker_models()
        port = config.get("worker", {}).get("port", 8000)
        r = ssh_cmd(f"curl -s http://localhost:{port}/v1/models")
        console.print(f"Models API: {r.stdout[:200]}")

        rate_arg = f"--request-rate {req_rate}" if req_rate > 0 else "--request-rate inf"
        bench_cmd = (
            f"docker exec {s['container']} python -m vllm.entrypoints.openai.api_server "
            f"--benchmark --num-prompts {num_prompts} {rate_arg}"
        )
        console.print("[dim]Running benchmark...[/dim]")
        rc = ssh_stream(bench_cmd, timeout=600)
        sys.exit(rc)
    except subprocess.TimeoutExpired:
        err_console.print("[red]Benchmark timed out[/red]")
        sys.exit(1)
    except (subprocess.SubprocessError, OSError, RuntimeError) as e:
        err_console.print(f"[red]Benchmark failed: {e}[/red]")
        sys.exit(1)


# --- Model weights ---


@cli.group("models", cls=OrderedGroup)
def models_group() -> None:
    """Manage models on the worker node.

    \b
    Examples:
      worker models list              # show configured + cached models
      worker models add <alias> <repo>  # add and download a model
      worker start <alias>            # start serving a model
      worker models remove <alias>    # remove model and free disk
      worker models check             # audit and fix missing weights
    """


@models_group.command("list")
def models_list_cmd() -> None:
    """Show configured and cached models."""
    try:
        output = models_list()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("add")
@click.argument("alias", shell_complete=_complete_alias)
@click.argument("repo")
def models_add_cmd(alias: str, repo: str) -> None:
    """Add a new model and download weights."""
    try:
        console.print(f"Adding {alias} ({repo})...")
        rc = models_add(alias, repo)
        if rc == 0:
            console.print(f"✅ {alias} added and downloaded.")
        else:
            console.print(f"⚠ {alias} added but download failed (rc={rc}).")
            sys.exit(rc)
    except ValueError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("remove")
@click.argument("alias", shell_complete=_complete_alias)
def models_remove_cmd(alias: str) -> None:
    """Remove a model from config and cache."""
    try:
        console.print(f"Removing {alias}...")
        rc = models_remove(alias)
        if rc == 0:
            console.print(f"✅ {alias} removed (moved to retired).")
        else:
            console.print(f"⚠ {alias} retired but cache removal failed.")
    except ValueError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("check")
@click.option("--prune", is_flag=True, help="Remove unconfigured cached models.")
def models_check_cmd(prune: bool) -> None:
    """Audit models and download missing weights."""
    try:
        results, unconfigured = models_check(prune=prune)
        for alias, ok, msg in results:
            status = "✅" if ok else "❌"
            console.print(f"  {status} {alias}: {msg}")

        if unconfigured:
            if prune:
                console.print("")
                for repo, size in unconfigured:
                    console.print(f"  🗑 Removed {repo} ({size})")
            else:
                total = sum(float(s.rstrip("G")) for s, _ in [(size, None) for _, size in unconfigured] if s.endswith("G"))
                console.print(f"\n  ⚠ {len(unconfigured)} unconfigured models in cache (~{total:.1f}G):")
                for repo, size in unconfigured:
                    console.print(f"    {repo} ({size})")
                console.print("  Run 'worker models check --prune' to remove them.")
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


# --- Docker images ---


@cli.group("images", cls=OrderedGroup)
def images_group() -> None:
    """Manage vLLM docker images on the worker node.

    \b
    Examples:
      worker images pull           # default image from config
      worker images pull vllm/vllm-openai:latest-aarch64-cu130
    """


@images_group.command("pull")
@click.argument("image", required=False)
def images_pull_cmd(image: str | None) -> None:
    """Pull a vLLM image. Without IMAGE, pulls the default from config."""
    try:
        label = image or "default image"
        console.print(f"Pulling {label}...")
        rc = images_pull(image)
        if rc == 0:
            console.print("✅ Image pulled.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@images_group.command("list")
def images_list_cmd() -> None:
    """List docker images on the worker node."""
    try:
        output = images_list()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


# --- Worker node ---


@cli.command()
def check() -> None:
    """Verify prerequisites — SSH, Docker, GPU, uvx."""
    try:
        results = worker_check()
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)

    all_ok = True
    for name, passed, detail in results:
        icon = "✅" if passed else "❌"
        console.print(f"  {icon} {name:<8} {detail}")
        if not passed:
            all_ok = False

    if not all_ok:
        sys.exit(1)


@cli.command()
def info() -> None:
    """Show GPU, disk usage, and memory on the worker node."""
    try:
        output = worker_info()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@cli.group("cache", cls=OrderedGroup)
def cache_group() -> None:
    """Manage compiled kernel caches (flashinfer, vllm)."""


@cache_group.command("clear")
def cache_clear_cmd() -> None:
    """Wipe flashinfer and vllm caches. Use after driver updates."""
    try:
        rc = cache_clear()
        if rc == 0:
            console.print("✅ Caches cleared.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


# --- Kiro Gateway ---


@cli.group(cls=OrderedGroup)
def kiro() -> None:
    """Manage Kiro Gateway for free Claude, DeepSeek, and Qwen access.

    \b
    Requires Kiro Gateway installed at ~/opt/kiro-gateway.
    See README.md § Kiro Gateway Setup for configuration.
    """


@kiro.command("start")
def kiro_start() -> None:
    """Start the gateway container."""
    try:
        console.print("Starting Kiro Gateway...")
        start_gateway()
        gw = get_gateway_status()
        console.print(f"✅ Gateway ready at {gw['url']}")
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@kiro.command("stop")
def kiro_stop() -> None:
    """Stop the gateway container."""
    stop_gateway()
    console.print("✅ Gateway stopped.")


@kiro.command("status")
def kiro_status_cmd() -> None:
    """Check gateway health."""
    gw = get_gateway_status()
    if gw["active"]:
        console.print(f"Gateway: {gw['url']} (healthy)")
    else:
        console.print("Gateway: not running")


# --- Hidden ---


@cli.command("help", hidden=True)
@click.pass_context
def help_cmd(ctx: click.Context) -> None:
    """Show help."""
    click.echo(ctx.parent.get_help())


if __name__ == "__main__":
    cli()
