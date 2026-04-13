"""Plan pipeline helpers — extracted from plan.py for testability and size management."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from .. import prompts
from ..models import ModelConfig
from ..config import get_max_tokens
from .. import ui


def check_req_coverage(d: Path, requirements: str) -> None:
    """Warn on REQ IDs in REQUIREMENTS.md not covered by any task's reqs: field (REQ-P-17)."""
    import yaml as _yaml

    all_reqs = set(re.findall(r"REQ-[A-Z]+-\d+", requirements))
    if not all_reqs:
        return

    covered: set[str] = set()
    active = d / "tasks" / "active"
    if active.exists():
        for tf in active.glob("TASK-*.md"):
            text = tf.read_text()
            if text.startswith("---"):
                try:
                    end = text.index("---", 3)
                    fm = _yaml.safe_load(text[3:end]) or {}
                    for r in fm.get("reqs", []):
                        covered.update(re.findall(r"REQ-[A-Z]+-\d+", str(r)))
                except (ValueError, _yaml.YAMLError):
                    pass

    uncovered = sorted(all_reqs - covered)
    if uncovered:
        ui.warn(f"{len(uncovered)} requirement(s) not covered by any task: {', '.join(uncovered[:10])}")
        if len(uncovered) > 10:
            ui.warn(f"  ... and {len(uncovered) - 10} more")
    else:
        ui.detail(f"All {len(all_reqs)} requirements covered by tasks.")


def dispatch_agent(
    model: ModelConfig,
    tools: list,
    handlers: dict,
    log: Path,
    system_prompt: str,
    user_message: str,
    retry_message: str | None,
    check_fn: Callable[[], bool],
    stage_label: str,
    stage_key: str = "plan.architecture",
    agent_cls: type | None = None,
) -> bool:
    """Dispatch one agent, verify artifact, retry once on failure. Returns True on success."""
    if agent_cls is None:
        from ..agent import AgentLoop
        agent_cls = AgentLoop

    agent = agent_cls(
        model=model,
        system_prompt=system_prompt,
        tools=tools,
        tool_handlers=handlers,
        stream=False,
        max_tokens=get_max_tokens(model, stage_key),
        log_path=log,
        show_spinner=False,
    )

    with ui.spinner(ui.random_label(), stage_label) as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send(user_message)
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"{stage_label} failed: {e}")
            return False

    if check_fn():
        return True

    if retry_message is None:
        ui.error(f"Plan failed: {stage_label} produced no output.")
        return False

    ui.warn(f"{stage_label} — retrying...")
    with ui.spinner("Retrying...", f"{stage_label} retry") as spin:
        agent.on_progress = spin.on_progress
        try:
            response = agent.send(retry_message)
            with open(log, "a") as f:
                f.write(response + "\n")
        except (RuntimeError, OSError, ValueError) as e:
            ui.error(f"{stage_label} retry failed: {e}")
            return False

    if not check_fn():
        ui.error(f"Plan failed: {stage_label} still produced no output after retry.")
        return False

    return True


def extract_modules(arch_text: str, d: Path) -> list[str]:
    """Extract module names from ARCHITECTURE.md YAML frontmatter."""
    import yaml

    if arch_text.startswith("---"):
        try:
            end = arch_text.index("---", 3)
            fm = yaml.safe_load(arch_text[3:end]) or {}
            modules = fm.get("modules", [])
            if modules:
                return [str(m).lower() for m in modules]
        except (ValueError, yaml.YAMLError):
            pass

    arch_dir = d / "arch"
    if arch_dir.is_dir():
        return [p.stem for p in sorted(arch_dir.glob("*.md"))]

    return []


def arch_summary(arch_text: str, max_chars: int = 4000) -> str:
    """Return a compact architecture summary for Stage 2 context."""
    if len(arch_text) <= max_chars:
        return arch_text

    fm_end = 0
    if arch_text.startswith("---"):
        try:
            fm_end = arch_text.index("---", 3) + 3
        except ValueError:
            pass

    body_budget = max_chars - fm_end
    if body_budget <= 0:
        return arch_text[:max_chars]

    return arch_text[:fm_end] + arch_text[fm_end:fm_end + body_budget] + "\n\n[architecture continues...]"


def parse_outline_tasks(outline_path: Path) -> tuple[str, list[dict]]:
    """Parse module name and task list from a tasks/outline/<module>.md file."""
    import yaml
    content = outline_path.read_text()
    if not content.startswith("---"):
        return outline_path.stem, []
    try:
        end = content.index("---", 3)
        fm = yaml.safe_load(content[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return outline_path.stem, []
    return fm.get("module", outline_path.stem), fm.get("tasks", [])


def format_task_entry(outline_path: Path, task_id: int) -> str:
    """Extract a single task's outline entry as text for PLAN-TASK context."""
    import yaml
    content = outline_path.read_text()
    if not content.startswith("---"):
        return f"id: {task_id}"
    try:
        end = content.index("---", 3)
        fm = yaml.safe_load(content[3:end]) or {}
    except (ValueError, yaml.YAMLError):
        return f"id: {task_id}"

    tasks = fm.get("tasks", [])
    entry = next((t for t in tasks if t.get("id") == task_id), {})

    lines = [
        f"id: {entry.get('id', task_id)}",
        f"title: {entry.get('title', '')}",
    ]
    files = entry.get("files", [])
    if files:
        lines.append("files:")
        for f in files:
            lines.append(f"  - {f}")
    lines.append(f"depends: {entry.get('depends', [])}")

    body = content[end + 3:].lstrip("\n")
    match = re.search(
        rf"(?:^|\n)(## Task {task_id}[:\s].*?)(?=\n## Task \d+|\Z)",
        body,
        re.DOTALL,
    )
    if match:
        lines.append("")
        lines.append(match.group(1).strip())

    return "\n".join(lines)


def build_task_files(d: Path, requirements: str, architecture: str, idea_id: int | None = None) -> int:
    """Read task files written by the model and build manifest (REQ-TM-1, REQ-TM-4)."""
    import yaml
    from ..manifest import ManifestManager

    mm = ManifestManager(project_dir=d.parent)
    mm.ensure_dirs()
    mm._data = {"tasks": {}, "modules": {}, "dependencies": {}, "next_id": 1, "next_bug_id": 1}

    active = mm._active_dir
    count = 0
    for task_file in sorted(active.glob("TASK-*.md")):
        content = task_file.read_text()
        if not content.startswith("---"):
            continue
        try:
            end = content.index("---", 3)
            fm = yaml.safe_load(content[3:end]) or {}
        except (ValueError, yaml.YAMLError):
            continue

        tid = fm.get("id")
        module = fm.get("module", "default")
        depends = fm.get("depends", [])
        if tid is None:
            continue

        mm.add_task(int(tid), module, depends=depends or None, idea=idea_id)

        needs_rewrite = False
        if idea_id is not None and fm.get("idea") != idea_id:
            fm["idea"] = idea_id
            needs_rewrite = True

        valid = available_skills()
        if valid:
            skills = fm.get("skills", [])
            invalid = [s for s in skills if s not in valid]
            if invalid:
                resolved = [s for s in skills if s in valid]
                for bad in invalid:
                    match = resolve_skill(bad, valid)
                    if match:
                        resolved.append(match)
                        ui.info(f"TASK-{tid}: resolved skill '{bad}' → '{match}'")
                    else:
                        ui.warn(f"TASK-{tid}: stripped unknown skill '{bad}' (no match)")
                fm["skills"] = resolved
                needs_rewrite = True

        if needs_rewrite:
            fm_str = yaml.dump(fm, default_flow_style=False).strip()
            body = content[end + 3:].lstrip("\n")
            task_file.write_text(f"---\n{fm_str}\n---\n{body}")

        count += 1

    mm.save()
    return count


def available_skills() -> set[str]:
    """Return set of valid skill names from all layers."""
    return set(available_skills_with_desc().keys())


def source_file_listing(project_dir: Path) -> str:
    """Build a newline-separated listing of project source files (REQ-P-11)."""
    import pathspec

    gitignore = project_dir / ".gitignore"
    spec = (
        pathspec.PathSpec.from_lines("gitignore", gitignore.read_text().splitlines())
        if gitignore.is_file()
        else pathspec.PathSpec.from_lines("gitignore", [])
    )

    lines = []
    for p in sorted(project_dir.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(project_dir)
        if any(part.startswith(".") for part in rel.parts):
            continue
        if spec.match_file(str(rel)):
            continue
        lines.append(str(rel))
    return "\n".join(lines)


def available_skills_with_desc() -> dict[str, str]:
    """Return dict of skill name → description from all layers."""
    from ..skills import _skill_dirs, _first_line
    skills: dict[str, str] = {}
    for skills_dir in _skill_dirs(Path.cwd()):
        if not skills_dir.is_dir():
            continue
        for p in skills_dir.glob("*.md"):
            name = p.stem.upper()
            if name not in skills:
                skills[name] = _first_line(p)
    return skills


def resolve_skill(invalid: str, valid: set[str]) -> str | None:
    """Return the best-matching valid skill by word overlap, or None (REQ-P-9)."""
    invalid_words = set(invalid.upper().split("-"))
    best: str | None = None
    best_count = 0
    for candidate in valid:
        shared = len(invalid_words & set(candidate.split("-")))
        if shared > best_count:
            best_count = shared
            best = candidate
    return best if best_count > 0 else None
