"""Worker CLI — manage local model containers and Kiro Gateway (REQ-WK-1)."""

from __future__ import annotations

import os
import subprocess
import sys

import click
from rich.console import Console

from .models import (
    list_models,
    load_worker_models,
    start_model,
    stop_model,
    get_status,
    start_gateway,
    stop_gateway,
    get_gateway_status,
    ssh_cmd,
)

console = Console()
err_console = Console(stderr=True)


@click.group()
def cli() -> None:
    """Worker CLI — manage local model containers and Kiro Gateway."""


@cli.command()
@click.argument("alias")
@click.option("--refresh", is_flag=True, help="Force-restart even if already running")
def start(alias: str, refresh: bool) -> None:
    """Start a local model container (REQ-WK-2)."""
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
    """Stop the active model container (REQ-WK-3)."""
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
    """Report active model and endpoint (REQ-WK-4)."""
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
def models() -> None:
    """List available model aliases (REQ-WK-6)."""
    available = list_models()
    if not available:
        console.print("No models configured. Check worker-models.yml.")
        return

    s = get_status()
    active_alias = s["model"] if s["active"] else None

    for alias, m in sorted(available.items()):
        marker = " ✅" if alias == active_alias else ""
        console.print(f"  {alias:<20} {m.repository}{marker}")


@cli.command()
@click.argument("num_prompts", default=100, type=int)
@click.argument("req_rate", default=0, type=float)
def bench(num_prompts: int, req_rate: float) -> None:
    """Benchmark the active model (REQ-WK-5)."""
    s = get_status()
    if not s["active"]:
        err_console.print("[red]No active worker container. Run 'worker start <alias>' first.[/red]")
        sys.exit(1)

    console.print(f"[bold cyan]Worker Bench[/bold cyan] — {num_prompts} prompts")
    console.print(f"Container: {s['container']}")

    try:
        # Get model info
        worker_ip = os.environ.get("WORKER_IP", "")
        config = load_worker_models()
        port = config.get("worker", {}).get("port", 8000)
        r = ssh_cmd(f"curl -s http://localhost:{port}/v1/models")
        console.print(f"Models API: {r.stdout[:200]}")

        # Run benchmark
        rate_arg = f"--request-rate {req_rate}" if req_rate > 0 else "--request-rate inf"
        bench_cmd = (
            f"docker exec {s['container']} python -m vllm.entrypoints.openai.api_server "
            f"--benchmark --num-prompts {num_prompts} {rate_arg}"
        )
        console.print("[dim]Running benchmark...[/dim]")
        subprocess.run(
            ["ssh", f"{os.environ.get('WORKER_USR', '')}@{worker_ip}", bench_cmd],
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        err_console.print("[red]Benchmark timed out[/red]")
        sys.exit(1)
    except (subprocess.SubprocessError, OSError, RuntimeError) as e:
        err_console.print(f"[red]Benchmark failed: {e}[/red]")
        sys.exit(1)


@cli.group()
def kiro() -> None:
    """Manage Kiro Gateway (REQ-WK-9)."""


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
    """Report Kiro Gateway health."""
    gw = get_gateway_status()
    if gw["active"]:
        console.print(f"Gateway: {gw['url']} (healthy)")
    else:
        console.print("Gateway: not running")


if __name__ == "__main__":
    cli()
