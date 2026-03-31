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
        # Fallback: remove known plan artifacts not tracked in STATE.md
        for target in [d / "ARCHITECTURE.md", d / "TASKS.md"]:
            if target.exists() and str(target) not in deleted:
                target.unlink()
                deleted.append(str(target))
        arch_dir = d / "arch"
        if arch_dir.is_dir():
            for af in arch_dir.glob("*.md"):
                if str(af) not in deleted:
                    af.unlink()
                    deleted.append(str(af))
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
    task_format = prompts.load_template("TASK-FORMAT")

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
            response = arch_agent.send(prompts.load_prompt("plan", "ARCH-USER"))
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
                response = arch_agent.send(prompts.load_prompt("plan", "ARCH-RETRY"))
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
            response = tasks_agent.send(prompts.load_prompt("plan", "TASKS-USER"))
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
                response = tasks_agent.send(prompts.load_prompt("plan", "TASKS-RETRY"))
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
    """Return set of invalid skill tags found in skills: lines of TASKS.md."""
    valid_upper = {v.upper() for v in valid}
    invalid = set()
    for line in tasks_path.read_text().splitlines():
        stripped = line.strip()
        if stripped.lower().startswith("skills:"):
            tags_part = stripped.split(":", 1)[1]
            for tag in tags_part.split(","):
                tag = tag.strip()
                if tag and tag.upper() not in valid_upper:
                    invalid.add(tag)
    return invalid


def _strip_invalid_tags(tasks_path: Path, invalid: set[str]) -> None:
    """Remove invalid skill tags from skills: lines in TASKS.md."""
    invalid_upper = {t.upper() for t in invalid}
    lines = tasks_path.read_text().splitlines()
    out = []
    for line in lines:
        stripped = line.strip()
        if stripped.lower().startswith("skills:"):
            indent = line[:len(line) - len(line.lstrip())]
            tags_part = stripped.split(":", 1)[1]
            kept = [t.strip() for t in tags_part.split(",") if t.strip() and t.strip().upper() not in invalid_upper]
            if kept:
                out.append(f"{indent}skills: {', '.join(kept)}")
            # else: drop the entire skills line
        else:
            out.append(line)
    tasks_path.write_text("\n".join(out) + "\n")
