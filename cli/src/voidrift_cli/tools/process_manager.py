"""Process lifecycle tools for Verify sub-agents (REQ-VF-8 through REQ-VF-11).

Provides start_process, stop_process, wait_for_ready, read_process_output, and
run_command as agent-callable tool functions. Processes are tracked in a
module-level registry so sub-agents can reference them by opaque handle ID.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
import uuid
from collections import deque
from typing import Deque


# Module-level process registry: handle_id -> _Process
_registry: dict[str, "_Process"] = {}
_registry_lock = threading.Lock()


class _Process:
    """Internal process wrapper with ring-buffered stdout/stderr capture."""

    def __init__(self, cmd: str, env: dict | None, cwd: str | None) -> None:
        import os
        import shlex

        self.handle_id = str(uuid.uuid4())
        self._buffer: Deque[str] = deque(maxlen=500)
        self._buffer_lock = threading.Lock()
        self._done = threading.Event()

        proc_env = os.environ.copy()
        if env:
            proc_env.update(env)

        args = shlex.split(cmd) if isinstance(cmd, str) else cmd
        self._proc = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            env=proc_env,
            cwd=cwd or None,
        )
        self._reader = threading.Thread(target=self._read_output, daemon=True)
        self._reader.start()

    def _read_output(self) -> None:
        assert self._proc.stdout is not None
        try:
            for line in self._proc.stdout:
                with self._buffer_lock:
                    self._buffer.append(line.rstrip("\n"))
        finally:
            self._done.set()

    def get_output(self) -> list[str]:
        with self._buffer_lock:
            return list(self._buffer)

    def stop(self, timeout: float = 5.0) -> None:
        import signal

        if self._proc.poll() is not None:
            return
        try:
            self._proc.send_signal(signal.SIGTERM)
        except ProcessLookupError:
            return
        try:
            self._proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            self._proc.kill()
            self._proc.wait()

    @property
    def pid(self) -> int:
        return self._proc.pid


def start_process(cmd: str, env: str = "{}", cwd: str = "") -> str:
    """Start a process and return its handle ID for use with other process tools.

    Args:
        cmd: Shell command to run (e.g. "uvicorn main:app --port 8000").
        env: JSON object of additional environment variables to set.
        cwd: Working directory for the process. Defaults to current directory.

    Returns:
        JSON with handle_id and pid on success, or an error message.
    """
    try:
        env_dict: dict = json.loads(env) if env.strip() else {}
    except json.JSONDecodeError as exc:
        return f"Invalid env JSON: {exc}"

    proc = _Process(cmd=cmd, env=env_dict or None, cwd=cwd or None)
    with _registry_lock:
        _registry[proc.handle_id] = proc
    return json.dumps({"handle_id": proc.handle_id, "pid": proc.pid})


def stop_process(handle_id: str) -> str:
    """Stop a running process by handle ID (SIGTERM, then SIGKILL after 5s).

    Args:
        handle_id: The handle ID returned by start_process.

    Returns:
        Confirmation message or error.
    """
    with _registry_lock:
        proc = _registry.pop(handle_id, None)
    if proc is None:
        return f"No process with handle_id '{handle_id}'."
    proc.stop()
    return f"Process {proc.pid} stopped."


def wait_for_ready(
    handle_id: str,
    strategy: str,
    target: str,
    timeout: int = 30,
) -> str:
    """Wait until a process is ready to accept requests.

    Args:
        handle_id: The handle ID returned by start_process.
        strategy: One of "http", "port", or "log_pattern".
        target: For "http": URL to poll for 200. For "port": port number as string.
                For "log_pattern": substring to search in process output.
        timeout: Maximum seconds to wait before giving up (default 30).

    Returns:
        "ready" on success, or error message on timeout.
    """
    with _registry_lock:
        proc = _registry.get(handle_id)
    if proc is None:
        return f"No process with handle_id '{handle_id}'."

    deadline = time.monotonic() + timeout

    if strategy == "http":
        import urllib.error
        import urllib.request

        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(target, timeout=2) as resp:
                    if resp.status < 400:
                        return "ready"
            except (urllib.error.URLError, OSError):
                pass
            time.sleep(0.5)
        proc.stop()
        with _registry_lock:
            _registry.pop(handle_id, None)
        return f"Timeout waiting for HTTP readiness at {target} after {timeout}s."

    elif strategy == "port":
        import socket

        try:
            port = int(target)
        except ValueError:
            return f"Invalid port: {target}"

        while time.monotonic() < deadline:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    return "ready"
            except OSError:
                pass
            time.sleep(0.5)
        proc.stop()
        with _registry_lock:
            _registry.pop(handle_id, None)
        return f"Timeout waiting for port {port} after {timeout}s."

    elif strategy == "log_pattern":
        while time.monotonic() < deadline:
            lines = proc.get_output()
            if any(target in line for line in lines):
                return "ready"
            time.sleep(0.2)
        proc.stop()
        with _registry_lock:
            _registry.pop(handle_id, None)
        return f"Timeout waiting for log pattern '{target}' after {timeout}s."

    else:
        return f"Unknown strategy '{strategy}'. Use 'http', 'port', or 'log_pattern'."


def read_process_output(handle_id: str) -> str:
    """Read buffered stdout/stderr from a running process (up to 500 lines).

    Args:
        handle_id: The handle ID returned by start_process.

    Returns:
        Buffered output lines joined by newlines, or error message.
    """
    with _registry_lock:
        proc = _registry.get(handle_id)
    if proc is None:
        return f"No process with handle_id '{handle_id}'."
    lines = proc.get_output()
    if not lines:
        return "(no output yet)"
    return "\n".join(lines)


def run_command(cmd: str, cwd: str = "") -> str:
    """Run a command synchronously and return its stdout, stderr, and exit code.

    Args:
        cmd: Shell command to run.
        cwd: Working directory. Defaults to current directory.

    Returns:
        JSON with stdout, stderr, and exit_code fields.
    """
    import shlex

    args = shlex.split(cmd) if isinstance(cmd, str) else cmd
    try:
        result = subprocess.run(
            args,
            capture_output=True,
            text=True,
            timeout=120,
            cwd=cwd or None,
        )
        return json.dumps({
            "stdout": result.stdout,
            "stderr": result.stderr,
            "exit_code": result.returncode,
        })
    except FileNotFoundError:
        return json.dumps({"error": f"Command not found: {args[0]}", "exit_code": 127})
    except subprocess.TimeoutExpired:
        return json.dumps({"error": "Command timed out after 120s", "exit_code": -1})


def stop_all() -> None:
    """Stop all tracked processes. Called by the orchestrator in try/finally."""
    with _registry_lock:
        handles = list(_registry.keys())
    for handle_id in handles:
        with _registry_lock:
            proc = _registry.pop(handle_id, None)
        if proc is not None:
            proc.stop()
