"""CLI-native filesystem tools.

These run on the workstation because they need local filesystem access.
Domain-separated by tool name:
  write_source_file / read_source_file  → project source tree
  write_framework_file / read_framework_file → .voidrift/ artifacts
  web_fetch → HTTP fetch + summarise via isolated sub-agent (chat only, REQ-U-8)
"""

from __future__ import annotations

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

    def __init__(self, project_dir: Path | None = None, model_type: str = "local") -> None:
        self._project_dir = (project_dir or Path.cwd()).resolve()
        self._framework_dir = self._project_dir / ".voidrift"
        self._model_type = model_type
        self._source_write_count: int = 0
        self._written_this_run: set[str] = set()
        self._rewrite_allowed: set[str] = set()
        self._session_files: list[str] = []

    # --- State management ---

    def reset_write_count(self) -> None:
        """Reset per-task write counter and duplicate guard. Call before each task."""
        self._source_write_count = 0
        self._written_this_run = set()
        self._rewrite_allowed = set()

    def reset_session_files(self) -> None:
        """Reset session-level file log. Call at develop session start."""
        self._session_files = []

    def get_session_files(self) -> list[str]:
        """Return all source files written since last reset_session_files()."""
        return list(self._session_files)

    def get_write_count(self) -> int:
        """Return number of write_source_file calls since last reset_write_count()."""
        return self._source_write_count

    def allow_rewrite(self, path: str) -> None:
        """Allow a path to be rewritten (e.g. during iterative synthesis)."""
        self._rewrite_allowed.add(path)
        self._rewrite_allowed.add(f".voidrift/{path}")

    # --- Validation helpers ---

    def _validate_content(self, content: str) -> str | None:
        if not content or content.strip() in ("...", "TODO", "TBD", "placeholder"):
            return f"Error: content is a placeholder ('{content.strip()}'). Write the FULL file content."
        return None

    def _check_write_size(self, path: str, content: str) -> str | None:
        from ..config import get_max_read_lines
        limit = get_max_read_lines(self._model_type)
        line_count = content.count("\n") + (1 if content and not content.endswith("\n") else 0)
        if line_count > limit:
            return (
                f"Error: {path} is {line_count} lines, which exceeds the {limit}-line limit "
                f"(model_type={self._model_type}). This file exceeds the max_read_lines limit. "
                f"Decompose into smaller files and write each separately."
            )
        return None

    def _check_duplicate(self, path: str, full: Path, content: str) -> str | None:
        if path in self._written_this_run and full.exists() and path not in self._rewrite_allowed:
            existing = full.read_text(encoding="utf-8", errors="replace")
            if existing == content:
                return f"Already written: {path} — file is complete. Proceed to the next step."
        return None

    # --- Tool implementations ---

    def write_source_file(self, path: str, content: str) -> str:
        """Write a source file to the project directory."""
        if err := self._validate_content(content):
            return err
        if err := self._check_write_size(path, content):
            return err
        if path.startswith(".voidrift/") or path.startswith(".voidrift\\"):
            return "Access denied: use write_framework_file for .voidrift/ paths."
        full = self._project_dir / path
        try:
            full.resolve().relative_to(self._project_dir)
        except ValueError:
            return f"Access denied: {path} is outside the project directory"
        if err := self._check_duplicate(path, full, content):
            return err
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._source_write_count += 1
        self._written_this_run.add(path)
        self._session_files.append(path)
        return f"Wrote {len(content)} bytes to {path}"

    def write_framework_file(self, path: str, content: str) -> str:
        """Write a framework artifact to the .voidrift/ directory."""
        if err := self._validate_content(content):
            return err
        if err := self._check_write_size(path, content):
            return err
        if path.startswith(".voidrift/"):
            path = path[len(".voidrift/"):]
        full = self._framework_dir / path
        try:
            full.resolve().relative_to(self._framework_dir.resolve())
        except ValueError:
            return f"Access denied: {path} resolves outside .voidrift/"
        canon = f".voidrift/{path}"
        if err := self._check_duplicate(canon, full, content):
            return err
        full.parent.mkdir(parents=True, exist_ok=True)
        full.write_text(content, encoding="utf-8")
        self._written_this_run.add(canon)
        return f"Wrote {len(content)} bytes to .voidrift/{path}"

    def _read_with_guard(self, full: Path, display_path: str, offset: int, limit: int | None) -> str:
        """Read lines from a file with optional pagination and size guard (REQ-FSZ-1)."""
        from ..config import get_max_read_lines
        effective_limit = limit if limit is not None else get_max_read_lines(self._model_type)
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
            return header + content

        return content

    def read_source_file(self, path: str, offset: int = 0, limit: int | None = None) -> str:
        """Read a source file from the project directory."""
        full = self._project_dir / path
        if not full.exists():
            return f"File not found: {path}"
        if not full.is_file():
            return f"Not a file: {path}"
        try:
            full.resolve().relative_to(self._project_dir)
        except ValueError:
            return f"Access denied: {path} is outside the project directory"
        if ".voidrift/logs" in path or ".voidrift\\logs" in path:
            return "Access denied: log files are not readable by the model. Use 'voidrift log' instead."
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
        try:
            full.resolve().relative_to(self._framework_dir.resolve())
        except ValueError:
            return f"Access denied: {path} resolves outside .voidrift/"
        if path.startswith("logs/") or path.startswith("logs\\"):
            return "Access denied: log files are not readable by the model."
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


def reset_write_count() -> None:
    """Reset per-task write counter and duplicate guard."""
    _ctx.reset_write_count()


def reset_session_files() -> None:
    """Reset session-level file log."""
    _ctx.reset_session_files()


def get_session_files() -> list[str]:
    """Return all source files written since last reset_session_files()."""
    return _ctx.get_session_files()


def get_write_count() -> int:
    """Return write_source_file call count since last reset."""
    return _ctx.get_write_count()


def allow_rewrite(path: str) -> None:
    """Allow a path to be rewritten (e.g. during iterative synthesis)."""
    _ctx.allow_rewrite(path)


def write_source_file(path: str, content: str) -> str:
    """Write a source file to the project directory."""
    return _ctx.write_source_file(path, content)


def write_framework_file(path: str, content: str) -> str:
    """Write a framework artifact to the .voidrift/ directory."""
    return _ctx.write_framework_file(path, content)


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
                },
                "required": ["path", "content"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "write_framework_file",
            "description": "Write a framework artifact to the .voidrift/ directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. TASKS.md, arch/backend.md)"},
                    "content": {"type": "string", "description": "File content to write"},
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
                    "path": {"type": "string", "description": "Path relative to .voidrift/ (e.g. arch/backend.md, spec/frontend.md)"},
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
]

LOCAL_HANDLERS = {
    "write_source_file": write_source_file,
    "write_framework_file": write_framework_file,
    "read_source_file": read_source_file,
    "read_framework_file": read_framework_file,
    "list_project_artifacts": list_project_artifacts,
    "web_fetch": web_fetch,
}
