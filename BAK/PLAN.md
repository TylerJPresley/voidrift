# Plan: Harness-Driven Memory Capture

## Problem

VoidRift's memory system is passive: the model decides when to call `write_memory`, and
memory tools only exist in chat. When plan, develop, and verify run, the harness has full
visibility of what happened — task outcomes, escalation counts, failed test items — but
discards it. Every session starts cold.

The insight from LangChain's "Your Harness, Your Memory": **the harness must own
accumulation, not the model.** A tool the model may forget to call is not a memory system.

## Scope

Two tiers, delivered together:

**Tier 1 — Harness-driven capture.** After develop, verify, and plan complete, the harness
writes structured run summaries to project memory. No model call. Uses data already in
memory at the completion point.

**Tier 2 — Inject into develop agents.** Develop agents receive the memory index as part of
their system prompt, the same way git context is injected (§3.13). Adds awareness of prior
run patterns at negligible context cost.

Chat's `read_memory`/`write_memory`/`list_memory` tools are unchanged — they remain the
operator's interface for manual memory management.

---

## New Module: `memory_capture.py`

**File:** `cli/src/voidrift_cli/memory_capture.py`

Three public functions, one per command. Each reads the existing entry (if any), prepends a
new record block, trims to the last `_MAX_HISTORY` (5) blocks, and writes via `MemoryManager`.
No model call in any path.

### `capture_develop_run`

```
capture_develop_run(
    project_dir: str | Path,
    model_alias: str,
    outcome: str,            # "completed" | "failed" | "interrupted" | "budget_exhausted"
    status_counts: dict,     # from mm.summary() — {verified, planned, failed, blocked, ...}
    escalation_count: int,   # from _dispatch_loop local var
    diff_stats: list,        # from _dispatch_loop return value
    error_summary: str,      # from errors.summary_by_category() or ""
) -> None
```

Writes/updates entry **`develop-run-history`** (project scope). Description: "Develop
command run history — outcomes, escalations, error patterns."

Format per record:
```
### <ISO timestamp> — <outcome> (<model_alias>)
- Tasks: <verified> verified, <failed> failed, <blocked> blocked
- Files modified: <sum of file counts from diff_stats>
- Escalations: <escalation_count>
- Errors: <error_summary or "none">
```

### `capture_verify_run`

```
capture_verify_run(
    project_dir: str | Path,
    model_alias: str,
    verdict: str,            # "PASS" | "FAIL"
    results: list[dict],     # [{item_id, status, bug_report_path}, ...]
) -> None
```

Writes/updates entry **`verify-run-history`** (project scope). Description: "Verify command
run history — verdicts, failed items, pass/fail counts."

Format per record:
```
### <ISO timestamp> — <verdict> (<model_alias>)
- Results: <pass_count> pass, <fail_count> fail, <skip_count> skip
- Failed: <comma-separated item_ids or "none">
```

### `capture_plan_run`

```
capture_plan_run(
    project_dir: str | Path,
    model_alias: str,
    task_count: int,
    module_count: int,
) -> None
```

Writes/updates entry **`plan-context`** (project scope). Description: "Plan command run
history — task count, module count."

Unlike develop and verify, plan runs are infrequent and each rewrites the architecture.
This entry is **overwritten** (not appended) on each plan run — it reflects current
structure, not a history.

Format:
```
## Latest Plan (<ISO timestamp>, <model_alias>)
- Modules: <module_count>
- Tasks: <task_count>
```

### Internal helper: `_trim_run_blocks`

```
_trim_run_blocks(content: str, max_blocks: int) -> str
```

Splits on `### ` headings, keeps the first `max_blocks`, returns rejoined string. Pure
function, no I/O. Used by develop and verify capture only.

---

## Caller Changes

### `develop.py`

**Injection point:** After `append_state(...)` call (line 219) and before `return`.

Data available at that point:
- `summary` → `outcome`
- `mm.summary()` → `status_counts`
- `escalation_count` — currently local to `_dispatch_loop`; must be **returned** alongside
  `all_diff_stats` (change return type from `tuple[int, list]` to `tuple[int, list, int]`)
- `diff_stats` → already returned
- `errors.summary_by_category()` → `error_summary`

```python
from .memory_capture import capture_develop_run
capture_develop_run(
    project_dir=d.parent,
    model_alias=worker.alias,
    outcome=summary,
    status_counts=mm.summary(),
    escalation_count=escalation_count,
    diff_stats=diff_stats,
    error_summary=errors.summary_by_category() if errors.has_errors() else "",
)
```

**Also required:** `_dispatch_loop` return signature changes from `(int, list)` to
`(int, list, int)` — the third element is `escalation_count`. Update the unpacking in
`develop.py` and the sequential/concurrent branches inside `_dispatch_loop`.

### `verify.py`

**Injection point:** After `append_state(...)` call (around line 230), inside the `try`
block.

Data available:
- `worker.alias`
- `verdict`
- `results`

```python
from .memory_capture import capture_verify_run
capture_verify_run(
    project_dir=d.parent,
    model_alias=worker.alias,
    verdict=verdict,
    results=results,
)
```

### `plan.py`

**Injection point:** After `append_state(...)` call (line 415), before `return 0`.

Data available:
- `model.alias`
- `task_count` (already computed)
- Module count: `len(modules)` from Stage 1 output — currently used for display, needs to
  be carried to the completion block. Check `_run_plan_pipeline` signature for where
  `modules` is available; pass count through or recompute from manifest.

```python
from .memory_capture import capture_plan_run
capture_plan_run(
    project_dir=d.parent,
    model_alias=model.alias,
    task_count=task_count,
    module_count=module_count,
)
```

---

## Tier 2: Memory Injection into Develop Agents

**File:** `cli/src/voidrift_cli/commands/_develop_pipeline.py`

**Injection point:** `_run_task`, after `git_context` is appended to `system` (line 204).

```python
from ..memory import MemoryManager
_mem = MemoryManager(str(project_dir))
_mem_block = _mem.index_prompt_block()
if _mem_block:
    system += f"\n\n{_mem_block}"
```

`project_dir` is derivable from `voidrift_dir()` or passed through. `_run_task` already
receives `ctx` which has `project_dir`. Use `ctx._project_dir` or add `project_dir` as an
explicit parameter.

The injected block is the same index format already used in chat (names + descriptions
only, `read_memory` available to load detail). Develop agents don't have `read_memory` in
their tool list — the block is read-only context. That is intentional: develop agents
should not write memory; the harness does that.

---

## Requirements to Add

New section in REQUIREMENTS.md under `4.x Memory`:

- **REQ-MEM-2:** WHEN a develop command run completes (any outcome), THE SYSTEM SHALL write
  a run summary to the `develop-run-history` project memory entry containing outcome,
  task status counts, escalation count, files modified count, and error summary. The entry
  SHALL retain at most the last 5 run records.
  - *Rationale:* Develop run patterns (frequent escalations, recurring error types) are
    diagnostic signals that accumulate across sessions. Harness-driven capture ensures
    the record is complete regardless of model behavior.
  - AC: Given a develop run completes with outcome "failed", When memory is read, Then
    `develop-run-history` contains a record with the correct outcome, task counts, and
    timestamp.
  - AC: Given 6 develop runs have been recorded, When the 7th completes, Then only the 5
    most recent records are retained.

- **REQ-MEM-3:** WHEN a verify command run completes (any verdict), THE SYSTEM SHALL write
  a run summary to the `verify-run-history` project memory entry containing verdict,
  pass/fail/skip counts, and the list of failed item IDs. The entry SHALL retain at most
  the last 5 run records.
  - *Rationale:* Recurring verify failures on the same items indicate systematic gaps that
    require operator attention. A record visible in chat lets the operator query patterns
    without grepping bug files.
  - AC: Given a verify run with verdict FAIL and 3 failed items, When memory is read, Then
    `verify-run-history` lists those 3 item IDs.

- **REQ-MEM-4:** WHEN a plan command run completes, THE SYSTEM SHALL write a summary to the
  `plan-context` project memory entry containing module count and task count. This entry is
  overwritten on each plan run.
  - *Rationale:* Provides develop and chat agents with basic structural context (how large
    the project is, how many modules) without requiring them to parse the manifest.

- **REQ-MEM-5:** WHEN a develop task agent is constructed, THE SYSTEM SHALL append the
  project memory index block to the task agent's system prompt, after the git context block
  if present. The injected block SHALL use the same format as the chat command memory
  injection (names and descriptions only).
  - *Rationale:* Develop agents benefit from accumulated project knowledge (e.g. a
    verify-run-history showing ITEM-7 fails repeatedly indicates a pattern the developer
    should address proactively).

---

## Tests to Write

**File:** `cli/tests/test_memory_capture.py`

| Test | What it verifies |
|------|-----------------|
| `test_capture_develop_run_creates_entry` | First run creates `develop-run-history.md` |
| `test_capture_develop_run_appends_record` | Second run prepends a new `###` block |
| `test_capture_develop_run_trims_to_max` | 6th run drops the oldest record |
| `test_capture_develop_run_outcome_fields` | outcome, task counts, escalation count, file count appear correctly |
| `test_capture_verify_run_pass` | PASS verdict with 0 failed items |
| `test_capture_verify_run_fail_with_items` | FAIL verdict with item IDs listed |
| `test_capture_verify_run_trims_to_max` | Same trim behavior as develop |
| `test_capture_plan_run_overwrites` | Second plan run replaces (not appends) entry |
| `test_trim_run_blocks_keeps_n` | Unit test of `_trim_run_blocks` |
| `test_trim_run_blocks_fewer_than_max` | No truncation when under limit |

Tests use `tmp_path` fixture (pytest) — no real project directory needed.

---

## Documentation Updates

**ARCHITECTURE.md:** Add new §3.x "Harness-driven memory capture" documenting:
- The three entry names (`develop-run-history`, `verify-run-history`, `plan-context`)
- Injection points and data sources
- The `_MAX_HISTORY = 5` retention limit
- Why the harness writes (not the model): reliability of accumulation

**REQUIREMENTS.md:** Add REQ-MEM-2 through REQ-MEM-5 as described above.

---

## Implementation Order

1. `memory_capture.py` — new module, all three functions + `_trim_run_blocks`
2. `cli/tests/test_memory_capture.py` — all tests passing before touching callers
3. `_dispatch_loop` return type change (add `escalation_count` as third return value)
4. `develop.py` caller update — unpack new return, call `capture_develop_run`
5. `verify.py` caller update — call `capture_verify_run`
6. `plan.py` caller update — resolve `module_count`, call `capture_plan_run`
7. `_develop_pipeline.py` — Tier 2 memory index injection in `_run_task`
8. REQUIREMENTS.md — add REQ-MEM-2 through REQ-MEM-5
9. ARCHITECTURE.md — add new section

Each step is independently verifiable. Steps 1–2 are pure new code with no side effects on
existing behavior.
