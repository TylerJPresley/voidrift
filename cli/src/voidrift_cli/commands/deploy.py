"""Deploy command: Release management and optional IaC (REQ-DPL-1 through REQ-DPL-5)."""

from __future__ import annotations

import re
import subprocess
from datetime import datetime
from pathlib import Path

from ..agent import AgentLoop, build_local_tools
from ..config import get_max_tokens
from ..models import ModelConfig
from ..utils import ensure_voidrift_dir, voidrift_dir, boot_run, check_disk_space
from .. import prompts
from .. import ui


def _detect_iac() -> bool:
    """Check if IaC files exist."""
    cwd = Path.cwd()
    for pattern in ["*.tf", "*/*.tf", "*/*/*.tf"]:
        if list(cwd.glob(pattern)):
            return True
    for name in ["cdk.json", "podman-compose.yml", "podman-compose.yaml",
                  "docker-compose.yml", "docker-compose.yaml"]:
        if (cwd / name).exists():
            return True
    return False


def _last_release_tag() -> str | None:
    """Return the most recent vX.Y.Z tag, or None."""
    try:
        result = subprocess.run(
            ["git", "tag", "--sort=-v:refname", "--list", "v*"],
            capture_output=True, text=True, timeout=5,
        )
        for line in result.stdout.strip().splitlines():
            if re.match(r"^v\d+\.\d+\.\d+$", line.strip()):
                return line.strip()
    except Exception:
        pass
    return None


def _read_history_since_tag(d: Path, tag: str | None) -> list[str]:
    """Read history.log lines since the given tag's timestamp, or all lines."""
    history = d / "tasks" / "history.log"
    if not history.exists():
        return []
    lines = history.read_text().strip().splitlines()
    if not tag:
        return lines
    # Get tag timestamp
    try:
        result = subprocess.run(
            ["git", "log", "-1", "--format=%aI", tag],
            capture_output=True, text=True, timeout=5,
        )
        tag_ts = result.stdout.strip()
    except Exception:
        return lines
    if not tag_ts:
        return lines
    return [l for l in lines if l[:19] > tag_ts[:19]]


def _build_changelog_entry(history_lines: list[str], version: str) -> str:
    """Build a changelog entry from history.log lines (REQ-DPL-2)."""
    modules: dict[str, list[str]] = {}
    for line in history_lines:
        # Format: 2026-04-01T10:00:00 TASK-1 verified module=backend assigned=kiro
        parts = line.split()
        if len(parts) < 4:
            continue
        entity = parts[1]
        mod = ""
        for p in parts[3:]:
            if p.startswith("module="):
                mod = p.split("=", 1)[1]
        modules.setdefault(mod or "general", []).append(entity)

    lines = [f"## {version} — {datetime.now().strftime('%Y-%m-%d')}\n"]
    for mod, entities in sorted(modules.items()):
        lines.append(f"### {mod.capitalize()}\n")
        for e in entities:
            lines.append(f"- {e}")
        lines.append("")
    return "\n".join(lines)


def _read_arch_field(d: Path, field: str) -> str:
    """Read a YAML-style field from ARCHITECTURE.md."""
    arch = d / "ARCHITECTURE.md"
    if not arch.exists():
        return ""
    pattern = re.compile(rf"^{field}:\s*(.+)$", re.MULTILINE)
    m = pattern.search(arch.read_text())
    return m.group(1).strip() if m else ""


def run_deploy(worker: ModelConfig, architect: ModelConfig | None = None) -> int:
    """Execute the deploy command (REQ-DPL-1 through REQ-DPL-5)."""
    check_disk_space()
    d = ensure_voidrift_dir()

    if not (d / "REQUIREMENTS.md").exists():
        ui.error("REQUIREMENTS.md not found. Run 'voidrift gather <model>' first.")
        return 1
    if not (d / "ARCHITECTURE.md").exists():
        ui.error("ARCHITECTURE.md not found. Run 'voidrift plan <model>' first.")
        return 1

    ui.header("VoidRift Deploy")
    log, run_id = boot_run("deploy")
    ui.detail(f"Log: {log}")

    # ── Version bump (REQ-DPL-1) ────────────────────────────────────────
    last_tag = _last_release_tag()
    history_lines = _read_history_since_tag(d, last_tag)

    if not history_lines:
        ui.warn("No verified tasks since last release. Nothing to deploy.")
        return 0

    current_version = last_tag.lstrip("v") if last_tag else "0.0.0"
    ui.detail(f"Current version: {current_version} ({len(history_lines)} tasks since)")

    # Ask model to classify the bump
    task_summary = "\n".join(history_lines)
    reqs_text = (d / "REQUIREMENTS.md").read_text()[:8000]

    agent = AgentLoop(
        model=worker,
        system_prompt=prompts.load_prompt("deploy", "VERSION-CLASSIFY"),
        tools=[], tool_handlers={},
        stream=False,
        max_tokens=get_max_tokens(worker, "deploy.version"),
        log_path=log,
        show_spinner=False,
    )

    user_msg = prompts.load_prompt("deploy", "VERSION-USER").format(
        current_version=current_version,
        task_summary=task_summary,
        requirements=reqs_text,
    )

    with ui.spinner("Classifying changes...", "deploy version") as spin:
        agent.on_progress = spin.on_progress
        try:
            bump_response = agent.send(user_msg).strip().lower()
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"Version classification failed: {e}")
            return 1

    bump = bump_response if bump_response in ("major", "minor", "patch") else "minor"

    # Calculate new version
    major, minor, patch = (int(x) for x in current_version.split("."))
    if bump == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump == "minor":
        minor, patch = minor + 1, 0
    else:
        patch += 1
    new_version = f"{major}.{minor}.{patch}"

    # Operator confirmation
    import click
    ui.info(f"Suggested bump: {bump} → v{new_version}")
    override = click.prompt(
        "  Confirm version (or enter a different one)",
        default=new_version,
    ).strip().lstrip("v")
    new_version = override

    # ── Changelog (REQ-DPL-2) ───────────────────────────────────────────
    changelog_entry = _build_changelog_entry(history_lines, f"v{new_version}")
    changelog_path = Path.cwd() / "CHANGELOG.md"
    if changelog_path.exists():
        existing = changelog_path.read_text()
        # Insert after the first heading
        m = re.search(r"^#\s+.+\n", existing)
        if m:
            insert_at = m.end()
            updated = existing[:insert_at] + "\n" + changelog_entry + "\n" + existing[insert_at:]
        else:
            updated = changelog_entry + "\n" + existing
        changelog_path.write_text(updated)
    else:
        changelog_path.write_text(f"# Changelog\n\n{changelog_entry}\n")
    ui.success(f"CHANGELOG.md updated with v{new_version}")

    # ── Git tag (REQ-DPL-3) ─────────────────────────────────────────────
    tag_name = f"v{new_version}"
    try:
        subprocess.run(
            ["git", "tag", "-a", tag_name, "-m", changelog_entry],
            check=True, capture_output=True, text=True, timeout=10,
        )
        ui.success(f"Tagged {tag_name}")
    except subprocess.CalledProcessError as e:
        ui.error(f"Git tag failed: {e.stderr}")
        return 1

    # ── History log rotation (REQ-DPL-3) ────────────────────────────────
    from ..manifest import ManifestManager
    mm = ManifestManager(project_dir=d.parent)
    archived = mm.rotate_history_log(new_version)
    if archived:
        ui.detail(f"History archived: {archived.relative_to(Path.cwd())}")

    # ── Conditional IaC (REQ-DPL-4) ─────────────────────────────────────
    arch_text = (d / "ARCHITECTURE.md").read_text()
    has_infra = any(s in arch_text.lower() for s in ["infrastructure", "deployment", "iac", "terraform", "docker"])
    if has_infra:
        ui.stage("Generating infrastructure-as-code...")
        iac_tools, iac_handlers = build_local_tools()
        iac_agent = AgentLoop(
            model=worker,
            system_prompt=prompts.load_prompt("deploy", "IAC"),
            tools=iac_tools, tool_handlers=iac_handlers,
            stream=False, max_tokens=get_max_tokens(worker, "deploy.iac"),
            log_path=log, show_spinner=False,
        )
        iac_mode = "Review" if _detect_iac() else "Generate"
        iac_user = prompts.load_prompt("deploy", "IAC-USER").format(
            iac_mode=iac_mode,
            architecture=arch_text[:8000],
        )
        with ui.spinner(f"{iac_mode}ing IaC...", "deploy iac") as spin:
            iac_agent.on_progress = spin.on_progress
            try:
                iac_agent.send(iac_user)
            except (RuntimeError, OSError, ValueError) as e:
                ui.warn(f"IaC generation failed: {e}")

    # ── Post-deploy hook (REQ-DPL-5) ────────────────────────────────────
    post_deploy = _read_arch_field(d, "post_deploy")
    if post_deploy:
        ui.stage(f"Running post-deploy: {post_deploy}")
        try:
            result = subprocess.run(
                post_deploy, shell=True, capture_output=True, text=True,
                timeout=120, env={**__import__("os").environ, "VERSION": new_version},
            )
            if result.returncode != 0:
                ui.warn(f"Post-deploy exited {result.returncode}: {result.stderr[:200]}")
            else:
                ui.detail("Post-deploy complete.")
        except subprocess.TimeoutExpired:
            ui.warn("Post-deploy timed out (120s).")

    # ── State entry ─────────────────────────────────────────────────────
    from ..utils import append_state
    append_state(
        cmd="deploy",
        model_alias=worker.alias,
        summary=f"Released v{new_version} ({bump} bump, {len(history_lines)} tasks).",
        files_created=["CHANGELOG.md"],
    )

    ui.done(f"Deploy complete — v{new_version}")
    return 0
