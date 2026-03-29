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

# Category-specific analysis lenses (REQ-G-8 stage 2)
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
    """Return True if the error string indicates a truncated tool call JSON (REQ-G-15)."""
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
    """Reverse engineering mode — three-stage pipeline (REQ-G-8, REQ-ARCH-7)."""
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

    from ..config import get_max_input_chars
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

    # Load methodology for triage/consolidation only — analysis/synthesis use lens-only (REQ-G-8)
    _get_prompt = all_handlers.get("get_prompt", lambda *a: "")
    _get_skill = all_handlers.get("get_skill", lambda *a: "")
    analyst_role = _get_skill("ANALYSIS-REQS")  # used by triage and consolidation only

    import json as _json

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
        import re
        m = re.search(r"\{.*\}", triage_response, re.DOTALL)
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
            # Flatten if model returned sub-groups
            categories[cat] = [f for fs in files.values() for f in fs]
        else:
            categories[cat] = []

    # --- Validation pass — model reviews its own triage output ---
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

    # Build file-to-category mapping for analysis
    file_category: dict[str, str] = {}
    for cat, files in categories.items():
        for f in files:
            file_category[f] = cat

    all_files = list(file_category.keys())
    cat_counts = {c: len(fs) for c, fs in categories.items() if fs}
    ui.info(f"{len(all_files)} files: {', '.join(f'{c}({n})' for c, n in cat_counts.items())}")
    with open(log, "a") as f:
        f.write(f"Triage: {_json.dumps(categories)}\n")

    # --- Stage 2: Analysis — one agent per file, category-aware ---
    ui.stage("Stage 2: Analyzing files...")
    analysis_tools, analysis_handlers = _pick_tools(
        {"read_source_file", "store_file_analysis"}
    )

    analysis_prompt_tpl = _get_prompt("gather", "ANALYSIS")

    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..config import get_concurrency

    concurrency = get_concurrency(model.model_type)
    max_workers = len(all_files) if concurrency == 0 else concurrency
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    from ..config import get_max_tokens as _get_max_tokens

    def _analyze_file(filepath: str) -> tuple[str, float | None, str | None]:
        cat = file_category.get(filepath, "source")
        lens = _ANALYSIS_LENS.get(cat, _ANALYSIS_LENS["source"])
        # Lens-only system prompt — no ANALYSIS-REQS skill (REQ-G-8)
        system = analysis_prompt_tpl.format(category=cat, analysis_lens=lens)
        max_tok = _get_max_tokens(model.model_type, "analysis")
        start = _time.time()

        # REQ-G-13: chunk large files instead of truncating
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
                        store_fn = analysis_handlers.get("store_file_analysis")
                        if store_fn:
                            store_fn(filepath, combined)
                    return filepath, _time.time() - start, None

        # Normal flow: agent reads file and stores analysis via tool calls
        agent = AgentLoop(
            model=model, stream=False, extra_body=extra, max_tokens=max_tok,
            log_path=log,
            system_prompt=system,
            tools=analysis_tools, tool_handlers=analysis_handlers,
        )
        try:
            agent.send(f"Analyze: {filepath}")
            return filepath, _time.time() - start, None
        except (RuntimeError, OSError) as e:
            err_str = str(e)
            # REQ-G-15: retry on truncated tool call JSON
            if _is_truncated_json_error(err_str):
                with open(log, "a") as _f:
                    _f.write(f"[TRUNCATED_JSON] {filepath} — retrying with halved tokens\n")
                retry_agent = AgentLoop(
                    model=model, stream=False, extra_body=extra,
                    max_tokens=max(max_tok // 2, 256),
                    log_path=log,
                    system_prompt=system,
                    tools=analysis_tools, tool_handlers=analysis_handlers,
                )
                try:
                    retry_agent.send(f"Analyze: {filepath}\nBe very brief — 5 bullet points maximum.")
                    return filepath, _time.time() - start, None
                except (RuntimeError, OSError) as e2:
                    return filepath, None, str(e2)
            return filepath, None, err_str

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_analyze_file, fp): fp for fp in all_files}
        from rich.live import Live
        from rich.spinner import Spinner
        from rich.text import Text
        from rich.console import Group
        from rich.markup import escape as _esc

        completed_lines: list[Text] = []

        with Live(Spinner("dots", text=f"  {len(all_files)} files analyzing...", style="dim"),
                   console=ui._con, refresh_per_second=10) as live:
            for future in as_completed(futures):
                filepath, elapsed, err = future.result()
                with _lock:
                    _counter["done"] += 1
                    n = _counter["done"]
                if err:
                    completed_lines.append(Text.from_markup(
                        f"[dim]  {n}/{len(all_files)} {_esc(filepath)}...[/dim]"
                        f" [yellow]⚠ {_esc(err)}[/yellow]"
                    ))
                else:
                    completed_lines.append(Text.from_markup(
                        f"[dim]  {n}/{len(all_files)} {_esc(filepath)}...[/dim]"
                        f" [green]✓[/green] [dim]{elapsed:.1f}s[/dim]"
                    ))
                remaining = len(all_files) - n
                if remaining:
                    live.update(Group(
                        *completed_lines,
                        Spinner("dots", text=f"  {remaining} file{'s' if remaining != 1 else ''} analyzing...", style="dim"),
                    ))
                else:
                    live.update(Group(*completed_lines))
                with open(log, "a") as f:
                    f.write(f"Analyzed: {filepath}\n")

    # Retrieve all analyses from SessionStore
    all_analyses = mcp_mod.session_store.get_all(run_id, "analysis") if mcp_mod else {}

    # Write operator-readable analysis output — index + per-file detail files
    voidrift_dir = target.parent
    analysis_dir = voidrift_dir / "analysis"
    analysis_dir.mkdir(exist_ok=True)

    # Per-file analysis files mirroring the source tree
    for cat in CATEGORIES:
        for fp in sorted(categories.get(cat, [])):
            analysis_text = all_analyses.get(fp, "")
            if not analysis_text:
                continue
            dest = analysis_dir / (fp + ".md")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(
                f"# {fp}\n\n**Category:** {cat}\n\n{analysis_text.strip()}\n",
                encoding="utf-8",
            )

    # Index file — categories, file counts, and links to individual analyses
    analysis_log = voidrift_dir / "ANALYSIS.md"
    with open(analysis_log, "w", encoding="utf-8") as _af:
        _af.write(f"# Gather Analysis\n\nSource: `{from_path}`\n\n")
        total_analyzed = sum(1 for fp in all_analyses if all_analyses[fp])
        _af.write(f"{total_analyzed} files analyzed.\n\n")
        for cat in CATEGORIES:
            cat_files = sorted(fp for fp in categories.get(cat, []) if all_analyses.get(fp))
            if not cat_files:
                continue
            _af.write(f"## {cat.capitalize()} ({len(cat_files)})\n\n")
            for fp in cat_files:
                _af.write(f"- [{fp}](analysis/{fp}.md)\n")
            _af.write("\n")

    # --- Stage 3: Synthesize requirements from all analyzed files (category order per REQ-G-8) ---
    all_analyzed = [
        (fp, cat, all_analyses.get(fp, ""))
        for cat in CATEGORIES
        for fp in sorted(categories.get(cat, []))
        if all_analyses.get(fp, "")
    ]

    ui.stage(f"Stage 3: Synthesizing requirements from {len(all_analyzed)} files...")

    extract_tools, extract_handlers = _pick_tools({"store_requirements"})

    try:
        for i, (fp, cat, analysis) in enumerate(all_analyzed, 1):
            ui.stage(f"Stage 3: {i}/{len(all_analyzed)} — {fp}")
            lens = _ANALYSIS_LENS.get(cat, _ANALYSIS_LENS["source"])
            # Lens-only system prompt for synthesis agents (REQ-G-8)
            synth_prompt = _get_prompt("gather", "SYNTHESIS").format(category_lens=lens)
            agent = AgentLoop(
                model=model, stream=False, extra_body=extra,
                max_tokens=_get_max_tokens(model.model_type, "synthesis"),
                log_path=log,
                system_prompt=synth_prompt,
                tools=extract_tools, tool_handlers=extract_handlers,
            )
            response = agent.send(f"[{cat}] {fp}:\n\n{analysis}")
            with open(log, "a") as f:
                f.write(f"Synthesize ({i}/{len(all_analyzed)} {fp}):\n{response}\n")

        # --- Stage 4: Consolidation — structured requirements from all categories ---
        ui.stage("Stage 4: Consolidating requirements...")
        ui.model_label(model.alias)

        stored_reqs = []
        for cat in CATEGORIES:
            for fp in sorted(categories.get(cat, [])):
                req = mcp_mod.artifacts.get("requirements", fp) if mcp_mod else None
                if req:
                    stored_reqs.append(f"### {fp} [{cat}]\n\n{req}")
        all_requirements_text = "\n\n---\n\n".join(stored_reqs)

        consol_tools, consol_handlers = _pick_tools({"get_template", "write_framework_file"})
        consol_prompt = _get_prompt("gather", "CONSOLIDATION")
        consol_max_tok = _get_max_tokens(model.model_type, "consolidation")
        consol_system = f"{analyst_role}\n\n{consol_prompt}"
        consol_msg = f"Extracted requirements:\n\n{all_requirements_text}"

        def _make_consol_agent(max_tok: int) -> AgentLoop:
            return AgentLoop(
                model=model, stream=False, extra_body=extra, max_tokens=max_tok,
                log_path=log,
                system_prompt=consol_system,
                tools=consol_tools, tool_handlers=consol_handlers,
            )

        try:
            response = _make_consol_agent(consol_max_tok).send(consol_msg)
        except (RuntimeError, OSError) as e:
            if _is_truncated_json_error(str(e)):
                with open(log, "a") as _f:
                    _f.write(f"[TRUNCATED_JSON] consolidation — retrying with halved tokens\n")
                response = _make_consol_agent(max(consol_max_tok // 2, 256)).send(
                    consol_msg + "\n\nBe concise — fewer requirements, essential only."
                )
            else:
                raise
        with open(log, "a") as f:
            f.write(f"Consolidation:\n{response}\n")

    except KeyboardInterrupt:
        ui.info("Interrupted.")
        return 1

    if target.exists():
        # Write state entry (REQ-PS-3)
        from ..utils import append_state
        analyzed = [(fp, cat) for cat in CATEGORIES for fp in sorted(categories.get(cat, []))]
        files_created = [str(target.relative_to(Path.cwd()))]
        if analysis_log.exists():
            files_created.append(str(analysis_log.relative_to(Path.cwd())))
        for af in sorted(analysis_dir.rglob("*.md")):
            files_created.append(str(af.relative_to(Path.cwd())))
        total = len([f for fs in categories.values() for f in fs])
        src_count = len(categories.get("source", []))
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
    else:
        ui.warn("Requirements file was not created.")
        return 1


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
