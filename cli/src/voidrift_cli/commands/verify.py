"""Verify command: Requirements-driven acceptance testing (REQ-VF-3 through REQ-VF-16)."""

from __future__ import annotations

# Tools available to verify-plan agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS_PLAN: frozenset[str] = frozenset({
    "read_source_file",
    "read_framework_file",
    "write_framework_file",
})

# Tools available to verify-execute agents (consumed by tool_builder.build_local_tools).
AGENT_TOOLS_EXECUTE: frozenset[str] = frozenset({
    "read_framework_file",
    "write_framework_file",
    "read_process_output",
    "http_request",
    "run_command",
    "browser_navigate",
    "browser_screenshot",
    "browser_click",
    "browser_get_text",
})

import json
import re
import signal
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from ..agent import build_local_tools
from ..config import get_max_tokens
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



from ._verify_pipeline import (
    _parse_verify_plan,
    _read_arch_field,
    _run_doc_verify,
    _run_plan_agent,
    _run_sub_agent,
    _build_plan_prompt,
    _build_execute_prompt,
    _write_verify_md,
    _update_manifest,
)

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
        # ── Stage 0: Documentation verification (REQ-VF-17) ─────────────
        ui.stage("Stage 0 — Verifying documentation...")
        from ..tools.filesystem import WriteContext as _WriteContext
        _fs_ctx = _WriteContext(project_dir=d.parent, max_read_lines=worker.max_read_lines)

        doc_bugs_before = set((d / "bugs").glob("DOC-*.md")) if (d / "bugs").exists() else set()
        _doc_verify_ok = _run_doc_verify(worker, d, log, _fs_ctx)
        doc_bugs_after = set((d / "bugs").glob("DOC-*.md")) if (d / "bugs").exists() else set()
        doc_bug_count = len(doc_bugs_after - doc_bugs_before)
        if doc_bug_count:
            ui.warn(f"Documentation: {doc_bug_count} mismatch(es) found. See .voidrift/bugs/DOC-*.md")
        else:
            ui.detail("Documentation consistent with source code.")

        # ── Stage 1: Plan agent ──────────────────────────────────────────
        ui.stage("Stage 1 — Planning test cases...")

        if not _run_plan_agent(worker, d, log, _fs_ctx):
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
            max_workers = worker.concurrency
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

        # ── Update manifest with results (REQ-TM-6, REQ-TM-7) ─────────
        _update_manifest(d, results, run_id)

        # ── Stage 3: Write report ────────────────────────────────────────
        ui.stage("Stage 3 — Writing report...")
        # Sort results by item_id for deterministic output
        results.sort(key=lambda r: r["item_id"])
        verdict = _write_verify_md(d, results, run_id, doc_bug_count=doc_bug_count)

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
