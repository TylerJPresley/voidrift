#!/usr/bin/env python3
"""
A pty capture harness for the resize-leftover emulator test (cli-blueprint
§5.2). It boots the BUILT `voidrift chat` in a real pty against the fake OpenAI
server scripted to HANG (the model never responds), so the `⠠ Thinking · N s`
spinner stays LIVE on the dynamic region. It then resizes the window from a
wide start width to a narrower target (TIOCSWINSZ + the kernel's SIGWINCH,
exactly as a real terminal does), lets the reflow settle, and emits the raw
captured master bytes plus the byte offset of the resize so the Node test can
replay the pre- and post-resize bytes into a headless terminal emulator at the
matching widths.

Protocol: one JSON object on argv[1]:
  { "cli": "<dist/cli.js>", "cwd": "<ws>", "env": {HOME, XDG_CONFIG_HOME},
    "prompt": "say hi", "startCols": 100, "targetCols": 40, "rows": 40,
    "timeoutMs": 30000 }
Stdout: JSON { ok, startCols, targetCols, rows, resizeIndex, output } where
`output` is the raw master bytes (latin-1 so every byte round-trips) and
`resizeIndex` is the byte index in `output` at which the resize was issued.

python3 is OPTIONAL: the Node test skips cleanly when it is absent (no new
devDependency). Deterministic and bounded; the child is hard-killed on timeout.
"""
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time
import fcntl


def set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


def main() -> int:
    spec = json.loads(sys.argv[1])
    cli = spec["cli"]
    cwd = spec["cwd"]
    extra_env = spec.get("env", {})
    prompt = spec.get("prompt", "say hi")
    start_cols = int(spec.get("startCols", 100))
    target_cols = int(spec.get("targetCols", 40))
    rows = int(spec.get("rows", 40))
    deadline = time.time() + spec.get("timeoutMs", 30000) / 1000.0

    env = dict(os.environ)
    ci_vars = [
        "CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "RUN_ID", "GITHUB_ACTIONS",
        "GITLAB_CI", "CIRCLECI", "TRAVIS", "APPVEYOR", "BUILDKITE", "DRONE",
        "GITHUB_RUNNER_DEBUG",
    ]
    for var in ci_vars:
        env.pop(var, None)
    env.update(extra_env)
    env["NO_COLOR"] = "1"
    env["TERM"] = "xterm-256color"
    env["LANG"] = "en_US.UTF-8"

    pid, master = pty.fork()
    if pid == 0:
        try:
            os.chdir(cwd)
        except Exception:
            pass
        os.environ.clear()
        os.environ.update(env)
        os.execvp("node", ["node", cli, "chat"])
        os._exit(127)

    set_winsize(master, rows, start_cols)
    captured = bytearray()

    def pump(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end and time.time() < deadline:
            r, _, _ = select.select([master], [], [], 0.05)
            if master in r:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    return
                if not data:
                    return
                captured.extend(data)

    def strip_ansi(data: bytes) -> bytes:
        import re
        return re.sub(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b[\(\)][AB012]|\x1b[=><]|\r", b"", data)

    def wait_for(needle: bytes, seconds: float) -> bool:
        end = time.time() + seconds
        while time.time() < end and time.time() < deadline:
            r, _, _ = select.select([master], [], [], 0.05)
            if master in r:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                captured.extend(data)
            if strip_ansi(bytes(captured)).find(needle) >= 0:
                return True
        return False

    ok = True
    resize_index = 0
    end_index = 0
    try:
        ok = ok and wait_for(b"ask a question", 15)
        # Submit the prompt; the model HANGS, so the spinner starts and stays up.
        os.write(master, prompt.encode())
        pump(0.5)
        os.write(master, b"\r")
        # Wait for the live spinner verb (Thinking) to appear.
        ok = ok and wait_for(b"Thinking", 12)
        # Let the spinner tick a couple of times at the start width so the wide
        # frame (rules + status line) is painted before the resize.
        pump(1.0)
        # Resize narrower: TIOCSWINSZ + the kernel SIGWINCH. Mark the byte offset.
        resize_index = len(captured)
        set_winsize(master, rows, target_cols)
        pump(2.0)
        # Mark the END of the reflow-settle window: the emulator replays only
        # [0, end_index) so the exit sequence below (ctrl+c / /quit frames) never
        # repaints over the post-resize screen under test.
        end_index = len(captured)
    finally:
        try:
            os.write(master, b"\x03")
            pump(0.2)
            os.write(master, b"\x03")
            pump(0.3)
            os.write(master, b"/quit\r")
        except OSError:
            pass
        pump(0.5)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        _reap(pid)
        try:
            os.close(master)
        except OSError:
            pass

    sys.stdout.buffer.write(
        json.dumps(
            {
                "ok": ok,
                "startCols": start_cols,
                "targetCols": target_cols,
                "rows": rows,
                "resizeIndex": resize_index,
                "endIndex": end_index if end_index > 0 else len(captured),
                # latin-1 so every raw byte round-trips losslessly through JSON.
                "output": bytes(captured).decode("latin-1"),
            }
        ).encode()
    )
    return 0


def _reap(pid: int) -> None:
    for _ in range(40):
        try:
            done, _ = os.waitpid(pid, os.WNOHANG)
            if done == pid:
                return
        except ChildProcessError:
            return
        time.sleep(0.05)
    try:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    except (ProcessLookupError, ChildProcessError):
        pass


if __name__ == "__main__":
    sys.exit(main())
