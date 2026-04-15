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
