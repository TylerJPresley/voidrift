"""Phase 1 — Gather: Reverse-engineer requirements from a codebase (REQ-G-1, REQ-G-8)."""

from __future__ import annotations

from pathlib import Path

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, boot_run, check_disk_space,
)
from .. import ui

# Predefined categories (REQ-G-8 stage 1)
CATEGORIES = ("source", "tests", "config", "infrastructure", "documentation", "assets")
_NON_SOURCE = ("tests", "config", "infrastructure", "documentation", "assets")

# Category-specific analysis lenses (REQ-G-8 stage 3 — source analysis)
_ANALYSIS_LENS = {
    "source": (
        "Analyze for functional requirements:\n"
        "- Purpose and business intent (outcomes over mechanisms)\n"
        "- Key components, functions, classes, and their responsibilities\n"
        "- Dependencies and external integrations\n"
        "- Data flows and state management\n"
        "- Error handling patterns\n"
        "- Requirements implied by the code (use EARS notation: WHEN [trigger], THE SYSTEM SHALL [result])"
    ),
    "tests": (
        "Analyze for behavioral expectations and acceptance criteria:\n"
        "- What behavior each test validates\n"
        "- Expected inputs, outputs, and error conditions\n"
        "- Edge cases and boundary conditions\n"
        "- Implicit requirements revealed by assertions"
    ),
    "config": (
        "Analyze for constraints and toolchain requirements:\n"
        "- Build system and dependency constraints\n"
        "- Environment variables and configuration parameters\n"
        "- Version requirements and compatibility constraints\n"
        "- Development workflow requirements"
    ),
    "infrastructure": (
        "Analyze for deployment and operational requirements:\n"
        "- Deployment topology and runtime environment\n"
        "- Resource constraints (CPU, memory, storage)\n"
        "- Networking, ports, and service dependencies\n"
        "- CI/CD pipeline requirements"
    ),
    "documentation": (
        "Analyze for documented design intent and decisions:\n"
        "- Stated purpose and scope\n"
        "- Architectural decisions and rationale\n"
        "- User-facing contracts and API documentation\n"
        "- Known limitations and future plans"
    ),
    "assets": (
        "Analyze for data requirements:\n"
        "- Schema definitions and data models\n"
        "- Migration patterns and versioning\n"
        "- Localization and internationalization needs\n"
        "- Static resource dependencies"
    ),
}


def _make_chunks(text: str, size: int, overlap: int = 200) -> list[str]:
    """Split text into overlapping fixed-size chunks (REQ-G-13)."""
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start : start + size])
        if start + size >= len(text):
            break
        start = start + size - overlap
    return chunks


def _is_truncated_json_error(err: str) -> bool:
    """Return True if the error string indicates a truncated tool call JSON."""
    return "Invalid JSON" in err or "EOF while parsing" in err


def run_gather(
    model: ModelConfig,
    from_path: str,
    overwrite: bool = False,
) -> int:
    """Execute the gather phase — reverse-engineer requirements from a codebase."""
    check_disk_space()
    d = ensure_voidrift_dir()
    target = d / "REQUIREMENTS.md"
    source = Path(from_path)

    return _gather_from(model, target, source, overwrite)


def _gather_from(
    model: ModelConfig,
    target: Path,
    from_path: Path,
    overwrite: bool,
) -> int:
    """Reverse engineering mode — four-stage pipeline (REQ-G-8, REQ-ARCH-7).

    Stages:
      1. Triage — categorize files into source vs context categories
      2. Context Build — one agent per non-source category, direct response
      3. Source Analysis — one agent per source file, context injected, direct response
      4. Final Pass — CLI pre-fetches template, model returns markdown, CLI writes file
    """
    if target.exists() and not overwrite:
        ui.error(f"{target} already exists. Use --overwrite to replace.")
        return 1
    if not from_path.is_dir():
        ui.error(f"{from_path} is not a directory")
        return 1
    if overwrite:
        from ..utils import undo_phase
        deleted = undo_phase("gather")
        if deleted:
            ui.info(f"Removed {len(deleted)} files from previous gather.")

    log, run_id = boot_run("gather")

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod.run_id = run_id
        mcp_mod._boot()
        all_tools, all_handlers = build_mcp_tools(mcp_mod, phase="gather")
    except ImportError:
        from ..tools import LOCAL_TOOLS, LOCAL_HANDLERS
        all_tools = list(LOCAL_TOOLS)
        all_handlers = dict(LOCAL_HANDLERS)
        mcp_mod = None

    from ..config import get_max_input_chars, get_max_tokens as _get_max_tokens
    _input_limit = get_max_input_chars(model.model_type)

    def read_from_source(path: str) -> str:
        full = (from_path / path).resolve()
        if not str(full).startswith(str(from_path.resolve())):
            return f"Access denied: {path} is outside the source directory"
        if not full.exists():
            return f"File not found: {path}"
        return full.read_text(encoding="utf-8", errors="replace")

    all_handlers["read_source_file"] = read_from_source

    def _pick_tools(names: set) -> tuple[list, dict]:
        return (
            [t for t in all_tools if t["function"]["name"] in names],
            {k: v for k, v in all_handlers.items() if k in names},
        )

    extra = (
        {"chat_template_kwargs": {"enable_thinking": False}}
        if model.model_type == "local" else None
    )

    ui.phase("VoidRift Gather (Reverse Engineering)")
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

    _get_prompt = all_handlers.get("get_prompt", lambda *a: "")
    _get_skill = all_handlers.get("get_skill", lambda *a: "")
    _get_template = all_handlers.get("get_template", lambda *a: "")
    analyst_role = _get_skill("ANALYSIS-REQS")

    import json as _json
    import re as _re
    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..config import get_concurrency

    # --- Stage 1: Triage — categorize files ---
    ui.stage("Stage 1: Triaging files...")
    triage_prompt = _get_prompt("gather", "TRIAGE")
    triage = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{triage_prompt}",
        tools=[], tool_handlers={},
    )
    try:
        triage_response = triage.send(f"File tree:\n{file_tree}")
    except (RuntimeError, OSError) as e:
        ui.error(f"Triage failed: {e}")
        return 1

    try:
        triage_data = _json.loads(triage_response.strip())
    except _json.JSONDecodeError:
        m = _re.search(r"\{.*\}", triage_response, _re.DOTALL)
        if m:
            triage_data = _json.loads(m.group())
        else:
            ui.error("Triage did not return valid JSON.")
            with open(log, "a") as f:
                f.write(f"Triage response:\n{triage_response}\n")
            return 1

    # Normalize into categories dict
    categories: dict[str, list[str]] = {}
    for cat in CATEGORIES:
        files = triage_data.get(cat, [])
        if isinstance(files, list):
            categories[cat] = files
        elif isinstance(files, dict):
            categories[cat] = [f for fs in files.values() for f in fs]
        else:
            categories[cat] = []

    # Validation pass — model reviews its own triage output
    all_files = [f for fs in categories.values() for f in fs]
    validation_prompt = _get_prompt("gather", "TRIAGE-VALIDATION")
    validator = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{validation_prompt}",
        tools=[], tool_handlers={},
    )
    try:
        val_response = validator.send(f"Files to review:\n{_json.dumps(all_files)}")
        val_data = _json.loads(val_response.strip())
        if isinstance(val_data, dict):
            val_data = next(iter(val_data.values()), [])
        keep = set(val_data)
        categories = {c: [f for f in fs if f in keep] for c, fs in categories.items()}
    except Exception:
        pass  # validation is best-effort

    file_category: dict[str, str] = {}
    for cat, files in categories.items():
        for f in files:
            file_category[f] = cat

    source_files = categories.get("source", [])
    cat_counts = {c: len(fs) for c, fs in categories.items() if fs}
    ui.info(f"{len(file_category)} files: {', '.join(f'{c}({n})' for c, n in cat_counts.items())}")
    with open(log, "a") as f:
        f.write(f"Triage: {_json.dumps(categories)}\n")

    # --- Stage 2: Context Build — one agent per non-source category (REQ-G-17) ---
    ui.stage("Stage 2: Building context from non-source files...")
    context_summaries: dict[str, str] = {}
    ctx_build_prompt_tpl = _get_prompt("gather", "CONTEXT-BUILD")

    for cat in _NON_SOURCE:
        cat_files = categories.get(cat, [])
        if not cat_files:
            continue
        # Concatenate all files in this category
        parts = []
        total_chars = 0
        for fp in sorted(cat_files):
            text = read_from_source(fp)
            entry = f"### {fp}\n\n{text}"
            if _input_limit and total_chars + len(entry) > _input_limit:
                parts.append(f"### {fp}\n\n[omitted — context limit reached]")
                break
            parts.append(entry)
            total_chars += len(entry)
        content_block = "\n\n---\n\n".join(parts)

        lens = _ANALYSIS_LENS.get(cat, "")
        system = ctx_build_prompt_tpl.format(category=cat, context_lens=lens)
        ctx_agent = AgentLoop(
            model=model, stream=False, extra_body=extra,
            max_tokens=_get_max_tokens(model.model_type, "analysis"),
            log_path=log,
            system_prompt=system,
            tools=[], tool_handlers={},
        )
        try:
            summary = ctx_agent.send(f"Files:\n\n{content_block}")
            context_summaries[cat] = summary
            ui.detail(f"  {cat}: {len(cat_files)} file(s) → context summary ({len(summary)} chars)")
            with open(log, "a") as f:
                f.write(f"Context [{cat}]:\n{summary}\n")
        except (RuntimeError, OSError) as e:
            ui.warn(f"  Context build failed for {cat}: {e}")

    # Build context block to inject into every source analysis agent (REQ-G-17)
    context_block = ""
    if context_summaries:
        ctx_parts = []
        for cat, summary in context_summaries.items():
            ctx_parts.append(f"### {cat.capitalize()}\n\n{summary.strip()}")
        context_block = "## Project Context\n\n" + "\n\n".join(ctx_parts)

    # --- Stage 3: Source Analysis — one agent per source file, direct response ---
    ui.stage(f"Stage 3: Analyzing {len(source_files)} source files...")

    source_tools, source_handlers = _pick_tools({"read_source_file"})
    analysis_prompt_tpl = _get_prompt("gather", "ANALYSIS")
    source_requirements: dict[str, str] = {}

    concurrency = get_concurrency(model.model_type)
    max_workers = len(source_files) if concurrency == 0 else concurrency
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    def _analyze_source(filepath: str) -> tuple[str, float | None, str | None, str]:
        lens = _ANALYSIS_LENS["source"]
        system = analysis_prompt_tpl.format(analysis_lens=lens)
        if context_block:
            system = system + "\n\n" + context_block
        max_tok = _get_max_tokens(model.model_type, "analysis")
        start = _time.time()

        # REQ-G-13: chunk large source files instead of truncating
        if _input_limit:
            full_path = (from_path / filepath).resolve()
            if full_path.exists():
                raw = full_path.read_text(encoding="utf-8", errors="replace")
                if len(raw) > _input_limit:
                    chunks = _make_chunks(raw, _input_limit)
                    with open(log, "a") as _f:
                        _f.write(f"[CHUNKED] {filepath} ({len(raw)} chars → {len(chunks)} chunks)\n")
                    partial: list[str] = []
                    for i, chunk in enumerate(chunks, 1):
                        chunk_agent = AgentLoop(
                            model=model, stream=False, extra_body=extra, max_tokens=max_tok,
                            log_path=log,
                            system_prompt=system,
                            tools=[], tool_handlers={},
                        )
                        try:
                            resp = chunk_agent.send(
                                f"Analyze portion {i}/{len(chunks)} of {filepath}:\n\n{chunk}"
                            )
                            partial.append(resp)
                        except (RuntimeError, OSError):
                            pass
                    if partial:
                        if len(partial) == 1:
                            combined = partial[0]
                        else:
                            consol_agent = AgentLoop(
                                model=model, stream=False, extra_body=extra, max_tokens=max_tok,
                                log_path=log,
                                system_prompt=system,
                                tools=[], tool_handlers={},
                            )
                            parts_text = "\n\n---\n\n".join(
                                f"[Chunk {j+1}/{len(partial)}]\n{p}"
                                for j, p in enumerate(partial)
                            )
                            combined = consol_agent.send(
                                f"Partial analyses of {filepath}:\n\n{parts_text}\n\n"
                                "Write one unified, non-redundant analysis of the whole file."
                            )
                        return filepath, _time.time() - start, None, combined

        # Normal flow: agent calls read_source_file(), returns analysis as direct text
        agent = AgentLoop(
            model=model, stream=False, extra_body=extra, max_tokens=max_tok,
            log_path=log,
            system_prompt=system,
            tools=source_tools, tool_handlers=source_handlers,
        )
        try:
            response = agent.send(f"Analyze: {filepath}")
            return filepath, _time.time() - start, None, response
        except (RuntimeError, OSError) as e:
            return filepath, None, str(e), ""

    if source_files:
        with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
            futures = {pool.submit(_analyze_source, fp): fp for fp in source_files}
            from rich.live import Live
            from rich.spinner import Spinner
            from rich.text import Text
            from rich.console import Group
            from rich.markup import escape as _esc

            completed_lines: list[Text] = []

            with Live(
                Spinner("dots", text=f"  {len(source_files)} source files analyzing...", style="dim"),
                console=ui._con, refresh_per_second=10,
            ) as live:
                for future in as_completed(futures):
                    filepath, elapsed, err, response = future.result()
                    with _lock:
                        _counter["done"] += 1
                        n = _counter["done"]
                    if err:
                        completed_lines.append(Text.from_markup(
                            f"[dim]  {n}/{len(source_files)} {_esc(filepath)}...[/dim]"
                            f" [yellow]⚠ {_esc(err)}[/yellow]"
                        ))
                    else:
                        source_requirements[filepath] = response
                        completed_lines.append(Text.from_markup(
                            f"[dim]  {n}/{len(source_files)} {_esc(filepath)}...[/dim]"
                            f" [green]✓[/green] [dim]{elapsed:.1f}s[/dim]"
                        ))
                    remaining = len(source_files) - n
                    if remaining:
                        live.update(Group(
                            *completed_lines,
                            Spinner("dots",
                                    text=f"  {remaining} file{'s' if remaining != 1 else ''} analyzing...",
                                    style="dim"),
                        ))
                    else:
                        live.update(Group(*completed_lines))
                    with open(log, "a") as f:
                        f.write(f"Analyzed: {filepath}\n")

    # Write operator-readable analysis output — ANALYSIS.md index + per-file detail files
    voidrift_dir = target.parent
    analysis_dir = voidrift_dir / "analysis"
    analysis_dir.mkdir(exist_ok=True)

    for fp in sorted(source_requirements):
        analysis_text = source_requirements[fp]
        if not analysis_text:
            continue
        dest = analysis_dir / (fp + ".md")
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(
            f"# {fp}\n\n**Category:** source\n\n{analysis_text.strip()}\n",
            encoding="utf-8",
        )

    analysis_log = voidrift_dir / "ANALYSIS.md"
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

    # --- Stage 4: Final Pass — CLI owns all persistence, model returns markdown directly ---
    ui.stage("Stage 4: Final pass — consolidating requirements...")
    ui.model_label(model.alias)

    # Pre-fetch template (CLI calls directly, no model tool call)
    requirements_template = _get_template("REQUIREMENTS-TEMPLATE")

    # Build source requirements text
    source_reqs_text = "\n\n---\n\n".join(
        f"### {fp}\n\n{req.strip()}"
        for fp, req in sorted(source_requirements.items())
        if req.strip()
    )

    # Build context text for final pass
    if context_summaries:
        ctx_text = "\n\n".join(
            f"**{cat.capitalize()}:**\n{summary.strip()}"
            for cat, summary in context_summaries.items()
        )
        final_msg = (
            f"Source Requirements:\n\n{source_reqs_text}"
            f"\n\n---\n\nProject Context:\n\n{ctx_text}"
        )
    else:
        final_msg = f"Source Requirements:\n\n{source_reqs_text}"

    # System prompt: consolidation instructions + template
    final_prompt = _get_prompt("gather", "CONSOLIDATION")
    if requirements_template:
        final_system = final_prompt + f"\n\n## Output Template\n\n{requirements_template}"
    else:
        final_system = final_prompt

    try:
        final_agent = AgentLoop(
            model=model, stream=False, extra_body=extra,
            max_tokens=_get_max_tokens(model.model_type, "consolidation"),
            log_path=log,
            system_prompt=final_system,
            tools=[], tool_handlers={},
        )
        final_response = final_agent.send(final_msg)
        with open(log, "a") as f:
            f.write(f"Final pass response ({len(final_response)} chars)\n")
    except (RuntimeError, OSError) as e:
        ui.error(f"Final pass failed: {e}")
        return 1
    except KeyboardInterrupt:
        ui.info("Interrupted.")
        return 1

    # Strip any preamble — find first `#` header
    match = _re.search(r"^#\s+", final_response, _re.MULTILINE)
    final_content = final_response[match.start():] if match else final_response

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
    append_state(
        phase="gather",
        model_alias=model.alias,
        summary=f"Analyzed {total} files ({src_count} source). Wrote REQUIREMENTS.md.",
        files_created=files_created,
        analyzed_files=analyzed,
    )
    ui.done(f"Requirements written to {str(target.relative_to(Path.cwd()))}")
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
