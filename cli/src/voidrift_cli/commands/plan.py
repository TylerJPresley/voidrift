"""Plan command: Five-stage architecture and task breakdown (REQ-P-1)."""

from __future__ import annotations

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


def run_plan(
    model: ModelConfig,
    overwrite: bool = False,
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

    ui.header("VoidRift Plan")

    if overwrite:
        from ..utils import undo_command
        deleted = undo_command("plan")
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

    log, _run_id = boot_run("plan")
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
    # system_context (system.md CONTEXT) is for the chat command — it orients a
    # conversational agent about the full framework. Plan stage agents each have a
    # scoped prompt that tells them exactly what to produce; they don't need it.

    # ── Stage 1: Architecture ────────────────────────────────────────────
    ui.stage("Stage 1/5: Architecture...")

    arch_template = prompts.load_template("ARCHITECTURE-TEMPLATE")
    arch_prompt = prompts.load_prompt("plan", "PLAN-ARCH").format(
        requirements=requirements,
        specs_section=specs_section,
        arch_template=arch_template,
    )
    # Stage 1 gets no global system context — the artifact table in system.md
    # describes arch/*.md as a Plan output, which causes the model to write them here.
    # Each stage agent only receives context scoped to its job.
    arch_system = "\n\n".join(p for p in [skill, arch_prompt] if p)


    ok = _dispatch_agent(
        model=model, tools=tools, handlers=handlers, log=log,
        system_prompt=arch_system,
        user_message=prompts.load_prompt("plan", "ARCH-USER"),
        retry_message=prompts.load_prompt("plan", "ARCH-RETRY"),
        check_fn=lambda: (d / "ARCHITECTURE.md").exists(),
        stage_label="architecture",
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
    ui.stage(f"Stage 2/5: Module arch ({len(modules)} modules)...")
    for i, module in enumerate(modules):

        module_prompt = prompts.load_prompt("plan", "PLAN-MODULE").format(
            module=module,
            architecture=arch_summary,
        )
        module_system = "\n\n".join(p for p in [skill, module_prompt] if p)
        retry_msg = prompts.load_prompt("plan", "MODULE-RETRY").format(module=module)
        arch_file = d / "arch" / f"{module}.md"

        ok = _dispatch_agent(
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=module_system,
            user_message=prompts.load_prompt("plan", "MODULE-USER").format(module=module),
            retry_message=retry_msg,
            check_fn=lambda f=arch_file: f.exists(),
            stage_label=module,
        )
        if not ok:
            return 1

    ui.success(f"arch/ — {', '.join(modules)}")

    # ── Stage 3: Task outlines ───────────────────────────────────────────
    (d / "tasks" / "outline").mkdir(parents=True, exist_ok=True)
    id_offset = 1
    ui.stage(f"Stage 3/5: Task outlines ({len(modules)} modules)...")
    for i, module in enumerate(modules):

        module_arch = (d / "arch" / f"{module}.md").read_text()
        outline_prompt = prompts.load_prompt("plan", "PLAN-OUTLINE").format(
            module=module,
            id_offset=id_offset,
            architecture=arch_text,
            module_arch=module_arch,
        )
        outline_system = "\n\n".join(p for p in [skill, outline_prompt] if p)
        retry_msg = prompts.load_prompt("plan", "OUTLINE-RETRY").format(module=module)
        outline_path = d / "tasks" / "outline" / f"{module}.md"

        ok = _dispatch_agent(
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=outline_system,
            user_message=prompts.load_prompt("plan", "OUTLINE-USER").format(module=module),
            retry_message=retry_msg,
            check_fn=lambda p=outline_path: p.exists(),
            stage_label=module,
        )
        if not ok:
            return 1

        _, tasks_in_module = _parse_outline_tasks(outline_path)
        id_offset += max(len(tasks_in_module), 1)

    ui.success(f"tasks/outline/ — {', '.join(modules)}")

    # ── Stage 4: Dependency resolution (multi-module only) ────────────────
    if len(modules) > 1:
        ui.stage("Stage 4/5: Dependency resolution...")

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

        ok = _dispatch_agent(
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=deps_system,
            user_message=prompts.load_prompt("plan", "DEPS-USER"),
            retry_message=prompts.load_prompt("plan", "DEPS-RETRY"),
            check_fn=lambda: deps_path.exists(),
            stage_label="dependencies",
        )
        if not ok:
            return 1

        ui.success("tasks/outline/deps.yml")
    else:
        ui.detail("Stage 4/5: Dependency resolution skipped (single module).")

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
        for task_entry in tasks_list:
            all_tasks.append((module, task_entry))

    if not all_tasks:
        ui.error("Plan failed: no tasks found in outline files.")
        return 1

    total_tasks = len(all_tasks)
    (d / "tasks" / "active").mkdir(parents=True, exist_ok=True)

    ui.stage(f"Stage 5/5: Task files ({total_tasks} tasks)...")
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

        ok = _dispatch_agent(
            model=model, tools=tools, handlers=handlers, log=log,
            system_prompt=task_system,
            user_message=prompts.load_prompt("plan", "TASK-USER").format(task_id=task_id),
            retry_message=retry_msg,
            check_fn=lambda f=task_file: f.exists(),
            stage_label=f"TASK-{task_id}",
        )
        if not ok:
            return 1

    # ── Post-processing ──────────────────────────────────────────────────
    task_count = _build_task_files(d, requirements, arch_text)
    ui.success(f"{task_count} tasks")

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


def _dispatch_agent(
    model: ModelConfig,
    tools: list,
    handlers: dict,
    log: Path,
    system_prompt: str,
    user_message: str,
    retry_message: str | None,
    check_fn: Callable[[], bool],
    stage_label: str,
) -> bool:
    """Dispatch one agent, verify artifact, retry once on failure. Returns True on success."""
    agent = AgentLoop(
        model=model,
        system_prompt=system_prompt,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(model, "plan"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), stage_label) as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send(user_message)
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"{stage_label} failed: {e}")
            return False

    if check_fn():
        return True

    if retry_message is None:
        ui.error(f"Plan failed: {stage_label} produced no output.")
        return False

    ui.warn(f"{stage_label} — retrying...")
    with ui.spinner("Retrying...", f"{stage_label} retry") as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send(retry_message)
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"{stage_label} retry failed: {e}")
            return False

    if not check_fn():
        ui.error(f"Plan failed: {stage_label} still produced no output after retry.")
        return False

    return True


def _extract_modules(arch_text: str, d: Path) -> list[str]:
    """Extract module names from ARCHITECTURE.md YAML frontmatter.

    Falls back to scanning the arch/ directory for pre-existing files (update mode).
    """
    import yaml

    if arch_text.startswith("---"):
        try:
            end = arch_text.index("---", 3)
            fm = yaml.safe_load(arch_text[3:end]) or {}
            modules = fm.get("modules", [])
            if modules:
                return [str(m).lower() for m in modules]
        except (ValueError, yaml.YAMLError):
            pass

    # Fallback: scan arch/ directory (update mode where files already exist)
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        return [p.stem for p in sorted(arch_dir.glob("*.md"))]

    return []


def _arch_summary(arch_text: str, max_chars: int = 4000) -> str:
    """Return a compact architecture summary for Stage 2 context.

    Keeps the YAML frontmatter (modules, startup_command) and the body up to
    max_chars. The full 20KB+ arc42 document is unnecessary for a module
    architect — the component list and API contracts are what matter.
    """
    if len(arch_text) <= max_chars:
        return arch_text

    # Find the end of the frontmatter so we always include it
    fm_end = 0
    if arch_text.startswith("---"):
        try:
            fm_end = arch_text.index("---", 3) + 3
        except ValueError:
            pass

    # Take frontmatter + as much body as fits
    body_budget = max_chars - fm_end
    if body_budget <= 0:
        return arch_text[:max_chars]

    return arch_text[:fm_end] + arch_text[fm_end:fm_end + body_budget] + "\n\n[architecture continues...]"


def _parse_outline_tasks(outline_path: Path) -> tuple[str, list[dict]]:
    """Parse module name and task list from a tasks/outline/<module>.md file."""
    import yaml
    content = outline_path.read_text()
    if not content.startswith("---"):
        return outline_path.stem, []
    try:
        end = content.index("---", 3)
        fm = yaml.safe_load(content[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return outline_path.stem, []
    return fm.get("module", outline_path.stem), fm.get("tasks", [])


def _format_task_entry(outline_path: Path, task_id: int) -> str:
    """Extract a single task's outline entry as text for PLAN-TASK context."""
    import yaml
    content = outline_path.read_text()
    if not content.startswith("---"):
        return f"id: {task_id}"
    try:
        end = content.index("---", 3)
        fm = yaml.safe_load(content[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return f"id: {task_id}"

    tasks = fm.get("tasks", [])
    entry = next((t for t in tasks if t.get("id") == task_id), {})

    lines = [
        f"id: {entry.get('id', task_id)}",
        f"title: {entry.get('title', '')}",
    ]
    files = entry.get("files", [])
    if files:
        lines.append("files:")
        for f in files:
            lines.append(f"  - {f}")
    lines.append(f"depends: {entry.get('depends', [])}")

    # Extract description from body under ## Task N: heading
    body = content[end + 3:]
    match = re.search(
        rf"(?:^|\n)(## Task {task_id}[:\s].*?)(?=\n## Task \d+|\Z)",
        body,
        re.DOTALL,
    )
    if match:
        lines.append("")
        lines.append(match.group(1).strip())

    return "\n".join(lines)


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

        # Validate skill tags (REQ-P-9)
        valid = _available_skills()
        if valid:
            skills = fm.get("skills", [])
            invalid = [s for s in skills if s not in valid]
            if invalid:
                resolved = [s for s in skills if s in valid]
                for bad in invalid:
                    match = _resolve_skill(bad, valid)
                    if match:
                        resolved.append(match)
                        ui.info(f"TASK-{tid}: resolved skill '{bad}' → '{match}'")
                    else:
                        ui.warn(f"TASK-{tid}: stripped unknown skill '{bad}' (no match)")
                fm["skills"] = resolved
                fm_str = yaml.dump(fm, default_flow_style=False).strip()
                body = content[end + 3:].lstrip("\n")
                task_file.write_text(f"---\n{fm_str}\n---\n{body}")

        count += 1

    mm.save()
    return count


def _available_skills() -> set[str]:
    """Return set of valid skill names from all layers."""
    return set(_available_skills_with_desc().keys())


def _available_skills_with_desc() -> dict[str, str]:
    """Return dict of skill name → description from all layers (first match wins)."""
    from ..skills import _skill_dirs, _first_line
    skills: dict[str, str] = {}
    for skills_dir in _skill_dirs(Path.cwd()):
        if not skills_dir.is_dir():
            continue
        for p in skills_dir.glob("*.md"):
            name = p.stem.upper()
            if name not in skills:
                skills[name] = _first_line(p)
    return skills


def _resolve_skill(invalid: str, valid: set[str]) -> str | None:
    """Return the best-matching valid skill by word overlap, or None (REQ-P-9).

    Splits both names on hyphens, counts shared words. The valid skill with the
    most overlap wins. Returns None if no valid skill shares any word.
    """
    invalid_words = set(invalid.upper().split("-"))
    best: str | None = None
    best_count = 0
    for candidate in valid:
        shared = len(invalid_words & set(candidate.split("-")))
        if shared > best_count:
            best_count = shared
            best = candidate
    return best if best_count > 0 else None
