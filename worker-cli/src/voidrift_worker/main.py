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


@click.group()
def cli() -> None:
    """Manage local model containers, images, and Kiro Gateway on the worker node."""


# --- Top-level commands ---


@cli.command()
@click.argument("alias")
@click.option("--refresh", is_flag=True, help="Force-restart even if already running.")
def start(alias: str, refresh: bool) -> None:
    """Start a local model container.

    ALIAS is the model name from worker-models.yml (e.g. qwen3-coder).
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
    """Show active model, container, endpoint, and gateway status."""
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
    """Show logs from the active model container.

    Without --follow, shows the last 200 lines.
    """
    try:
        rc = worker_logs(follow=follow)
        sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]{e}[/red]")
        sys.exit(1)


@cli.command()
def info() -> None:
    """Show worker node GPU, disk usage, and memory."""
    try:
        output = worker_info()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@cli.command()
def check() -> None:
    """Verify worker node prerequisites (SSH, Docker, GPU, uvx)."""
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


# --- worker models ---


@cli.group("models")
def models_group() -> None:
    """Manage model weights on the worker node.

    \b
    Examples:
      worker models list          # cached models and disk usage
      worker models pull qwen3-coder
      worker models prune         # clean broken revisions
    """


@models_group.command("list")
def models_list_cmd() -> None:
    """List cached models and disk usage on the worker node."""
    try:
        output = models_list_cached()
        console.print(output)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


@models_group.command("aliases")
def models_aliases_cmd() -> None:
    """List configured model aliases from worker-models.yml."""
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
    """Download model weights for ALIAS.

    Resolves the HuggingFace repository from worker-models.yml.
    """
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
    """Remove a cached model revision by REVISION_ID.

    Get revision IDs from 'worker models list'.
    """
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
    """Clean broken or detached model revisions."""
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
    """Fix HuggingFace cache directory permissions.

    Resolves "Permission denied" errors when removing models.
    """
    try:
        rc = models_fix_perms()
        if rc == 0:
            console.print("✅ Permissions fixed.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


# --- worker images ---


@cli.group("images")
def images_group() -> None:
    """Manage vLLM docker images on the worker node.

    \b
    Examples:
      worker images pull           # pull default image from config
      worker images pull vllm/vllm-openai:latest-aarch64-cu130
      worker images list
    """


@images_group.command("pull")
@click.argument("image", required=False)
def images_pull_cmd(image: str | None) -> None:
    """Pull a vLLM docker image.

    Without IMAGE, pulls the default from worker-models.yml.
    """
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


# --- worker cache ---


@cli.group("cache")
def cache_group() -> None:
    """Manage compiled kernel caches on the worker node."""


@cache_group.command("clear")
def cache_clear_cmd() -> None:
    """Clear flashinfer and vllm kernel caches.

    Use when experiencing GPU compilation errors after driver updates.
    """
    try:
        rc = cache_clear()
        if rc == 0:
            console.print("✅ Caches cleared.")
        else:
            sys.exit(rc)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        sys.exit(1)


# --- worker bench ---


@cli.command()
@click.argument("num_prompts", default=100, type=int)
@click.argument("req_rate", default=0, type=float)
def bench(num_prompts: int, req_rate: float) -> None:
    """Benchmark the active model with NUM_PROMPTS requests.

    \b
    Examples:
      worker bench              # 100 prompts, max rate
      worker bench 100 1        # 100 prompts, 1 req/s
    """
    s = get_status()
    if not s["active"]:
        err_console.print("[red]No active worker container. Run 'worker start <alias>' first.[/red]")
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


# --- worker kiro ---


@cli.group()
def kiro() -> None:
    """Manage Kiro Gateway for free Claude access.

    \b
    Examples:
      worker kiro start
      worker kiro status
      worker kiro stop
    """


@kiro.command("start")
def kiro_start() -> None:
    """Start the Kiro Gateway container."""
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
    """Stop the Kiro Gateway container."""
    stop_gateway()
    console.print("✅ Gateway stopped.")


@kiro.command("status")
def kiro_status_cmd() -> None:
    """Show Kiro Gateway health and URL."""
    gw = get_gateway_status()
    if gw["active"]:
        console.print(f"Gateway: {gw['url']} (healthy)")
    else:
        console.print("Gateway: not running")


if __name__ == "__main__":
    cli()
