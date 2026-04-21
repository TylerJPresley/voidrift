"""Verify pipeline helpers — parsing, sub-agents, reporting, manifest updates."""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from ..config import get_max_tokens
from ..models import ModelConfig
from ..utils import (
    ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space,
    check_requirements_exist, append_state,
)
from .. import prompts, ui
from ..skills import find_skill
from ..tools.process_manager import start_process, wait_for_ready, stop_all
from ..tools.http_client import clear_sessions
from ..tools.browser import close_all_sessions

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
    return m.group(1).strip().strip('"').strip("'") if m else ""


# ---------------------------------------------------------------------------
# Documentation verification (REQ-VF-17)
# ---------------------------------------------------------------------------

def _run_doc_verify(worker: "ModelConfig", d: Path, log: Path, fs_ctx: object) -> bool:
    """Run documentation verification agent. Returns True if no issues found."""
    doc_prompt = prompts.load_prompt("verify", "DOC-VERIFY")
    if not doc_prompt:
        return True

    (d / "bugs").mkdir(exist_ok=True)

    tools, handlers = build_local_tools("verify-plan", project_dir=d.parent, ctx=fs_ctx)
    agent = AgentLoop(
        model=worker,
        system_prompt=doc_prompt,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(worker, "verify.plan"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), "doc verify") as spin:
        agent.on_progress = spin.on_progress
        try:
            agent.send(prompts.load_prompt("verify", "DOC-VERIFY-USER"))
        except (RuntimeError, OSError, ValueError) as exc:
            ui.warn(f"Doc verification failed: {exc}")
            return False

    return True


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
    from ..tools.filesystem import WriteContext as _WriteContext
    _exec_ctx = _WriteContext(project_dir=voidrift_dir().parent, max_read_lines=worker.max_read_lines)
    tools, handlers = build_local_tools("verify-execute", project_dir=voidrift_dir().parent, ctx=_exec_ctx)

    agent = AgentLoop(
        model=worker,
        system_prompt=system_prompt,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(worker, "verify.execute"),
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
    doc_bug_count: int = 0,
) -> str:
    """Write .voidrift/VERIFY.md and return the verdict string."""
    total = len(results)
    passed = sum(1 for r in results if r["status"] == "pass")
    failed = sum(1 for r in results if r["status"] == "fail")
    skipped = sum(1 for r in results if r["status"] == "skip")
    verdict = "PASS" if failed == 0 and doc_bug_count == 0 else "FAIL"
    ts = datetime.now().isoformat(timespec="seconds")

    lines = [
        "# Verify Report",
        "",
        f"Run: {run_id}",
        f"Completed: {ts}",
        f"Verdict: {verdict}",
        "",
    ]

    if doc_bug_count:
        lines += [
            "## Documentation",
            "",
            f"{doc_bug_count} documentation mismatch(es) found. See `.voidrift/bugs/DOC-*.md`.",
            "",
        ]

    lines += [
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


def _update_manifest(d: Path, results: list[dict], run_id: str) -> None:
    """Create bugs for failures, archive verified tasks (REQ-TM-6, REQ-TM-7)."""
    from ..manifest import ManifestManager
    import shutil

    mm = ManifestManager(project_dir=d.parent)
    if not mm.exists():
        return
    mm.load()

    tasks = mm.tasks()
    if not tasks:
        return

    # Build req → task_ids mapping from task files
    req_to_tasks: dict[str, list[int]] = {}
    for tid in tasks:
        content = mm.read_task(tid)
        if not content:
            continue
        for line in content.splitlines():
            stripped = line.strip().lower()
            if stripped.startswith("reqs:"):
                for r in stripped.split(":", 1)[1].split(","):
                    r = r.strip().upper()
                    if r:
                        req_to_tasks.setdefault(r, []).append(tid)

    failed_task_ids: set[int] = set()
    passed_item_ids: set[str] = set()

    for r in results:
        item_id = r["item_id"]
        if r["status"] == "fail":
            # Extract REQ reference from item_id (e.g. ITEM-REQ-D-1 → REQ-D-1)
            req_ref = item_id.replace("ITEM-", "")
            task_ids = req_to_tasks.get(req_ref, [])
            failed_task_ids.update(task_ids)

            # Create bug in manifest
            bug_id = mm.next_bug_id
            bug_path = r.get("bug_report_path")
            if bug_path:
                # Move bug from .voidrift/bugs/ to tasks/active/BUG-{id}.md
                src = Path(bug_path)
                if src.exists():
                    dst = mm.bug_path(bug_id)
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(src), str(dst))
            mm.add_bug(bug_id, refs=task_ids)

            # Mark linked tasks as failed
            for tid in task_ids:
                mm.set_status(tid, "failed")

        elif r["status"] == "pass":
            passed_item_ids.add(item_id)

    # Check if any implemented tasks have all their reqs passing
    for tid, task in tasks.items():
        if task.get("status") != "implemented":
            continue
        if tid in failed_task_ids:
            continue
        # All reqs for this task must have passed
        content = mm.read_task(tid)
        if not content:
            continue
        task_reqs: list[str] = []
        for line in content.splitlines():
            stripped = line.strip().lower()
            if stripped.startswith("reqs:"):
                task_reqs = [r.strip().upper() for r in stripped.split(":", 1)[1].split(",") if r.strip()]
        if not task_reqs:
            continue
        all_passed = all(f"ITEM-{req}" in passed_item_ids for req in task_reqs)
        if all_passed:
            mm.set_status(tid, "verified")
            mm.archive(tid)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------



def _run_plan_agent(worker: ModelConfig, d: Path, log: Path, fs_ctx: object) -> bool:
    """Run the Stage 1 plan agent. Returns True on success."""
    plan_tools, plan_handlers = build_local_tools("verify-plan", project_dir=d.parent, ctx=fs_ctx)
    plan_agent = AgentLoop(
        model=worker,
        system_prompt=_build_plan_prompt(),
        tools=plan_tools,
        tool_handlers=plan_handlers,
        stream=False,
        max_tokens=get_max_tokens(worker, "verify.plan"),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), "verify plan") as spin:
        plan_agent.on_progress = spin.on_progress
        try:
            plan_agent.send(prompts.load_prompt("verify", "PLAN-USER"))
        except (RuntimeError, OSError, ValueError) as exc:
            ui.error(f"Plan agent failed: {exc}")
            return False
    return True
