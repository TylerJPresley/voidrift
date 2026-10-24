#!/usr/bin/env python3
"""
A pty capture driver for the live fan-out shimmer band (cli-blueprint §4.4, D1).

Unlike `pty-harness.py` (which forces NO_COLOR and drives a fixed keystroke
sequence), this harness runs the BUILT `voidrift chat` with COLOUR ON, submits a
single prompt that fans out >= 2 workers, and then SAMPLES the pty master into a
series of time-stamped raw frames while the fan-out is live. The Node test
inspects the frames for the sweeping inverse band (the GENERATING tier) and
proves its column position ADVANCES frame to frame — in the real binary.

Determinism: the workers are held `running` by the fake server's per-reply
`delayMs`, so the row stays GENERATING across several ~125 ms shimmer ticks; the
harness samples every ~60 ms for a bounded window. A hard overall timeout kills
the child. Colour is left ON (no NO_COLOR) so the inverse-video band is emitted;
`reduceMotion` is driven by the project config the Node test writes, NOT by env.

Protocol: a single JSON object on argv[1]:
  { "cli": "<dist/cli.js>", "cwd": "<ws>", "env": {HOME, XDG_CONFIG_HOME},
    "prompt": "<text>", "sampleMs": 60, "windowMs": 2500, "timeoutMs": 30000 }
Stdout is a JSON object: { "ok", "frames": ["<raw>", ...], "output": "<all>" }.
"""
import json
import os
import pty
import select
import struct
import sys
import termios
import time
import fcntl
import signal


def main() -> int:
    spec = json.loads(sys.argv[1])
    cli = spec["cli"]
    cwd = spec["cwd"]
    extra_env = spec.get("env", {})
    prompt = spec.get("prompt", "fan out")
    sample_ms = spec.get("sampleMs", 60) / 1000.0
    window_ms = spec.get("windowMs", 2500) / 1000.0
    deadline = time.time() + spec.get("timeoutMs", 30000) / 1000.0

    env = dict(os.environ)
    for var in [
        "CI", "CONTINUOUS_INTEGRATION", "BUILD_NUMBER", "RUN_ID", "GITHUB_ACTIONS",
        "GITLAB_CI", "CIRCLECI", "TRAVIS", "APPVEYOR", "BUILDKITE", "DRONE",
        "GITHUB_RUNNER_DEBUG", "NO_COLOR",
    ]:
        env.pop(var, None)
    env.update(extra_env)
    # Colour ON so the inverse-video band is emitted; a real-ish 256-colour term.
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
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

    set_winsize(master, 40, 100)
    captured = bytearray()
    frames = []

    def drain() -> None:
        r, _, _ = select.select([master], [], [], 0.0)
        if master in r:
            try:
                data = os.read(master, 65536)
            except OSError:
                return
            if data:
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
        ok = ok and wait_for(b"ask a question", 15)
        # Submit the prompt as its own key event after it registers.
        os.write(master, prompt.encode())
        pump(master, captured, 0.5, deadline)
        os.write(master, b"\r")
        # Wait until the live fan-out header appears (the fan-out is live).
        ok = ok and wait_for(b"Orchestrating", 20)
        # Sample time-stamped frames across the live window.
        end = time.time() + window_ms
        while time.time() < end and time.time() < deadline:
            before = len(captured)
            drain()
            frames.append(
                {
                    "t": round((time.time()) * 1000),
                    "raw": bytes(captured[before:]).decode("utf-8", "replace"),
                }
            )
            time.sleep(sample_ms)
    finally:
        try:
            os.write(master, b"\x03")
            time.sleep(0.2)
            os.write(master, b"\x03")
            time.sleep(0.3)
            os.write(master, b"/quit\r")
        except OSError:
            pass
        pump(master, captured, 0.5, deadline)
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
            {"ok": ok, "frames": frames, "output": bytes(captured).decode("utf-8", "replace")}
        ).encode()
    )
    return 0


def pump(master: int, captured: bytearray, seconds: float, deadline: float) -> None:
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


def set_winsize(fd: int, rows: int, cols: int) -> None:
    try:
        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
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
