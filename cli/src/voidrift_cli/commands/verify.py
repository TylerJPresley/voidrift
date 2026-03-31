"""Verify command: Requirements-driven acceptance testing (REQ-VF-3 through REQ-VF-16)."""

from __future__ import annotations

import json
import re
import signal
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from ..config import get_concurrency, get_max_tokens
from ..models import ModelConfig
from ..utils import (
    append_state,
    boot_run,
    check_disk_space,
    check_requirements_exist,
    ensure_voidrift_dir,
    voidrift_dir,
)
from .. import prompts, ui
from ..skills import find_skill
from ..tools.process_manager import start_process, wait_for_ready, stop_all
from ..tools.http_client import clear_sessions
from ..tools.browser import close_all_sessions


# ---------------------------------------------------------------------------
# VERIFY-PLAN.md parser
# ---------------------------------------------------------------------------

_ITEM_RE = re.compile(r"^### (ITEM-\d+)(\s+\[SKIP\])?", re.MULTILINE)


def _parse_verify_plan(text: str) -> list[dict]:
    """Parse VERIFY-PLAN.md into a list of item dicts.

    Each dict has: item_id (str), skip (bool), content (str — full item block text).
    """
    items = []
    matches = list(_ITEM_RE.finditer(text))
    for i, match in enumerate(matches):
        item_id = match.group(1)
        skip = bool(match.group(2))
        start = match.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        content = text[start:end].strip()
        items.append({"item_id": item_id, "skip": skip, "content": content})
    return items


# ---------------------------------------------------------------------------
# ARCHITECTURE.md helpers
# ---------------------------------------------------------------------------

def _read_arch_field(d: Path, field: str) -> str:
    """Return the value of a `field:` line from ARCHITECTURE.md, or empty string."""
    arch = d / "ARCHITECTURE.md"
    if not arch.exists():
        return ""
    pattern = re.compile(rf"^\s*{re.escape(field)}:\s*(.+)$", re.MULTILINE)
    m = pattern.search(arch.read_text())
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Sub-agent executor
# ---------------------------------------------------------------------------

def _run_sub_agent(
    item: dict,
    run_id: str,
    worker: ModelConfig,
    log: Path,
    process_handle_id: str | None,
) -> dict:
    """Execute one test case in an isolated sub-agent.

    Args:
        item: Parsed item dict (item_id, skip, content).
        run_id: Current verify run ID (injected into bug reports).
        worker: Model config.
        log: Path to the run log.
        process_handle_id: Handle ID of the running product process, or None.

    Returns:
        Dict with: item_id, status ("pass"/"fail"/"skip"), bug_report_path (or None).
    """
    item_id = item["item_id"]

    if item["skip"]:
        return {"item_id": item_id, "status": "skip", "bug_report_path": None}

    # Inject run context into the test case
    context_lines = [f"Run ID: {run_id}", f"Timestamp: {datetime.now().isoformat()}"]
    if process_handle_id:
        context_lines.append(f"Process handle_id: {process_handle_id}")
    context_prefix = "\n".join(context_lines)

    system_prompt = _build_execute_prompt()
    tools, handlers = build_local_tools("verify-execute")

    agent = AgentLoop(
        model=worker,
        system_prompt=system_prompt,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(worker.model_type, "verify-execute"),
        log_path=log,
        show_spinner=False,
    )

    user_msg = f"{context_prefix}\n\n{item['content']}"
    try:
        agent.send(user_msg)
    except (RuntimeError, OSError, ValueError) as exc:
        return {
            "item_id": item_id,
            "status": "fail",
            "bug_report_path": None,
            "error": str(exc),
        }

    # Determine pass/fail from response and whether a bug report was written
    d = voidrift_dir()
    bug_path = d / "bugs" / f"{item_id}.md"
    if bug_path.exists():
        return {"item_id": item_id, "status": "fail", "bug_report_path": str(bug_path)}

    # No bug report written → treat as pass
    return {"item_id": item_id, "status": "pass", "bug_report_path": None}


# ---------------------------------------------------------------------------
# Prompt builders
# ---------------------------------------------------------------------------

def _build_plan_prompt() -> str:
    """Build the Stage 1 system prompt."""
    parts: list[str] = []
    system_ctx = prompts.load_prompt("system", "CONTEXT")
    if system_ctx:
        parts.append(system_ctx)
    skill = find_skill("QUALITY-QA")
    if skill:
        parts.append(skill)
    plan_prompt = prompts.load_prompt("verify", "PLAN")
    if plan_prompt:
        parts.append(plan_prompt)
    return "\n\n".join(parts)


def _build_execute_prompt() -> str:
    """Build the Stage 2 sub-agent system prompt."""
    parts: list[str] = []
    system_ctx = prompts.load_prompt("system", "CONTEXT")
    if system_ctx:
        parts.append(system_ctx)
    skill = find_skill("QUALITY-QA")
    if skill:
        parts.append(skill)
    exec_prompt = prompts.load_prompt("verify", "EXECUTE")
    if exec_prompt:
        parts.append(exec_prompt)
    return "\n\n".join(parts)


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------

def _write_verify_md(
    d: Path,
    results: list[dict],
    run_id: str,
) -> str:
    """Write .voidrift/VERIFY.md and return the verdict string."""
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skip")
    verdict = "PASS" if failed == 0 else "FAIL"
    ts = datetime.now().isoformat(timespec="seconds")

    lines = [
        "# Verify Report",
        "",
        f"Run: {run_id}",
        f"Completed: {ts}",
        f"Verdict: {verdict}",
        "",
        "## Summary",
        "",
        "| Total | Passed | Failed | Skipped |",
        "|-------|--------|--------|---------|",
        f"| {total} | {passed} | {failed} | {skipped} |",
        "",
        "## Results",
        "",
    ]

    for r in results:
        item_id = r["item_id"]
        status = r["status"]
        if status == "pass":
            lines.append(f"### {item_id} ✓ PASS")
        elif status == "fail":
            bug = r.get("bug_report_path") or "no bug report"
            lines.append(f"### {item_id} ✗ FAIL")
            lines.append(f"Bug report: [{bug}]({bug})")
            if r.get("error"):
                lines.append(f"Error: {r['error']}")
        else:
            lines.append(f"### {item_id} — SKIPPED")
        lines.append("")

    lines += [
        "## Verdict",
        "",
        f"{verdict} — {passed} passed, {failed} failed, {skipped} skipped.",
    ]

    content = "\n".join(lines)
    (d / "VERIFY.md").write_text(content)
    return verdict


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_verify(worker: ModelConfig) -> int:
    """Execute the verify command (REQ-VF-3 through REQ-VF-16).

    Args:
        worker: Model configuration for both plan and execute agents.

    Returns:
        Exit code (0 for PASS, 1 for FAIL or error).
    """
    check_disk_space()
    d = ensure_voidrift_dir()

    # REQ-VF-P: preflight guard
    if not check_requirements_exist():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1

    log, run_id = boot_run("verify")
    ui.header("VoidRift Verify")
    ui.detail(f"Run: {run_id}  Log: {log}")

    process_handle_id: str | None = None
    _interrupted = False

    def _handle_sigterm(signum: int, frame: object) -> None:
        nonlocal _interrupted
        _interrupted = True

    prev_sigterm = signal.signal(signal.SIGTERM, _handle_sigterm)
    prev_sigint = signal.signal(signal.SIGINT, _handle_sigterm)

    try:
        # ── Stage 1: Plan agent ──────────────────────────────────────────
        ui.stage("Stage 1 — Planning test cases...")
        plan_tools, plan_handlers = build_local_tools("verify-plan")
        plan_agent = AgentLoop(
            model=worker,
            system_prompt=_build_plan_prompt(),
            tools=plan_tools,
            tool_handlers=plan_handlers,
            stream=False,
            max_tokens=get_max_tokens(worker.model_type, "verify-plan"),
            log_path=log,
            show_spinner=False,
        )

        with ui.spinner(ui.random_label(), "verify plan") as spin:
            plan_agent.on_progress = spin.on_progress
            try:
                plan_agent.send("Produce the verify plan for this project.")
            except (RuntimeError, OSError, ValueError) as exc:
                ui.error(f"Plan agent failed: {exc}")
                return 1

        verify_plan_file = d / "VERIFY-PLAN.md"
        if not verify_plan_file.exists():
            ui.error("Plan agent did not write VERIFY-PLAN.md.")
            return 1

        items = _parse_verify_plan(verify_plan_file.read_text())
        if not items:
            ui.error("VERIFY-PLAN.md contains no items.")
            return 1

        testable = [it for it in items if not it["skip"]]
        skipped_items = [it for it in items if it["skip"]]
        ui.detail(f"{len(testable)} test cases, {len(skipped_items)} skipped.")

        # ── Bootstrap ───────────────────────────────────────────────────
        bootstrap_cmd = _read_arch_field(d, "test_bootstrap")
        if bootstrap_cmd and bootstrap_cmd.lower() not in ("none", ""):
            ui.stage("Running test bootstrap...")
            try:
                result = subprocess.run(
                    bootstrap_cmd,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=120,
                )
                if result.returncode != 0:
                    ui.warn(f"Bootstrap exited {result.returncode}: {result.stderr[:200]}")
                else:
                    ui.detail("Bootstrap complete.")
            except subprocess.TimeoutExpired:
                ui.warn("Bootstrap timed out (120s) — continuing.")

        # ── Start product process ────────────────────────────────────────
        startup_cmd = _read_arch_field(d, "startup_command")
        if startup_cmd and startup_cmd.lower() not in ("none", ""):
            ui.stage(f"Starting product: {startup_cmd}")
            handle_result = start_process(startup_cmd)
            try:
                handle_data = json.loads(handle_result)
                process_handle_id = handle_data.get("handle_id")
                ui.detail(f"PID {handle_data.get('pid')} — handle {process_handle_id}")
            except (ValueError, KeyError):
                ui.error(f"Failed to start product: {handle_result}")
                return 1

            # Wait for readiness — default http strategy if startup_command is an http server
            # Fall back to a brief fixed delay if no strategy can be inferred
            ready_result = wait_for_ready(
                process_handle_id,
                strategy="http",
                target="http://localhost:8000/",
                timeout=30,
            )
            if ready_result != "ready":
                # Not fatal — the test cases themselves will detect if the server is down
                ui.warn(f"Readiness check: {ready_result}")

        # ── Stage 2: Concurrent sub-agents ──────────────────────────────
        ui.stage("Stage 2 — Executing test cases...")
        results: list[dict] = []

        # Add skip results immediately
        for item in skipped_items:
            results.append({"item_id": item["item_id"], "status": "skip", "bug_report_path": None})

        if testable:
            (d / "bugs").mkdir(exist_ok=True)
            max_workers = get_concurrency(worker.model_type)
            if max_workers == 0:
                max_workers = len(testable)
            max_workers = max(1, max_workers)

            with ThreadPoolExecutor(max_workers=max_workers) as pool:
                futures = {
                    pool.submit(
                        _run_sub_agent,
                        item,
                        run_id,
                        worker,
                        log,
                        process_handle_id,
                    ): item["item_id"]
                    for item in testable
                }
                done_count = 0
                for future in as_completed(futures):
                    item_id = futures[future]
                    try:
                        result = future.result()
                    except Exception as exc:
                        result = {"item_id": item_id, "status": "fail", "bug_report_path": None, "error": str(exc)}
                    results.append(result)
                    done_count += 1
                    status_icon = "✓" if result["status"] == "pass" else "✗"
                    ui.detail(f"  {status_icon} {item_id} ({done_count}/{len(testable)})")

        # ── Stage 3: Write report ────────────────────────────────────────
        ui.stage("Stage 3 — Writing report...")
        # Sort results by item_id for deterministic output
        results.sort(key=lambda r: r["item_id"])
        verdict = _write_verify_md(d, results, run_id)

        failed_count = sum(1 for r in results if r["status"] == "fail")
        append_state(
            cmd="verify",
            model_alias=worker.alias,
            summary=(
                f"Verdict: {verdict} — "
                f"{sum(1 for r in results if r['status'] == 'pass')} passed, "
                f"{failed_count} failed, "
                f"{sum(1 for r in results if r['status'] == 'skip')} skipped"
            ),
            files_created=["VERIFY.md"],
        )

        if verdict == "PASS":
            ui.done("Verification passed.")
            return 0
        else:
            ui.error(f"Verification failed — {failed_count} failure(s). See .voidrift/VERIFY.md.")
            return 1

    except KeyboardInterrupt:
        _interrupted = True
        ui.warn("Interrupted.")
        return 1
    finally:
        signal.signal(signal.SIGTERM, prev_sigterm)
        signal.signal(signal.SIGINT, prev_sigint)
        stop_all()
        clear_sessions()
        close_all_sessions()
