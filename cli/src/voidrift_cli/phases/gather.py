"""Phase 1 — Gather: Requirements elicitation (AC-G1 through AC-G13)."""

from __future__ import annotations

import sys
from pathlib import Path

import click
from rich.console import Console

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space, console, err_console,
)

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

    # Build system prompt
    system = ANALYST_PROMPT.replace("{model}", model.alias)
    target_rel = str(target.relative_to(Path.cwd()))
    system += f"\n\nWhen using write_file(), write to exactly this path: {target_rel}"
    if reference_path:
        system += f"\n\nA reference codebase is available at {reference_path}. You can use read_source_file() to examine it."

    # Load existing file into system prompt for revision (AC-G1)
    if target.exists():
        system += f"\n\nHere is the existing requirements file for revision:\n\n{target.read_text()}"

    # CLI-native filesystem tools for interactive gather (REQ-G-3, REQ-MCP-4a)
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

    # Interactive terminal loop (REQ-UI-1)
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

    # Build tools: MCP content tools + CLI-native filesystem tools (REQ-MCP-4a)
    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        from ..tools import LOCAL_TOOLS, LOCAL_HANDLERS
        tools = list(LOCAL_TOOLS)
        handlers = dict(LOCAL_HANDLERS)

    # Override read_source_file to read from the source codebase
    def read_from_source(path: str) -> str:
        full = (from_path / path).resolve()
        if not str(full).startswith(str(from_path.resolve())):
            return f"Access denied: {path} is outside the source directory"
        if not full.exists():
            return f"File not found: {path}"
        return full.read_text(encoding="utf-8", errors="replace")

    handlers["read_source_file"] = read_from_source

    log = log_path("gather")
    console.print(f"[bold cyan]VoidRift Gather (Reverse Engineering)[/bold cyan]")
    console.print(f"[dim]Log: {log}[/dim]")
    console.print(f"Source: {from_path}")
    console.print(f"Target: {target}")

    # Load requirements template and skills
    resources = Path.home() / ".voidrift" / "resources"
    template = ""
    skills = ""
    try:
        t = resources / "templates" / "REQUIREMENTS-TEMPLATE.md"
        if t.exists():
            template = t.read_text()
        for name in ("PROD-STRATEGY.md", "QUALITY-QA.md"):
            s = resources / "skills" / name
            if s.exists():
                skills += s.read_text() + "\n\n"
    except OSError:
        pass

    _blue = "\033[38;5;117m"
    _reset = "\033[0m"
    _at_line_start = True
    _blank_lines = 0

    def _on_token(token: str) -> None:
        nonlocal _at_line_start, _blank_lines
        out = ""
        for ch in token:
            if ch == "\n":
                if _at_line_start:
                    _blank_lines += 1
                    if _blank_lines > 1:
                        continue
                else:
                    _blank_lines = 0
                _at_line_start = True
                out += ch
            else:
                if _at_line_start:
                    out += "  "
                    _at_line_start = False
                    _blank_lines = 0
                out += ch
        if out:
            sys.stdout.write(f"{_blue}{out}{_reset}")
            sys.stdout.flush()

    agent = AgentLoop(
        model=model,
        system_prompt=(
            "[ROLE: Analyst]\n\n"
            "You are reverse-engineering requirements from an existing codebase.\n"
            "The codebase is read-only. Treat code as ground truth, documentation as claims to verify.\n"
            "Analyze the codebase structure, then produce requirements.\n"
            "Use write_file() to write the requirements when ready.\n\n"
            "You MUST follow this template structure exactly:\n\n"
            f"{template}\n\n"
            f"Follow these skills:\n\n{skills}"
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=True,
        on_token=_on_token,
        extra_body={"chat_template_kwargs": {"enable_thinking": False}}
        if model.model_type == "local"
        else None,
    )

    # Build file tree from reference directory
    file_tree = _build_file_tree(from_path)
    prompt = (
        f"Analyze this codebase at {from_path} and generate requirements.\n\n"
        f"File tree:\n{file_tree}\n\n"
        f"Use read_source_file() to examine files (use relative paths like 'README.md').\n"
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
