"""Plan command: Architecture and task breakdown (AC-P1 through AC-P16)."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from .. import prompts
from ..skills import find_skill
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space
from ..config import get_max_tokens
from .. import ui


# Task format description — single source of truth injected into both PLAN and PLAN-UPDATE prompts.
# Uses {{valid_skills}} (double-braces) so the outer .format() doesn't consume it; callers must
# call _TASK_FORMAT.format(valid_skills=...) to produce the final string.
_TASK_FORMAT = """\
**Task format** — each line in TASKS.md must be:
`- [ ] <Action verb> <file path>: <exact behavior>. <rationale or user story context> [skill1, skill2]`

- Action verbs: Create, Update, Add, Implement, Define.
- File path: exact relative path from project root to a project source file (e.g. `src/main.py`, `.github/workflows/ci.yml`). All paths target the project tree — `.voidrift/` artifacts are produced by you (the architect) directly via `write_framework_file()`, not as developer tasks.
- Exact behavior: specific inputs, outputs, return types, error handling. Include acceptance criteria, expected behavior, and error cases.
- Rationale: WHY this task exists — the user story, requirement, or design decision it satisfies.
- Skill tags: ONLY from this list: {valid_skills}. Format: `[skill1, skill2]`

The developer agent implements ONE task at a time with limited context. Each task description must be self-contained — include enough detail that a developer can implement without reading the full requirements. Tasks that say only "implement X" or "create Y" without specifying exact behavior are insufficient."""


def run_plan(
    model: ModelConfig,
    feature: str | None = None,
    overwrite: bool = False,
) -> int:
    """Execute the plan command.

    Args:
        model: Model configuration for the architect role.
        feature: Optional feature name to plan.
        overwrite: Remove previous plan artifacts (per STATE.md) before starting.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    ui.header("VoidRift Plan")

    if overwrite:
        from ..utils import undo_command
        deleted = undo_command("plan")
        if deleted:
            ui.info(f"Cleared {len(deleted)} files from previous plan.")

    log, run_id = boot_run("plan")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Plan run: {datetime.now().isoformat()} ===\n")

    tools, handlers = build_local_tools(cmd="plan")

    requirements = (d / "REQUIREMENTS.md").read_text()
    specs = []
    spec_dir = d / "spec"
    if spec_dir.is_dir():
        for f in sorted(spec_dir.glob("*.md")):
            specs.append(f"### {f.stem}\n\n{f.read_text()}")

    skill = find_skill("ARCH-DESIGN") or ""

    specs_section = "FEATURE SPECS:\n" + "\n\n".join(specs) if specs else ""
    valid_skills = ", ".join(sorted(_available_skills())) if _available_skills() else ""
    task_format = _TASK_FORMAT.format(valid_skills=valid_skills)

    # Load shared framework context (REQ-RES-7)
    system_context = prompts.load_prompt("system", "CONTEXT")

    arch_path = d / "ARCHITECTURE.md"
    tasks_path = d / "TASKS.md"
    update = arch_path.exists() and tasks_path.exists()

    if update:
        stage_prompt = prompts.load_prompt("plan", "PLAN-UPDATE").format(
            requirements=requirements,
            specs_section=specs_section,
            architecture=arch_path.read_text(),
            tasks=tasks_path.read_text(),
            task_format=task_format,
        )
    else:
        feature_section = f"Focus on feature: {feature}" if feature else ""
        stage_prompt = prompts.load_prompt("plan", "PLAN").format(
            requirements=requirements,
            specs_section=specs_section,
            feature_section=feature_section,
            task_format=task_format,
        )

    system = "\n\n".join(p for p in [system_context, skill, stage_prompt] if p)

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(model.model_type, "plan"),
        log_path=log,
        show_spinner=False,
    )

    ui.stage("Planning architecture and tasks...")
    with ui.spinner(ui.random_label(), "plan") as spin:
        agent.on_progress = spin.on_progress
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
            "Please create them now using write_framework_file()."
        )
        with ui.spinner("Retrying...", "plan retry") as spin:
            agent.on_progress = spin.on_progress
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

    # Validate skill tags (REQ-P-9) — strip invalid tags directly
    valid_skills = _available_skills()
    if valid_skills:
        invalid = _validate_skill_tags(d / "TASKS.md", valid_skills)
        if invalid:
            _strip_invalid_tags(d / "TASKS.md", invalid)
            ui.warn(f"Stripped invalid skill tags: {', '.join(sorted(invalid))}")

    # Summary
    task_files = list(d.glob("TASKS*.md"))
    for tf in task_files:
        lines = [l for l in tf.read_text().splitlines() if l.strip().startswith("- [ ]")]
        ui.success(f"{tf.name}: {len(lines)} tasks")
    if (d / "ARCHITECTURE.md").exists():
        ui.success("ARCHITECTURE.md created")

    # Write state entry (REQ-PS-3)
    from ..utils import append_state
    files_created = []
    if (d / "ARCHITECTURE.md").exists():
        files_created.append(".voidrift/ARCHITECTURE.md")
    for tf in task_files:
        files_created.append(f".voidrift/{tf.name}")
    for af in sorted((d / "arch").glob("*.md")):
        files_created.append(f".voidrift/arch/{af.name}")
    task_count = sum(
        len([l for l in tf.read_text().splitlines() if l.strip().startswith("- [ ]")])
        for tf in task_files
    )
    append_state(
        cmd="plan",
        model_alias=model.alias,
        summary=f"Wrote ARCHITECTURE.md, {len(files_created) - 1} supporting files, {task_count} tasks.",
        files_created=files_created,
    )

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


def _strip_invalid_tags(tasks_path: Path, invalid: set[str]) -> None:
    """Remove invalid skill tags from task lines in-place."""
    import re
    lines = tasks_path.read_text().splitlines()
    out = []
    for line in lines:
        if line.strip().startswith("- [ ]"):
            m = re.search(r"\[([^\]]+)\]\s*$", line)
            if m:
                tags = [t.strip() for t in m.group(1).split(",")
                        if t.strip().lower() not in invalid]
                if tags:
                    line = line[:m.start()] + "[" + ", ".join(tags) + "]"
                else:
                    line = line[:m.start()].rstrip()
        out.append(line)
    tasks_path.write_text("\n".join(out) + "\n")
