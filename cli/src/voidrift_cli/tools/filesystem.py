"""CLI-native filesystem tools.

These run on the workstation because they need local filesystem access.
Domain-separated by tool name:
  write_source_file / read_source_file  → project source tree
  write_framework_file / read_framework_file → .voidrift/ artifacts
  web_fetch → HTTP fetch + summarise via isolated sub-agent (chat only, REQ-U-8)
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Callable

# Web fetch — moved to tools/web.py; re-exported for back-compat
from .web import _strip_html, _default_web_confirm, make_web_fetch_handler


class WriteContext:
    """Per-run state for filesystem write tools (REQ-D-5, REQ-PS-3).

    Encapsulates mutable write-tracking state so tests can create isolated
    instances without relying on module-level globals.

    Usage:
        ctx = WriteContext(project_dir=tmp_path)
        ctx.write_source_file("src/main.py", "...")
    """

    def __init__(self, project_dir: Path | None = None, max_read_lines: int = 2000) -> None:
        self._project_dir = (project_dir or Path.cwd()).resolve()
        self._framework_dir = self._project_dir / ".voidrift"
        self._max_read_lines = max_read_lines
        self._max_read_bytes = 524288  # 512KB default (REQ-FSZ-5)
        self._source_write_count: int = 0
        self._written_this_run: set[str] = set()
        self._rewrite_allowed: set[str] = set()
        self._session_files: list[str] = []
        self._read_files: list[str] = []  # ordered history of files read (REQ-U-11)
        self._protected_paths: set[str] = set()  # paths blocked from writes (TASK-FW-013)
        self._log_path: Path | None = None
        self._mtime_registry: dict[str, float] = {}  # path → mtime after last write (REQ-D-19)

    # --- State management ---

    def reset_write_count(self) -> None:
        """Reset per-task write counter and duplicate guard. Call before each task."""
        self._source_write_count = 0
        self._written_this_run = set()
        self._mtime_registry = {}
        self._rewrite_allowed = set()

    def reset_session_files(self) -> None:
        """Reset session-level file log. Call at develop session start."""
        self._session_files = []

    def get_session_files(self) -> list[str]:
        """Return all source files written since last reset_session_files()."""
        return list(self._session_files)

    def get_read_files(self) -> list[str]:
        """Return unique file paths read during the session, most recent last (REQ-U-11)."""
        seen: set[str] = set()
        result: list[str] = []
        for p in self._read_files:
            if p not in seen:
                seen.add(p)
                result.append(p)
        return result

    def reset_read_files(self) -> None:
        """Reset read-file tracking."""
        self._read_files = []

    def get_write_count(self) -> int:
        """Return number of write_source_file calls since last reset_write_count()."""
        return self._source_write_count

    def allow_rewrite(self, path: str) -> None:
        """Allow a path to be rewritten (e.g. during iterative synthesis)."""
        self._rewrite_allowed.add(path)
        self._rewrite_allowed.add(f".voidrift/{path}")

    # --- Validation helpers ---

    def _log_block(self, path: str, reason: str) -> None:
        """Log a path block event (TASK-FW-013)."""
        if self._log_path:
            with open(self._log_path, "a") as f:
                f.write(f"[PATH_BLOCKED path={path!r} reason={reason}]\n")

    def _check_protected(self, path: str) -> str | None:
        """Return error if path is in the protected set (TASK-FW-013)."""
        if path in self._protected_paths:
            self._log_block(path, "protected")
            return f"Access denied: {path} is protected. Remove from protected_paths config to allow writes."
        return None

    def _check_sandbox(self, path: str, full: Path, root: Path) -> str | None:
        """Return error if resolved path escapes root (TASK-FW-013)."""
        try:
            full.resolve().relative_to(root)
        except ValueError:
            self._log_block(path, "outside_root")
            return f"Access denied: {path} is outside the project directory"
        return None

    def _snapshot_before_write(self, path: str, full: Path) -> None:
        """Record original file state before first write (REQ-D-15)."""
        snaps = getattr(_snapshots, "data", None)
        if snaps is None:
            return
        if path not in snaps:
            snaps[path] = full.read_text(encoding="utf-8", errors="replace") if full.exists() else None

    def _validate_content(self, content: str) -> str | None:
        if not content or content.strip() in ("...", "TODO", "TBD", "placeholder"):
            return f"Error: content is a placeholder ('{content.strip()}'). Write the FULL file content."
        return None

    def _check_write_size(self, path: str, content: str) -> str | None:
        limit = self._max_read_lines
        line_count = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        if line_count > limit:
            return (
                f"Error: {path} is {line_count} lines, which exceeds the {limit}-line limit. "
                f"This file exceeds the max_read_lines limit. "
                f"Decompose into smaller files and write each separately."
            )
        return None

    def _check_duplicate(self, path: str, full: Path, content: str) -> str | None:
        if path in self._written_this_run and full.exists() and path not in self._rewrite_allowed:
            existing = full.read_text(encoding="utf-8", errors="replace")
            if existing == content:
                return f"Already written: {path} — file is complete. Proceed to the next step."
        return None

    def _check_mtime(self, path: str, full: Path) -> str | None:
        """Return warning if file was modified externally since last write (REQ-D-19)."""
        if path not in self._mtime_registry:
            return None
        try:
            current = full.stat().st_mtime
        except OSError:
            return None
        if current != self._mtime_registry[path]:
            return (
                f"WARNING: {path} was modified externally since the last write. "
                f"Pass force_write=true to overwrite, or read the file first to merge."
            )
        return None

    def _record_mtime(self, path: str, full: Path) -> None:
        """Record mtime after a successful write (REQ-D-19)."""
        try:
            self._mtime_registry[path] = full.stat().st_mtime
        except OSError:
            pass

    # --- Tool implementations ---

    def write_source_file(self, path: str, content: str, force_write: bool = False) -> str:
        """Write a source file to the project directory."""
        if err := self._validate_content(content):
            return err
        if err := self._check_write_size(path, content):
            return err
        if path.startswith(".voidrift/") or path.startswith(".voidrift\\"):
            return "Access denied: use write_framework_file for .voidrift/ paths."
        full = self._project_dir / path
        if err := self._check_sandbox(path, full, self._project_dir):
            return err
        if err := self._check_protected(path):
            return err
        if not force_write:
            if err := self._check_mtime(path, full):
                return err
        if err := self._check_duplicate(path, full, content):
            return err
        self._snapshot_before_write(path, full)
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._source_write_count += 1
        self._written_this_run.add(path)
        self._session_files.append(path)
        self._record_mtime(path, full)
        return f"Wrote {len(content)} bytes to {path}"

    def edit_source_file(self, path: str, old_str: str, new_str: str, force_write: bool = False) -> str:
        """Surgical edit: replace old_str with new_str in a source file (REQ-FSZ-4)."""
        if path.startswith(".voidrift/") or path.startswith(".voidrift\\"):
            return "Access denied: use write_framework_file for .voidrift/ paths."
        full = self._project_dir / path
        if err := self._check_sandbox(path, full, self._project_dir):
            return err
        if err := self._check_protected(path):
            return err
        if not full.exists():
            return f"File not found: {path}"
        if not force_write:
            if err := self._check_mtime(path, full):
                return err

        content = full.read_text(encoding="utf-8", errors="replace")
        self._snapshot_before_write(path, full)

        # Exact match — must appear exactly once (REQ-FSZ-4 ambiguity rejection)
        occurrences = content.count(old_str)
        if occurrences > 1:
            return (
                f"Error: old_str appears {occurrences} times in {path}. "
                "Add surrounding lines to old_str to make it unique."
            )
        if occurrences == 1:
            result = content.replace(old_str, new_str, 1)
            full.write_text(result, encoding="utf-8")
            self._source_write_count += 1
            self._session_files.append(path)
            self._record_mtime(path, full)
            return f"Edited {path} — replaced {len(old_str)} chars with {len(new_str)} chars"

        # Whitespace-normalized fallback: strip leading/trailing whitespace per line
        def _normalize(s: str) -> str:
            return "\n".join(line.strip() for line in s.splitlines())

        norm_content = _normalize(content)
        norm_old = _normalize(old_str)
        idx = norm_content.find(norm_old)
        if idx != -1:
            # Map normalized index back to original content
            orig_lines = content.splitlines(keepends=True)
            norm_lines = norm_content.splitlines(keepends=True)
            # Find which original lines correspond to the match
            char_count = 0
            start_line = 0
            for i, nl in enumerate(norm_lines):
                if char_count == idx:
                    start_line = i
                    break
                char_count += len(nl)
            match_line_count = len(norm_old.splitlines())
            # Detect indentation from the first matched original line
            first_orig = orig_lines[start_line] if start_line < len(orig_lines) else ""
            indent = first_orig[: len(first_orig) - len(first_orig.lstrip())]
            # Apply new_str with original indentation
            new_lines = new_str.splitlines(keepends=True)
            indented = []
            for j, nl in enumerate(new_lines):
                indented.append(indent + nl.lstrip() if j > 0 else indent + nl.lstrip())
            # Replace the matched lines
            result_lines = orig_lines[:start_line] + indented + orig_lines[start_line + match_line_count:]
            result = "".join(result_lines)
            full.write_text(result, encoding="utf-8")
            self._source_write_count += 1
            self._session_files.append(path)
            self._record_mtime(path, full)
            return f"Edited {path} (whitespace-normalized match) — replaced {match_line_count} lines"

        # No match
        preview = "\n".join(old_str.splitlines()[:3])
        return f"Error: old_str not found in {path}. First 3 lines of old_str:\n{preview}"

    def delete_source_file(self, path: str) -> str:
        """Delete a source file from the project directory (REQ-D-24)."""
        root = self._project_dir
        full = (root / path).resolve()

        if err := self._check_protected(path):
            return err
        if err := self._check_sandbox(path, full, root):
            return err
        if full.is_dir():
            return f"Error: {path} is a directory. Only files can be deleted."
        if not full.exists():
            return f"Error: {path} does not exist."

        self._snapshot_before_write(path, full)
        full.unlink()
        self._session_files.append(path)
        return f"Deleted {path}"

    def write_framework_file(self, path: str, content: str, append: bool = False) -> str:
        """Write a framework artifact to the .voidrift/ directory."""
        if err := self._validate_content(content):
            return err
        if path.startswith(".voidrift/"):
            path = path[len(".voidrift/"):]
        full = self._framework_dir / path
        if err := self._check_sandbox(f".voidrift/{path}", full, self._framework_dir.resolve()):
            return err
        canon = f".voidrift/{path}"
        if append and full.exists():
            existing = full.read_text(encoding="utf-8")
            content = existing + content
        if err := self._check_write_size(path, content):
            return err
        if not append:
            if err := self._check_duplicate(canon, full, content):
                return err
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._written_this_run.add(canon)
        verb = "Appended" if append else "Wrote"
        return f"{verb} {len(content)} bytes to .voidrift/{path}"

    def _read_with_guard(self, full: Path, display_path: str, offset: int, limit: int | None) -> str:
        """Read lines from a file with optional pagination and size guard (REQ-FSZ-1, REQ-FSZ-5)."""
        effective_limit = limit if limit is not None else self._max_read_lines
        explicit_limit = limit is not None or offset > 0

        lines = full.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True)
        total = len(lines)

        chunk = lines[offset: offset + effective_limit]
        content = "".join(chunk)

        if not explicit_limit and total > effective_limit:
            next_offset = offset + effective_limit
            header = (
                f"WARNING: {display_path} has {total} lines. "
                f"Returning lines {offset + 1}–{offset + len(chunk)}. "
                f"Use offset={next_offset} to read the next chunk.\n\n"
            )
            content = header + content

        # Byte guard (REQ-FSZ-5) — applies after line pagination
        if self._max_read_bytes > 0:
            encoded = content.encode("utf-8")
            if len(encoded) > self._max_read_bytes:
                trunc = encoded[:self._max_read_bytes]
                # Step back to valid UTF-8 boundary
                while trunc and trunc[-1] & 0xC0 == 0x80:
                    trunc = trunc[:-1]
                if trunc and trunc[-1] & 0x80:
                    trunc = trunc[:-1]
                content = trunc.decode("utf-8", errors="ignore")
                total_kb = len(encoded) // 1024
                shown_kb = self._max_read_bytes // 1024
                content += (
                    f"\n\n[TRUNCATED: {display_path} result is {total_kb}KB. "
                    f"Showing first {shown_kb}KB. "
                    f"Use offset/limit to read specific sections.]"
                )

        return content

    def read_source_file(self, path: str, offset: int = 0, limit: int | None = None) -> str:
        """Read a source file from the project directory."""
        full = self._project_dir / path
        if not full.exists():
            return f"File not found: {path}"
        if not full.is_file():
            return f"Not a file: {path}"
        if err := self._check_sandbox(path, full, self._project_dir):
            return err
        if ".voidrift/logs" in path or ".voidrift\\logs" in path:
            return "Access denied: log files are not readable by the model. Use 'voidrift log' instead."
        self._read_files.append(path)
        return self._read_with_guard(full, path, offset, limit)

    def read_framework_file(self, path: str, offset: int = 0, limit: int | None = None) -> str:
        """Read a framework artifact from the .voidrift/ directory."""
        if path.startswith(".voidrift/"):
            path = path[len(".voidrift/"):]
        full = self._framework_dir / path
        if not full.exists():
            return f"File not found: .voidrift/{path}"
        if not full.is_file():
            return f"Not a file: .voidrift/{path}"
        if err := self._check_sandbox(f".voidrift/{path}", full, self._framework_dir.resolve()):
            return err
        if path.startswith("logs/") or path.startswith("logs\\"):
            return "Access denied: log files are not readable by the model."
        self._read_files.append(f".voidrift/{path}")
        return self._read_with_guard(full, f".voidrift/{path}", offset, limit)

    def list_project_artifacts(self) -> str:
        """List all files in the project's .voidrift/ directory (excludes logs)."""
        if not self._framework_dir.is_dir():
            return "No .voidrift/ directory found."
        files = sorted(self._framework_dir.rglob("*"))
        result = []
        for f in files:
            if f.is_file() and "logs" not in f.relative_to(self._framework_dir).parts:
                rel = f.relative_to(self._project_dir)
                size = f.stat().st_size
                result.append(f"  {rel} ({size} bytes)")
        if not result:
            return ".voidrift/ directory is empty."
        return f"Project artifacts ({len(result)} files):\n" + "\n".join(result)

    def get_handlers(self) -> dict[str, Callable]:
        """Return a handler dict mapping tool names to bound methods."""
        return {
            "write_source_file": self.write_source_file,
            "edit_source_file": self.edit_source_file,
            "write_framework_file": self.write_framework_file,
            "read_source_file": self.read_source_file,
            "read_framework_file": self.read_framework_file,
            "list_project_artifacts": self.list_project_artifacts,
        }


# Snapshot/rollback — moved to tools/snapshot.py; re-exported for back-compat
from .snapshot import (
    _snapshots, set_snapshots, get_snapshots, clear_snapshots,
    rollback_snapshots, compute_diff_stats,
)

# Interaction tools — moved to tools/interaction.py; re-exported for back-compat
from .interaction import make_ask_user_handler
