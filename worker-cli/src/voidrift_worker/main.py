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
    list_models,
    load_worker_models,
    models_add,
    models_fix_perms,
    models_list_cached,
    models_prune,
    models_pull,
    models_remove,
    ssh_cmd,
    ssh_stream,
    start_gateway,
    start_model,
    stop_gateway,
    stop_model,
    worker_check,
    worker_info,
    worker_logs,
)

console = Console()
err_console = Console(stderr=True)

HELP_TEXT = """Manage local model containers, images, and Kiro Gateway.

Getting started:
  worker check                    Verify worker node is ready
  worker models pull <alias>      Download model weights
  worker start <alias>            Start serving the model
  worker status                   Confirm it's running

Commands:
  start <alias> [--refresh]   Start a model container
  stop                        Stop the active container
  status                      Show what's running
  logs [-f]                   View container output
  check                       Verify prerequisites
  info                        GPU, disk, memory
  bench [<num>] [<rate>]      Run vLLM benchmark

Model Weights:
  models list                 Cached models + disk usage
  models aliases              Configured aliases
  models add <alias> <repo>   Add a new model to config
  models pull <alias>         Download weights
  models remove <id>          Delete a cached revision
  models prune                Clean broken revisions
  models fix-perms            Fix cache permissions

Docker Images:
  images pull [<image>]       Pull vLLM image
  images list                 List images

Kernel Caches:
  cache clear                 Wipe flashinfer/vllm caches

Kiro Gateway:
  kiro start                  Start gateway
  kiro stop                   Stop gateway
  kiro status                 Health check

Environment:
  WORKER_USR                  SSH username for worker node
  WORKER_IP                   Worker node IP address

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


# --- Container lifecycle ---


@cli.command()
@click.argument("alias")
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
        rc = worker_logs(follow=follow)
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
    """Manage model weights on the worker node.

    \b
    Examples:
      worker models list                # what's cached + disk usage
      worker models pull <alias>        # download by alias
      worker models prune               # clean broken revisions
    """


@models_group.command("list")
def models_list_cmd() -> None:
    """Show cached models and disk usage."""
    try:
        output = models_list_cached()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("aliases")
def models_aliases_cmd() -> None:
    """Show configured aliases from worker-models.yml."""
    available = list_models()
    if not available:
        console.print("No models configured. Check worker-models.yml.")
        return
    s = get_status()
    active_alias = s["model"] if s["active"] else None
    for alias, m in sorted(available.items()):
        marker = " ✅" if alias == active_alias else ""
        console.print(f"  {alias:<20} {m.repository}{marker}")


@models_group.command("pull")
@click.argument("alias")
def models_pull_cmd(alias: str) -> None:
    """Download model weights. Resolves HF repo from worker-models.yml."""
    try:
        console.print(f"Downloading {alias}...")
        rc = models_pull(alias)
        if rc == 0:
            console.print(f"✅ {alias} downloaded.")
        else:
            sys.exit(rc)
    except (RuntimeError, ValueError) as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("remove")
@click.argument("revision_id")
def models_remove_cmd(revision_id: str) -> None:
    """Delete a cached revision. Get IDs from 'worker models list'."""
    try:
        rc = models_remove(revision_id)
        if rc == 0:
            console.print("✅ Removed.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("prune")
def models_prune_cmd() -> None:
    """Clean broken or detached revisions."""
    try:
        rc = models_prune()
        if rc == 0:
            console.print("✅ Pruned.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("fix-perms")
def models_fix_perms_cmd() -> None:
    """Fix cache permissions. Resolves 'Permission denied' on model removal."""
    try:
        rc = models_fix_perms()
        if rc == 0:
            console.print("✅ Permissions fixed.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("add")
@click.argument("alias")
@click.argument("repo")
def models_add_cmd(alias: str, repo: str) -> None:
    """Add a new model to worker-models.yml with defaults.

    Edit worker-models.yml afterwards to customize vllm_args.
    """
    try:
        models_add(alias, repo)
        console.print(f"✅ Added {alias} → {repo}")
    except ValueError as e:
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
