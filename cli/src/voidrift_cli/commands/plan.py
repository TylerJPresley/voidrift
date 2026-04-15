"""Plan command: Five-stage architecture and task breakdown (REQ-P-1)."""

from __future__ import annotations

# Tools available to plan agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "file",
})

# Per-command action visibility within each domain tool (REQ-TOOL-8).
AGENT_TOOL_ACTIONS: dict[str, list[str]] = {
    "file": ["read", "write", "edit", "list"],
}

import re
from datetime import datetime
from pathlib import Path
from typing import Callable

from ..agent import AgentLoop, build_local_tools
from .. import prompts
from ..skills import find_skill
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, boot_run, check_disk_space
from ..config import get_max_tokens
from .. import ui

from ._plan_pipeline import (
    check_req_coverage as _check_req_coverage,
    dispatch_agent as _dispatch_agent,
    extract_modules as _extract_modules,
    arch_summary as _arch_summary,
    parse_outline_tasks as _parse_outline_tasks,
    format_task_entry as _format_task_entry,
    build_task_files as _build_task_files,
    available_skills as _available_skills,
    available_skills_with_desc as _available_skills_with_desc,
    source_file_listing as _source_file_listing,
    resolve_skill as _resolve_skill,
)


def run_plan(
    model: ModelConfig,
    overwrite: bool = False,
    idea_id: int | None = None,
) -> int:
    """Execute the five-stage plan command (REQ-P-1).

    Stage 1: Produce ARCHITECTURE.md (one agent).
    Stage 2: Produce arch/<module>.md for each module (one agent per module).
    Stage 3: Produce tasks/outline/<module>.md for each module (one agent per module).
    Stage 4: Resolve cross-module dependencies into tasks/outline/deps.yml (skipped for single-module).
    Stage 5: Produce tasks/active/TASK-N.md for each task (one agent per task, fresh skill injection).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    # Idea-scoped planning (REQ-IDEA-5)
    idea_content = ""
    if idea_id is not None:
        from ..manifest import ManifestManager
        mm = ManifestManager(project_dir=d.parent)
        if not mm.exists():
            ui.error(f"No manifest found. Create an idea first with /idea in chat.")
            return 1
        mm.load()
        idea_content = mm.read_idea(idea_id)
        if not idea_content:
            ui.error(f"IDEA-{idea_id} not found in ideas/.")
            return 1
        if "reqs:" not in idea_content.lower():
            ui.error(f"No requirements found for IDEA-{idea_id}. Run 'voidrift gather <model> --idea {idea_id}' first.")
            return 1

    ui.header("VoidRift Plan")

    if overwrite:
        from ..utils import undo_command
        import shutil
        deleted = undo_command("plan")
        for target in [d / "ARCHITECTURE.md", d / "README.md"]:
            if target.exists() and str(target) not in deleted:
                target.unlink()
                deleted.append(str(target))
        for cleanup_dir in [d / "arch", d / "tasks"]:
            if cleanup_dir.is_dir():
                count = sum(1 for _ in cleanup_dir.rglob("*") if _.is_file())
                shutil.rmtree(cleanup_dir)
                deleted.extend([f"({count} files in {cleanup_dir.name}/"])
        if deleted:
            ui.info(f"Cleared {len(deleted)} items from previous plan.")

    log, _run_id = boot_run("plan")
    ui.detail(f"Log: {log}")
    with open(log, "a") as f:
        f.write(f"\n=== Plan run: {datetime.now().isoformat()} ===\n")

    tools, handlers = build_local_tools(cmd="plan")
    requirements = (d / "REQUIREMENTS.md").read_text()
    if idea_content:
        requirements += f"\n\n## Idea Context (IDEA-{idea_id})\n\n{idea_content}"

    skill = find_skill("ARCH-DESIGN") or ""

    # ── Delta analysis (REQ-P-11) — update mode when artifacts exist ─────
    delta_summary = ""
    is_update = (
        not overwrite
        and (d / "ARCHITECTURE.md").exists()
        and (d / "tasks" / "manifest.yml").exists()
    )
    if is_update:
        ui.stage("Delta analysis — scanning source tree...")
        source_files = _source_file_listing(d.parent)
        if source_files:
            existing_arch = (d / "ARCHITECTURE.md").read_text()
            delta_prompt = prompts.load_prompt("plan", "PLAN-DELTA")
            delta_user = prompts.load_prompt("plan", "DELTA-USER").format(
                requirements=requirements,
                architecture=existing_arch,
                source_files=source_files,
            )
            delta_agent = AgentLoop(
                model=model,
                system_prompt=delta_prompt,
                tools=[], tool_handlers={},
                stream=False,
                max_tokens=get_max_tokens(model, "plan.delta"),
                log_path=log,
                show_spinner=False,
            )
            with ui.spinner(ui.random_label(), "delta analysis") as spin:
                delta_agent.on_progress = spin.on_progress
                try:
                    delta_summary = delta_agent.send(delta_user)
                    with open(log, "a") as f:
                        f.write(f"\n[DELTA]\n{delta_summary}\n")
                    ui.success("Delta analysis complete")
                except (RuntimeError, OSError, ValueError) as e:
                    ui.warn(f"Delta analysis failed: {e} — running full plan")
                    delta_summary = ""
        else:
            ui.detail("No source files found — running full plan")

    # ── Stage 1: Architecture ────────────────────────────────────────────
    ui.stage("Stage 1/6: Architecture...")

    arch_template = prompts.load_template("ARCHITECTURE-TEMPLATE")
    arch_prompt = prompts.load_prompt("plan", "PLAN-ARCH").format(
        requirements=requirements,
        arch_template=arch_template,
    )
    # Stage 1 gets no global system context — the artifact table in system.md
    # describes arch/*.md as a Plan output, which causes the model to write them here.
    # Each stage agent only receives context scoped to its job.
    arch_system = "\n\n".join(p for p in [skill, arch_prompt] if p)
    if delta_summary:
        arch_system += f"\n\n## Implementation Delta\n\nThe following delta analysis identifies which requirements are already implemented. Focus architecture updates on unimplemented areas.\n\n{delta_summary}"


    ok = _dispatch_agent(agent_cls=AgentLoop, 
        model=model, tools=tools, handlers=handlers, log=log,
        system_prompt=arch_system,
        user_message=prompts.load_prompt("plan", "ARCH-USER"),
        retry_message=prompts.load_prompt("plan", "ARCH-RETRY"),
        check_fn=lambda: (d / "ARCHITECTURE.md").exists(),
        stage_label="architecture",
        stage_key="plan.architecture",
    )
    if not ok:
        # Recovery: model may write to arch/ARCHITECTURE.md instead of ARCHITECTURE.md
        misplaced = d / "arch" / "ARCHITECTURE.md"
        if misplaced.exists() and not (d / "ARCHITECTURE.md").exists():
            misplaced.rename(d / "ARCHITECTURE.md")
            ui.detail("Recovered ARCHITECTURE.md from arch/ (model used wrong path).")
            ok = True
    if not ok:
        return 1

    # Enforce stage boundary: remove any arch files written prematurely by Stage 1.
    # Local models often ignore "do not write arch files" instructions.
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        premature = list(arch_dir.glob("*.md"))
        if premature:
            for af in premature:
                af.unlink()
            ui.detail(f"Stage 1 wrote {len(premature)} arch file(s) prematurely — removed (Stage 2 will write them).")

    arch_text = (d / "ARCHITECTURE.md").read_text()
    modules = _extract_modules(arch_text, d)
    if not modules:
        ui.error("Plan failed: no module arch references found in ARCHITECTURE.md.")
        return 1

    ui.success(f"ARCHITECTURE.md ({len(modules)} module(s): {', '.join(modules)})")

    # ── Stage 2: Module arch ─────────────────────────────────────────────
    arch_summary = _arch_summary(arch_text)
    ui.stage(f"Stage 2/6: Module arch ({len(modules)} modules)...")
    for i, module in enumerate(modules):

        module_prompt = prompts.load_prompt("plan", "PLAN-MODULE").format(
            module=module,
            architecture=arch_summary,
        )
        module_system = "\n\n".join(p for p in [skill, module_prompt] if p)
        retry_msg = prompts.load_prompt("plan", "MODULE-RETRY").format(module=module)
        arch_file = d / "arch" / f"{module}.md"

        ok = _dispatch_agent(agent_cls=AgentLoop, 
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=module_system,
            user_message=prompts.load_prompt("plan", "MODULE-USER").format(module=module),
            retry_message=retry_msg,
            check_fn=lambda f=arch_file: f.exists(),
            stage_label=module,
            stage_key="plan.module-arch",
        )
        if not ok:
            return 1

    ui.success(f"arch/ — {', '.join(modules)}")

    # ── Stage 3: Task outlines ───────────────────────────────────────────
    (d / "tasks" / "outline").mkdir(parents=True, exist_ok=True)
    id_offset = 1
    ui.stage(f"Stage 3/6: Task outlines ({len(modules)} modules)...")
    for i, module in enumerate(modules):

        module_arch = (d / "arch" / f"{module}.md").read_text()
        outline_prompt = prompts.load_prompt("plan", "PLAN-OUTLINE").format(
            module=module,
            id_offset=id_offset,
            architecture=arch_text,
            module_arch=module_arch,
        )
        outline_system = "\n\n".join(p for p in [skill, outline_prompt] if p)
        if delta_summary:
            outline_system += f"\n\n## Implementation Delta\n\nOnly create tasks for unimplemented requirements. Skip requirements already satisfied.\n\n{delta_summary}"
        retry_msg = prompts.load_prompt("plan", "OUTLINE-RETRY").format(module=module)
        outline_path = d / "tasks" / "outline" / f"{module}.md"

        ok = _dispatch_agent(agent_cls=AgentLoop, 
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=outline_system,
            user_message=prompts.load_prompt("plan", "OUTLINE-USER").format(module=module),
            retry_message=retry_msg,
            check_fn=lambda p=outline_path: p.exists(),
            stage_label=module,
            stage_key="plan.outline",
        )
        if not ok:
            return 1

        _, tasks_in_module = _parse_outline_tasks(outline_path)
        with open(log, "a") as f:
            f.write(f"\n[OUTLINE] {module}: parsed {len(tasks_in_module)} tasks, next id_offset={id_offset + max(len(tasks_in_module), 1)}\n")
        id_offset += max(len(tasks_in_module), 1)

    ui.success(f"tasks/outline/ — {', '.join(modules)}")

    # ── Stage 4: Dependency resolution (multi-module only) ────────────────
    if len(modules) > 1:
        ui.stage("Stage 4/6: Dependency resolution...")

        outline_parts = []
        for module in modules:
            outline_path = d / "tasks" / "outline" / f"{module}.md"
            outline_parts.append(f"### {module}\n\n{outline_path.read_text()}")
        outlines_text = "\n\n".join(outline_parts)

        deps_prompt = prompts.load_prompt("plan", "PLAN-DEPS").format(
            outlines=outlines_text,
        )
        deps_system = "\n\n".join(p for p in [deps_prompt] if p)
        deps_path = d / "tasks" / "outline" / "deps.yml"

        ok = _dispatch_agent(agent_cls=AgentLoop, 
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=deps_system,
            user_message=prompts.load_prompt("plan", "DEPS-USER"),
            retry_message=prompts.load_prompt("plan", "DEPS-RETRY"),
            check_fn=lambda: deps_path.exists(),
            stage_label="dependencies",
            stage_key="plan.deps",
        )
        if not ok:
            return 1

        ui.success("tasks/outline/deps.yml")
    else:
        ui.detail("Stage 4/6: Dependency resolution skipped (single module).")

    # ── Stage 5: Task files ──────────────────────────────────────────────
    skills_with_desc = _available_skills_with_desc()
    valid_skills_str = (
        "\n".join(f"- {name}: {desc}" for name, desc in sorted(skills_with_desc.items()))
        if skills_with_desc else ""
    )

    all_tasks: list[tuple[str, dict]] = []
    for module in modules:
        outline_path = d / "tasks" / "outline" / f"{module}.md"
        _, tasks_list = _parse_outline_tasks(outline_path)
        with open(log, "a") as f:
            f.write(f"\n[OUTLINE] {module}: {len(tasks_list)} tasks, IDs: {[t.get('id') for t in tasks_list]}\n")
            f.write(f"[OUTLINE] {module} raw:\n{outline_path.read_text()}\n")
        for task_entry in tasks_list:
            all_tasks.append((module, task_entry))

    if not all_tasks:
        ui.error("Plan failed: no tasks found in outline files.")
        return 1

    all_ids = [t.get("id", i + 1) for i, (_, t) in enumerate(all_tasks)]
    expected = list(range(min(all_ids), max(all_ids) + 1))
    missing = set(expected) - set(all_ids)
    if missing:
        ui.warn(f"Task ID gap detected: missing {sorted(missing)} from outlines")
        with open(log, "a") as f:
            f.write(f"[OUTLINE] ID gap: expected {expected}, got {all_ids}, missing {sorted(missing)}\n")

    if not all_tasks:
        ui.error("Plan failed: no tasks found in outline files.")
        return 1

    total_tasks = len(all_tasks)
    (d / "tasks" / "active").mkdir(parents=True, exist_ok=True)

    ui.stage(f"Stage 5/6: Task files ({total_tasks} tasks)...")
    for i, (module, task_entry) in enumerate(all_tasks):
        task_id = task_entry.get("id", i + 1)

        module_arch = (d / "arch" / f"{module}.md").read_text()
        outline_path = d / "tasks" / "outline" / f"{module}.md"
        task_outline_text = _format_task_entry(outline_path, task_id)

        task_prompt = prompts.load_prompt("plan", "PLAN-TASK").format(
            task_id=task_id,
            module=module,
            valid_skills=valid_skills_str,
            task_outline=task_outline_text,
            module_arch=module_arch,
        )
        task_system = "\n\n".join(p for p in [task_prompt] if p)
        retry_msg = prompts.load_prompt("plan", "TASK-RETRY").format(task_id=task_id)
        task_file = d / "tasks" / "active" / f"TASK-{task_id}.md"

        ok = _dispatch_agent(agent_cls=AgentLoop, 
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=task_system,
            user_message=prompts.load_prompt("plan", "TASK-USER").format(task_id=task_id),
            retry_message=retry_msg,
            check_fn=lambda f=task_file: f.exists(),
            stage_label=f"TASK-{task_id}",
            stage_key="plan.task",
        )
        if not ok:
            return 1

    # ── Post-processing ──────────────────────────────────────────────────
    task_count = _build_task_files(d, requirements, arch_text, idea_id=idea_id)
    ui.success(f"{task_count} tasks")

    # ── Requirement coverage check (REQ-P-17) ────────────────────────────
    _check_req_coverage(d, requirements)

    # ── Stage 6: README (REQ-P-1) ────────────────────────────────────────
    ui.stage("Stage 6/6: README...")
    readme_template = prompts.load_template("README-TEMPLATE")
    readme_prompt = prompts.load_prompt("plan", "PLAN-README").format(
        readme_template=readme_template,
        requirements=requirements,
        architecture=arch_text,
    )
    readme_file = d / "README.md"
    ok = _dispatch_agent(agent_cls=AgentLoop, 
        model=model, tools=tools, handlers=handlers, log=log,
        system_prompt=readme_prompt,
        user_message=prompts.load_prompt("plan", "README-USER"),
        retry_message=prompts.load_prompt("plan", "README-RETRY"),
        check_fn=lambda: readme_file.exists(),
        stage_label="README",
        stage_key="plan.readme",
    )
    if not ok:
        ui.warn("README generation failed — continuing without README")

    # Clean up outline intermediates
    outline_dir = d / "tasks" / "outline"
    if outline_dir.is_dir():
        for f in outline_dir.glob("*.md"):
            f.unlink()
        deps = outline_dir / "deps.yml"
        if deps.exists():
            deps.unlink()
        try:
            outline_dir.rmdir()
        except OSError:
            pass

    from ..utils import append_state
    files_created = []
    if (d / "ARCHITECTURE.md").exists():
        files_created.append(".voidrift/ARCHITECTURE.md")
    if (d / "README.md").exists():
        files_created.append(".voidrift/README.md")
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        for af in sorted(arch_dir.glob("*.md")):
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
