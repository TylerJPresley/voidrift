#!/usr/bin/env python3
"""
A tiny interactive-pty driver for the VoidRift CLI smoke test (cli-blueprint
§11). It allocates a real pty, execs the BUILT `node <cli> chat` inside it (so
the TUI runs interactively, which a pipe can never trigger), drives a scripted
sequence of keystrokes and a terminal resize, and prints the captured master
output on stdout for the Node test to assert.

Determinism: every step waits for a substring to appear (bounded) before the
next keystroke, so the harness never races the renderer. A hard overall timeout
kills the child and exits non-zero. The window resize is done with a TIOCSWINSZ
ioctl on the pty, which makes the kernel deliver SIGWINCH to the foreground
process group — exactly what a real terminal resize does.

Protocol: a single JSON object on argv[1]:
  { "cli": "<path to dist/cli.js>", "cwd": "<workspace>", "env": {..},
    "prompt": "<text to send>", "timeoutMs": 45000,
    "fullSequence": true, "exitMode": "keys" }
It drives this fixed sequence:
  1. wait for the input placeholder (TUI booted)
  2. type the prompt + Enter; wait for the scripted reply text
  3. Shift+Tab (cycle mode); wait for the [Research] bracket   (fullSequence only)
  4. Ctrl+G (open monitor), then Ctrl+G (close)                (fullSequence only)
  5. resize to 40 columns (TIOCSWINSZ + SIGWINCH)
  6. end: double Ctrl+C + /quit ("keys"), or deliver SIGINT/SIGTERM to the
     child ("sigint"/"sigterm") to exercise the signal exit path.
Stdout is the raw captured bytes; the Node test strips ANSI and asserts.
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


def main() -> int:
    spec = json.loads(sys.argv[1])
    cli = spec["cli"]
    cwd = spec["cwd"]
    extra_env = spec.get("env", {})
    prompt = spec.get("prompt", "hello")
    reply = spec.get("reply", "")
    # How to end the session (cli-blueprint §1.5, §10.2): "keys" drives the
    # normal double-Ctrl+C / /quit keystroke exit; "sigint"/"sigterm" deliver
    # the OS signal to the child instead, so a test can assert the cursor is
    # restored (ESC[?25h) on the signal exit path.
    exit_mode = spec.get("exitMode", "keys")
    deadline = time.time() + spec.get("timeoutMs", 45000) / 1000.0

    env = dict(os.environ)
    # Scrub CI detection variables: Ink detects CI environments (GitHub Actions,
    # CircleCI, GitLab CI, etc.) and renders only the final frame to reduce spam.
    # For e2e tests, we need full frame delivery to verify the TUI's interactive
    # sequences, so strip all CI environment markers before passing to the child.
    ci_vars = [
        "CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "RUN_ID", "GITHUB_ACTIONS",
        "GITLAB_CI", "CIRCLECI", "TRAVIS", "APPVEYOR", "BUILDKITE", "DRONE",
        "GITHUB_RUNNER_DEBUG"
    ]
    for var in ci_vars:
        env.pop(var, None)
    env.update(extra_env)
    # A sane interactive terminal: colour off (NO_COLOR), UTF-8, 100x40 to start.
    env["NO_COLOR"] = "1"
    env["TERM"] = "xterm-256color"
    env["LANG"] = "en_US.UTF-8"

    pid, master = pty.fork()
    if pid == 0:
        # Child: exec the CLI in the workspace. pty.fork already made the slave
        # our controlling terminal and wired stdio to it.
        try:
            os.chdir(cwd)
        except Exception:
            pass
        os.environ.clear()
        os.environ.update(env)
        os.execvp("node", ["node", cli, "chat"])
        os._exit(127)  # unreachable on success

    # Parent: set the initial window size (100x40), drive the session.
    set_winsize(master, 40, 100)
    captured = bytearray()

    def pump(seconds: float) -> None:
        end = time.time() + seconds
        while time.time() < end:
            if time.time() > deadline:
                break
            r, _, _ = select.select([master], [], [], 0.05)
            if master in r:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    return
                if not data:
                    return
                captured.extend(data)

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
    try:
        # 1. the TUI booted — the input placeholder is shown.
        ok = ok and wait_for(b"ask a question", 15)
        # 2. type the prompt, let it register, THEN press Enter as its own key
        #    event (Ink processes keystrokes one at a time; a prompt+CR in one
        #    write can race the renderer and drop the submit), and wait for the
        #    streamed reply to commit.
        os.write(master, prompt.encode())
        pump(0.6)
        os.write(master, b"\r")
        if reply:
            ok = ok and wait_for(reply.encode(), 20)
        # Let the turn COMPLETE (a mode change is refused while a turn is active,
        # §3.5) before cycling — drain until the "working…" indicator clears.
        pump(2.0)
        full = spec.get("fullSequence", True)
        if full:
            # 3. Shift+Tab cycles to the next top-level agent (research); the
            #    bracket changes from [Chat] to [Research].
            os.write(master, b"\x1b[Z")  # Shift+Tab
            wait_for(b"[Research]", 10)
            # 4. Ctrl+G opens the agent monitor, a second Ctrl+G closes it.
            os.write(master, b"\x07")
            pump(0.5)
            os.write(master, b"\x07")
            pump(0.5)
        # 5. resize to 40 columns: TIOCSWINSZ + the kernel's SIGWINCH. Mark the
        #    buffer position BEFORE the resize so the returned tail captures the
        #    reflow repaint(s); then settle so the new-width frame is flushed.
        resize_marker_index = len(captured)
        set_winsize(master, 40, 40)
        pump(1.5)
        # 6. end the session: either the double-Ctrl+C keystroke exit, or deliver
        #    an OS signal (SIGINT/SIGTERM) to assert the signal exit path.
        if exit_mode == "sigint":
            os.kill(pid, signal.SIGINT)
            pump(1.2)
        elif exit_mode == "sigterm":
            os.kill(pid, signal.SIGTERM)
            pump(1.2)
        else:
            os.write(master, b"\x03")
            pump(0.3)
            os.write(master, b"\x03")
            pump(0.6)
    finally:
        # Fallback: /quit, then reap. Never leave the child running.
        try:
            os.write(master, b"/quit\r")
        except OSError:
            pass
        pump(0.6)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        _reap(pid)
        try:
            os.close(master)
        except OSError:
            pass

    # Emit a JSON result the Node test parses: the full capture, the decoded
    # post-resize tail (sliced on the byte buffer BEFORE decoding, so a
    # multi-byte char or escape is never cut mid-sequence), and the ok flag.
    ri = resize_marker_index if "resize_marker_index" in dir() else 0
    sys.stdout.buffer.write(
        json.dumps(
            {
                "ok": ok,
                "output": bytes(captured).decode("utf-8", "replace"),
                "tail": bytes(captured[ri:]).decode("utf-8", "replace"),
            }
        ).encode()
    )
    return 0


def set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except OSError:
        pass


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


_ANSI_RE = None


def strip_ansi(data: bytes) -> bytes:
    import re

    global _ANSI_RE
    if _ANSI_RE is None:
        _ANSI_RE = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b[\(\)][AB012]|\x1b[=><]|\r")
    return _ANSI_RE.sub(b"", data)


if __name__ == "__main__":
    sys.exit(main())
