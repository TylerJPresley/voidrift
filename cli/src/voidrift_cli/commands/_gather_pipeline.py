"""Gather pipeline stage functions (REQ-G-8, REQ-ARCH-7).

Extracted from commands/gather.py to enable independent unit testing of each
of the four pipeline stages without running the full gather pipeline:

  _run_triage          — Stage 1: categorise files via triage agent
  _run_context_build   — Stage 2: summarise non-source categories
  _run_source_analysis — Stage 3: analyse each source file in parallel
  _run_consolidation   — Stage 4: consolidate analyses into REQUIREMENTS.md
"""

from __future__ import annotations

import hashlib
import time as _time_mod
from pathlib import Path

from ..agent import AgentLoop
from .. import prompts
from .. import ui
from ..models import ModelConfig

# Predefined categories (REQ-G-8 stage 1)
CATEGORIES: tuple[str, ...] = (
    "source", "tests", "config", "infrastructure", "documentation", "assets"
)
_NON_SOURCE: tuple[str, ...] = (
    "tests", "config", "infrastructure", "documentation", "assets"
)

# Category-specific analysis lenses (REQ-G-8 stage 3 — source analysis)
_ANALYSIS_LENS: dict[str, str] = {
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


# ── Chunking helper ─────────────────────────────────────────────────────────

def _make_chunks(text: str, size: int, overlap: int = 200) -> list[str]:
    """Split text into overlapping fixed-size chunks (REQ-G-13)."""
    overlap = min(overlap, size - 1)
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start : start + size])
        if start + size >= len(text):
            break
        start = start + size - overlap
    return chunks


# ── Analysis cache helpers (REQ-CTX-5) ──────────────────────────────────────

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


def _write_analysis(
    analysis_file: Path, filepath: str, file_hash: str, analysis: str
) -> None:
    """Write analysis with YAML frontmatter containing cache metadata (REQ-CTX-5)."""
    analysis_file.parent.mkdir(parents=True, exist_ok=True)
    ts = _time_mod.strftime("%Y-%m-%dT%H:%M:%S")
    analysis_file.write_text(
        f"---\nfile: {filepath}\nhash: {file_hash}\ntimestamp: {ts}\n---\n\n{analysis.strip()}\n",
        encoding="utf-8",
    )


# ── Pipeline stage functions ─────────────────────────────────────────────────

def _run_triage(
    model: ModelConfig,
    log: Path,
    analyst_role: str,
    file_tree: str,
    token_budget: "TokenBudget | None",
    extra: object,
) -> "dict[str, list[str]]":
    """Stage 1: Categorize files via triage agent (REQ-G-8 stage 1).

    Returns a categories dict mapping category name → list of file paths.
    Raises RuntimeError on fatal failure.
    """
    import json as _json
    import re as _re

    def _sanitize_json(text: str) -> str:
        """Strip ASCII control characters that break json.loads (REQ-G-20)."""
        return _re.sub(r"[\x00-\x1f]+", "", text)

    def _repair_truncated_json(text: str) -> str:
        """Attempt to close truncated JSON from max_tokens cutoff (REQ-G-20)."""
        text = text.rstrip().rstrip(",")
        open_b = text.count("[") - text.count("]")
        open_c = text.count("{") - text.count("}")
        text += "]" * open_b + "}" * open_c
        return text

    from ..config import get_max_tokens as _get_max_tokens

    triage_prompt = prompts.load_prompt("gather", "TRIAGE")
    triage = AgentLoop(
        model=model, stream=True, extra_body=extra,
        max_tokens=_get_max_tokens(model, "gather.triage"),
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{triage_prompt}",
        tools=[], tool_handlers={}, show_spinner=False,
        token_budget=token_budget,
    )
    with ui.spinner(ui.random_label(), "triage") as spin:
        triage.on_progress = spin.on_progress
        triage.on_token = lambda t: None
        triage_response = triage.send(
            prompts.load_prompt("gather", "TRIAGE-USER").format(file_tree=file_tree)
        )

    def _parse_triage_json(text: str) -> dict:
        """Parse triage JSON with sanitization and truncation repair (REQ-G-20)."""
        sanitized = _sanitize_json(text.strip())
        try:
            return _json.loads(sanitized)
        except _json.JSONDecodeError:
            pass
        m = _re.search(r"\{.*\}", sanitized, _re.DOTALL)
        if m:
            try:
                return _json.loads(m.group())
            except _json.JSONDecodeError:
                try:
                    return _json.loads(_repair_truncated_json(m.group()))
                except _json.JSONDecodeError:
                    pass
        if sanitized.startswith("{"):
            try:
                return _json.loads(_repair_truncated_json(sanitized))
            except _json.JSONDecodeError:
                pass
        raise _json.JSONDecodeError("Could not parse triage JSON", text, 0)

    try:
        triage_data = _parse_triage_json(triage_response)
    except _json.JSONDecodeError:
        with open(log, "a") as _f:
            _f.write(f"Triage response:\n{triage_response}\n")
        raise RuntimeError("Triage did not return valid JSON.")

    categories: dict[str, list[str]] = {}
    for cat in CATEGORIES:
        files = triage_data.get(cat, [])
        if isinstance(files, list):
            categories[cat] = files
        elif isinstance(files, dict):
            categories[cat] = [f for fs in files.values() for f in fs]
        else:
            categories[cat] = []

    # Validation pass — model reviews its own triage output (best-effort)
    all_files = [f for fs in categories.values() for f in fs]
    validation_prompt = prompts.load_prompt("gather", "TRIAGE-VALIDATION")
    validator = AgentLoop(
        model=model, stream=True, extra_body=extra,
        max_tokens=_get_max_tokens(model, "gather.triage"),
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{validation_prompt}",
        tools=[], tool_handlers={}, show_spinner=False,
        token_budget=token_budget,
    )
    try:
        with ui.spinner(ui.random_label(), "validation") as spin:
            validator.on_progress = spin.on_progress
            validator.on_token = lambda t: None
            val_response = validator.send(
                prompts.load_prompt("gather", "VALIDATION-USER").format(
                    files_json=_json.dumps(all_files)
                )
            )
        val_data = _json.loads(val_response.strip())
        if isinstance(val_data, dict):
            val_data = next(iter(val_data.values()), [])
        keep = set(val_data)
        categories = {c: [f for f in fs if f in keep] for c, fs in categories.items()}
    except (RuntimeError, ValueError, TypeError, KeyError, _json.JSONDecodeError):
        pass  # validation is best-effort

    return categories


def _run_context_build(
    model: ModelConfig,
    categories: "dict[str, list[str]]",
    read_fn: "callable",
    log: Path,
    analyst_role: str,
    token_budget: "TokenBudget | None",
    extra: object,
    input_limit: "int | None",
    errors: object,
) -> "dict[str, str]":
    """Stage 2: Summarize non-source categories for context injection (REQ-G-17).

    Returns a dict mapping category name → summary text.
    Errors are recorded via ``errors.record()`` but never fatal.
    """
    from ..config import get_max_tokens as _get_max_tokens

    context_summaries: dict[str, str] = {}
    ctx_build_prompt_tpl = prompts.load_prompt("gather", "CONTEXT-BUILD")
    cats_with_files = [cat for cat in _NON_SOURCE if categories.get(cat)]

    with ui.multi_spinner(f"{len(cats_with_files)} categories") as ms:
        for cat in cats_with_files:
            cat_files = categories[cat]
            parts: list[str] = []
            total_chars = 0
            for fp in sorted(cat_files):
                text = read_fn(fp)
                entry = f"### {fp}\n\n{text}"
                if input_limit and total_chars + len(entry) > input_limit:
                    parts.append(f"### {fp}\n\n[omitted — context limit reached]")
                    break
                parts.append(entry)
                total_chars += len(entry)
            content_block = "\n\n---\n\n".join(parts)

            lens = _ANALYSIS_LENS.get(cat, "")
            system = ctx_build_prompt_tpl.format(category=cat, context_lens=lens)
            ctx_agent = AgentLoop(
                model=model, stream=True, extra_body=extra,
                max_tokens=_get_max_tokens(model, "gather.analysis"),
                log_path=log,
                system_prompt=system,
                tools=[], tool_handlers={}, show_spinner=False,
                token_budget=token_budget,
            )
            tracker = ms.track(f"{cat} ({len(cat_files)} files)")
            _stats: dict = {"elapsed": 0, "pt": 0, "ct": 0, "ctx": None}

            def _on_ctx_complete(data: dict, s: dict = _stats) -> None:
                s["pt"] = max(s["pt"], data.get("prompt_tokens", 0))
                s["ct"] += data.get("completion_tokens", 0)
                if data.get("ctx_pct") is not None:
                    s["ctx"] = data["ctx_pct"]

            try:
                import time as _t2
                ctx_agent.on_progress = tracker
                ctx_agent.on_token = lambda t: None
                ctx_agent.on_complete = _on_ctx_complete
                _s2 = _t2.time()
                summary = ctx_agent.send(
                    prompts.load_prompt("gather", "CONTEXT-USER").format(
                        content_block=content_block
                    )
                )
                _e2 = _t2.time() - _s2
                context_summaries[cat] = summary
                ms.done(
                    f"{cat} ({len(cat_files)} files)",
                    f"{cat}: {len(cat_files)} file(s)",
                    _e2, _stats["pt"], _stats["ct"], _stats["ctx"],
                )
                with open(log, "a") as _f:
                    _f.write(f"Context [{cat}]:\n{summary}\n")
            except (RuntimeError, OSError) as e:
                ms.done(f"{cat} ({len(cat_files)} files)", f"{cat}", 0, failed=True)
                errors.record("api", type(e).__name__, str(e)[:200], recoverable=False)

    return context_summaries


def _run_source_analysis(
    model: ModelConfig,
    source_files: "list[str]",
    from_path: Path,
    log: Path,
    context_block: str,
    target: Path,
    token_budget: "TokenBudget | None",
    extra: object,
    concurrency: int,
    errors: object,
) -> "dict[str, str]":
    """Stage 3: Analyze each source file in parallel (REQ-G-8 stage 3).

    Returns a dict mapping filepath → analysis text.
    Per-file errors are recorded via ``errors.record()``; the stage never
    raises so the pipeline always reaches Stage 4.
    """
    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    from ..config import get_max_tokens as _get_max_tokens

    source_requirements: dict[str, str] = {}
    if not source_files:
        return source_requirements

    analysis_prompt_tpl = prompts.load_prompt("gather", "ANALYSIS")
    max_workers = len(source_files) if concurrency == 0 else concurrency
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    def _analyze_one(
        filepath: str,
        on_progress: object = None,
    ) -> "tuple[str, float | None, str | None, str, int, int, int | None]":
        lens = _ANALYSIS_LENS["source"]
        system = analysis_prompt_tpl.format(analysis_lens=lens)
        if context_block:
            system = system + "\n\n" + context_block
        max_tok = _get_max_tokens(model, "gather.analysis")
        _pt: list[int] = [0]
        _ct: list[int] = [0]
        _ctx_pct: list[int | None] = [None]

        def _on_complete(data: dict) -> None:
            _pt[0] = max(_pt[0], data.get("prompt_tokens", 0))
            _ct[0] += data.get("completion_tokens", 0)
            if data.get("ctx_pct") is not None:
                _ctx_pct[0] = data["ctx_pct"]

        full_path = (from_path / filepath).resolve()
        raw_content: str | None = None
        file_hash: str | None = None
        if full_path.exists():
            raw_content = full_path.read_text(encoding="utf-8", errors="replace")
            file_hash = hashlib.sha256(
                raw_content.encode("utf-8", errors="replace")
            ).hexdigest()

        # Cache lookup (REQ-CTX-5)
        if file_hash is not None:
            cached = _load_cached_analysis(
                _analysis_path(target.parent, filepath), file_hash
            )
            if cached is not None:
                with open(log, "a") as _f:
                    _f.write(f"[CACHE HIT] {filepath} (hash {file_hash[:8]})\n")
                return filepath, 0.0, None, cached, 0, 0, None

        start = _time.time()
        input_limit = model.max_input_chars

        # Chunked flow for large files (REQ-G-13)
        if input_limit and raw_content is not None and len(raw_content) > input_limit:
            chunks = _make_chunks(raw_content, input_limit)
            with open(log, "a") as _f:
                _f.write(
                    f"[CHUNKED] {filepath} ({len(raw_content)} chars"
                    f" → {len(chunks)} chunks)\n"
                )
            partial: list[str] = []
            for i, chunk in enumerate(chunks, 1):
                chunk_agent = AgentLoop(
                    model=model, stream=True, extra_body=extra, max_tokens=max_tok,
                    log_path=log, system_prompt=system,
                    tools=[], tool_handlers={}, show_spinner=False,
                    token_budget=token_budget,
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
                    errors.record(
                        "api", "ChunkAnalysisError",
                        f"Chunk {i}/{len(chunks)} of {filepath}", recoverable=True,
                    )
            if partial:
                if len(partial) == 1:
                    combined = partial[0]
                else:
                    consol_agent = AgentLoop(
                        model=model, stream=True, extra_body=extra, max_tokens=max_tok,
                        log_path=log, system_prompt=system,
                        tools=[], tool_handlers={}, show_spinner=False,
                        token_budget=token_budget,
                    )
                    consol_agent.on_progress = on_progress
                    consol_agent.on_token = lambda t: None
                    consol_agent.on_complete = _on_complete
                    parts_text = "\n\n---\n\n".join(
                        f"[Chunk {j + 1}/{len(partial)}]\n{p}"
                        for j, p in enumerate(partial)
                    )
                    combined = consol_agent.send(
                        f"Partial analyses of {filepath}:\n\n{parts_text}\n\n"
                        "Write one unified, non-redundant analysis of the whole file."
                    )
                if file_hash and combined:
                    _write_analysis(
                        _analysis_path(target.parent, filepath), filepath, file_hash, combined
                    )
                return filepath, _time.time() - start, None, combined, _pt[0], _ct[0], _ctx_pct[0]

        # Normal flow — zero tools, content injected directly (REQ-G-19)
        agent = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=max_tok,
            log_path=log, system_prompt=system,
            tools=[], tool_handlers={}, show_spinner=False,
            token_budget=token_budget,
        )
        agent.on_progress = on_progress
        agent.on_token = lambda t: None
        agent.on_complete = _on_complete
        try:
            content_for_msg = raw_content or ""
            response = agent.send(
                prompts.load_prompt("gather", "ANALYSIS-USER").format(
                    filepath=filepath, file_content=content_for_msg,
                )
            )
            if file_hash and response:
                _write_analysis(
                    _analysis_path(target.parent, filepath), filepath, file_hash, response
                )
            return filepath, _time.time() - start, None, response, _pt[0], _ct[0], _ctx_pct[0]
        except (RuntimeError, OSError) as e:
            return filepath, None, str(e), "", 0, 0, None

    with ui.multi_spinner(f"{ui.random_label()} ({len(source_files)} source files)") as ms:
        with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
            futures = {
                pool.submit(_analyze_one, fp, ms.track(fp)): fp
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
                    errors.record(
                        "api", "SourceAnalysisError",
                        f"{filepath}: {err[:150]}", recoverable=True,
                    )
                else:
                    source_requirements[filepath] = response
                    ms.done(filepath, label, elapsed or 0, pt, ct, ctx_pct)
                with open(log, "a") as _f:
                    _f.write(f"Analyzed: {filepath}\n")

    return source_requirements


def _run_consolidation(
    model: ModelConfig,
    source_requirements: "dict[str, str]",
    context_summaries: "dict[str, str]",
    existing_requirements: "str | None",
    log: Path,
    token_budget: "TokenBudget | None",
    extra: object,
) -> str:
    """Stage 4: Consolidate analyses into REQUIREMENTS.md text (REQ-G-8 stage 4).

    Returns the final markdown string.
    Raises RuntimeError on model failure, KeyboardInterrupt on user interrupt.
    """
    from ..config import get_max_tokens as _get_max_tokens

    requirements_template = prompts.load_template("REQUIREMENTS-TEMPLATE")

    source_reqs_text = "\n\n---\n\n".join(
        f"### {fp}\n\n{req.strip()}"
        for fp, req in sorted(source_requirements.items())
        if req.strip()
    )

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
        final_msg += (
            f"\n\n---\n\nExisting REQUIREMENTS.md (update, don't replace):"
            f"\n\n{existing_requirements}"
        )

    final_prompt = prompts.load_prompt("gather", "CONSOLIDATION")
    final_system = (
        final_prompt + f"\n\n## Output Template\n\n{requirements_template}"
        if requirements_template
        else final_prompt
    )

    final_agent = AgentLoop(
        model=model, stream=True, extra_body=extra,
        max_tokens=_get_max_tokens(model, "gather.consolidation"),
        log_path=log,
        system_prompt=final_system,
        tools=[], tool_handlers={}, show_spinner=False,
        token_budget=token_budget,
    )
    with ui.spinner(ui.random_label(), "consolidation") as spin:
        final_agent.on_progress = spin.on_progress
        final_agent.on_token = lambda t: None
        final_response = final_agent.send(final_msg)

    with open(log, "a") as _f:
        _f.write(f"Final pass response ({len(final_response)} chars)\n")
    return final_response
