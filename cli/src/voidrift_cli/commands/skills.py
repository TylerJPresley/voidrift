"""Skills management commands (REQ-SKL-1 through REQ-SKL-5)."""

from __future__ import annotations

import shutil
from pathlib import Path
from urllib.parse import urlparse

import click

from .. import ui
from ..config import voidrift_home


def _voidrift_dir() -> Path:
    """Return the project .voidrift directory."""
    from ..utils import voidrift_dir
    return voidrift_dir()


def _ns_dir() -> Path:
    return voidrift_home() / "resources" / "skills"


def _domain_dir() -> Path:
    return voidrift_home() / "domain-skills"


def _pending_dir() -> Path:
    return _domain_dir() / "pending"


def _project_dir() -> Path:
    return _voidrift_dir() / "skills"


def _find_skill_path(name: str) -> tuple[Path | None, str]:
    """Return (path, layer_label) for the first matching skill across all layers."""
    upper = name.upper()
    for path, label in (
        (_project_dir(), "project"),
        (_domain_dir(), "domain"),
        (_ns_dir(), "north-star"),
    ):
        candidate = path / f"{upper}.md"
        if candidate.is_file():
            return candidate, label
    return None, ""


def _read_description(path: Path) -> str:
    content = path.read_text(encoding="utf-8")
    if content.startswith("---\n"):
        end = content.find("\n---\n", 4)
        if end != -1:
            for line in content[4:end].splitlines():
                if line.startswith("description:"):
                    return line[len("description:"):].strip()[:100]
    for line in content.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and not stripped.startswith("---"):
            return stripped[:100]
    return ""


def _list_layer(directory: Path, label: str) -> list[tuple[str, str, str]]:
    if not directory.is_dir():
        return []
    rows = []
    for p in sorted(directory.glob("*.md")):
        rows.append((p.stem.lower(), label, _read_description(p)))
    return rows


def _raw_base_url(repo_url: str) -> str:
    """Convert a GitHub repo URL to its raw content base URL."""
    parsed = urlparse(repo_url)
    if "github.com" in parsed.netloc:
        path = parsed.path.rstrip("/").rstrip(".git")
        return f"https://raw.githubusercontent.com{path}/main"
    # For other hosts just append /raw
    return repo_url.rstrip("/")


def _fetch_url(url: str) -> str | None:
    """Fetch a URL and return text, or None on error."""
    import urllib.request
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def _fetch_manifest(repo_url: str) -> list[dict]:
    """Fetch and parse a skills-manifest.yml from a repo. Returns [] on failure."""
    raw_base = _raw_base_url(repo_url)
    manifest_url = f"{raw_base}/skills-manifest.yml"
    content = _fetch_url(manifest_url)
    if not content:
        return []
    try:
        import yaml
        data = yaml.safe_load(content)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("skills", [])
    except Exception:
        pass
    return []


def _search_repo_manifests(query: str) -> list[tuple[str, str, str, str]]:
    """Search repo manifests for skills matching query. Returns (name, desc, tags, source_url)."""
    from ..config import get_skills_config
    cfg = get_skills_config()
    repos = cfg.get("repos", [])
    q = query.lower()
    results = []
    for repo_url in repos:
        manifests = _fetch_manifest(repo_url)
        for entry in manifests:
            name = str(entry.get("name", "")).lower()
            desc = str(entry.get("description", ""))
            tags = ", ".join(entry.get("tags", []))
            if q in name or q in desc.lower() or q in tags.lower():
                results.append((name, desc, tags, repo_url))
    return results


@click.group("skills")
def skills_cmd():
    """Manage skills (north-star, domain, project layers)."""


@skills_cmd.command("list")
@click.option("--layer", type=click.Choice(["north-star", "domain", "project", "all"]), default="all")
def skills_list(layer):
    """List available skills across all layers."""
    rows = []
    if layer in ("all", "north-star"):
        rows += _list_layer(_ns_dir(), "north-star")
    if layer in ("all", "domain"):
        rows += _list_layer(_domain_dir(), "domain")
        rows += [(name, "domain/pending", desc) for name, _, desc in _list_layer(_pending_dir(), "domain/pending")]
    if layer in ("all", "project"):
        rows += _list_layer(_project_dir(), "project")

    if not rows:
        ui.info("No skills found.")
        return

    col_name = max(len(r[0]) for r in rows) + 2
    col_layer = max(len(r[1]) for r in rows) + 2
    for name, lyr, desc in rows:
        ui._con.print(f"  {name:<{col_name}} {lyr:<{col_layer}} {desc}")


@skills_cmd.command("search")
@click.argument("query")
@click.option("--local-only", is_flag=True, help="Search local layers only, skip repo manifests")
def skills_search(query, local_only):
    """Search skills by name or description (local layers + configured repos)."""
    q = query.lower()
    rows: list[tuple[str, str, str]] = []

    # Search local layers
    for directory, label in (
        (_ns_dir(), "north-star"),
        (_domain_dir(), "domain"),
        (_pending_dir(), "domain/pending"),
        (_project_dir(), "project"),
    ):
        if not directory.is_dir():
            continue
        for p in sorted(directory.glob("*.md")):
            name = p.stem.lower()
            desc = _read_description(p)
            if q in name or q in desc.lower():
                rows.append((name, label, desc))

    # Search repo manifests
    if not local_only:
        from ..config import get_skills_config
        repos = get_skills_config().get("repos", [])
        if repos:
            ui.info(f"Searching {len(repos)} configured repo(s)...")
            for repo_url in repos:
                manifests = _fetch_manifest(repo_url)
                if manifests is None:
                    ui.warn(f"Could not reach {repo_url}")
                    continue
                for entry in manifests:
                    name = str(entry.get("name", "")).lower()
                    desc = str(entry.get("description", ""))
                    tags = ", ".join(entry.get("tags", []))
                    combined = f"{name} {desc} {tags}".lower()
                    if q in combined:
                        source = urlparse(repo_url).netloc or repo_url
                        rows.append((name, f"repo:{source}", desc))

    if not rows:
        ui.info(f"No skills matching '{query}'.")
        return

    col_name = max(len(r[0]) for r in rows) + 2
    col_layer = max(len(r[1]) for r in rows) + 2
    for name, lyr, desc in rows:
        ui._con.print(f"  {name:<{col_name}} {lyr:<{col_layer}} {desc}")


@skills_cmd.command("review")
@click.argument("name", required=False)
def skills_review(name):
    """Display pending skills awaiting approval, or print a named skill's content."""
    if name is None:
        rows = _list_layer(_pending_dir(), "domain/pending")
        if not rows:
            ui.info("No pending skills.")
            return
        ui.detail("Pending skills (approve with: voidrift skills approve <name>)")
        for skill_name, _, desc in rows:
            ui._con.print(f"  {skill_name}  {desc}")
        return

    path, layer = _find_skill_path(name)
    if path is None:
        ui.error(f"Skill '{name}' not found.")
        return

    ui.detail(f"Skill: {name.upper()} ({layer})")
    ui._con.print(path.read_text(encoding="utf-8"))


@skills_cmd.command("install")
@click.argument("name")
@click.option("--from", "source_layer", type=click.Choice(["north-star", "domain"]), default=None,
              help="Copy from a local layer instead of running synthesis pipeline")
def skills_install(name, source_layer):
    """Synthesize and install a domain skill to pending/ for review.

    If skills.repos and skills.synthesis_model are configured, fetches matching
    skill content from configured repos and synthesizes it into VoidRift format.
    Otherwise copies from a local layer (north-star or domain).
    """
    from ..config import get_skills_config
    cfg = get_skills_config()
    repos = cfg.get("repos", [])
    synthesis_model_alias = cfg.get("synthesis_model", "")

    # --- Synthesis pipeline path (REQ-SKL-5) ---
    if repos and synthesis_model_alias and not source_layer:
        _install_via_synthesis(name, repos, synthesis_model_alias)
        return

    # --- Fallback: copy from local layer ---
    upper = name.upper()

    if source_layer == "north-star":
        src = _ns_dir() / f"{upper}.md"
    elif source_layer == "domain":
        src = _domain_dir() / f"{upper}.md"
    else:
        src = None
        for candidate in (_domain_dir() / f"{upper}.md", _ns_dir() / f"{upper}.md"):
            if candidate.is_file():
                src = candidate
                break

    if src is None or not src.is_file():
        ui.error(
            f"Skill '{name}' not found locally. "
            "Configure skills.repos and skills.synthesis_model to use the synthesis pipeline."
        )
        return

    dest_dir = _pending_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{upper}.md"

    if dest.exists():
        ui.warn(f"Pending skill '{name}' already exists — overwriting.")

    shutil.copy2(src, dest)
    ui.success(f"Copied '{name.lower()}' to pending. Review with: voidrift skills review {name}")


def _install_via_synthesis(name: str, repos: list[str], model_alias: str) -> None:
    """Run the synthesis pipeline to install a domain skill (REQ-SKL-5)."""
    upper = name.upper()
    q = name.lower()

    ui.stage(f"Searching {len(repos)} repo(s) for '{name}'...")

    # Step 1: Find matching entries in manifests
    matches: list[dict] = []
    for repo_url in repos:
        entries = _fetch_manifest(repo_url)
        for entry in entries:
            entry_name = str(entry.get("name", "")).lower()
            if q in entry_name or entry_name in q:
                entry["_repo_url"] = repo_url
                matches.append(entry)

    if not matches:
        ui.error(f"No skills matching '{name}' found in configured repos.")
        ui.info("Use 'voidrift skills search <name>' to discover available skills.")
        return

    # Step 2: Fetch full skill content from matching repos
    source_contents: list[str] = []
    for match in matches:
        repo_url = match.get("_repo_url", "")
        file_path = match.get("file_path", "")
        if not file_path:
            continue
        raw_base = _raw_base_url(repo_url)
        content = _fetch_url(f"{raw_base}/{file_path}")
        if content:
            source_contents.append(
                f"--- Source: {repo_url}/{file_path} ---\n{content}"
            )

    if not source_contents:
        ui.error(f"Found manifest entries for '{name}' but could not fetch skill content.")
        return

    ui.info(f"Fetched {len(source_contents)} source skill(s). Synthesizing...")

    # Step 3: Load DOMAIN-SKILL-TEMPLATE and invoke synthesis agent
    try:
        from ..models import resolve_model
        model = resolve_model(model_alias)
    except Exception as e:
        ui.error(f"Cannot resolve synthesis model '{model_alias}': {e}")
        return

    from .. import prompts as _prompts
    template = _prompts.load_template("DOMAIN-SKILL-TEMPLATE")
    if not template:
        template = "Write a VoidRift domain skill with: name, description, core philosophy, implementation rules."

    combined_sources = "\n\n".join(source_contents)
    system = _prompts.load_prompt("skills", "SYNTHESIS").format(template=template)
    user_message = _prompts.load_prompt("skills", "SYNTHESIS-USER").format(
        name=upper, sources=combined_sources
    )

    from ..agent import AgentLoop
    agent = AgentLoop(
        model=model,
        system_prompt=system,
        tools=[],
        tool_handlers={},
        stream=False,
    )

    try:
        result = agent.send(user_message)
    except Exception as e:
        ui.error(f"Synthesis failed: {e}")
        return

    if not result or len(result.strip()) < 50:
        ui.error("Synthesis produced insufficient output.")
        return

    # Ensure YAML frontmatter is present
    if not result.strip().startswith("---"):
        result = f"---\nname: {upper}\ndescription: {name.lower()} domain skill\n---\n\n{result}"

    dest_dir = _pending_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / f"{upper}.md"

    if dest.exists():
        ui.warn(f"Pending skill '{name}' already exists — overwriting.")

    dest.write_text(result, encoding="utf-8")
    ui.success(f"Synthesized '{name.lower()}' written to pending/.")
    ui.info(f"Review with: voidrift skills review {name}")
    ui.info(f"Approve with: voidrift skills approve {name}")


@skills_cmd.command("remove")
@click.argument("name")
@click.option("--layer", type=click.Choice(["project", "domain", "pending"]), default="project",
              help="Layer to remove from (default: project)")
def skills_remove(name, layer):
    """Remove a skill from the project or domain layer."""
    upper = name.upper()
    if layer == "project":
        target = _project_dir() / f"{upper}.md"
    elif layer == "pending":
        target = _pending_dir() / f"{upper}.md"
    else:
        target = _domain_dir() / f"{upper}.md"

    if not target.is_file():
        ui.error(f"Skill '{name}' not found in {layer} layer.")
        return

    target.unlink()
    ui.success(f"Removed '{name.lower()}' from {layer} layer.")


@skills_cmd.command("approve")
@click.argument("name")
def skills_approve(name):
    """Promote a pending or draft skill to approved status.

    For domain/pending skills: moves the file from pending/ to the active
    domain layer.

    For project-layer draft skills (created by find_or_synthesize_skill):
    updates the frontmatter status from 'draft' to 'approved' in place.
    """
    upper = name.upper()

    # Path 1: pending → domain (original behaviour)
    src = _pending_dir() / f"{upper}.md"
    if src.is_file():
        dest_dir = _domain_dir()
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{upper}.md"
        if dest.exists():
            ui.warn(f"Domain skill '{name}' already exists — overwriting.")
        shutil.move(str(src), dest)
        ui.success(f"Approved '{name.lower()}' — moved to domain layer.")
        return

    # Path 2: project-layer draft → approved
    from ..skills import approve_draft_skill
    project_root = _project_dir().parent.parent  # .voidrift/skills/../.. = project root
    promoted = approve_draft_skill(name, project_dir=project_root)
    if promoted:
        ui.success(f"Approved draft skill '{name.lower()}' — status set to approved.")
        return

    ui.error(
        f"No pending or draft skill '{name}' found. "
        "Use 'voidrift skills install' to add a pending skill, or "
        "'voidrift skills review' to see pending skills."
    )
