"""Phase 2 — Plan: Architecture and task breakdown (AC-P1 through AC-P16)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space
from .. import ui


def run_plan(
    model: ModelConfig,
    feature: str | None = None,
    fresh_start: bool = False,
    update: bool = False,
) -> int:
    """Execute the plan phase.

    Args:
        model: Model configuration for the architect role.
        feature: Optional feature name to plan.
        fresh_start: Delete existing planning artifacts before starting.
        update: Revise existing plan to align with current requirements.

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
        mcp_mod.run_id = run_id
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

    _get_prompt = handlers.get("get_prompt", lambda *a: "")
    _get_skill = handlers.get("get_skill", lambda *a: "")

    skill = _get_skill("ARCH-DESIGN")

    specs_section = "FEATURE SPECS:\n" + "\n\n".join(specs) if specs else ""

    if update:
        arch_path = d / "ARCHITECTURE.md"
        tasks_path = d / "TASKS.md"
        if not arch_path.exists() or not tasks_path.exists():
            ui.error("--update requires existing ARCHITECTURE.md and TASKS.md. Run plan without --update first.")
            return 1
        stage_prompt = _get_prompt("plan", "PLAN-UPDATE").format(
            requirements=requirements,
            specs_section=specs_section,
            architecture=arch_path.read_text(),
            tasks=tasks_path.read_text(),
        )
    else:
        feature_section = f"Focus on feature: {feature}" if feature else ""
        stage_prompt = _get_prompt("plan", "PLAN").format(
            requirements=requirements,
            specs_section=specs_section,
            feature_section=feature_section,
        )

    system = f"{skill}\n\n{stage_prompt}" if skill else stage_prompt

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=32768,
        log_path=log,
    )

    ui.stage("Planning architecture and tasks...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            response = agent.send("Create the architecture and task breakdown.")
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

    # Validate skill tags (REQ-P-9)
    valid_skills = _available_skills()
    if valid_skills:  # skip if no skills directory (framework not fully installed)
        invalid = _validate_skill_tags(d / "TASKS.md", valid_skills)
        if invalid:
            ui.warn(f"Invalid skill tags: {', '.join(sorted(invalid))} — asking model to fix...")
            fix_msg = (
                f"TASKS.md contains invalid skill tags: {', '.join(sorted(invalid))}. "
                f"Valid skills: {', '.join(sorted(valid_skills))}. "
                "Please rewrite TASKS.md with only valid skill tags using write_file()."
            )
            with Status("  ⠋ Fixing tags...", console=ui._con):
                try:
                    response = agent.send(fix_msg)
                    with open(log, "a") as f:
                        f.write(f"\n=== TAG FIX ===\n{response}\n")
                except (RuntimeError, OSError, ValueError) as e:
                    ui.error(f"Tag fix failed: {e}")
            invalid = _validate_skill_tags(d / "TASKS.md", valid_skills)
            if invalid:
                ui.error(f"Plan failed: still has invalid skill tags: {', '.join(sorted(invalid))}")
                return 1

    # Summary
    task_files = list(d.glob("TASKS*.md"))
    for tf in task_files:
        lines = [l for l in tf.read_text().splitlines() if l.strip().startswith("- [ ]")]
        ui.success(f"{tf.name}: {len(lines)} tasks")
    if (d / "ARCHITECTURE.md").exists():
        ui.success("ARCHITECTURE.md created")

    ui.done("Plan complete.")
    return 0


def _available_skills() -> set[str]:
    """Return lowercase names of all skill files in resources/skills/."""
    from ..config import _voidrift_home
    skills_dir = _voidrift_home() / "resources" / "skills"
    if not skills_dir.is_dir():
        return set()
    return {p.stem.lower() for p in skills_dir.glob("*.md")}


def _validate_skill_tags(tasks_path: Path, valid: set[str]) -> set[str]:
    """Parse [tag, ...] from task lines and return any not in valid skills."""
    import re
    if not tasks_path.exists():
        return set()
    tags = set()
    for line in tasks_path.read_text().splitlines():
        if line.strip().startswith("- [ ]"):
            m = re.search(r"\[([^\]]+)\]\s*$", line)
            if m:
                tags.update(t.strip().lower() for t in m.group(1).split(","))
    return tags - valid
