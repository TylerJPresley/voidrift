"""Deploy command: Infrastructure-as-code generation (AC-A1 through AC-A10)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space
from .. import ui


def _detect_iac() -> bool:
    """Check if IaC files exist."""
    cwd = Path.cwd()
    for depth in range(3):
        pattern = "/".join(["*"] * depth + ["*.tf"]) if depth else "*.tf"
        if list(cwd.glob(pattern)):
            return True
    for name in ["cdk.json", "podman-compose.yml", "podman-compose.yaml",
                  "docker-compose.yml", "docker-compose.yaml"]:
        if (cwd / name).exists():
            return True
    return False


def run_deploy(worker: ModelConfig, architect: ModelConfig | None = None) -> int:
    """Execute the deploy command."""
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    iac_exists = _detect_iac()
    mode = "Review" if iac_exists else "Generate"

    ui.header(f"VoidRift Deploy ({mode})")
    log, run_id = boot_run("deploy")
    ui.detail(f"Log: {log}")

    tools, handlers = build_local_tools()

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
            "Use write_source_file() to create/modify IaC files. "
            "Use read_source_file() to examine existing files."
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        log_path=log,
        show_spinner=False,
    )

    ui.stage(f"{mode}ing infrastructure...")
    with ui.spinner(ui.random_label(), mode.lower()) as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send("\n".join(prompt_parts))
            with open(log, "a") as f:
                f.write(f"\n=== Deploy {mode}: {datetime.now().isoformat()} ===\n{response}\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Deploy failed: {e}")
            return 1

    if mode == "Generate" and not _detect_iac():
        ui.warn("No IaC files detected after generation. Check REQUIREMENTS.md ## Deployment.")
        return 1

    ui.done(f"Deploy ({mode.lower()}) complete.")
    return 0
