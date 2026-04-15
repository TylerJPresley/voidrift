"""Slash command handlers for the chat TUI (REQ-U-2b).

Each handler follows the contract: fn(args, mc, state, prompt_fn, log).
wrap_command() provides the lifecycle harness (busy flag, mode, error catch).
"""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path


def wrap_command(fn, args, mc, state, prompt_fn, log):
    """Run a slash command handler in a background thread.

    Manages state.busy, state.mode, and error display. Reusable by all
    slash command handlers (/gather, /plan, /develop, /verify, /deploy).
    """
    cmd_name = fn.__name__.replace("handle_", "")
    state.busy = True
    state.mode = f"/{cmd_name}"
    state._refresh()

    def _bg():
        try:
            fn(args, mc, state, prompt_fn, log)
        except Exception as e:
            state.add_system(f"Error: {e}")
        finally:
            state.busy = False
            state.mode = "/chat"
            state._refresh()

    threading.Thread(target=_bg, daemon=True).start()


def handle_gather(args, mc, state, prompt_fn, log):
    """Run the gather pipeline interactively (REQ-U-2b)."""
    from ..skills import find_skill
    from ..utils import ensure_voidrift_dir, boot_run, append_state
    from ..error_tracker import ErrorTracker
    from ..tools.filesystem import WriteContext
    from .gather import (
        _build_file_tree, build_context_block, strip_preamble,
        _assign_uncategorized, CATEGORIES,
    )
    from ._gather_pipeline import (
        _run_triage, _run_context_build, _run_source_analysis, _run_consolidation,
    )

    from_path = Path(args) if args else Path.cwd()
    if not from_path.is_dir():
        state.add_system(f"Error: {from_path} is not a directory.")
        return

    d = ensure_voidrift_dir()
    target = d / "REQUIREMENTS.md"
    existing = target.read_text() if target.exists() else None
    glog, run_id = boot_run("gather")
    _start = time.time()
    errors = ErrorTracker()
    source_ctx = WriteContext(project_dir=from_path, max_read_lines=mc.max_read_lines)
    analyst_role = find_skill("ANALYSIS-REQS") or ""

    state.add_system(f"Gathering from {from_path}")

    # Build file tree
    try:
        file_tree = _build_file_tree(from_path)
    except RuntimeError as e:
        state.add_system(f"Error: {e}")
        return

    # Stage 1: Triage
    state.add_system("Stage 1: Triaging files...")
    categories = _run_triage(mc, glog, analyst_role, file_tree, None, None)

    file_category = {f: cat for cat, files in categories.items() for f in files}
    source_files = categories.get("source", [])
    cat_counts = {c: len(fs) for c, fs in categories.items() if fs}
    state.add_system(f"{len(file_category)} files: {', '.join(f'{c}({n})' for c, n in cat_counts.items())}")

    # File listing (REQ-G-23)
    all_input = set(file_tree.strip().splitlines())
    uncategorized = sorted(all_input - set(file_category))
    for cat in CATEGORIES:
        files = categories.get(cat, [])
        if files:
            state.add_system(f"  {cat}:")
            for fp in sorted(files):
                state.add_system(f"    {fp}")
    if uncategorized:
        state.add_system("  uncategorized:")
        for fp in uncategorized:
            state.add_system(f"    {fp}")
        _assign_uncategorized(uncategorized, categories, file_category, prompt_fn)
        source_files = categories.get("source", [])

    # Coverage check
    if len(file_category) < len(all_input):
        state.add_system(f"⚠ {len(all_input) - len(file_category)} file(s) not categorized")

    # Stage 2: Context Build
    state.add_system("Stage 2: Building context...")
    context_summaries = _run_context_build(
        mc, categories, source_ctx.read_source_file, glog,
        analyst_role, None, None, mc.max_input_chars, errors,
    )
    context_block = build_context_block(context_summaries)

    # Stage 3: Source Analysis
    state.add_system(f"Stage 3: Analyzing {len(source_files)} source files...")
    source_requirements = _run_source_analysis(
        mc, source_files, from_path, glog,
        context_block, target, None, None, mc.concurrency, errors,
    )

    # Write analysis index
    analysis_dir = d / "analysis"
    analysis_dir.mkdir(exist_ok=True)
    analysis_log = d / "ANALYSIS.md"
    with open(analysis_log, "w", encoding="utf-8") as af:
        af.write(f"# Gather Analysis\n\nSource: `{from_path}`\n\n")
        af.write(f"{len(source_requirements)} source files analyzed.\n\n")
        af.write("## Source\n\n")
        for fp in sorted(source_requirements):
            af.write(f"- [{fp}](analysis/{fp}.md)\n")

    # Stage 4: Consolidation
    state.add_system("Stage 4: Consolidating requirements...")
    final_response = _run_consolidation(
        mc, source_requirements, context_summaries, existing, glog, None, None,
    )
    target.write_text(strip_preamble(final_response), encoding="utf-8")

    # State entry
    append_state(
        cmd="gather", model_alias=mc.alias,
        summary=f"Analyzed {len(file_category)} files ({len(source_files)} source). Wrote REQUIREMENTS.md.",
        files_created=[".voidrift/REQUIREMENTS.md"],
    )

    elapsed = time.time() - _start
    m, s = divmod(int(elapsed), 60)
    state.add_system(f"✓ Requirements written to .voidrift/REQUIREMENTS.md ({m}m {s}s)")


def handle_plan(args, mc, state, prompt_fn, log):
    """Run the plan pipeline interactively (REQ-U-2c)."""
    import shutil
    from ..agent import AgentLoop, build_local_tools
    from ..skills import find_skill
    from ..utils import ensure_voidrift_dir, boot_run, append_state
    from ..config import get_max_tokens
    from .. import prompts
    from ._plan_pipeline import (
        dispatch_agent, extract_modules, arch_summary,
        parse_outline_tasks, format_task_entry, build_task_files,
        check_req_coverage, available_skills_with_desc, source_file_listing,
    )

    d = ensure_voidrift_dir()
    if not (d / "REQUIREMENTS.md").exists():
        state.add_system("Error: REQUIREMENTS.md not found. Run /gather first.")
        return

    # Detect existing artifacts → ask overwrite or update
    overwrite = False
    is_update = (d / "ARCHITECTURE.md").exists() and (d / "tasks" / "manifest.yml").exists()
    if is_update:
        choice = prompt_fn("plan_overwrite", ["overwrite", "update"])
        overwrite = choice == "overwrite"

    if overwrite:
        from ..utils import undo_command
        deleted = undo_command("plan")
        for t in [d / "ARCHITECTURE.md", d / "README.md"]:
            if t.exists():
                t.unlink()
        for cd in [d / "arch", d / "tasks"]:
            if cd.is_dir():
                shutil.rmtree(cd)
        state.add_system("Cleared previous plan artifacts.")

    plog, _run_id = boot_run("plan")
    tools, handlers = build_local_tools(cmd="plan")
    requirements = (d / "REQUIREMENTS.md").read_text()
    skill = find_skill("ARCH-DESIGN") or ""

    # Delta analysis (update mode)
    delta_summary = ""
    if is_update and not overwrite:
        state.add_system("Delta analysis — scanning source tree...")
        src_listing = source_file_listing(d.parent)
        if src_listing:
            existing_arch = (d / "ARCHITECTURE.md").read_text()
            delta_agent = AgentLoop(
                model=mc, system_prompt=prompts.load_prompt("plan", "PLAN-DELTA"),
                tools=[], tool_handlers={}, stream=False,
                max_tokens=get_max_tokens(mc, "plan.delta"), log_path=plog, show_spinner=False,
            )
            try:
                delta_summary = delta_agent.send(
                    prompts.load_prompt("plan", "DELTA-USER").format(
                        requirements=requirements, architecture=existing_arch, source_files=src_listing,
                    )
                )
                state.add_system("Delta analysis complete.")
            except Exception as e:
                state.add_system(f"Delta analysis failed: {e} — running full plan.")

    # Stage 1: Architecture
    state.add_system("Stage 1/6: Architecture...")
    arch_template = prompts.load_template("ARCHITECTURE-TEMPLATE")
    arch_sys = "\n\n".join(p for p in [skill, prompts.load_prompt("plan", "PLAN-ARCH").format(
        requirements=requirements, arch_template=arch_template)] if p)
    if delta_summary:
        arch_sys += f"\n\n## Implementation Delta\n\n{delta_summary}"

    ok = dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
        system_prompt=arch_sys, user_message=prompts.load_prompt("plan", "ARCH-USER"),
        retry_message=prompts.load_prompt("plan", "ARCH-RETRY"),
        check_fn=lambda: (d / "ARCHITECTURE.md").exists(),
        stage_label="architecture", stage_key="plan.architecture")
    if not ok:
        # Recovery: model may write to arch/ARCHITECTURE.md
        misplaced = d / "arch" / "ARCHITECTURE.md"
        if misplaced.exists() and not (d / "ARCHITECTURE.md").exists():
            misplaced.rename(d / "ARCHITECTURE.md")
            ok = True
    if not ok:
        state.add_system("Error: Stage 1 failed — ARCHITECTURE.md not produced.")
        return

    # Clean premature arch files
    arch_dir = d / "arch"
    if arch_dir.is_dir():
        for af in arch_dir.glob("*.md"):
            af.unlink()

    arch_text = (d / "ARCHITECTURE.md").read_text()
    modules = extract_modules(arch_text, d)
    if not modules:
        state.add_system("Error: No modules found in ARCHITECTURE.md.")
        return
    state.add_system(f"✓ ARCHITECTURE.md ({len(modules)} modules: {', '.join(modules)})")

    # Stage 2: Module arch
    state.add_system(f"Stage 2/6: Module arch ({len(modules)} modules)...")
    a_summary = arch_summary(arch_text)
    for module in modules:
        mod_sys = "\n\n".join(p for p in [skill, prompts.load_prompt("plan", "PLAN-MODULE").format(
            module=module, architecture=a_summary)] if p)
        ok = dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
            system_prompt=mod_sys,
            user_message=prompts.load_prompt("plan", "MODULE-USER").format(module=module),
            retry_message=prompts.load_prompt("plan", "MODULE-RETRY").format(module=module),
            check_fn=lambda f=d / "arch" / f"{module}.md": f.exists(),
            stage_label=module, stage_key="plan.module-arch")
        if not ok:
            state.add_system(f"Error: Stage 2 failed for module {module}.")
            return
    state.add_system(f"✓ arch/ — {', '.join(modules)}")

    # Stage 3: Task outlines
    (d / "tasks" / "outline").mkdir(parents=True, exist_ok=True)
    id_offset = 1
    state.add_system(f"Stage 3/6: Task outlines ({len(modules)} modules)...")
    for module in modules:
        module_arch = (d / "arch" / f"{module}.md").read_text()
        outline_sys = "\n\n".join(p for p in [skill, prompts.load_prompt("plan", "PLAN-OUTLINE").format(
            module=module, id_offset=id_offset, architecture=arch_text, module_arch=module_arch)] if p)
        if delta_summary:
            outline_sys += f"\n\n## Implementation Delta\n\n{delta_summary}"
        outline_path = d / "tasks" / "outline" / f"{module}.md"
        ok = dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
            system_prompt=outline_sys,
            user_message=prompts.load_prompt("plan", "OUTLINE-USER").format(module=module),
            retry_message=prompts.load_prompt("plan", "OUTLINE-RETRY").format(module=module),
            check_fn=lambda p=outline_path: p.exists(),
            stage_label=module, stage_key="plan.outline")
        if not ok:
            state.add_system(f"Error: Stage 3 failed for module {module}.")
            return
        _, tasks_in_mod = parse_outline_tasks(outline_path)
        id_offset += max(len(tasks_in_mod), 1)
    state.add_system("✓ Task outlines complete")

    # Stage 4: Dependency resolution (multi-module only)
    if len(modules) > 1:
        state.add_system("Stage 4/6: Dependency resolution...")
        outlines_text = "\n\n".join(
            f"### {m}\n\n{(d / 'tasks' / 'outline' / f'{m}.md').read_text()}" for m in modules
        )
        deps_path = d / "tasks" / "outline" / "deps.yml"
        ok = dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
            system_prompt=prompts.load_prompt("plan", "PLAN-DEPS").format(outlines=outlines_text),
            user_message=prompts.load_prompt("plan", "DEPS-USER"),
            retry_message=prompts.load_prompt("plan", "DEPS-RETRY"),
            check_fn=lambda: deps_path.exists(),
            stage_label="dependencies", stage_key="plan.deps")
        if not ok:
            state.add_system("Error: Stage 4 failed.")
            return
        state.add_system("✓ deps.yml")
    else:
        state.add_system("Stage 4/6: Skipped (single module)")

    # Stage 5: Task files
    skills_desc = available_skills_with_desc()
    valid_skills_str = "\n".join(f"- {n}: {d}" for n, d in sorted(skills_desc.items())) if skills_desc else ""
    all_tasks = []
    for module in modules:
        _, tasks_list = parse_outline_tasks(d / "tasks" / "outline" / f"{module}.md")
        for t in tasks_list:
            all_tasks.append((module, t))

    if not all_tasks:
        state.add_system("Error: No tasks found in outlines.")
        return

    (d / "tasks" / "active").mkdir(parents=True, exist_ok=True)
    state.add_system(f"Stage 5/6: Task files ({len(all_tasks)} tasks)...")
    for i, (module, task_entry) in enumerate(all_tasks):
        task_id = task_entry.get("id", i + 1)
        module_arch = (d / "arch" / f"{module}.md").read_text()
        task_outline_text = format_task_entry(d / "tasks" / "outline" / f"{module}.md", task_id)
        task_sys = prompts.load_prompt("plan", "PLAN-TASK").format(
            task_id=task_id, module=module, valid_skills=valid_skills_str,
            task_outline=task_outline_text, module_arch=module_arch)
        task_file = d / "tasks" / "active" / f"TASK-{task_id}.md"
        ok = dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
            system_prompt=task_sys,
            user_message=prompts.load_prompt("plan", "TASK-USER").format(task_id=task_id),
            retry_message=prompts.load_prompt("plan", "TASK-RETRY").format(task_id=task_id),
            check_fn=lambda f=task_file: f.exists(),
            stage_label=f"TASK-{task_id}", stage_key="plan.task")
        if not ok:
            state.add_system(f"Error: Stage 5 failed for TASK-{task_id}.")
            return

    # Post-processing
    task_count = build_task_files(d, requirements, arch_text)
    check_req_coverage(d, requirements)

    # Stage 6: README
    state.add_system("Stage 6/6: README...")
    readme_sys = prompts.load_prompt("plan", "PLAN-README").format(
        readme_template=prompts.load_template("README-TEMPLATE"),
        requirements=requirements, architecture=arch_text)
    readme_file = d / "README.md"
    dispatch_agent(agent_cls=AgentLoop, model=mc, tools=tools, handlers=handlers, log=plog,
        system_prompt=readme_sys,
        user_message=prompts.load_prompt("plan", "README-USER"),
        retry_message=prompts.load_prompt("plan", "README-RETRY"),
        check_fn=lambda: readme_file.exists(),
        stage_label="README", stage_key="plan.readme")

    # Cleanup outlines
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

    append_state(cmd="plan", model_alias=mc.alias,
        summary=f"Wrote ARCHITECTURE.md, {task_count} tasks, manifest.yml.",
        files_created=[".voidrift/ARCHITECTURE.md", ".voidrift/tasks/manifest.yml"])

    state.add_system(f"✓ Plan complete — {task_count} tasks across {len(modules)} module(s)")
