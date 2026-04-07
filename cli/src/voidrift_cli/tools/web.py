"""Web fetch tool — HTTP fetch and HTML extraction (REQ-SEC-3, REQ-U-8)."""

from __future__ import annotations

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
    except Exception as exc:
        import logging as _logging
        _logging.getLogger(__name__).debug(
            "HTML parse error (returning partial content): %s", exc
        )
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
