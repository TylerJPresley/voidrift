"""Diagnostic checks for voidrift doctor (REQ-U-16, REQ-U-16b)."""

from __future__ import annotations

import shutil
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

CheckResult = Literal["pass", "warn", "fail"]


@dataclass
class Check:
    name: str
    result: CheckResult
    message: str = ""
    fix_hint: str = ""
    auto_fixable: bool = False


def run_checks(fix: bool = False) -> list[Check]:
    """Run all doctor checks. If fix=True, auto-remediate where safe."""
    from .config import _voidrift_home, load_config, get_models_file

    checks: list[Check] = []
    home = _voidrift_home()

    # 1. Config file
    cfg_path = home / "config.yml"
    if not cfg_path.exists():
        checks.append(Check("config", "fail", f"Config not found: {cfg_path}", "Run 'make sync' to create it"))
    else:
        try:
            load_config()
            checks.append(Check("config", "pass", str(cfg_path)))
        except Exception as e:
            checks.append(Check("config", "fail", f"Config parse error: {e}"))

    # 2. Models file
    try:
        mf = get_models_file()
        if not mf.exists():
            checks.append(Check("models", "fail", f"Models file not found: {mf}", "Configure models_file in config.yml"))
        else:
            import yaml
            try:
                data = yaml.safe_load(mf.read_text()) or {}
                models = data.get("models", [])
                count = len(models) if isinstance(models, list) else 0
                checks.append(Check("models", "pass", f"{mf} ({count} models)"))
            except yaml.YAMLError as e:
                checks.append(Check("models", "fail", f"Models YAML error: {e}"))
    except Exception:
        checks.append(Check("models", "warn", "Could not determine models file path"))

    # 3. Skills
    skills_dir = home / "resources" / "skills"
    if skills_dir.is_dir():
        files = list(skills_dir.glob("*.md"))
        bad = []
        for f in files:
            try:
                text = f.read_text(encoding="utf-8")[:512]
                if not text.startswith("---"):
                    bad.append(f.name)
            except OSError:
                bad.append(f.name)
        if bad:
            msg = f"{len(files)} files, {len(bad)} missing frontmatter"
            checks.append(Check("skills", "warn", msg, "Add YAML frontmatter to skill files"))
        else:
            checks.append(Check("skills", "pass", f"{len(files)} files, all parseable"))
    else:
        checks.append(Check("skills", "warn", "Skills directory not found", "Run 'make sync'"))

    # 4. Log directory
    log_dir = home / "logs"
    if log_dir.is_dir():
        try:
            test_file = log_dir / ".doctor-test"
            test_file.write_text("ok")
            test_file.unlink()
            checks.append(Check("logs", "pass", f"{log_dir} — writable"))
        except OSError:
            checks.append(Check("logs", "fail", f"{log_dir} — not writable"))
    else:
        if fix:
            log_dir.mkdir(parents=True, exist_ok=True)
            checks.append(Check("logs", "pass", f"Created {log_dir}"))
        else:
            checks.append(Check("logs", "fail", f"{log_dir} missing", "Run 'voidrift doctor --fix'", auto_fixable=True))

    # 5. Disk space
    try:
        usage = shutil.disk_usage(Path.cwd())
        free_gb = usage.free / (1024 ** 3)
        if free_gb < 0.1:
            checks.append(Check("disk", "fail", f"{free_gb:.1f}GB available", "Free disk space"))
        elif free_gb < 1.0:
            checks.append(Check("disk", "warn", f"{free_gb:.1f}GB available"))
        else:
            checks.append(Check("disk", "pass", f"{free_gb:.0f}GB available"))
    except OSError:
        checks.append(Check("disk", "warn", "Could not check disk space"))

    # 6. Model entry validation (REQ-U-16b)
    try:
        mf = get_models_file()
        if mf.exists():
            checks.extend(_check_model_entries(mf))
    except Exception:
        pass

    # 7. Optional tool dependencies (REQ-U-16a)
    checks.extend(_check_optional_deps())

    return checks


_VALID_PROTOCOLS: frozenset[str] = frozenset({"openai", "anthropic"})


def _check_model_entries(models_file_path: Path) -> list[Check]:
    """Validate individual model entries for required fields and valid protocol (REQ-U-16b)."""
    import yaml

    try:
        data = yaml.safe_load(models_file_path.read_text()) or {}
    except Exception:
        return []  # Already reported by the models file YAML check

    defaults = data.get("defaults", {}) or {}
    models = data.get("models", {}) or {}
    if not isinstance(models, dict):
        return []

    failures: list[str] = []
    for alias, entry in models.items():
        if not isinstance(entry, dict):
            failures.append(f"'{alias}': not a valid entry")
            continue
        m = {**defaults, **entry}
        for field in ("base_url", "api_key", "model_id"):
            if field not in m:
                failures.append(f"'{alias}': missing required field '{field}'")
        protocol = m.get("protocol", "openai")
        if protocol not in _VALID_PROTOCOLS:
            failures.append(
                f"'{alias}': invalid protocol '{protocol}' "
                f"(valid: {', '.join(sorted(_VALID_PROTOCOLS))})"
            )

    if failures:
        return [Check(
            "model-entries",
            "fail",
            "; ".join(failures),
            "Fix missing/invalid fields in models.yml then re-run 'voidrift doctor'",
        )]
    count = len(models)
    return [Check("model-entries", "pass", f"{count} entr{'y' if count == 1 else 'ies'} valid")]


_OPTIONAL_DEPS: list[tuple[str, str, str]] = [
    ("tree_sitter", "tree-sitter", "code_analysis tool"),
    ("tree_sitter_python", "tree-sitter-python", "code_analysis for Python"),
    ("fitz", "pymupdf", "read_document for PDF"),
    ("docx", "python-docx", "read_document for DOCX"),
    ("openpyxl", "openpyxl", "read_document for XLSX"),
]


def _check_optional_deps() -> list[Check]:
    """Check availability of optional tool dependencies."""
    import importlib

    checks: list[Check] = []
    for module_name, pip_name, purpose in _OPTIONAL_DEPS:
        try:
            importlib.import_module(module_name)
            checks.append(Check(f"optional:{pip_name}", "pass", f"{pip_name} — available ({purpose})"))
        except (ImportError, ModuleNotFoundError):
            checks.append(Check(
                f"optional:{pip_name}", "warn",
                f"{pip_name} not installed ({purpose})",
                f"pip install {pip_name}",
            ))
    return checks
