"""Gather command: Reverse-engineer requirements from a codebase (REQ-G-1, REQ-G-8)."""

from __future__ import annotations

import hashlib
import json
import time as _time_mod
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from .. import prompts
from ..skills import find_skill
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


# ── Analysis cache (REQ-CTX-5) ──────────────────────────────────────────────

def _analysis_path(voidrift_dir: Path, filepath: str) -> Path:
    """Return the analysis file path for a source file."""
    return voidrift_dir / "analysis" / (filepath + ".md")


def _load_cached_analysis(analysis_file: Path, file_hash: str) -> str | None:
    """Return cached analysis if the hash matches frontmatter, else None."""
    if not analysis_file.exists():
        return None
    try:
        text = analysis_file.read_text(encoding="utf-8")
        if not text.startswith("---"):
            return None
        end = text.index("---", 3)
        frontmatter = text[3:end]
        for line in frontmatter.splitlines():
            if line.strip().startswith("hash:"):
                cached_hash = line.split(":", 1)[1].strip()
                if cached_hash == file_hash:
                    return text[end + 3:].strip()
                return None
        return None
    except (OSError, ValueError):
        return None


def _write_analysis(analysis_file: Path, filepath: str, file_hash: str, analysis: str) -> None:
    """Write analysis with YAML frontmatter containing cache metadata (REQ-CTX-5)."""
    analysis_file.parent.mkdir(parents=True, exist_ok=True)
    ts = _time_mod.strftime("%Y-%m-%dT%H:%M:%S")
    analysis_file.write_text(
        f"---\nfile: {filepath}\nhash: {file_hash}\ntimestamp: {ts}\n---\n\n{analysis.strip()}\n",
        encoding="utf-8",
    )


def run_gather(
    model: ModelConfig,
    from_path: str,
    overwrite: bool = False,
) -> int:
    """Execute the gather command — reverse-engineer requirements from a codebase."""
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

    all_tools, all_handlers = build_local_tools(cmd="gather")

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

    import json as _json
    import re as _re
    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..config import get_concurrency

    # --- Stage 1: Triage — categorize files ---
    ui.stage("Stage 1: Triaging files...")
    triage_prompt = prompts.load_prompt("gather", "TRIAGE")
    triage = AgentLoop(
        model=model, stream=True, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{triage_prompt}",
        tools=[], tool_handlers={}, show_spinner=False,
    )
    try:
        with ui.spinner(ui.random_label(), "triage") as spin:
            triage.on_progress = spin.on_progress
            triage.on_token = lambda t: None
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
    validation_prompt = prompts.load_prompt("gather","TRIAGE-VALIDATION")
    validator = AgentLoop(
        model=model, stream=True, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{validation_prompt}",
        tools=[], tool_handlers={}, show_spinner=False,
    )
    try:
        with ui.spinner(ui.random_label(), "validation") as spin:
            validator.on_progress = spin.on_progress
            validator.on_token = lambda t: None
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
    ctx_build_prompt_tpl = prompts.load_prompt("gather","CONTEXT-BUILD")

    cats_with_files = [cat for cat in _NON_SOURCE if categories.get(cat)]
    with ui.multi_spinner(f"{len(cats_with_files)} categories") as ms:
        for cat in cats_with_files:
            cat_files = categories[cat]
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
                model=model, stream=True, extra_body=extra,
                max_tokens=_get_max_tokens(model.model_type, "analysis"),
                log_path=log,
                system_prompt=system,
                tools=[], tool_handlers={}, show_spinner=False,
            )
            tracker = ms.track(f"{cat} ({len(cat_files)} files)")
            try:
                ctx_agent.on_progress = tracker
                ctx_agent.on_token = lambda t: None
                summary = ctx_agent.send(f"Files:\n\n{content_block}")
                context_summaries[cat] = summary
                ms.done(f"{cat} ({len(cat_files)} files)", f"{cat}: {len(cat_files)} file(s)", 0)
                with open(log, "a") as f:
                    f.write(f"Context [{cat}]:\n{summary}\n")
            except (RuntimeError, OSError) as e:
                ms.done(f"{cat} ({len(cat_files)} files)", f"{cat}", 0, failed=True)

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
    analysis_prompt_tpl = prompts.load_prompt("gather","ANALYSIS")
    source_requirements: dict[str, str] = {}

    concurrency = get_concurrency(model.model_type)
    max_workers = len(source_files) if concurrency == 0 else concurrency
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    def _analyze_source(
        filepath: str,
        on_progress=None,
    ) -> tuple[str, float | None, str | None, str, int, int, int | None]:
        lens = _ANALYSIS_LENS["source"]
        system = analysis_prompt_tpl.format(analysis_lens=lens)
        if context_block:
            system = system + "\n\n" + context_block
        max_tok = _get_max_tokens(model.model_type, "analysis")
        _pt: list[int] = [0]
        _ct: list[int] = [0]
        _ctx: list[int | None] = [None]

        def _on_complete(data: dict) -> None:
            _pt[0] = max(_pt[0], data.get("prompt_tokens", 0))
            _ct[0] += data.get("completion_tokens", 0)
            if data.get("ctx_pct") is not None:
                _ctx[0] = data["ctx_pct"]

        # Read file content once — used for cache hash and chunking (REQ-CTX-5, REQ-G-13)
        full_path = (from_path / filepath).resolve()
        raw_content: str | None = None
        file_hash: str | None = None
        if full_path.exists():
            raw_content = full_path.read_text(encoding="utf-8", errors="replace")
            file_hash = hashlib.sha256(raw_content.encode("utf-8", errors="replace")).hexdigest()

        # Cache lookup — skip model inference if unchanged (REQ-CTX-5)
        if file_hash is not None:
            cached = _load_cached_analysis(_analysis_path(target.parent, filepath), file_hash)
            if cached is not None:
                with open(log, "a") as _f:
                    _f.write(f"[CACHE HIT] {filepath} (hash {file_hash[:8]})\n")
                return filepath, 0.0, None, cached, 0, 0, None

        start = _time.time()

        # REQ-G-13: chunk large source files instead of truncating
        if _input_limit and raw_content is not None and len(raw_content) > _input_limit:
            chunks = _make_chunks(raw_content, _input_limit)
            with open(log, "a") as _f:
                _f.write(f"[CHUNKED] {filepath} ({len(raw_content)} chars → {len(chunks)} chunks)\n")
            partial: list[str] = []
            for i, chunk in enumerate(chunks, 1):
                chunk_agent = AgentLoop(
                    model=model, stream=True, extra_body=extra, max_tokens=max_tok,
                    log_path=log,
                    system_prompt=system,
                    tools=[], tool_handlers={}, show_spinner=False,
                )
                chunk_agent.on_progress = on_progress
                chunk_agent.on_token = lambda t: None
                chunk_agent.on_complete = _on_complete
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
                        model=model, stream=True, extra_body=extra, max_tokens=max_tok,
                        log_path=log,
                        system_prompt=system,
                        tools=[], tool_handlers={}, show_spinner=False,
                    )
                    consol_agent.on_progress = on_progress
                    consol_agent.on_token = lambda t: None
                    consol_agent.on_complete = _on_complete
                    parts_text = "\n\n---\n\n".join(
                        f"[Chunk {j+1}/{len(partial)}]\n{p}"
                        for j, p in enumerate(partial)
                    )
                    combined = consol_agent.send(
                        f"Partial analyses of {filepath}:\n\n{parts_text}\n\n"
                        "Write one unified, non-redundant analysis of the whole file."
                    )
                if file_hash and combined:
                    _write_analysis(_analysis_path(target.parent, filepath), filepath, file_hash, combined)
                return filepath, _time.time() - start, None, combined, _pt[0], _ct[0], _ctx[0]

        # Normal flow: agent calls read_source_file(), returns analysis as direct text
        agent = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=max_tok,
            log_path=log,
            system_prompt=system,
            tools=source_tools, tool_handlers=source_handlers, show_spinner=False,
        )
        agent.on_progress = on_progress
        agent.on_token = lambda t: None
        agent.on_complete = _on_complete
        try:
            response = agent.send(f"Analyze: {filepath}")
            if file_hash and response:
                _write_analysis(_analysis_path(target.parent, filepath), filepath, file_hash, response)
            return filepath, _time.time() - start, None, response, _pt[0], _ct[0], _ctx[0]
        except (RuntimeError, OSError) as e:
            return filepath, None, str(e), "", 0, 0, None

    if source_files:
        from rich.markup import escape as _esc

        with ui.multi_spinner(f"{ui.random_label()} ({len(source_files)} source files)") as ms:
            with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
                futures = {
                    pool.submit(_analyze_source, fp, ms.track(fp)): fp
                    for fp in source_files
                }
                for future in as_completed(futures):
                    filepath, elapsed, err, response, pt, ct, ctx_pct = future.result()
                    with _lock:
                        _counter["done"] += 1
                        n = _counter["done"]
                    label = f"{n}/{len(source_files)} {filepath}"
                    if err:
                        ms.done(filepath, label, elapsed or 0, failed=True)
                    else:
                        source_requirements[filepath] = response
                        ms.done(filepath, label, elapsed or 0, pt, ct, ctx_pct)
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

    # Pre-fetch template (CLI calls directly, no model tool call)
    requirements_template = prompts.load_template("REQUIREMENTS-TEMPLATE")

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

    if existing_requirements:
        final_msg += f"\n\n---\n\nExisting REQUIREMENTS.md (update, don't replace):\n\n{existing_requirements}"

    # System prompt: consolidation instructions + template
    final_prompt = prompts.load_prompt("gather", "CONSOLIDATION")
    if requirements_template:
        final_system = final_prompt + f"\n\n## Output Template\n\n{requirements_template}"
    else:
        final_system = final_prompt

    try:
        final_agent = AgentLoop(
            model=model, stream=True, extra_body=extra,
            max_tokens=_get_max_tokens(model.model_type, "consolidation"),
            log_path=log,
            system_prompt=final_system,
            tools=[], tool_handlers={}, show_spinner=False,
        )
        with ui.spinner(ui.random_label(), "consolidation") as spin:
            final_agent.on_progress = spin.on_progress
            final_agent.on_token = lambda t: None
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
        cmd="gather",
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
