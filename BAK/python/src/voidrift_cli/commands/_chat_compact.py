"""Context compaction utility for the chat command (REQ-U-7, REQ-U-10, REQ-U-11)."""

from __future__ import annotations

from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from pathlib import Path


class ContextCompactor:
    """Encapsulates auto-compact state and logic for the interactive chat loop.

    Zero terminal I/O in the constructor — all I/O occurs inside compact().
    The three mutable flags replace the _compact_failures / _compact_nudged /
    _auto_compact_disabled variables that previously lived as bare locals inside
    _interactive_loop().

    Dependency injection via constructor makes every method independently
    testable without a live TTY or model (REQ-U-21).
    """

    AUTO_COMPACT_THRESHOLD = 80
    NUDGE_THRESHOLD = 70
    FAILURE_LIMIT = 3

    def __init__(
        self,
        agent: object,
        log: "Path",
        max_ctx: int | None,
        ui: object,
        session: object | None,
        original_skill: str,
        fs_ctx: object | None,
        estimate_tokens: Callable,
        setup_terminal: Callable,
        restore_terminal: Callable,
    ) -> None:
        self._agent = agent
        self._log = log
        self._max_ctx = max_ctx
        self._ui = ui
        self._session = session
        self._original_skill = original_skill
        self._fs_ctx = fs_ctx
        self._estimate_tokens = estimate_tokens
        self._setup_terminal = setup_terminal
        self._restore_terminal = restore_terminal

        self.failures: int = 0
        self.nudged: bool = False
        self.disabled: bool = False

    def should_auto_compact(self, pct: int) -> bool:
        """Return True when pct >= 80 and auto-compact is still enabled."""
        return pct >= self.AUTO_COMPACT_THRESHOLD and not self.disabled

    def should_nudge(self, pct: int) -> bool:
        """Return True when pct >= 70 and the nudge has not yet been shown."""
        return pct >= self.NUDGE_THRESHOLD and not self.nudged

    def compact(self) -> bool:
        """Summarize history to free context. Returns True on success."""
        import sys
        from rich.live import Live
        from rich.spinner import Spinner as _RSpinner
        from .. import prompts as _prompts

        agent = self._agent
        ui = self._ui
        max_ctx = self._max_ctx
        log = self._log

        ui._con.print()
        if len(agent.messages) <= 1:
            ui.info("Nothing to compact.")
            return True

        target = max_ctx // 10 if max_ctx else 8000
        compact_prompt = _prompts.load_prompt("chat", "COMPACT").format(
            target_tokens=target,
        )

        original_system = agent.messages[0]["content"]

        try:
            compact_fd: int | None = sys.stdin.fileno()
        except Exception:
            compact_fd = None
        compact_termios, compact_saved = self._setup_terminal(compact_fd)

        summary = ""
        try:
            spinner = _RSpinner("dots", text=f"  {ui.random_label()}", style="dim")
            with Live(spinner, console=ui._con, refresh_per_second=12, transient=True):
                client = agent._get_client()
                resp = client.chat.completions.create(
                    model=agent._model_name(),
                    messages=agent.messages + [{"role": "user", "content": compact_prompt}],
                    max_tokens=target,
                )
                summary = resp.choices[0].message.content or ""
        except Exception as e:
            ui.error(f"Compact failed: {e}")
            self.failures += 1
            if self.failures >= self.FAILURE_LIMIT:
                self.disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            return False
        finally:
            self._restore_terminal(compact_fd, compact_termios, compact_saved)

        sys_content = original_system + f"\n\n[Conversation summary]\n{summary}"
        agent.messages = [{"role": "system", "content": sys_content}]

        result_tokens = self._estimate_tokens(agent.messages)
        if max_ctx and result_tokens > max_ctx // 10:
            self.failures += 1
            if self.failures >= self.FAILURE_LIMIT:
                self.disabled = True
                ui.warn("Compaction failing repeatedly — auto-compact disabled. Start a new session.")
            ui.warn(f"Compact result still {result_tokens * 100 // max_ctx}% of context.")
            return False

        self.failures = 0

        restore_parts: list[str] = []
        restore_budget = max_ctx // 5 if max_ctx else 50000
        restore_used = 0

        if self._fs_ctx is not None:
            recent = self._fs_ctx.get_read_files()
            seen: set[str] = set()
            newest_3: list[str] = []
            for p in reversed(recent):
                if p not in seen:
                    seen.add(p)
                    newest_3.append(p)
                    if len(newest_3) == 3:
                        break

            for fpath in newest_3:
                try:
                    from pathlib import Path as _Path
                    full = _Path.cwd() / fpath
                    if not full.exists():
                        continue
                    content = full.read_text(encoding="utf-8", errors="replace")
                    cost = len(content) // 4
                    if restore_used + cost > restore_budget:
                        break
                    restore_parts.append(f"[File: {fpath}]\n{content}")
                    restore_used += cost
                except Exception:
                    continue

        if self._original_skill and restore_used + len(self._original_skill) // 4 <= restore_budget:
            restore_parts.append(f"[Skills]\n{self._original_skill}")

        if restore_parts:
            agent.messages.append({
                "role": "system",
                "content": "[Restored context]\n\n" + "\n\n".join(restore_parts),
            })

        pct = self._estimate_tokens(agent.messages) * 100 // max_ctx if max_ctx else 0
        ui.info(f"Compacted to {pct}% of context window.")
        ui._con.print(ui.render_text(summary), style="dim")
        with open(log, "a") as f:
            f.write(f"\n[COMPACT] {summary}\n")
        if self._session:
            self._session.append_compaction(summary)
        self.nudged = False
        return True
