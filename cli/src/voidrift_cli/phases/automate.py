"""Phase 4 — Automate: Infrastructure-as-code generation (AC-A1 through AC-A10)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.console import Console
from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space, console, err_console


def _detect_iac() -> bool:
    """Check if IaC files exist (AC-A1).

    Returns:
        True if any infrastructure-as-code files are detected.
    """
    cwd = Path.cwd()
    # Terraform files up to 2 levels deep
    for depth in range(3):
        pattern = "/".join(["*"] * depth + ["*.tf"]) if depth else "*.tf"
        if list(cwd.glob(pattern)):
            return True
    # Other IaC markers
    for name in ["cdk.json", "podman-compose.yml", "podman-compose.yaml",
                  "docker-compose.yml", "docker-compose.yaml"]:
        if (cwd / name).exists():
            return True
    return False


def run_automate(worker: ModelConfig, architect: ModelConfig | None = None) -> int:
    """Execute the automate phase.

    Args:
        worker: Model configuration for the developer role.
        architect: Optional model for design decisions.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        err_console.print("[red]REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.[/red]")
        return 1

    log = log_path("automate")
    console.print(f"[dim]Log: {log}[/dim]")
    iac_exists = _detect_iac()
    mode = "Review" if iac_exists else "Generate"

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    requirements = (d / "REQUIREMENTS.md").read_text()
    arch_text = ""
    if (d / "ARCHITECTURE.md").exists():
        arch_text = (d / "ARCHITECTURE.md").read_text()

    prompt_parts = [f"Mode: {mode} infrastructure-as-code."]
    if mode == "Generate":
        prompt_parts.append(
            "Generate IaC based on the Runtime Environment in REQUIREMENTS.md. "
            "Put IaC files in infra/ except compose files which go in project root. "
            "No hardcoded secrets — use env vars and .env.example. "
            "Update ARCHITECTURE.md Deployment section with provisioning commands."
        )
    else:
        prompt_parts.append(
            "Review existing IaC for consistency with REQUIREMENTS.md and ARCHITECTURE.md. "
            "Reconcile gaps: add missing services, correct port mappings, update env vars. "
            "Do NOT delete and replace — only address specific gaps."
        )

    prompt_parts.append(f"\nREQUIREMENTS:\n{requirements[:12000]}")
    if arch_text:
        prompt_parts.append(f"\nARCHITECTURE:\n{arch_text[:8000]}")

    agent = AgentLoop(
        model=worker,
        system_prompt=(
            "[ROLE: Developer]\n\n"
            "Generate or review infrastructure-as-code. "
            "Use write_file() to create/modify IaC files. "
            "Use read_source_file() to examine existing files."
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=False,
    )

    console.print(f"[bold cyan]VoidRift Automate ({mode})[/bold cyan]")

    with Status(f"[bold cyan]{mode}ing infrastructure...", console=console):
        try:
            response = agent.send("\n".join(prompt_parts))
            with open(log, "a") as f:
                f.write(f"\n=== Automate {mode}: {datetime.now().isoformat()} ===\n{response}\n")
        except (RuntimeError, OSError, ValueError) as e:
            err_console.print(f"[red]Automate failed: {e}[/red]")
            return 1


    # Verify IaC was created (AC-A8)
    if mode == "Generate" and not _detect_iac():
        err_console.print("[yellow]⚠ No IaC files detected after generation. Check REQUIREMENTS.md ## Deployment.[/yellow]")
        return 1

    console.print(f"[green]✅ Automate ({mode.lower()}) complete.[/green]")
    return 0
