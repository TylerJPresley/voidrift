"""Phase 1 — Gather: Reverse-engineer requirements from a codebase (REQ-G-1, REQ-G-8)."""

from __future__ import annotations

from pathlib import Path

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, boot_run, check_disk_space,
)
from .. import ui


def run_gather(
    model: ModelConfig,
    from_path: str,
    force: bool = False,
) -> int:
    """Execute the gather phase — reverse-engineer requirements from a codebase.

    Args:
        model: Model configuration for the analyst role.
        from_path: Path to existing codebase.
        force: Overwrite existing requirements.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()
    target = d / "REQUIREMENTS.md"
    source = Path(from_path)

    return _gather_from(model, target, source, force)



def _gather_from(
    model: ModelConfig,
    target: Path,
    from_path: Path,
    force: bool,
) -> int:
    """Reverse engineering mode — four-stage pipeline (REQ-G-8, REQ-ARCH-7)."""
    if target.exists() and not force:
        ui.error(f"{target} already exists. Use --force to overwrite.")
        return 1
    if not from_path.is_dir():
        ui.error(f"{from_path} is not a directory")
        return 1
    if force and target.exists():
        target.unlink()

    log, run_id = boot_run("gather")

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod.run_id = run_id
        mcp_mod._boot()
        all_tools, all_handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        from ..tools import LOCAL_TOOLS, LOCAL_HANDLERS
        all_tools = list(LOCAL_TOOLS)
        all_handlers = dict(LOCAL_HANDLERS)
        mcp_mod = None

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
    target_rel = str(target.relative_to(Path.cwd()))

    with open(log, "a") as f:
        f.write(f"=== Reverse engineering from {from_path} ===\n")

    # Load shared methodology once for all stages (REQ-RES-7)
    _get_prompt = all_handlers.get("get_prompt", lambda *a: "")
    _get_skill = all_handlers.get("get_skill", lambda *a: "")
    analyst_role = _get_skill("ANALYSIS-REQS")

    # --- Stage 1: Triage — identify files and logical groups ---
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

    import json as _json
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

    # Normalize: support old flat list format or new groups format
    if "groups" in triage_data:
        groups: dict[str, list[str]] = triage_data["groups"]
    elif isinstance(triage_data, list):
        groups = {"project": triage_data}
    else:
        groups = {"project": list(triage_data.values())[0] if triage_data else []}

    # --- Validation pass — model reviews its own triage output ---
    all_files = [f for fs in groups.values() for f in fs]
    validation_prompt = _get_prompt("gather", "TRIAGE-VALIDATION")
    validator = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=f"{analyst_role}\n\n{validation_prompt}",
        tools=[], tool_handlers={},
    )
    try:
        val_response = validator.send(f"Files to review:\n{_json.dumps(all_files)}")
        keep = set(_json.loads(val_response.strip()))
        groups = {g: [f for f in fs if f in keep] for g, fs in groups.items()}
        groups = {g: fs for g, fs in groups.items() if fs}  # drop empty groups
    except Exception:
        pass  # validation is best-effort; proceed with original triage

    all_files = [f for files in groups.values() for f in files]
    ui.info(f"{len(all_files)} files in {len(groups)} group(s): {', '.join(groups.keys())}")
    with open(log, "a") as f:
        f.write(f"Triage: {_json.dumps(groups)}\n")

    # --- Stage 2: Analysis — one agent per file, concurrent ---
    ui.stage("Stage 2: Analyzing files...")
    analysis_tools, analysis_handlers = _pick_tools(
        {"read_source_file", "store_file_analysis", "get_skill", "list_skills"}
    )

    # Build analysis prompt (skill already prepended via analyst_role)
    analysis_prompt = _get_prompt("gather", "ANALYSIS")
    analysis_system = f"{analyst_role}\n\n{analysis_prompt}"

    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from ..config import get_concurrency

    concurrency = get_concurrency(model.model_type)
    max_workers = len(all_files) if concurrency == 0 else concurrency
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    def _analyze_file(filepath: str) -> tuple[str, float | None, str | None]:
        start = _time.time()
        agent = AgentLoop(
            model=model, stream=False, extra_body=extra, max_tokens=4096,
            log_path=log,
            system_prompt=analysis_system,
            tools=analysis_tools, tool_handlers=analysis_handlers,
        )
        try:
            agent.send(f"Analyze: {filepath}")
            return filepath, _time.time() - start, None
        except (RuntimeError, OSError) as e:
            return filepath, None, str(e)

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(_analyze_file, fp): fp for fp in all_files}
        for future in as_completed(futures):
            filepath, elapsed, err = future.result()
            with _lock:
                _counter["done"] += 1
                n = _counter["done"]
            if err:
                ui.progress(n, len(all_files), f"{filepath}...", end="")
                ui._con.print(f" [yellow]⚠ {err}[/yellow]")
            else:
                ui.progress(n, len(all_files), f"{filepath}...", end="")
                ui._con.print(f" [green]✓[/green] [dim]{elapsed:.1f}s[/dim]")
            with open(log, "a") as f:
                f.write(f"Analyzed: {filepath}\n")

    # Retrieve all analyses from SessionStore for building per-group context
    all_analyses = mcp_mod.session_store.get_all(run_id, "analysis") if mcp_mod else {}

    def _build_group_analyses(file_list: list[str]) -> str:
        parts = []
        for fp in sorted(file_list):
            content = all_analyses.get(fp, "")
            if content:
                parts.append(f"## {fp}\n\n{content}")
        return "\n\n---\n\n".join(parts)

    synth_tools, synth_handlers = _pick_tools(
        {"get_template", "get_skill", "write_file"}
    )
    multi = len(groups) > 1

    if multi:
        # --- Stage 3: Per-group synthesis ---
        total_stages = len(groups) + 1
        for i, (group_name, group_files) in enumerate(groups.items(), 1):
            spec_path = f".voidrift/spec/{group_name}.md"
            ui.stage(f"Stage 3.{i}/{total_stages}: Writing {group_name} spec...")
            ui.model_label(model.alias)

            group_context = _build_group_analyses(group_files)
            synth_prompt = _get_prompt("gather", "SYNTHESIS").format(
                group_name=group_name,
                spec_path=spec_path,
                group_context=f"--- FILE ANALYSES FOR {group_name.upper()} ---\n\n{group_context}",
            )
            synth = AgentLoop(
                model=model, stream=True, extra_body=extra, max_tokens=16384,
                log_path=log,
                on_token=ui.make_token_handler(),
                system_prompt=f"{analyst_role}\n\n{synth_prompt}",
                tools=synth_tools, tool_handlers=synth_handlers,
            )
            try:
                response = synth.send(f"Write detailed requirements for the {group_name} component.")
                with open(log, "a") as f:
                    f.write(f"Synthesis ({group_name}):\n{response}\n")
            except KeyboardInterrupt:
                ui.info("Interrupted.")
                return 1

        # --- Stage 4: Overview ---
        ui.stage(f"Stage 4: Writing project overview...")
        ui.model_label(model.alias)

        spec_dir = Path.cwd() / ".voidrift" / "spec"
        spec_summaries = []
        for group_name in groups:
            sp = spec_dir / f"{group_name}.md"
            if sp.exists():
                spec_summaries.append(f"## {group_name}\n\n{sp.read_text()}")
        specs_context = "\n\n---\n\n".join(spec_summaries)

        overview_prompt = _get_prompt("gather", "OVERVIEW").format(
            target_rel=target_rel,
            spec_refs=", ".join(f"spec/{g}.md" for g in groups),
            specs_context=f"--- COMPONENT SPECS ---\n\n{specs_context}",
        )
        overview = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=8192,
            log_path=log,
            on_token=ui.make_token_handler(),
            system_prompt=f"{analyst_role}\n\n{overview_prompt}",
            tools=synth_tools, tool_handlers=synth_handlers,
        )
        try:
            response = overview.send("Write the project-level requirements overview.")
            with open(log, "a") as f:
                f.write(f"Overview:\n{response}\n")
        except KeyboardInterrupt:
            ui.info("Interrupted.")
            return 1

    else:
        # Single group — write directly to REQUIREMENTS.md
        ui.stage("Stage 3: Writing requirements...")
        ui.model_label(model.alias)

        group_context = _build_group_analyses(all_files)
        single_prompt = _get_prompt("gather", "SYNTHESIS-SINGLE").format(
            target_rel=target_rel,
            group_context=f"--- FILE ANALYSES ---\n\n{group_context}",
        )
        synth = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=16384,
            log_path=log,
            on_token=ui.make_token_handler(),
            system_prompt=f"{analyst_role}\n\n{single_prompt}",
            tools=synth_tools, tool_handlers=synth_handlers,
        )
        try:
            response = synth.send("Write the requirements from the file analyses.")
            with open(log, "a") as f:
                f.write(f"Synthesis:\n{response}\n")
        except KeyboardInterrupt:
            ui.info("Interrupted.")

    if target.exists():
        ui.done(f"Requirements written to {target_rel}")
        return 0
    else:
        ui.warn("Requirements file was not created.")
        return 1

def _build_file_tree(directory: Path, max_files: int = 500) -> str:
    """Build a file tree string, excluding dot-directories.

    Args:
        directory: Root directory to scan.
        max_files: Maximum files before raising an error.

    Returns:
        Newline-separated list of relative file paths.

    Raises:
        RuntimeError: If file count exceeds max_files (no silent truncation).
    """
    lines = []
    for p in sorted(directory.rglob("*")):
        if any(part.startswith(".") for part in p.relative_to(directory).parts):
            continue
        if p.is_file():
            lines.append(str(p.relative_to(directory)))
    if len(lines) > max_files:
        raise RuntimeError(
            f"Source tree has {len(lines)} files (limit {max_files}). "
            "Triage cannot process this many files. "
            "Point gather at a smaller subdirectory or increase the limit."
        )
    return "\n".join(lines)
