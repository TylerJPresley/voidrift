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
    overwrite: bool = False,
) -> int:
    """Execute the two-stage plan command (REQ-P-1).

    Stage 1: Produce ARCHITECTURE.md and arch/<module>.md files.
    Stage 2: Produce task files in tasks/active/ using Stage 1 architecture as input.
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
        for target in [d / "ARCHITECTURE.md"]:
            if target.exists() and str(target) not in deleted:
                target.unlink()
                deleted.append(str(target))
        for cleanup_dir in [d / "arch", d / "tasks" / "active"]:
            if cleanup_dir.is_dir():
                for af in cleanup_dir.glob("*.md"):
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
        max_tokens=get_max_tokens(model, "plan"),
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

    arch_files_list = sorted((d / "arch").glob("*.md")) if (d / "arch").is_dir() else []
    arch_names = ", ".join(f"arch/{af.name}" for af in arch_files_list)
    if arch_names:
        ui.success(f"ARCHITECTURE.md + {arch_names}")
    else:
        ui.success("ARCHITECTURE.md")

    # ── Stage 2: Tasks ──────────────────────────────────────────────────
    ui.stage("Stage 2/2: Task breakdown...")

    architecture = (d / "ARCHITECTURE.md").read_text()
    arch_files_parts = []
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        for af in sorted(arch_dir.glob("*.md")):
            arch_files_parts.append(f"- `arch/{af.name}`")
    arch_files_section = "\n".join(arch_files_parts) if arch_files_parts else "(none)"

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
        max_tokens=get_max_tokens(model, "plan"),
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

    active_dir = d / "tasks" / "active"
    active_dir.mkdir(parents=True, exist_ok=True)
    has_tasks = bool(list(active_dir.glob("TASK-*.md")))

    if not has_tasks:
        ui.warn("No task files written — retrying Stage 2...")
        with ui.spinner("Retrying...", "plan stage 2 retry") as spin:
            tasks_agent.on_progress = spin.on_progress
            try:
                response = tasks_agent.send(prompts.load_prompt("plan", "TASKS-RETRY"))
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Stage 2 retry failed: {e}")
                return 1

        has_tasks = bool(list(active_dir.glob("TASK-*.md")))
        if not has_tasks:
            ui.error("Plan failed: no task files written after retry.")
            return 1

    # ── Post-processing ─────────────────────────────────────────────────
    # Build manifest from task files (REQ-TM-1, REQ-TM-4)
    task_count = _build_task_files(d, requirements, architecture)
    ui.success(f"{task_count} tasks")

    from ..utils import append_state
    files_created = []
    if (d / "ARCHITECTURE.md").exists():
        files_created.append(".voidrift/ARCHITECTURE.md")
    for af in sorted((d / "arch").glob("*.md")) if (d / "arch").is_dir() else []:
        files_created.append(f".voidrift/arch/{af.name}")
    files_created.append(".voidrift/tasks/manifest.yml")
    append_state(
        cmd="plan",
        model_alias=model.alias,
        summary=f"Wrote ARCHITECTURE.md, {task_count} tasks, manifest.yml.",
        files_created=files_created,
    )

    ui.done("Plan complete.")
    return 0


def _build_task_files(d: Path, requirements: str, architecture: str) -> int:
    """Read task files written by the model and build manifest (REQ-TM-1, REQ-TM-4).

    Returns the number of tasks registered.
    """
    import yaml
    from ..manifest import ManifestManager

    mm = ManifestManager(project_dir=d.parent)
    mm.ensure_dirs()
    mm._data = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1, "next_bug_id": 1}

    active = mm._active_dir
    count = 0
    for task_file in sorted(active.glob("TASK-*.md")):
        content = task_file.read_text()
        if not content.startswith("---"):
            continue
        try:
            end = content.index("---", 3)
            fm = yaml.safe_load(content[3:end]) or {}
        except (ValueError, yaml.YAMLError):
            continue

        tid = fm.get("id")
        module = fm.get("module", "default")
        depends = fm.get("depends", [])
        if tid is None:
            continue

        mm.add_task(int(tid), module, depends=depends or None)

        # Validate skill tags
        valid = _available_skills()
        if valid:
            skills = fm.get("skills", [])
            invalid = [s for s in skills if s not in valid]
            if invalid:
                fm["skills"] = [s for s in skills if s in valid]
                fm_str = yaml.dump(fm, default_flow_style=False).strip()
                body = content[end + 3:].lstrip("\n")
                task_file.write_text(f"---\n{fm_str}\n---\n{body}")
                ui.warn(f"TASK-{tid}: stripped invalid skills: {', '.join(invalid)}")

        count += 1

    mm.save()
    return count


def _available_skills() -> set[str]:
    """Return set of valid skill names from all layers."""
    from ..skills import _skill_dirs
    names: set[str] = set()
    for skills_dir in _skill_dirs(Path.cwd()):
        if skills_dir.is_dir():
            for p in skills_dir.glob("*.md"):
                names.add(p.stem.upper())
    return names



