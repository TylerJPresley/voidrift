"""Phase 1 — Gather: Requirements elicitation (AC-G1 through AC-G13)."""

from __future__ import annotations

from pathlib import Path

import click

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, log_path, boot_run, check_disk_space,
)
from .. import ui

# System prompt for the Analyst role
ANALYST_PROMPT = """[ROLE: Analyst]

You are an Analyst in the VoidRift framework. Your job is to elicit requirements through interactive conversation.

Focus on "what" the system must do, not "how" it will be built.
Ask clarifying questions before writing requirements.
Keep responses concise — a few focused questions per turn, not exhaustive lists.
Do not discuss technology choices unless the operator explicitly requests them.

You have MCP tools available to read/write requirements and examine project artifacts.

When writing REQUIREMENTS.md, use exactly these sections:
- Goal
- Users
- Features
- Runtime Environment (Local development + Production subsections)
- Constraints
- Out of Scope

When writing feature specs (spec/<feature>.md), use exactly these sections:
- Goal
- User Stories (As a [role], I want [capability] so that [benefit])
- Acceptance Criteria (Given/When/Then BDD format)
- Non-Functional Requirements
- Edge Cases

After writing REQUIREMENTS.md, list the exact commands to run for each feature, ready to copy. Example:
  voidrift gather {model} "feature name"
Do not explain the command format — just list the commands.

Do NOT write the file until you have sufficient information. Ask questions first.
When you have enough information, tell the operator you're ready to write and ask them to type /write.
"""


def run_gather(
    model: ModelConfig,
    feature: str | None = None,
    from_path: str | None = None,
    reference_path: str | None = None,
    force: bool = False,
) -> int:
    """Execute the gather phase.

    Args:
        model: Model configuration for the analyst role.
        feature: Optional feature name for a feature spec.
        from_path: Path to existing codebase for reverse engineering.
        reference_path: Path to reference codebase for interactive lookup.
        force: Overwrite existing requirements when using from_path.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    # Determine target file (AC-G1)
    if feature:
        if not (d / "REQUIREMENTS.md").exists():
            ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
            return 1
        target = d / "spec" / f"{feature}.md"
        target.parent.mkdir(exist_ok=True)
    else:
        target = d / "REQUIREMENTS.md"

    # Reverse engineering mode (AC-G11)
    if from_path:
        return _gather_from(model, target, Path(from_path), feature, force)

    # Interactive mode (AC-G3, AC-G4)
    system = ANALYST_PROMPT.replace("{model}", model.alias)
    target_rel = str(target.relative_to(Path.cwd()))
    system += f"\n\nWhen using write_file(), write to exactly this path: {target_rel}"
    if reference_path:
        system += f"\n\nA reference codebase is available at {reference_path}. You can use read_source_file() to examine it."
    if target.exists():
        system += f"\n\nHere is the existing requirements file for revision:\n\n{target.read_text()}"

    from ..tools import LOCAL_TOOLS, LOCAL_HANDLERS
    allowed = {"write_file", "read_source_file"} if reference_path else {"write_file"}
    tools = [t for t in LOCAL_TOOLS if t["function"]["name"] in allowed]
    handlers = {k: v for k, v in LOCAL_HANDLERS.items() if k in allowed}

    from ..main import _interactive_loop
    log, _ = boot_run("gather")

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=[],
        tool_handlers=handlers,
        stream=True,
        max_tokens=16384,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
        log_path=log,
    )

    target_label = str(target.relative_to(Path.cwd()))
    title = f"VoidRift Gather — Feature: {feature}" if feature else "VoidRift Gather"
    extra = [f"Target: {target_label}"]
    _interactive_loop(agent, model, log, title, write_tools=tools, extra_header=extra)
    return 0



def _gather_from(
    model: ModelConfig,
    target: Path,
    from_path: Path,
    feature: str | None,
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

    file_tree = _build_file_tree(from_path)
    target_rel = str(target.relative_to(Path.cwd()))

    with open(log, "a") as f:
        f.write(f"=== Reverse engineering from {from_path} ===\n")

    # --- Stage 1: Triage — identify files and logical groups ---
    ui.stage("Stage 1: Triaging files...")
    triage = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=(
            "You are a code analyst. Given a file tree, return ONLY a JSON object with:\n"
            '- "groups": a dict mapping logical boundary names to lists of relative file paths.\n'
            "  Auto-detect boundaries from directory structure (e.g. frontend/, backend/, api/, shared/).\n"
            "  For single-application codebases, use one group named after the project.\n\n"
            "INCLUDE ONLY these three categories:\n"
            "1. Source files — code written by developers\n"
            "2. Documentation — READMEs, design docs, specs\n"
            "3. Configuration — env files, Dockerfiles, CI/CD, build configs\n\n"
            "You MUST NOT include:\n"
            "- Files with content hashes in their names (e.g. index-CW8_b_Xi.js) — these are compiled build output\n"
            "- Lock files (package-lock.json, poetry.lock, Gemfile.lock, etc.)\n"
            "- Binary files and images (.png, .jpg, .gif, .ico, .woff, .ttf)\n"
            "- Dependency directories (node_modules, vendor, target, __pycache__)\n"
            "- Generated HTML in build/static/dist directories\n"
            "- Minified or bundled files\n\n"
            "Use your knowledge of the project's language and toolchain to decide.\n"
            "Return raw JSON, no markdown fences.\n\n"
            'Example: {"groups": {"backend": ["backend/main.py"], "frontend": ["frontend/src/App.vue"]}}'
        ),
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
    validator = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        log_path=log,
        system_prompt=(
            "You are a strict code reviewer. Given a list of files selected for source code analysis, "
            "remove any that should NOT be analyzed:\n"
            "- Compiled/bundled files (hashed filenames like index-CW8_b_Xi.js)\n"
            "- Lock files (package-lock.json, poetry.lock, etc.)\n"
            "- Binary files and images (.png, .jpg, .gif, .ico, .woff, .ttf)\n"
            "- Generated build output (files in static/assets/, dist/, build/ directories)\n"
            "- Minified files\n\n"
            "Return ONLY a JSON list of files that SHOULD be kept. No markdown fences."
        ),
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
    analysis_tools, analysis_handlers = _pick_tools({"read_source_file", "store_file_analysis"})

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
            system_prompt=(
                "You are a code analyst. Read the file, then call store_file_analysis() "
                "with a concise summary covering: purpose, key components/functions, "
                "dependencies, and any requirements implied by the code."
            ),
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
            synth = AgentLoop(
                model=model, stream=True, extra_body=extra, max_tokens=16384,
                log_path=log,
                on_token=ui.make_token_handler(),
                system_prompt=(
                    f"[ROLE: Analyst]\n\n"
                    f"You are writing detailed requirements for the '{group_name}' component.\n"
                    "Steps:\n"
                    "1. Call get_template('REQUIREMENTS-TEMPLATE') for the output format.\n"
                    "2. Call get_skill('PROD-STRATEGY') for guidance.\n"
                    f"3. Call write_file() EXACTLY ONCE to write the COMPLETE requirements to '{spec_path}'.\n"
                    "4. Call done() when finished.\n"
                    "Do NOT call the same tool more than once.\n\n"
                    "CRITICAL: Be THOROUGH and DETAILED.\n"
                    "- Every endpoint, component, data flow, config parameter, and error behavior must be a requirement.\n"
                    "- Each requirement needs specific acceptance criteria.\n"
                    "- Do not summarize or abbreviate.\n\n"
                    f"After calling done(), summarize the key requirements for {group_name}.\n\n"
                    f"--- FILE ANALYSES FOR {group_name.upper()} ---\n\n{group_context}"
                ),
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
                spec_summaries.append(f"## {group_name}\n\n{sp.read_text()[:8000]}")
        specs_context = "\n\n---\n\n".join(spec_summaries)

        overview = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=8192,
            log_path=log,
            on_token=ui.make_token_handler(),
            system_prompt=(
                "[ROLE: Analyst]\n\n"
                "You are writing a project-level requirements overview.\n"
                "The project has multiple components, each with its own spec file.\n"
                "Steps:\n"
                f"1. Call write_file() EXACTLY ONCE to write the COMPLETE overview to '{target_rel}'.\n"
                "2. Call done() when finished.\n\n"
                "The overview must cover:\n"
                "- System purpose and scope\n"
                "- How the components interact (API contracts, shared config, data flow)\n"
                "- Deployment topology\n"
                "- Cross-cutting concerns (auth, logging, monitoring, error handling)\n"
                f"- References to spec files: {', '.join(f'spec/{g}.md' for g in groups)}\n\n"
                "After calling done(), summarize the project architecture.\n\n"
                f"--- COMPONENT SPECS ---\n\n{specs_context}"
            ),
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
        synth = AgentLoop(
            model=model, stream=True, extra_body=extra, max_tokens=16384,
            log_path=log,
            on_token=ui.make_token_handler(),
            system_prompt=(
                "[ROLE: Analyst]\n\n"
                "You are writing comprehensive requirements from file analysis summaries.\n"
                "Steps:\n"
                "1. Call get_template('REQUIREMENTS-TEMPLATE') for the output format.\n"
                "2. Call get_skill('PROD-STRATEGY') for guidance.\n"
                f"3. Call write_file() EXACTLY ONCE to write the COMPLETE requirements to '{target_rel}'.\n"
                "4. Call done() when finished.\n"
                "Do NOT call the same tool more than once.\n\n"
                "CRITICAL: Be THOROUGH and DETAILED.\n"
                "- Every endpoint, component, data flow, config parameter, and error behavior must be a requirement.\n"
                "- Each requirement needs specific acceptance criteria.\n"
                "- Do not summarize or abbreviate.\n\n"
                "After calling done(), summarize the key requirements.\n\n"
                f"--- FILE ANALYSES ---\n\n{group_context}"
            ),
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
    """Build a file tree string, excluding common non-source directories.

    Args:
        directory: Root directory to scan.
        max_files: Maximum number of files to include.

    Returns:
        Newline-separated list of relative file paths.
    """
    lines = []
    count = 0
    for p in sorted(directory.rglob("*")):
        if count >= max_files:
            lines.append(f"... (truncated at {max_files} files)")
            break
        if any(part.startswith(".") for part in p.relative_to(directory).parts):
            continue
        if p.is_file():
            lines.append(str(p.relative_to(directory)))
            count += 1
    return "\n".join(lines)
