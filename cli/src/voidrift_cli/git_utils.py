"""Git diff with safety limits (REQ-GIT-4)."""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field

BINARY_EXTENSIONS = frozenset({
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".svg",
    ".pdf", ".zip", ".tar", ".gz", ".whl", ".pyc",
    ".so", ".dylib", ".dll", ".exe", ".db", ".sqlite",
})


@dataclass
class DiffResult:
    files_changed: list[str] = field(default_factory=list)
    diff_text: str = ""
    truncated: bool = False
    binary_files: list[str] = field(default_factory=list)
    total_files: int = 0
    total_lines: int = 0


def get_bounded_diff(
    project_dir: str,
    max_lines: int = 2000,
    max_files: int = 50,
    max_file_lines: int = 400,
) -> DiffResult:
    """Run git diff HEAD with safety limits. Returns DiffResult with truncation markers."""
    def _git(*args: str, timeout: int = 10) -> str:
        r = subprocess.run(
            ["git", *args], cwd=project_dir,
            capture_output=True, text=True, timeout=timeout,
        )
        return r.stdout.strip() if r.returncode == 0 else ""

    all_files = [f for f in _git("diff", "HEAD", "--name-only").splitlines() if f]
    total_files = len(all_files)

    binary = [f for f in all_files if any(f.lower().endswith(e) for e in BINARY_EXTENSIONS)]
    text = [f for f in all_files if f not in set(binary)]

    truncated = False
    files_to_diff = text
    if len(text) > max_files:
        files_to_diff = text[:max_files]
        truncated = True

    if not files_to_diff:
        return DiffResult(
            files_changed=all_files,
            diff_text="(no text file changes)" if all_files else "(no changes)",
            truncated=truncated, binary_files=binary,
            total_files=total_files, total_lines=0,
        )

    raw = _git("diff", "HEAD", "--", *files_to_diff, timeout=30)
    lines = raw.splitlines(keepends=True)
    total_lines = len(lines)

    out: list[str] = []
    file_lines = 0
    for line in lines:
        if line.startswith("diff --git"):
            file_lines = 0
        if file_lines >= max_file_lines:
            if not out or not out[-1].startswith("[TRUNCATED"):
                out.append(f"[TRUNCATED: file diff exceeds {max_file_lines} lines]\n")
                truncated = True
            continue
        if len(out) >= max_lines:
            omitted = total_lines - max_lines
            out.append(f"\n[TRUNCATED: diff exceeds {max_lines} total lines. {omitted} lines omitted.]\n")
            truncated = True
            break
        out.append(line)
        file_lines += 1

    if binary:
        out.append(f"\n[BINARY FILES SKIPPED: {', '.join(binary)}]\n")
    if len(text) > max_files:
        skipped = text[max_files:]
        names = ", ".join(skipped[:10]) + ("..." if len(skipped) > 10 else "")
        out.append(f"\n[FILES TRUNCATED: showing {max_files}/{len(text)} text files. Omitted: {names}]\n")

    return DiffResult(
        files_changed=all_files, diff_text="".join(out),
        truncated=truncated, binary_files=binary,
        total_files=total_files, total_lines=total_lines,
    )
