"""Phase 2 — Plan: Architecture and task breakdown (AC-P1 through AC-P16)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space
from .. import ui

ARCHITECT_PROMPT = """[ROLE: Architect]

You are an Architect in the VoidRift framework. Design the system's structure and create the implementation roadmap.

You have MCP tools to read requirements, skills, and templates. Use them.

CRITICAL TASK FORMAT — each task must be:
- [ ] <Action verb> <file path>: <exact behavior> [skill1, skill2]

Action verbs: Create, Update, Add, Implement, Define
NEVER: "Design", "Plan", "Consider"
File path: exact relative path from project root
Exact behavior: specific inputs, outputs, return types, error handling
Skill tags: only skills directly needed

You MUST produce:
1. .voidrift/ARCHITECTURE.md (use the architecture template)
2. .voidrift/TASKS.md — single file. For multi-module projects, use ## Module: <name> headers.
3. ADR file(s) in .voidrift/adr/

Use write_file() to create all artifacts.
"""


def run_plan(
    model: ModelConfig,
    feature: str | None = None,
    fresh_start: bool = False,
) -> int:
    """Execute the plan phase.

    Args:
        model: Model configuration for the architect role.
        feature: Optional feature name to plan.
        fresh_start: Delete existing planning artifacts before starting.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    ui.phase("VoidRift Plan")

    if fresh_start:
        for f in [d / "ARCHITECTURE.md"] + list(d.glob("TASKS*.md")):
            f.unlink(missing_ok=True)
        for f in (d / "spec").glob("*.md"):
            f.unlink()
        ui.info("Cleared existing planning artifacts.")

    log, run_id = boot_run("plan")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Plan run: {datetime.now().isoformat()} ===\n")

    # Set up tools
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    requirements = (d / "REQUIREMENTS.md").read_text()
    specs = []
    spec_dir = d / "spec"
    if spec_dir.is_dir():
        for f in sorted(spec_dir.glob("*.md")):
            specs.append(f"### {f.stem}\n\n{f.read_text()}")

    prompt = f"Plan the implementation for this project.\n\nREQUIREMENTS:\n{requirements}"
    if specs:
        prompt += "\n\nFEATURE SPECS:\n" + "\n\n".join(specs)
    if feature:
        prompt += f"\n\nFocus on feature: {feature}"
    prompt += (
        "\n\nUse get_skill() to load skill conventions. "
        "Use get_template() to load templates. "
        "Use write_file() to create ARCHITECTURE.md and TASKS.md."
    )

    agent = AgentLoop(
        model=model,
        system_prompt=ARCHITECT_PROMPT,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=32768,
    )

    ui.stage("Planning architecture and tasks...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            response = agent.send(prompt)
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Plan failed: {e}")
            with open(log, "a") as f:
                f.write(f"ERROR: {e}\n")
            return 1

    # Validate outputs (REQ-P-1)
    has_arch = (d / "ARCHITECTURE.md").exists()
    has_tasks = (d / "TASKS.md").exists()

    if not has_arch or not has_tasks:
        missing = []
        if not has_arch:
            missing.append("ARCHITECTURE.md")
        if not has_tasks:
            missing.append("TASKS.md")
        ui.warn(f"Missing: {', '.join(missing)} — retrying...")

        retry_msg = (
            f"You did not produce all required artifacts. Missing: {', '.join(missing)}. "
            "Please create them now using write_file()."
        )
        with Status("  ⠋ Retrying...", console=ui._con):
            try:
                response = agent.send(retry_msg)
                with open(log, "a") as f:
                    f.write(f"\n=== RETRY ===\n{response}\n")
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Retry failed: {e}")

        has_arch = (d / "ARCHITECTURE.md").exists()
        has_tasks = (d / "TASKS.md").exists()

        if not has_arch or not has_tasks:
            missing = []
            if not has_arch:
                missing.append("ARCHITECTURE.md")
            if not has_tasks:
                missing.append("TASKS.md")
            ui.error(f"Plan failed: still missing {', '.join(missing)}")
            return 1

    # Summary
    task_files = list(d.glob("TASKS*.md"))
    for tf in task_files:
        lines = [l for l in tf.read_text().splitlines() if l.strip().startswith("- [ ]")]
        ui.success(f"{tf.name}: {len(lines)} tasks")
    if (d / "ARCHITECTURE.md").exists():
        ui.success("ARCHITECTURE.md created")
    for adr in sorted((d / "adr").glob("*.md")) if (d / "adr").is_dir() else []:
        ui.success(str(adr.relative_to(d)))

    ui.done("Plan complete.")
    return 0
