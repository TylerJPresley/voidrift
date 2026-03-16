"""Phase 1 — Gather: Requirements elicitation (AC-G1 through AC-G13)."""

from __future__ import annotations

import sys
from pathlib import Path

import click
from rich.console import Console

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig, ensure_model_ready, cleanup_model
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space, console, err_console,
)

# System prompt for the Analyst role
ANALYST_PROMPT = """[ROLE: Analyst]

You are an Analyst in the VoidRift framework. Your job is to elicit requirements through interactive conversation.

Focus on "what" the system must do, not "how" it will be built.
Ask clarifying questions before writing requirements.
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

After writing REQUIREMENTS.md, list all identified features and tell the user to run 'voidrift gather <model> <feature>' for each.

Do NOT write the file until you have sufficient information. Ask questions first.
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
        # Feature gather requires REQUIREMENTS.md to exist (AC-G2)
        if not (d / "REQUIREMENTS.md").exists():
            err_console.print(
                "[red]REQUIREMENTS.md not found. Run 'voidrift gather <model>' "
                "first to create project requirements.[/red]"
            )
            return 1
        target = d / "spec" / f"{feature}.md"
        target.parent.mkdir(exist_ok=True)  # AC-G10
    else:
        target = d / "REQUIREMENTS.md"

    # Reverse engineering mode (AC-G11)
    if from_path:
        return _gather_from(model, target, Path(from_path), feature, force)

    # Interactive mode (AC-G3, AC-G4)
    try:
        ensure_model_ready(model)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        return 1

    # Build system prompt
    system = ANALYST_PROMPT
    if reference_path:
        system += f"\n\nA reference codebase is available at {reference_path}. You can use read_source_file() to examine it."

    # Load existing file for revision (AC-G1)
    initial_context = ""
    if target.exists():
        initial_context = f"Here is the existing file for revision:\n\n{target.read_text()}"

    # Set up MCP tools (AC-CLI4)
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=tools,
        tool_handlers=handlers,
        stream=True,
    )

    # Start conversation
    console.print(f"[bold cyan]VoidRift Gather[/bold cyan] — {'Feature: ' + feature if feature else 'Full Project'}")
    console.print(f"Model: {model.alias} ({model.model_id})")
    if target.exists():
        console.print(f"[dim]Revising existing: {target.relative_to(Path.cwd())}[/dim]")
    else:
        console.print(f"[dim]Creating new: {target.relative_to(Path.cwd())}[/dim]")
    console.print("[dim]Type 'quit' or Ctrl+C to exit[/dim]\n")

    if initial_context:
        agent.send(initial_context)

    # Interactive loop (AC-G3)
    log = log_path("gather")
    try:
        while True:
            try:
                user_input = input("\n> ").strip()
            except EOFError:
                break
            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "/quit"):
                break

            with open(log, "a") as f:
                f.write(f"\n> {user_input}\n")

            response = agent.send(user_input)

            with open(log, "a") as f:
                f.write(f"\n{response}\n")
    except KeyboardInterrupt:
        console.print("\n[dim]Session ended.[/dim]")
    finally:
        cleanup_model(model)

    return 0


def _gather_from(
    model: ModelConfig,
    target: Path,
    from_path: Path,
    feature: str | None,
    force: bool,
) -> int:
    """Reverse engineering mode (AC-G11).

    Args:
        model: Model configuration for the analyst role.
        target: Path where requirements will be written.
        from_path: Path to the existing codebase.
        feature: Optional feature name.
        force: Overwrite existing target file.

    Returns:
        Exit code (0 for success, 1 for failure).
    """
    # Check target exists
    if target.exists() and not force:
        console.print(
            f"[red]Error: {target} already exists. Use --force to overwrite, "
            f"or run without --from to revise interactively.[/red]"
        )
        return 1

    if not from_path.is_dir():
        err_console.print(f"[red]Error: {from_path} is not a directory[/red]")
        return 1

    if force and target.exists():
        target.unlink()

    try:
        ensure_model_ready(model)
    except RuntimeError as e:
        err_console.print(f"[red]Error: {e}[/red]")
        return 1

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    log = log_path("gather")
    console.print(f"[bold cyan]VoidRift Gather (Reverse Engineering)[/bold cyan]")
    console.print(f"Source: {from_path}")
    console.print(f"Target: {target}")

    agent = AgentLoop(
        model=model,
        system_prompt=(
            "[ROLE: Analyst]\n\n"
            "You are reverse-engineering requirements from an existing codebase.\n"
            "The codebase is read-only. Treat code as ground truth, documentation as claims to verify.\n"
            "Analyze the codebase structure, then produce requirements.\n"
            "Use write_file() to write the requirements when ready.\n"
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=True,
    )

    # Build file tree from reference directory
    file_tree = _build_file_tree(from_path)
    prompt = (
        f"Analyze this codebase at {from_path} and generate requirements.\n\n"
        f"File tree:\n{file_tree}\n\n"
        f"Use read_source_file() to examine files (prefix paths with '{from_path}/').\n"
        f"When done, use write_file() to write the requirements to "
        f"'{target.relative_to(Path.cwd())}'."
    )

    with open(log, "a") as f:
        f.write(f"=== Reverse engineering from {from_path} ===\n")

    try:
        response = agent.send(prompt)
        with open(log, "a") as f:
            f.write(response + "\n")
    except KeyboardInterrupt:
        console.print("\n[dim]Interrupted.[/dim]")
    finally:
        cleanup_model(model)

    if target.exists():
        console.print(f"\n[green]✅ Requirements written to {target.relative_to(Path.cwd())}[/green]")
        return 0
    else:
        err_console.print("[yellow]⚠ Requirements file was not created.[/yellow]")
        return 1


def _build_file_tree(directory: Path, max_files: int = 500) -> str:
    """Build a file tree string, excluding common non-source directories.

    Args:
        directory: Root directory to scan.
        max_files: Maximum number of files to include.

    Returns:
        Newline-separated list of relative file paths.
    """
    exclude = {".git", "node_modules", "__pycache__", ".cache", "dist", "build", ".venv", "venv"}
    lines = []
    count = 0
    for p in sorted(directory.rglob("*")):
        if count >= max_files:
            lines.append(f"... (truncated at {max_files} files)")
            break
        if any(part in exclude for part in p.parts):
            continue
        if p.is_file():
            lines.append(str(p.relative_to(directory)))
            count += 1
    return "\n".join(lines)
