"""CLI-native agent tools for the VoidRift framework.

Re-exports from sub-modules:
  filesystem  — write_source_file, read_source_file, write_framework_file,
                read_framework_file, list_project_artifacts, web_fetch, WriteContext
  process_manager — start_process, stop_process, wait_for_ready,
                    read_process_output, stop_all
  bash        — BashConfig, create_run_command
  http_client — http_request, clear_sessions
  browser     — browser_navigate, browser_screenshot, browser_click,
                browser_get_text, close_all_sessions, close_session
"""

from __future__ import annotations

from .filesystem import (
    WriteContext,
    _ctx,
    _strip_html,
    allow_rewrite,
    ask_user_question,
    clear_snapshots,
    compute_diff_stats,
    edit_source_file,
    get_session_files,
    get_write_count,
    list_project_artifacts,
    LOCAL_HANDLERS,
    LOCAL_TOOLS,
    make_ask_user_handler,
    make_web_fetch_handler,
    read_framework_file,
    read_source_file,
    reset_session_files,
    reset_write_count,
    rollback_snapshots,
    set_snapshots,
    web_fetch,
    write_framework_file,
    write_source_file,
)

__all__ = [
    "WriteContext",
    "_ctx",
    "_strip_html",
    "allow_rewrite",
    "ask_user_question",
    "clear_snapshots",
    "compute_diff_stats",
    "edit_source_file",
    "get_session_files",
    "get_write_count",
    "list_project_artifacts",
    "LOCAL_HANDLERS",
    "LOCAL_TOOLS",
    "make_ask_user_handler",
    "make_web_fetch_handler",
    "read_framework_file",
    "read_source_file",
    "reset_session_files",
    "reset_write_count",
    "rollback_snapshots",
    "set_snapshots",
    "web_fetch",
    "write_framework_file",
    "write_source_file",
]
