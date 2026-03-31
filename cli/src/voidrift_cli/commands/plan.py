"""Plan command: Two-stage architecture and task breakdown (REQ-P-1, REQ-ARCH-7)."""

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
    """Execute the two-stage plan command (REQ-P-1).

    Stage 1: Produce ARCHITECTURE.md and arch/<module>.md files.
    Stage 2: Produce TASKS.md using Stage 1 architecture as input.
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
        for sf in sorted(spec_dir.glob("*.md")):
            specs.append(f"### {sf.stem}\n\n{sf.read_text()}")
    specs_section = "FEATURE SPECS:\n" + "\n\n".join(specs) if specs else ""

    skill = find_skill("ARCH-DESIGN") or ""
    system_context = prompts.load_prompt("system", "CONTEXT")
    valid_skills = ", ".join(sorted(_available_skills())) if _available_skills() else ""
    task_format = _TASK_FORMAT.format(valid_skills=valid_skills)

    # ── Stage 1: Architecture ───────────────────────────────────────────
    ui.stage("Stage 1/2: Architecture...")

    arch_prompt = prompts.load_prompt("plan", "PLAN-ARCH").format(
        requirements=requirements,
        specs_section=specs_section,
    )
    arch_system = "\n\n".join(p for p in [system_context, skill, arch_prompt] if p)

    arch_agent = AgentLoop(
        model=model,
        system_prompt=arch_system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(model.model_type, "plan"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), "plan stage 1") as spin:
        arch_agent.on_progress = spin.on_progress
        try:
            response = arch_agent.send("Design the system architecture.")
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Stage 1 failed: {e}")
            return 1

    if not (d / "ARCHITECTURE.md").exists():
        ui.warn("ARCHITECTURE.md missing — retrying Stage 1...")
        with ui.spinner("Retrying...", "plan stage 1 retry") as spin:
            arch_agent.on_progress = spin.on_progress
            try:
                response = arch_agent.send(
                    "ARCHITECTURE.md was not written. Read existing files if present, "
                    "then write ARCHITECTURE.md and arch/<module>.md files now."
                )
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Stage 1 retry failed: {e}")
                return 1

        if not (d / "ARCHITECTURE.md").exists():
            ui.error("Plan failed: ARCHITECTURE.md still missing after retry.")
            return 1

    ui.success("Architecture complete.")

    # ── Stage 2: Tasks ──────────────────────────────────────────────────
    ui.stage("Stage 2/2: Task breakdown...")

    architecture = (d / "ARCHITECTURE.md").read_text()
    arch_files_parts = []
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        for af in sorted(arch_dir.glob("*.md")):
            arch_files_parts.append(f"### {af.stem}\n\n{af.read_text()}")
    arch_files_section = "\n\n".join(arch_files_parts) if arch_files_parts else "(none)"

    tasks_prompt = prompts.load_prompt("plan", "PLAN-TASKS").format(
        requirements=requirements,
        specs_section=specs_section,
        architecture=architecture,
        arch_files=arch_files_section,
        task_format=task_format,
        valid_skills=valid_skills,
    )
    tasks_system = "\n\n".join(p for p in [system_context, skill, tasks_prompt] if p)

    tasks_agent = AgentLoop(
        model=model,
        system_prompt=tasks_system,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(model.model_type, "plan"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), "plan stage 2") as spin:
        tasks_agent.on_progress = spin.on_progress
        try:
            response = tasks_agent.send("Create the task breakdown.")
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Stage 2 failed: {e}")
            return 1

    if not (d / "TASKS.md").exists():
        ui.warn("TASKS.md missing — retrying Stage 2...")
        with ui.spinner("Retrying...", "plan stage 2 retry") as spin:
            tasks_agent.on_progress = spin.on_progress
            try:
                response = tasks_agent.send(
                    "TASKS.md was not written. Read existing files if present, "
                    "then write TASKS.md now."
                )
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Stage 2 retry failed: {e}")
                return 1

        if not (d / "TASKS.md").exists():
            ui.error("Plan failed: TASKS.md still missing after retry.")
            return 1

    # ── Post-processing ─────────────────────────────────────────────────
    valid_skill_set = _available_skills()
    if valid_skill_set:
        invalid = _validate_skill_tags(d / "TASKS.md", valid_skill_set)
        if invalid:
            _strip_invalid_tags(d / "TASKS.md", invalid)
            ui.warn(f"Stripped invalid skill tags: {', '.join(sorted(invalid))}")

    task_files = list(d.glob("TASKS*.md"))
    for tf in task_files:
        lines = [l for l in tf.read_text().splitlines() if l.strip().startswith("- [ ]")]
        ui.success(f"{tf.name}: {len(lines)} tasks")
    if (d / "ARCHITECTURE.md").exists():
        ui.success("ARCHITECTURE.md created")

    from ..utils import append_state
    files_created = []
    if (d / "ARCHITECTURE.md").exists():
        files_created.append(".voidrift/ARCHITECTURE.md")
    for tf in task_files:
        files_created.append(f".voidrift/{tf.name}")
    for af in sorted((d / "arch").glob("*.md")) if (d / "arch").is_dir() else []:
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
    """Return set of valid skill names from all layers."""
    from ..skills import _skill_dirs
    names: set[str] = set()
    for skills_dir in _skill_dirs(Path.cwd()):
        if skills_dir.is_dir():
            for p in skills_dir.glob("*.md"):
                names.add(p.stem.upper())
    return names


def _validate_skill_tags(tasks_path: Path, valid: set[str]) -> set[str]:
    """Return set of invalid skill tags found in TASKS.md."""
    import re
    text = tasks_path.read_text()
    tags = set(re.findall(r"\[([^\]]+)\]", text))
    valid_upper = {v.upper() for v in valid}
    invalid = set()
    for tag_group in tags:
        for tag in tag_group.split(","):
            tag = tag.strip()
            if tag and tag.upper() not in valid_upper and not tag.startswith(("x", " ")):
                invalid.add(tag)
    return invalid


def _strip_invalid_tags(tasks_path: Path, invalid: set[str]) -> None:
    """Remove invalid skill tags from TASKS.md lines."""
    import re
    lines = tasks_path.read_text().splitlines()
    out = []
    for line in lines:
        for tag in invalid:
            line = re.sub(rf",\s*{re.escape(tag)}", "", line)
            line = re.sub(rf"{re.escape(tag)}\s*,\s*", "", line)
            line = re.sub(rf"\[\s*{re.escape(tag)}\s*\]", "", line)
        out.append(line)
    tasks_path.write_text("\n".join(out) + "\n")
