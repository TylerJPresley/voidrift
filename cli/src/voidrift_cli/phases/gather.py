"""Phase 1 — Gather: Requirements elicitation (AC-G1 through AC-G13)."""

from __future__ import annotations

from pathlib import Path

import click

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space,
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

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=[],
        tool_handlers=handlers,
        stream=True,
        max_tokens=16384,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )

    from ..main import _interactive_loop
    log = log_path("gather")
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
    """Reverse engineering mode — three-stage pipeline (REQ-G-8, REQ-ARCH-7)."""
    if target.exists() and not force:
        ui.error(f"{target} already exists. Use --force to overwrite.")
        return 1
    if not from_path.is_dir():
        ui.error(f"{from_path} is not a directory")
        return 1
    if force and target.exists():
        target.unlink()

    # Build tools from MCP + CLI-native (REQ-MCP-4a)
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        all_tools, all_handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        from ..tools import LOCAL_TOOLS, LOCAL_HANDLERS
        all_tools = list(LOCAL_TOOLS)
        all_handlers = dict(LOCAL_HANDLERS)

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

    log = log_path("gather")
    ui.phase("VoidRift Gather (Reverse Engineering)")
    ui.detail(f"Log: {log}")
    ui.detail(f"Source: {from_path}")
    ui.detail(f"Target: {target}")

    file_tree = _build_file_tree(from_path)
    target_rel = str(target.relative_to(Path.cwd()))

    with open(log, "a") as f:
        f.write(f"=== Reverse engineering from {from_path} ===\n")

    # --- Stage 1: Triage ---
    ui.stage("Stage 1/3: Triaging files...")
    triage = AgentLoop(
        model=model, stream=False, extra_body=extra, max_tokens=4096,
        system_prompt=(
            "You are a code analyst. Given a file tree, return ONLY a JSON array of "
            "relative file paths worth analyzing for requirements. Skip build artifacts, "
            "minified bundles, lock files, images, and generated code. "
            "Return raw JSON, no markdown fences."
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
        files = _json.loads(triage_response.strip())
    except _json.JSONDecodeError:
        import re
        m = re.search(r"\[.*\]", triage_response, re.DOTALL)
        if m:
            files = _json.loads(m.group())
        else:
            ui.error("Triage did not return a valid file list.")
            with open(log, "a") as f:
                f.write(f"Triage response:\n{triage_response}\n")
            return 1

    ui.info(f"{len(files)} files selected")
    with open(log, "a") as f:
        f.write(f"Triage: {files}\n")

    # --- Stage 2: Analysis — one agent per file, concurrent (REQ-ARCH-7) ---
    ui.stage("Stage 2/3: Analyzing files...")
    analysis_tools, analysis_handlers = _pick_tools({"read_source_file", "store_file_analysis"})

    import time as _time
    from concurrent.futures import ThreadPoolExecutor, as_completed

    max_workers = 2 if model.model_type == "local" else 8
    _counter = {"done": 0}
    _lock = __import__("threading").Lock()

    def _analyze_file(filepath: str) -> tuple[str, float | None, str | None]:
        start = _time.time()
        agent = AgentLoop(
            model=model, stream=False, extra_body=extra, max_tokens=4096,
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
        futures = {pool.submit(_analyze_file, fp): fp for fp in files}
        for future in as_completed(futures):
            filepath, elapsed, err = future.result()
            with _lock:
                _counter["done"] += 1
                n = _counter["done"]
            if err:
                ui.progress(n, len(files), f"{filepath}...")
                ui._con.print(f" [yellow]⚠ {err}[/yellow]")
            else:
                ui.progress(n, len(files), f"{filepath}...")
                ui._con.print(f" [green]✓[/green] [dim]{elapsed:.1f}s[/dim]")
            with open(log, "a") as f:
                f.write(f"Analyzed: {filepath}\n")

    # --- Stage 3: Synthesis ---
    ui.stage("Stage 3/3: Writing requirements...")
    ui.model_label(model.alias)

    synth_tools, synth_handlers = _pick_tools(
        {"get_all_analyses", "get_template", "get_skill", "write_file"}
    )
    synth = AgentLoop(
        model=model, stream=True, extra_body=extra, max_tokens=8192,
        on_token=ui.make_token_handler(),
        system_prompt=(
            "[ROLE: Analyst]\n\n"
            "You are writing requirements from file analysis summaries.\n"
            "Use get_all_analyses() to retrieve the summaries.\n"
            "Use get_template('REQUIREMENTS-TEMPLATE') for the output format.\n"
            "Use get_skill('PROD-STRATEGY') and get_skill('QUALITY-QA') for guidance.\n"
            f"Use write_file() to write the final requirements to '{target_rel}'."
        ),
        tools=synth_tools, tool_handlers=synth_handlers,
    )

    try:
        response = synth.send("Write the requirements from the stored analyses.")
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
    exclude = {".git", "node_modules", "__pycache__", ".cache", "dist", "build", ".venv", "venv",
               ".voidrift", ".agendev", ".aider.tags.cache.v4", "static/assets"}
    skip_names = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}
    lines = []
    count = 0
    for p in sorted(directory.rglob("*")):
        if count >= max_files:
            lines.append(f"... (truncated at {max_files} files)")
            break
        if any(part in exclude for part in p.parts):
            continue
        if p.is_file():
            # Skip dotfiles in root (e.g. .aider.*, .gitignore)
            rel = p.relative_to(directory)
            if rel.parts[0].startswith("."):
                continue
            if p.name in skip_names:
                continue
            lines.append(str(rel))
            count += 1
    return "\n".join(lines)
