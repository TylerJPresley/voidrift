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


def _strip_html(html_text: str) -> str:
    """Strip HTML tags and return plain text, excluding script/style content."""
    from html.parser import HTMLParser

    class _Stripper(HTMLParser):
        def __init__(self) -> None:
            super().__init__()
            self.parts: list[str] = []
            self._skip = False

        def handle_starttag(self, tag: str, attrs: list) -> None:
            if tag in ("script", "style", "head", "noscript"):
                self._skip = True

        def handle_endtag(self, tag: str) -> None:
            if tag in ("script", "style", "head", "noscript"):
                self._skip = False

        def handle_data(self, data: str) -> None:
            if not self._skip:
                stripped = data.strip()
                if stripped:
                    self.parts.append(stripped)

    stripper = _Stripper()
    try:
        stripper.feed(html_text)
    except Exception:
        pass
    return "\n".join(stripper.parts)


def _default_web_confirm(url: str) -> bool:
    """Default confirm function — shows URL and prompts operator (no spinner awareness)."""
    import click
    from .. import ui
    ui._con.print(f"\n[dim]web_fetch →[/dim] [cyan]{url}[/cyan]")
    try:
        return click.confirm("  Allow fetch?", default=False)
    except click.Abort:
        return False


def make_web_fetch_handler(
    mc,
    log: str,
    web_cache: dict | None = None,
    agent_loop_cls=None,
    confirm_fn: Callable[[str], bool] | None = None,
) -> Callable[[str], str]:
    """Create a web_fetch agent tool handler bound to the current chat session (REQ-U-8).

    Each call fetches the URL in an isolated sub-agent context so raw page
    content never enters the chat agent's context window — only the summary
    does. Results are cached in ``web_cache`` for the duration of the run.

    Args:
        mc: ModelConfig for the summarisation sub-agent.
        log: Path to the command log file.
        web_cache: In-memory dict mapping url -> summary (mutated in place). Pass {} to enable caching.
        agent_loop_cls: AgentLoop class; defaults to the real one (injectable for tests).
        confirm_fn: Optional callable to confirm fetches; defaults to interactive prompt.
    """
    if agent_loop_cls is None:
        from ..agent import AgentLoop
        agent_loop_cls = AgentLoop

    _confirm = confirm_fn or _default_web_confirm

    def handler(url: str) -> str:
        # Return cached summary if available — no prompt needed for cached results
        if web_cache is not None and url in web_cache:
            return web_cache[url]

        # SSRF check before any network or operator interaction (REQ-SEC-3)
        from .ssrf_guard import check_url, SSRFError
        from ..config import get_ssrf_allow_list
        try:
            check_url(url, allow_list=get_ssrf_allow_list())
        except SSRFError as e:
            return f"web_fetch blocked: {e}"

        # Show URL and ask operator permission before making any HTTP connection
        if not _confirm(url):
            return f"Operator declined to fetch {url}."

        # Fetch the URL
        import urllib.request
        import urllib.error
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "VoidRift/1.0"})
            with urllib.request.urlopen(req, timeout=15) as resp:
                raw_bytes = resp.read(512 * 1024)  # 512 KB cap
                content_type = resp.headers.get("Content-Type", "")
                raw = raw_bytes.decode("utf-8", errors="replace")
        except Exception as e:
            return f"web_fetch error: {e}"

        # Strip markup if HTML
        if "html" in content_type.lower() or raw.lstrip().startswith("<"):
            raw = _strip_html(raw)

        # Summarise via isolated sub-agent — raw content stays out of chat context
        from .. import prompts as _prompts
        fetch_prompt = _prompts.load_prompt("chat", "WEB-FETCH")
        summarizer = agent_loop_cls(
            model=mc,
            system_prompt=fetch_prompt,
            tools=[],
            tool_handlers={},
            stream=False,
            log_path=log,
            max_tokens=1024,
        )
        try:
            summary = summarizer.send(f"URL: {url}\n\nContent:\n\n{raw[:32_000]}")
        except Exception as e:
            return f"web_fetch summarize error: {e}"

        # Cache for the session
        if web_cache is not None:
            web_cache[url] = summary

        return summary

    return handler


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
            "write_framework_file": self.write_framework_file,
            "read_source_file": self.read_source_file,
            "read_framework_file": self.read_framework_file,
            "list_project_artifacts": self.list_project_artifacts,
        }


# ---------------------------------------------------------------------------
# Module-level singleton — backward-compatible API for existing callers
# ---------------------------------------------------------------------------

_ctx = WriteContext()

# Thread-local snapshot storage for per-task rollback (REQ-D-15)
import threading as _threading
_snapshots = _threading.local()


def set_snapshots() -> None:
    """Initialize a fresh snapshot dict for the current task/thread."""
    _snapshots.data = {}


def get_snapshots() -> dict[str, str | None] | None:
    """Return the current thread's snapshot dict, or None if not set."""
    return getattr(_snapshots, "data", None)


def clear_snapshots() -> None:
    """Clear snapshots after a successful task."""
    _snapshots.data = None


def compute_diff_stats(project_dir: Path | None = None) -> list[dict]:
    """Compute per-file diff stats from current snapshots (TASK-FW-018).

    Call before clear_snapshots(). Returns list of
    {path, status, lines_added, lines_removed} dicts.
    """
    snaps = getattr(_snapshots, "data", None)
    if not snaps:
        return []
    base = project_dir or _ctx._project_dir
    stats = []
    for path, original in snaps.items():
        full = base / path
        current = full.read_text(encoding="utf-8", errors="replace") if full.exists() else None
        if original is None and current is not None:
            stats.append({"path": path, "status": "created", "lines_added": current.count("\n") + 1, "lines_removed": 0})
        elif original is not None and current is None:
            stats.append({"path": path, "status": "deleted", "lines_added": 0, "lines_removed": original.count("\n") + 1})
        elif original is not None and current is not None and original != current:
            old_lines = original.splitlines()
            new_lines = current.splitlines()
            added = sum(1 for l in new_lines if l not in old_lines)
            removed = sum(1 for l in old_lines if l not in new_lines)
            stats.append({"path": path, "status": "modified", "lines_added": added, "lines_removed": removed})
    return stats


def rollback_snapshots(log_path: Path | None = None, project_dir: Path | None = None) -> None:
    """Restore all snapshotted files to their pre-task state (REQ-D-15)."""
    snaps = getattr(_snapshots, "data", None)
    if not snaps:
        return
    base = project_dir or _ctx._project_dir
    for path, original in snaps.items():
        full = base / path
        if original is None:
            if full.exists():
                full.unlink()
                _log_rollback(log_path, f"[ROLLBACK deleted={path}]")
        else:
            full.parent.mkdir(parents=True, exist_ok=True)
            full.write_text(original, encoding="utf-8")
            _log_rollback(log_path, f"[ROLLBACK restored={path}]")
    _snapshots.data = None


def _log_rollback(log_path: Path | None, msg: str) -> None:
    if log_path:
        with open(log_path, "a") as f:
            f.write(msg + "\n")


def configure(
    max_read_lines: int = 2000,
    max_read_bytes: int = 524288,
    protected_paths: list[str] | None = None,
    log_path: Path | None = None,
) -> None:
    """Configure the module-level context with model limits and security settings."""
    _ctx._max_read_lines = max_read_lines
    _ctx._max_read_bytes = max_read_bytes
    if protected_paths is not None:
        _ctx._protected_paths = set(protected_paths)
    if log_path is not None:
        _ctx._log_path = log_path


def reset_write_count() -> None:
    """Reset per-task write counter and duplicate guard."""
    _ctx.reset_write_count()


def reset_session_files() -> None:
    """Reset session-level file log."""
    _ctx.reset_session_files()


def get_session_files() -> list[str]:
    """Return all source files written since last reset_session_files()."""
    return _ctx.get_session_files()


def get_read_files() -> list[str]:
    """Return unique file paths read during the session, most recent last (REQ-U-11)."""
    return _ctx.get_read_files()


def reset_read_files() -> None:
    """Reset read-file tracking."""
    _ctx.reset_read_files()


def get_write_count() -> int:
    """Return write_source_file call count since last reset."""
    return _ctx.get_write_count()


def allow_rewrite(path: str) -> None:
    """Allow a path to be rewritten (e.g. during iterative synthesis)."""
    _ctx.allow_rewrite(path)


def write_source_file(path: str, content: str, force_write: bool = False) -> str:
    """Write a source file to the project directory."""
    return _ctx.write_source_file(path, content, force_write=force_write)


def edit_source_file(path: str, old_str: str, new_str: str, force_write: bool = False) -> str:
    """Surgical edit: replace old_str with new_str in a source file (REQ-FSZ-4)."""
    return _ctx.edit_source_file(path, old_str, new_str, force_write=force_write)


def write_framework_file(path: str, content: str, append: bool = False) -> str:
    """Write a framework artifact to the .voidrift/ directory."""
    return _ctx.write_framework_file(path, content, append=append)


def read_source_file(path: str, offset: int = 0, limit: int | None = None) -> str:
    """Read a source file from the project directory."""
    return _ctx.read_source_file(path, offset=offset, limit=limit)


def read_framework_file(path: str, offset: int = 0, limit: int | None = None) -> str:
    """Read a framework artifact from the .voidrift/ directory."""
    return _ctx.read_framework_file(path, offset=offset, limit=limit)


def list_project_artifacts() -> str:
    """List all files in the project's .voidrift/ directory (excludes logs)."""
    return _ctx.list_project_artifacts()


def web_fetch(url: str) -> str:
    """Fetch a URL and return a summary of its content (chat command only).

    The real handler is injected by the chat command via make_web_fetch_handler().
    This placeholder is registered so the agent tool schema is available at build time.
    """
    return "web_fetch is only available during an active chat session."


def ask_user_question(question: str, options: str | None = None) -> str:
    """Ask the operator a clarifying question (chat command only).

    The real handler is injected by the chat command via make_ask_user_handler().
    This placeholder is registered so the agent tool schema is available at build time.
    """
    if not sys.stdin.isatty():
        return "[No operator present. Use your best judgment and document your decision in comments.]"
    return "ask_user_question is only available during an active chat session."


def make_ask_user_handler(
    ask_fn: Callable[[str, list[str] | None], str] | None = None,
) -> Callable:
    """Create an ask_user_question handler bound to the current session (TASK-FW-011).

    Args:
        ask_fn: Callback that displays the question and returns the operator's response.
                If None, uses a non-interactive fallback.
    """
    def handler(question: str, options: str | None = None) -> str:
        opt_list = None
        if options:
            try:
                import json as _json
                opt_list = _json.loads(options) if isinstance(options, str) else options
            except Exception:
                opt_list = None

        if not sys.stdin.isatty() or ask_fn is None:
            return "[No operator present. Use your best judgment and document your decision in comments.]"
        return ask_fn(question, opt_list)

    return handler


# Tool definitions in OpenAI format for use with AgentLoop
LOCAL_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "write_source_file",
            "description": "Write a source file to the project directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root (e.g. src/main.py)"},
                    "content": {"type": "string", "description": "File content to write"},
                    "force_write": {"type": "boolean", "description": "Overwrite even if the file was modified externally. Default: false."},
                },
                "required": ["path", "content"],
            },
        },
        "_guidelines": [
            "Write complete file content — never write placeholder stubs or TODOs.",
            "For existing files, read first to understand the current state.",
        ],
    },
    {
        "type": "function",
        "function": {
            "name": "edit_source_file",
            "description": (
                "Surgical edit: replace a specific section of an existing source file. "
                "old_str must match exactly one location — if it appears more than once, the edit is rejected. "
                "Use for modifications to existing files. Use write_source_file for new files or full rewrites."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                    "old_str": {"type": "string", "description": "Exact text to find and replace (must appear exactly once)"},
                    "new_str": {"type": "string", "description": "Replacement text"},
                    "force_write": {"type": "boolean", "description": "Overwrite even if the file was modified externally. Default: false."},
                },
                "required": ["path", "old_str", "new_str"],
            },
        },
        "_guidelines": [
            "Always call read_source_file before edit_source_file to confirm the exact string. Never guess at old_str content.",
            "Prefer edit_source_file over write_source_file for modifications to existing files.",
        ],
    },
    {
        "type": "function",
        "function": {
            "name": "write_framework_file",
            "description": "Write a framework artifact to the .voidrift/ directory. Use append=true to add content to an existing file.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. TASKS.md, arch/backend.md)"},
                    "content": {"type": "string", "description": "File content to write"},
                    "append": {"type": "boolean", "description": "Append to existing file instead of overwriting. Default: false."},
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "read_source_file",
            "description": (
                "Read a source file from the project directory. "
                "If the file exceeds the line limit, a warning header is returned with pagination instructions. "
                "Use offset and limit to read large files in chunks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Relative path from project root"},
                    "offset": {"type": "integer", "description": "Line offset to start reading from (0-based, default 0)"},
                    "limit": {"type": "integer", "description": "Maximum number of lines to return. Omit to use the model's configured max_read_lines."},
                },
                "required": ["path"],
            },
        },
        "_guidelines": [
            "When a pagination warning is returned, use offset to read remaining content before drawing conclusions.",
        ],
    },
    {
        "type": "function",
        "function": {
            "name": "read_framework_file",
            "description": (
                "Read a framework artifact from the .voidrift/ directory. "
                "If the file exceeds the line limit, a warning header is returned with pagination instructions. "
                "Use offset and limit to read large files in chunks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. arch/backend.md, analysis/src/main.py.md)"},
                    "offset": {"type": "integer", "description": "Line offset to start reading from (0-based, default 0)"},
                    "limit": {"type": "integer", "description": "Maximum number of lines to return. Omit to use the model's configured max_read_lines."},
                },
                "required": ["path"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_project_artifacts",
            "description": list_project_artifacts.__doc__,
            "parameters": {"type": "object", "properties": {}},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "web_fetch",
            "description": "Fetch a URL and return a concise summary of its content. Results are cached for the session.",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "The URL to fetch (https://)"},
                },
                "required": ["url"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "ask_user_question",
            "description": "Ask the operator a clarifying question. Use only for genuine ambiguity that cannot be resolved from available context — not for rhetorical questions or confirmations.",
            "parameters": {
                "type": "object",
                "properties": {
                    "question": {"type": "string", "description": "The specific question for the operator."},
                    "options": {"type": "string", "description": "Optional: JSON array of choices to present, e.g. '[\"option A\", \"option B\"]'"},
                },
                "required": ["question"],
            },
        },
    },
]

LOCAL_HANDLERS = {
    "write_source_file": write_source_file,
    "edit_source_file": edit_source_file,
    "write_framework_file": write_framework_file,
    "read_source_file": read_source_file,
    "read_framework_file": read_framework_file,
    "list_project_artifacts": list_project_artifacts,
    "web_fetch": web_fetch,
    "ask_user_question": ask_user_question,
}
