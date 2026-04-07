"""CLI-native agent tools for the VoidRift framework.

Re-exports from sub-modules:
  filesystem  — WriteContext
  web         — _strip_html, make_web_fetch_handler
  interaction — web_fetch, ask_user_question, make_ask_user_handler
  snapshot    — set_snapshots, get_snapshots, clear_snapshots,
                rollback_snapshots, compute_diff_stats
  registry    — LOCAL_TOOLS, make_local_handlers
  process_manager — start_process, stop_process, wait_for_ready,
                    read_process_output, stop_all
  bash        — BashConfig, create_run_command
  http_client — http_request, clear_sessions
  browser     — browser_navigate, browser_screenshot, browser_click,
                browser_get_text, close_all_sessions, close_session
"""

from __future__ import annotations

from .filesystem import WriteContext
from .web import _strip_html, make_web_fetch_handler
from .interaction import web_fetch, ask_user_question, make_ask_user_handler
from .snapshot import set_snapshots, get_snapshots, clear_snapshots, rollback_snapshots, compute_diff_stats
from .registry import LOCAL_TOOLS, make_local_handlers

__all__ = [
    "WriteContext",
    "_strip_html",
    "ask_user_question",
    "clear_snapshots",
    "compute_diff_stats",
    "get_snapshots",
    "LOCAL_TOOLS",
    "make_ask_user_handler",
    "make_local_handlers",
    "make_web_fetch_handler",
    "rollback_snapshots",
    "set_snapshots",
    "web_fetch",
]
