"""Benchmark result capture and BENCHMARKS.md management."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------


def _benchmarks_path() -> Path:
    from .config import voidrift_home
    return voidrift_home() / "BENCHMARKS.md"


# ---------------------------------------------------------------------------
# Parse vLLM bench serve output
# ---------------------------------------------------------------------------


def parse_bench_output(output: str) -> dict:
    """Extract metrics from vLLM bench serve stdout."""
    patterns = {
        "throughput_tok_s": r"Output token throughput \(tok/s\):\s+([\d.]+)",
        "ttft_mean_ms":     r"Mean TTFT \(ms\):\s+([\d.]+)",
        "ttft_median_ms":   r"Median TTFT \(ms\):\s+([\d.]+)",
        "ttft_p99_ms":      r"P99 TTFT \(ms\):\s+([\d.]+)",
        "tpot_mean_ms":     r"Mean TPOT \(ms\):\s+([\d.]+)",
        "tpot_median_ms":   r"Median TPOT \(ms\):\s+([\d.]+)",
        "tpot_p99_ms":      r"P99 TPOT \(ms\):\s+([\d.]+)",
        "successful_requests": r"Successful requests:\s+(\d+)",
        "failed_requests":     r"Failed requests:\s+(\d+)",
    }
    result = {}
    for key, pattern in patterns.items():
        m = re.search(pattern, output)
        if m:
            val = m.group(1)
            result[key] = float(val) if "." in val else int(val)
    return result


# ---------------------------------------------------------------------------
# Runtime queries
# ---------------------------------------------------------------------------


def fetch_vllm_version(container: str) -> str:
    """Query vLLM version from inside the running container."""
    from .models import ssh_cmd
    for py in ("python3", "python"):
        try:
            r = ssh_cmd(f'docker exec {container} {py} -c "import vllm; print(vllm.__version__)"')
            v = r.stdout.strip()
            if v:
                return v
        except Exception:
            continue
    return "unknown"


def fetch_kv_tokens(worker_ip: str, port: int) -> int | None:
    """Query vLLM /metrics for GPU KV cache block count → token capacity."""
    try:
        import httpx
        resp = httpx.get(f"http://{worker_ip}:{port}/metrics", timeout=5)
        # vllm:num_gpu_blocks is the total number of KV cache blocks allocated.
        # vLLM default block size is 16 tokens.
        m = re.search(r'vllm:num_gpu_blocks\{[^}]*\}\s+([\d.]+)', resp.text)
        if m:
            return int(float(m.group(1))) * 16
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Cell formatters
# ---------------------------------------------------------------------------


def _condense_vllm_args(args: list[str]) -> str:
    """Condense vllm_args to a compact readable string.

    Strips noise flags, keeps the values that affect benchmark results:
    attention backend, tool-call parser, prefix-caching, reasoning parser.
    """
    skip = {"--enable-auto-tool-choice"}
    rename = {"--enable-prefix-caching": "prefix-caching"}
    value_flags = {"--tool-call-parser", "--reasoning-parser", "--attention-backend"}

    result = []
    i = 0
    while i < len(args):
        arg = args[i]
        if arg in skip:
            i += 1
        elif arg in rename:
            result.append(rename[arg])
            i += 1
        elif arg in value_flags:
            if i + 1 < len(args):
                result.append(args[i + 1])
                i += 2
            else:
                i += 1
        else:
            i += 1
    return " ".join(result)


def _shorten_image(image: str) -> str:
    """scitrera/dgx-spark-vllm:0.17.0-t5 → scitrera:0.17.0-t5"""
    if not image:
        return "—"
    # Take the first path segment before / and the tag
    parts = image.split("/")
    prefix = parts[0]
    tag = image.split(":")[-1] if ":" in image else image
    return f"{prefix}:{tag}"


def _fmt_ms(v: float) -> str:
    return f"{v:.0f}ms"


def make_config_cell(model_cfg: dict) -> str:
    gpu_util_raw = model_cfg.get("gpu_memory_utilization", "?")
    gpu_util = f"{gpu_util_raw:.2f}" if isinstance(gpu_util_raw, float) else gpu_util_raw
    max_len = model_cfg.get("max_model_len", "?")
    args = _condense_vllm_args(model_cfg.get("vllm_args", []))
    parts = [f"gpu_util:{gpu_util}", f"max_len:{max_len}"]
    if args:
        parts.append(args)
    return " ".join(parts)


def make_ttft_cell(data: dict) -> str:
    mean = data.get("ttft_mean_ms")
    med  = data.get("ttft_median_ms")
    p99  = data.get("ttft_p99_ms")
    if mean is None:
        return "—"
    return f"{_fmt_ms(mean)}/{_fmt_ms(med)}/{_fmt_ms(p99)}"


def make_tpot_cell(data: dict) -> str:
    mean = data.get("tpot_mean_ms")
    med  = data.get("tpot_median_ms")
    p99  = data.get("tpot_p99_ms")
    if mean is None:
        return "—"
    return f"{_fmt_ms(mean)}/{_fmt_ms(med)}/{_fmt_ms(p99)}"


def make_resources_cell(kv_tokens: int | None) -> str:
    if kv_tokens is None:
        return "—"
    if kv_tokens >= 1_000_000:
        return f"{kv_tokens // 1_000_000}M KV"
    return f"{kv_tokens // 1_000}k KV"


def make_run_cell(data: dict, num_prompts: int, req_rate: float, dataset: str) -> str:
    ok   = data.get("successful_requests", "?")
    fail = data.get("failed_requests", 0)
    total = (ok + fail) if isinstance(ok, int) and isinstance(fail, int) else "?"
    rate_str = f"{req_rate:.0f}/s" if req_rate > 0 else "max"
    return f"{ok}/{total} · {num_prompts}p @ {rate_str} · {dataset}"


# ---------------------------------------------------------------------------
# Row formatting
# ---------------------------------------------------------------------------


def format_row(
    model: str,
    date: str,
    vllm_version: str,
    image: str,
    config_cell: str,
    throughput: float | None,
    ttft_cell: str,
    tpot_cell: str,
    resources_cell: str,
    run_cell: str,
) -> str:
    tput = f"{throughput:.0f} tok/s" if throughput else "—"
    cols = [model, date, vllm_version, image, config_cell, tput, ttft_cell, tpot_cell, resources_cell, run_cell]
    return "| " + " | ".join(cols) + " |"


# ---------------------------------------------------------------------------
# BENCHMARKS.md read / write
# ---------------------------------------------------------------------------

_TABLE_HEADER = (
    "| Model | Date | vLLM | Image | Config | Throughput | TTFT mean/med/P99 | TPOT mean/med/P99 | Resources | Run |\n"
    "|---|---|---|---|---|---|---|---|---|---|\n"
)

_TRIED_HEADER = (
    "## Tried / Retired\n\n"
    "Human judgment on models evaluated and not carried forward. Stats are in the tables above.\n\n"
    "| Model | Date | Verdict |\n"
    "|---|---|---|\n"
)

_FILE_HEADER = (
    "# Benchmark Results\n\n"
    "Hardware: ASUS Ascent GX10 · FlashInfer  \n"
    "Run: `worker bench <num_prompts> <req_rate>` · Dataset: ShareGPT\n\n"
)


def _initial_content(first_row: str) -> str:
    return (
        _FILE_HEADER
        + "## Current\n\n"
        + _TABLE_HEADER
        + first_row + "\n\n"
        + "## History\n\n"
        + _TABLE_HEADER
        + first_row + "\n\n"
        + _TRIED_HEADER
    )


def _upsert_current(content: str, new_row: str, model: str) -> str:
    """Replace the model's row in Current, or append it if not present."""
    # Locate the Current section (ends at the next ## heading)
    cur_start = content.find("\n## Current\n")
    if cur_start == -1:
        return content
    hist_start = content.find("\n## ", cur_start + 1)
    if hist_start == -1:
        hist_start = len(content)

    section = content[cur_start:hist_start]

    # Try to replace existing row (first column matches model exactly)
    escaped = re.escape(model)
    pattern = rf'(\| {escaped} \|[^\n]*)'
    if re.search(pattern, section):
        section = re.sub(pattern, new_row, section, count=1)
    else:
        # Append after the last table row in this section
        last_pipe = section.rfind("\n|")
        if last_pipe != -1:
            end_of_row = section.find("\n", last_pipe + 1)
            end_of_row = end_of_row if end_of_row != -1 else len(section)
            section = section[:end_of_row] + "\n" + new_row + section[end_of_row:]
        else:
            section += new_row + "\n"

    return content[:cur_start] + section + content[hist_start:]


def _append_history(content: str, new_row: str) -> str:
    """Append a row to the History table."""
    hist_start = content.find("\n## History\n")
    if hist_start == -1:
        return content

    tried_start = content.find("\n## Tried", hist_start + 1)
    end = tried_start if tried_start != -1 else len(content)

    section = content[hist_start:end]
    last_pipe = section.rfind("\n|")
    if last_pipe != -1:
        end_of_row = section.find("\n", last_pipe + 1)
        end_of_row = end_of_row if end_of_row != -1 else len(section)
        section = section[:end_of_row] + "\n" + new_row + section[end_of_row:]
    else:
        section += new_row + "\n"

    return content[:hist_start] + section + content[end:]


def update_benchmarks(row: str, model: str) -> Path:
    """Upsert row in Current, append to History. Create file if missing."""
    path = _benchmarks_path()
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(_initial_content(row))
        return path

    content = path.read_text()
    content = _upsert_current(content, row, model)
    content = _append_history(content, row)
    path.write_text(content)
    return path
