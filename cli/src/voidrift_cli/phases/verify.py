"""Phase 5 — Verify: Quality checks and reporting (AC-V1 through AC-V12)."""

from __future__ import annotations

import subprocess
from datetime import datetime
from pathlib import Path

from rich.status import Status

from ..agent import AgentLoop, build_mcp_tools
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, log_path, check_disk_space
from .. import ui


def _run_checks() -> tuple[str, int]:
    """Detect tech stack and run appropriate checks (AC-V1)."""
    cwd = Path.cwd()
    output_parts = [f"# Verification Results\n\nDate: {datetime.now().isoformat()}\n"]
    failed = 0
    checks_run = set()

    def _run(name: str, cmd: list[str], is_lint: bool = False) -> None:
        nonlocal failed
        if name in checks_run:
            return
        checks_run.add(name)
        ui.info(f"Running {name}...")
        output_parts.append(f"\n## {name}\n\n```\n")
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, cwd=cwd)
            output_parts.append(r.stdout)
            if r.stderr:
                output_parts.append(r.stderr)
            output_parts.append("```\n")
            if r.returncode != 0 and not is_lint:
                failed += 1
                output_parts.append(f"**EXIT CODE: {r.returncode}**\n")
        except FileNotFoundError:
            output_parts.append(f"Command not found: {cmd[0]}\n```\n")
        except subprocess.TimeoutExpired:
            output_parts.append("TIMEOUT (300s)\n```\n")
            failed += 1

    # Python
    if (cwd / "pyproject.toml").exists() or (cwd / "setup.py").exists() or list(cwd.glob("**/*.py")):
        if (cwd / "pyproject.toml").exists():
            _run("Python Tests (pytest)", ["python", "-m", "pytest", "-v", "--tb=short"])
        _run("Python Lint (ruff)", ["ruff", "check", "."], is_lint=True)

    # Node.js
    if (cwd / "package.json").exists():
        _run("Node Tests", ["npm", "test"])
        _run("Node Lint", ["npm", "run", "lint"], is_lint=True)

    # Rust
    if (cwd / "Cargo.toml").exists():
        _run("Rust Tests", ["cargo", "test"])
        _run("Rust Lint (clippy)", ["cargo", "clippy"], is_lint=True)

    # Go
    if (cwd / "go.mod").exists():
        _run("Go Tests", ["go", "test", "./..."])
        _run("Go Vet", ["go", "vet", "./..."], is_lint=True)

    # Java/Gradle
    if (cwd / "build.gradle").exists() or (cwd / "build.gradle.kts").exists():
        _run("Gradle Tests", ["./gradlew", "test"])

    # Java/Maven
    if (cwd / "pom.xml").exists():
        _run("Maven Tests", ["mvn", "test"])

    # Docker/Compose
    for compose in ["docker-compose.yml", "docker-compose.yaml", "podman-compose.yml", "podman-compose.yaml"]:
        if (cwd / compose).exists():
            _run("Compose Validation", ["docker-compose", "-f", compose, "config", "--quiet"])
            break

    # Terraform
    if list(cwd.glob("**/*.tf")):
        _run("Terraform Validate", ["terraform", "validate"])

    if not checks_run:
        output_parts.append("\nNo test suites detected.\n")

    return "\n".join(output_parts), failed


def run_verify(worker: ModelConfig, architect: ModelConfig | None = None) -> int:
    """Execute the verify phase."""
    check_disk_space()
    d = ensure_voidrift_dir()

    ui.phase("VoidRift Verify")

    # Run checks
    ui.stage("Running quality checks...")
    raw_output, failed_checks = _run_checks()

    raw_file = d / "VERIFY-RAW.md"
    raw_file.write_text(raw_output)

    log = log_path("verify")
    ui.detail(f"Log: {log}")

    try:
        import voidrift_mcp.server as mcp_mod
        mcp_mod._boot()
        tools, handlers = build_mcp_tools(mcp_mod)
    except ImportError:
        tools, handlers = [], {}

    # Analysis
    context_parts = [f"Raw check output:\n{raw_output}"]
    if (d / "REQUIREMENTS.md").exists():
        context_parts.append(f"REQUIREMENTS.md:\n{(d / 'REQUIREMENTS.md').read_text()[:12000]}")
    if (d / "ARCHITECTURE.md").exists():
        context_parts.append(f"ARCHITECTURE.md:\n{(d / 'ARCHITECTURE.md').read_text()[:8000]}")

    agent = AgentLoop(
        model=worker,
        system_prompt=(
            "[ROLE: Developer]\n\n"
            "Analyze test results and produce a verification report.\n"
            "Use write_file() to write .voidrift/VERIFY.md with exactly these sections:\n"
            "- Test Results\n- Lint & Static Analysis\n- Infrastructure\n"
            "- Requirements Coverage (table: criterion | status | evidence)\n"
            "- Issues (numbered list)\n"
            "- Verdict (first line: exactly 'PASS' or 'FAIL', then one-sentence summary)\n"
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=False,
    )

    ui.stage("Analyzing results...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            response = agent.send("\n\n".join(context_parts))
            with open(log, "a") as f:
                f.write(f"\n=== Verify: {datetime.now().isoformat()} ===\n{response}\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Analysis failed: {e}")
            return 1

    raw_file.unlink(missing_ok=True)

    # Check verdict
    verify_file = d / "VERIFY.md"
    passed = False
    if verify_file.exists():
        text = verify_file.read_text()
        for line in text.splitlines():
            stripped = line.strip()
            if stripped == "PASS" and failed_checks == 0:
                passed = True
                break
            if stripped == "FAIL":
                break

    if passed:
        ui.done("Verification passed.")
        return 0

    # FAIL path
    if not architect:
        ui.error("Verification failed.")
        ui.info("Re-run with an architect model to generate fix tasks.")
        return 1

    ui.warn("Verification failed — consulting architect for fix plan...")

    verify_content = verify_file.read_text() if verify_file.exists() else "No VERIFY.md produced"

    arch_agent = AgentLoop(
        model=architect,
        system_prompt=(
            "[ROLE: Architect]\n\n"
            "Review verification failures and create a remediation plan. "
            "Categorize each issue as: fixable task, acceptable tradeoff, or out-of-scope. "
            "Use write_file() to write your response to .voidrift/ARCHITECT_VERIFY.md"
        ),
        tools=tools,
        tool_handlers=handlers,
        stream=False,
    )

    ui.stage("Architect planning fixes...")
    with Status("  ⠋ Thinking...", console=ui._con):
        try:
            arch_response = arch_agent.send(verify_content)
            with open(log, "a") as f:
                f.write(f"\n--- Architect fix plan ---\n{arch_response}\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Architect consultation failed: {e}")

    arch_verify = d / "ARCHITECT_VERIFY.md"
    if arch_verify.exists():
        fix_agent = AgentLoop(
            model=worker,
            system_prompt=(
                "[ROLE: Developer]\n\n"
                "Read the architect's remediation plan and produce .voidrift/TASKS-fixes.md "
                "with fix tasks. Only include tasks the architect marked as needing work. "
                "Use standard task format. Delete .voidrift/ARCHITECT_VERIFY.md when done."
            ),
            tools=tools,
            tool_handlers=handlers,
            stream=False,
        )
        ui.stage("Generating fix tasks...")
        with Status("  ⠋ Thinking...", console=ui._con):
            try:
                fix_response = fix_agent.send(arch_verify.read_text())
                with open(log, "a") as f:
                    f.write(f"\n--- Fix tasks ---\n{fix_response}\n")
            except (RuntimeError, OSError, ValueError) as e:
                ui.error(f"Fix task generation failed: {e}")

    if (d / "TASKS-fixes.md").exists():
        ui.warn("Verification failed — fix tasks generated.")
        ui.info("Run 'voidrift develop <worker> <architect>' to address fixes.")
    else:
        ui.error("Verification failed.")

    return 1
