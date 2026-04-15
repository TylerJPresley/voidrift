"""Gather command: Reverse-engineer requirements from a codebase (REQ-G-1, REQ-G-8)."""

from __future__ import annotations

# Tools available to gather agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS: frozenset[str] = frozenset({
    "file",
    "analyze",
})

# Per-command action visibility within each domain tool (REQ-TOOL-8).
AGENT_TOOL_ACTIONS: dict[str, list[str]] = {
    "file": ["read", "list"],
}

import json
import time
from pathlib import Path

from ..skills import find_skill
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, boot_run, check_disk_space,
)
from .. import ui
from ..token_budget import TokenBudget

# Re-export pipeline internals so existing imports (e.g. tests) continue to work.
from ._gather_pipeline import (
    CATEGORIES,
    _NON_SOURCE,
    _ANALYSIS_LENS,
    _make_chunks,
    _analysis_path,
    _load_cached_analysis,
    _write_analysis,
    _run_triage,
    _run_context_build,
    _run_source_analysis,
    _run_consolidation,
)


# ── Context block & preamble helpers ────────────────────────────────────────

def build_context_block(context_summaries: dict[str, str]) -> str:
    """Build a '## Project Context' block from category summaries (REQ-G-17)."""
    if not context_summaries:
        return ""
    parts = [f"### {cat.capitalize()}\n\n{s.strip()}" for cat, s in context_summaries.items()]
    return "## Project Context\n\n" + "\n\n".join(parts)


def strip_preamble(response: str) -> str:
    """Strip text before the first markdown # header."""
    import re
    match = re.search(r"^#\s+", response, re.MULTILINE)
    return response[match.start():] if match else response


def run_gather(
    model: ModelConfig,
    from_path: str | None = None,
    idea_id: int | None = None,
    overwrite: bool = False,
    token_budget: TokenBudget | None = None,
) -> int:
    """Execute the gather command — reverse-engineer requirements (REQ-G-1)."""
    check_disk_space()
    d = ensure_voidrift_dir()
    target = d / "REQUIREMENTS.md"

    if idea_id is not None:
        return _gather_from_idea(model, target, idea_id, d)

    source = Path(from_path)
    try:
        return _gather_from(model, target, source, overwrite, token_budget=token_budget)
    except Exception as e:
        from ..token_budget import BudgetExhaustedError
        if isinstance(e, BudgetExhaustedError):
            ui.warn(f"Token budget exhausted: {e}")
            if token_budget:
                ui.info(f"Token budget: {token_budget.summary()}")
            return 1
        raise


def _gather_from_idea(
    model: ModelConfig,
    target: Path,
    idea_id: int,
    d: Path,
) -> int:
    """Generate requirements from a refined idea (REQ-G-1 --idea mode)."""
    from ..manifest import ManifestManager
    from ..agent import AgentLoop
    from .. import prompts
    from ..skills import find_skill
    from ..config import get_max_tokens

    mm = ManifestManager(project_dir=d.parent)
    if not mm.exists():
        ui.error("No manifest found. Create an idea first with /idea in chat.")
        return 1
    mm.load()

    idea_content = mm.read_idea(idea_id)
    if not idea_content:
        ui.error(f"IDEA-{idea_id} not found in ideas/.")
        return 1

    ui.header("VoidRift Gather — Idea Mode")
    log, run_id = boot_run("gather")
    ui.detail(f"Log: {log}")

    # Snapshot existing requirements for diff
    existing_reqs = target.read_text(encoding="utf-8") if target.exists() else ""

    skill = find_skill("ANALYSIS-REQS") or ""
    system_context = prompts.load_prompt("system", "CONTEXT")
    template = prompts.load_template("REQUIREMENTS-TEMPLATE")

    system = "\n\n".join(p for p in [system_context, skill] if p)
    system += f"\n\nUse this template for requirements format:\n\n{template}"

    user_msg = f"Generate or update requirements based on this idea.\n\n"
    user_msg += f"IDEA:\n\n{idea_content}\n\n"
    if existing_reqs:
        user_msg += f"EXISTING REQUIREMENTS (update, do not replace):\n\n{existing_reqs}"

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=[], tool_handlers={},
        stream=False,
        max_tokens=get_max_tokens(model, "gather.consolidation"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), "gather idea") as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send(user_msg)
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Gather failed: {e}")
            return 1

    final_content = strip_preamble(response)
    target.write_text(final_content, encoding="utf-8")

    # Record affected reqs and diff in idea file (REQ-IDEA-3)
    import re
    new_reqs = set(re.findall(r"REQ-[A-Z]+-\d+", final_content))
    old_reqs = set(re.findall(r"REQ-[A-Z]+-\d+", existing_reqs))
    affected = sorted(new_reqs - old_reqs) if existing_reqs else sorted(new_reqs)

    idea_path = mm.idea_path(idea_id)
    if idea_path.exists():
        idea_text = idea_path.read_text()
        # Append reqs and diff
        idea_text += f"\n\n## Requirements\n\nreqs: {', '.join(affected)}\n"
        if existing_reqs:
            added = new_reqs - old_reqs
            removed = old_reqs - new_reqs
            if added:
                idea_text += f"\nAdded: {', '.join(sorted(added))}"
            if removed:
                idea_text += f"\nRemoved: {', '.join(sorted(removed))}"
        idea_path.write_text(idea_text)

    from ..utils import append_state
    append_state(
        cmd="gather",
        model_alias=model.alias,
        summary=f"Idea mode: IDEA-{idea_id} → {len(affected)} requirements.",
        files_created=[".voidrift/REQUIREMENTS.md"],
    )

    ui.success(f"REQUIREMENTS.md updated — {len(affected)} requirements from IDEA-{idea_id}.")
    return 0


def _gather_from(
    model: ModelConfig,
    target: Path,
    from_path: Path,
    overwrite: bool,
    token_budget: TokenBudget | None = None,
) -> int:
    """Reverse engineering mode — four-stage pipeline (REQ-G-8, REQ-ARCH-7).

    Delegates each stage to a named helper function:
      _run_triage, _run_context_build, _run_source_analysis, _run_consolidation
    """
    existing_requirements = target.read_text() if (target.exists() and not overwrite) else None
    if not from_path.is_dir():
        ui.error(f"{from_path} is not a directory")
        return 1
    if overwrite:
        from ..utils import undo_command
        deleted = undo_command("gather")
        if deleted:
            ui.info(f"Removed {len(deleted)} files from previous gather.")

    log, run_id = boot_run("gather")
    _run_start = time.time()

    from ..error_tracker import ErrorTracker
    errors = ErrorTracker()

    from ..tools.filesystem import WriteContext as _WriteContext
    # WriteContext rooted at the source directory for source reads (REQ-G-18).
    # Provides full pagination, line/byte guards, and sandbox enforcement.
    _source_ctx = _WriteContext(project_dir=from_path, max_read_lines=model.max_read_lines)

    _input_limit = model.max_input_chars

    extra = None

    ui.header("VoidRift Gather (Reverse Engineering)")
    ui.detail(f"Log: {log}")
    ui.detail(f"Source: {from_path}")
    ui.detail(f"Target: {target}")

    try:
        file_tree = _build_file_tree(from_path)
    except RuntimeError as e:
        ui.error(str(e))
        return 1

    with open(log, "a") as f:
        f.write(f"=== Reverse engineering from {from_path} ===\n")

    analyst_role = find_skill("ANALYSIS-REQS") or ""

    # --- Stage 1: Triage ---
    ui.stage("Stage 1: Triaging files...")
    try:
        categories = _run_triage(model, log, analyst_role, file_tree, token_budget, extra)
    except (RuntimeError, OSError) as e:
        ui.error(f"Triage failed: {e}")
        return 1

    file_category: dict[str, str] = {
        f: cat for cat, files in categories.items() for f in files
    }
    source_files = categories.get("source", [])
    cat_counts = {c: len(fs) for c, fs in categories.items() if fs}
    ui.info(f"{len(file_category)} files: {', '.join(f'{c}({n})' for c, n in cat_counts.items())}")

    # Triage coverage check (REQ-G-21)
    input_count = len(file_tree.strip().splitlines())
    categorized_count = len(file_category)
    if categorized_count < input_count:
        ui.warn(f"Triage: {input_count - categorized_count} file(s) not categorized out of {input_count}")

    with open(log, "a") as f:
        f.write(f"Triage: {json.dumps(categories)}\n")

    # --- Stage 2: Context Build ---
    ui.stage("Stage 2: Building context from non-source files...")
    context_summaries = _run_context_build(
        model, categories, _source_ctx.read_source_file, log,
        analyst_role, token_budget, extra, _input_limit, errors,
    )
    context_block = build_context_block(context_summaries)

    # --- Stage 3: Source Analysis ---
    ui.stage(f"Stage 3: Analyzing {len(source_files)} source files...")
    source_requirements = _run_source_analysis(
        model, source_files, from_path, log,
        context_block,
        target, token_budget, extra, model.concurrency, errors,
    )

    # Write analysis index
    output_dir = target.parent
    analysis_dir = output_dir / "analysis"
    analysis_dir.mkdir(exist_ok=True)
    analysis_log = output_dir / "ANALYSIS.md"
    with open(analysis_log, "w", encoding="utf-8") as _af:
        _af.write(f"# Gather Analysis\n\nSource: `{from_path}`\n\n")
        _af.write(f"{len(source_requirements)} source files analyzed.\n\n")
        _af.write("## Source\n\n")
        for fp in sorted(source_requirements):
            _af.write(f"- [{fp}](analysis/{fp}.md)\n")
        _af.write("\n")
        if context_summaries:
            _af.write("## Context Summaries\n\n")
            for cat, summary in context_summaries.items():
                _af.write(f"### {cat.capitalize()}\n\n{summary.strip()}\n\n")

    # --- Stage 4: Consolidation ---
    ui.stage("Stage 4: Consolidating requirements...")
    try:
        final_response = _run_consolidation(
            model, source_requirements, context_summaries,
            existing_requirements, log, token_budget, extra,
        )
    except (RuntimeError, OSError) as e:
        ui.error(f"Consolidation failed: {e}")
        return 1
    except KeyboardInterrupt:
        ui.info("Interrupted.")
        return 1

    final_content = strip_preamble(final_response)
    target.write_text(final_content, encoding="utf-8")

    # Write state entry (REQ-PS-3)
    from ..utils import append_state
    analyzed = [(fp, "source") for fp in sorted(source_requirements)]
    files_created = [str(target.relative_to(Path.cwd()))]
    if analysis_log.exists():
        files_created.append(str(analysis_log.relative_to(Path.cwd())))
    for af in sorted(analysis_dir.rglob("*.md")):
        files_created.append(str(af.relative_to(Path.cwd())))
    total = len(file_category)
    src_count = len(source_files)
    error_info = ""
    if errors.has_errors():
        error_info = f" Errors: {errors.summary_by_category()}"
    append_state(
        cmd="gather",
        model_alias=model.alias,
        summary=f"Analyzed {total} files ({src_count} source). Wrote REQUIREMENTS.md.{error_info}",
        files_created=files_created,
        analyzed_files=analyzed,
    )
    if errors.has_errors():
        ui._con.print(errors.render_summary_table())
        errors.write_jsonl(log)
    _elapsed = ui.elapsed_str(time.time() - _run_start)
    ui.done(f"Requirements written to {str(target.relative_to(Path.cwd()))} ({_elapsed})")
    if analysis_log.exists():
        ui.detail(f"Analysis log: {str(analysis_log.relative_to(Path.cwd()))}")
    return 0


def _build_file_tree(directory: Path, max_files: int = 500) -> str:
    """Build a file tree string, respecting .gitignore and excluding dot-paths."""
    import pathspec

    gitignore = directory / ".gitignore"
    spec = (
        pathspec.PathSpec.from_lines("gitignore", gitignore.read_text().splitlines())
        if gitignore.is_file()
        else pathspec.PathSpec.from_lines("gitignore", [])
    )

    lines = []
    for p in sorted(directory.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(directory)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if spec.match_file(str(rel)):
            continue
        lines.append(str(rel))
    if len(lines) > max_files:
        raise RuntimeError(
            f"Source tree has {len(lines)} files (limit {max_files}). "
            "Triage cannot process this many files. "
            "Point gather at a smaller subdirectory or increase the limit."
        )
    return "\n".join(lines)
