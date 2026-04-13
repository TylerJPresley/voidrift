# VoidRift Codebase Audit — Pass 3

Audit of the codebase after AUDIT-2 remediation. Verified against `BACKEND-ENG`,
`QUALITY-QA`, `RELIABILITY-ENG`, `SECURITY-TRUST`, `ARCH-DESIGN`, and `WORKFLOW`
skills plus SOLID principles.

Test baseline: **675 passing, 0 failing** (`make test`, 2026-04-08).

---

## TASK_DOCS Cross-Reference

All prior audit and planning documents reviewed for this pass:

| File | Description | Key Status |
|------|-------------|------------|
| `TASK_DOCS/AUDIT.md` | Audit Pass 1 — 12 findings, agent.py at 1722 lines | All 12 items fixed (confirmed in AUDIT-2) |
| `TASK_DOCS/AUDIT-2.md` | Audit Pass 2 — 16 tasks | 14/16 fixed; AUDIT2-14 partial, AUDIT2-15 open + regressed |
| `TASK_DOCS/TASKS.md` | AUDIT-1 remediation task specs | All completed |
| `TASK_DOCS/TASKS-2.md` | AUDIT-2 remediation task specs | All completed (AUDIT2-15 still open) |
| `TASK_DOCS/TASK.md` | Anthropic protocol task (REQ-ARCH-22) | Implemented as `agent_protocol.py` (637 lines, never audited) |
| `TASK_DOCS/FEATURES.md` | Now/Next/Later feature backlog | Most ✅; see open backlog below |
| `TASK_DOCS/CL-FINDINGS.md` | Claude Code vs VoidRift gap analysis | Many gaps addressed; stop hooks, git injection, session persistence, worktree deferred |
| `TASK_DOCS/PI-FINDINGS.md` | pi-mono analysis | JSONL sessions, structured compaction, bash factory implemented |
| `TASK_DOCS/CL-FEATURES.md` | Claude Code TypeScript feature breakdown | Reference document; individual items tracked in FUTURE-WORK.md |
| `TASK_DOCS/LOOKING-FORWARD.md` | Lessons from Claude Code with reconciliation table | Most items implemented |
| `TASK_DOCS/FUTURE-WORK.md` | TASK-FW-001–020 (core infrastructure) | All 20 ✅ implemented |
| `TASK_DOCS/FUTURE-WORK-2.md` | TASK-FW-021–047 (tools, skills, sessions, UX) | Most ✅; 6 items still open (see backlog) |
| `TASK_DOCS/looking-forward.md` | Verify redesign spec (two-stage QA with bug reports) | All tasks open — not started |

---

## AUDIT-2 Resolution Status

| Task | Description | Status |
|------|-------------|--------|
| AUDIT2-01 | `except queue.Empty` in followup drain | ✅ FIXED |
| AUDIT2-02 | `except queue.Empty` in steering drain | ✅ FIXED |
| AUDIT2-03 | Log `reactive_compact()` failure | ✅ FIXED — `logging.debug` before `return False` |
| AUDIT2-04 | Narrow `interaction.py` exception | ✅ FIXED — `except (ValueError, TypeError)` |
| AUDIT2-05 | Narrow `gather.py` validation exception | ✅ FIXED — `except (RuntimeError, ValueError, TypeError, KeyError, JSONDecodeError)` |
| AUDIT2-06 | Debug log in `models.py` shell completion | ✅ FIXED — `logging.debug` before `return []` |
| AUDIT2-07/08 | Split `test_new_features.py` and `test_volume1.py` | ✅ FIXED — both files removed; classes moved to properly named test files |
| AUDIT2-09 | `filesystem.py` module-level `_ctx` singleton | ✅ FIXED — no module-level `WriteContext()` singleton present |
| AUDIT2-10 | `_mem`/`_session` invocation-time binding | ✅ FIXED — memory handlers instantiate `_MemMgr` per-call; session handler calls `load_or_create` inside the closure |
| AUDIT2-11 | `_active_skill_allowed_tools` mutable global | ✅ FIXED — removed from `tool_builder.py` and `agent.py`; no replacement found |
| AUDIT2-12 | `AGENT_TOOLS` constant in each command module | ✅ FIXED — `gather`, `plan`, `develop`, `chat`, `verify` all declare `AGENT_TOOLS` or `AGENT_TOOLS_PLAN`/`AGENT_TOOLS_EXECUTE` |
| AUDIT2-13 | `LOCAL_TOOLS`/`LOCAL_HANDLERS` out of `filesystem.py` | ✅ FIXED — moved to `tools/registry.py` |
| AUDIT2-14 | `_handle_stall()` and `_drain_queues()` extracted | ⚠️ PARTIAL — helpers exist and are tested in isolation, but `_run_loop` still drains queues inline (see §NEW-01) |
| AUDIT2-15 | Split `commands/chat.py` `_interactive_loop()` | ❌ OPEN and REGRESSED — 804 → 1060 lines (+32%) |
| AUDIT2-16 | Log masking for protected paths | ✅ FIXED — `_redact_tool_result()` with `_SENSITIVE_PATH_RE` |
| SECURITY-7.1 | Tool results logged verbatim | ✅ FIXED — redaction via `_SENSITIVE_PATH_RE` at `agent.py:226` |
| SECURITY-7.2 | `_expand_env` newline injection | ❌ OPEN — no newline sanitization added |

---

## New Findings

---

### NEW-01 — REQ-ARCH-20 Incomplete: `_drain_queues` Defined but Never Called

**Severity: HIGH** — The tested path differs from the executed path.

**File:** `cli/src/voidrift_cli/agent.py`

REQ-ARCH-20 requires `_drain_queues()` to be independently unit-testable, which implies
`_run_loop` calls it. Both helpers exist:

- `_drain_queues()` — line 559: drains both queues, returns `(steering_msgs, followup_items)`, has 2 unit tests
- `_handle_stall()` — line 580: used correctly, called at line 395

But `_run_loop` still drains queues inline:

```python
# Steering drain — inline at agent.py:472–476
while not self._steering_queue.empty():
    try:
        self.messages.extend(self._steering_queue.get_nowait())
    except queue.Empty:
        break

# Follow-up drain — inline at agent.py:364–375
if not self._followup_queue.empty():
    try:
        msgs, drain = self._followup_queue.get_nowait()
        ...
    except queue.Empty:
        pass
```

`_drain_queues` is called from test code only. Unit tests verify the helper in isolation
but provide no confidence in the actual loop behavior because the helper is dead code in
production.

**Note on semantics:** `_drain_queues()` drains the entire follow-up queue at once,
whereas the inline path processes one item per natural stop (respecting `drain="one-at-a-time"`).
The fix must account for this: either (a) replace the steering inline block only, or
(b) rework the follow-up drain logic to use `_drain_queues()` while preserving the
drain-mode semantics.

**Fix options:**
- **Minimal:** Replace only the steering queue inline block (`lines 472–476`) with a call
  to a steering-only helper. Remove the follow-up drain from `_drain_queues()` to match
  its actual tested surface.
- **Full:** Refactor `_drain_queues()` to return only steering messages (rename to
  `_drain_steering()`) and a separate `_drain_followup()` for one-item-at-a-time semantics.
  Call both from `_run_loop`. Ensures every tested path is the executed path.

---

### NEW-02 — `commands/chat.py` Size Regression: 804 → 1060 Lines

**Severity: HIGH** — File grew 32% since AUDIT-2 identified it as needing a split.

**File:** `cli/src/voidrift_cli/commands/chat.py` (1060 lines, 28 `def` statements)

AUDIT2-15 identified this file as the critical remaining split. Instead, it grew.
`_interactive_loop` contains 15+ nested closures covering:

- Terminal state management
- Rich Live display
- `web_fetch` confirm flow
- `ask_user` flow
- `prompt_toolkit` key bindings
- Session compaction
- Idea state machine
- Main run loop

These are distinct responsibilities that cannot be unit-tested in isolation.

**Fix:** Extract closures into module-level or class-level functions. Recommended
extraction order:
1. **Idea state machine** — pure state transitions, no I/O dependency
2. **Session compaction** — interacts only with the session object
3. **Key binding setup** — prompt_toolkit configuration, self-contained
4. **Confirm flows** (`web_fetch`, `ask_user`) — extract as named handler functions

---

### NEW-03 — `commands/gather.py` Size Growth: 759 → 902 Lines

**Severity: MEDIUM**

**File:** `cli/src/voidrift_cli/commands/gather.py` (902 lines)

This file grew 19% since AUDIT-2. The four pipeline stages are still inline in
`_gather_from()`. No split has been done.

**Fix:** Extract the four pipeline stages as module-level functions:
- `_run_triage(...)` — source triage agent
- `_run_context_build(...)` — context building pass
- `_run_source_analysis(...)` — threaded source analysis
- `_run_consolidation(...)` — consolidation pass

Each stage can then be tested independently.

---

### NEW-04 — `main.py` Size Growth: 691 → 750 Lines

**Severity: LOW–MEDIUM**

**File:** `cli/src/voidrift_cli/main.py` (750 lines)

Minor growth (+59 lines). Still over the 500-line target and still mixes command
registration, interactive mode, and utility helpers.

---

### NEW-05 — `agent_protocol.py` at 637 Lines — Never Audited

**Severity: MEDIUM**

**File:** `cli/src/voidrift_cli/agent_protocol.py` (637 lines)

New file implementing REQ-ARCH-22 (`ProtocolAdapter`, `OpenAIAdapter`,
`AnthropicAdapter`). It exceeds the 500-line target and has not been reviewed
in any previous audit.

Positive: no broad `except Exception` catches found.

Issues warranting review:

1. **Size**: At 637 lines with two concrete adapter classes plus ABC, it is
   already at 1.3× the target. Adding a third protocol (Gemini native) would
   push it further.

2. **`AnthropicAdapter.iter_stream()`** — the streaming path for the Anthropic
   protocol is complex and handles think-block buffering, tool call accumulation,
   and SSE event routing in a single method. If this mirrors the complexity of
   `_stream_response` from `agent.py` before the refactor, it has the same
   testability problem: a long streaming method that must be tested end-to-end.

3. **Test coverage**: `test_agent_protocol.py` exists (untracked in git status —
   needs to be committed). The depth of coverage is unknown from this audit.

---

### NEW-06 — `tools/registry.py` at 470 Lines — Near Threshold

**Severity: LOW**

**File:** `cli/src/voidrift_cli/tools/registry.py` (470 lines)

New file extracted from `filesystem.py` (correct move). Currently 30 lines
below the 500-line target. Every new tool schema added here will push it
toward the threshold. No action needed now, but it should not absorb more
tool schemas without a split plan.

---

### NEW-07 — `except Exception` for Token Budget Check

**Severity: LOW**

**File:** `cli/src/voidrift_cli/agent.py:493–496`

```python
elif self.token_budget:
    try:
        self.token_budget.check()
    except Exception:
        stop_reason = "budget_exhausted"
```

`self.token_budget.check()` raises `BudgetExhaustedError` and nothing else.
`except Exception` silently converts any other exception (e.g. an
`AttributeError` from a bug in `token_budget`) into a clean `"budget_exhausted"`
stop reason, hiding the real error.

**Fix:** `except BudgetExhaustedError: stop_reason = "budget_exhausted"`

---

### NEW-08 — `_expand_env` Newline Injection (Carried from AUDIT-2 §7.2)

**Severity: MEDIUM — SECURITY**

**File:** `cli/src/voidrift_cli/config.py:28–33`

No change since AUDIT-2. If an environment variable used in `models.yml`
(e.g. `api_key: ${MY_API_KEY}`) expands to a value containing `\n`, the
expanded value is embedded verbatim in structured log entries:

```
[SYSTEM] ...
FAKE_LOG_LINE_INJECTED_VIA_ENV_VAR
...
```

Any external tool parsing `.voidrift/logs/` as line-delimited records (log
aggregators, monitoring, the `log` command) can be deceived.

**Fix:** In `_replace()`, strip newlines from the expanded value before returning:

```python
def _replace(m: re.Match) -> str:
    var = m.group(1)
    if ":-" in var:
        name, default = var.split(":-", 1)
        value = os.environ.get(name, default)
    else:
        value = os.environ.get(var, "")
    return value.replace("\n", "").replace("\r", "")
```

---

### NEW-09 — `agent.py` Remains at 1073 Lines

**Severity: LOW–MEDIUM**

Was 1140 at AUDIT-2. Improved slightly but still 2.1× the 500-line target.
The file contains: `LoopState`, `AgentLoop` class, all streaming/sync response
methods, think-tag stripping, retry logic, tool execution and batching,
normalization, stall handling, and queue helpers. Each of these is a candidate
for further extraction.

---

## File Size Summary

| File | Lines | vs. AUDIT-2 | Status |
|------|-------|-------------|--------|
| `agent.py` | 1073 | −67 | Over target, slight improvement |
| `commands/chat.py` | 1060 | **+256** | ❌ REGRESSED — critical |
| `commands/gather.py` | 902 | **+143** | ❌ REGRESSED |
| `main.py` | 750 | **+59** | REGRESSED |
| `commands/plan.py` | 700 | +13 | Over target |
| `agent_protocol.py` | 637 | NEW | Over target — never audited |
| `commands/develop.py` | 555 | +24 | Over target |
| `commands/verify.py` | 530 | +21 | Over target |
| `ui.py` | 524 | Unchanged | Over target |
| `tools/registry.py` | 470 | NEW | Near target — watch |
| `commands/skills.py` | 445 | Unchanged | Under target ✓ |
| `tool_builder.py` | 315 | −176 | Under target ✓ |
| `tools/filesystem.py` | 394 | −248 | Under target ✓ |

Three files that were over target at AUDIT-2 got **larger**, not smaller.

---

## Confidence Assessment

| Area | Confidence | Reasoning |
|------|-----------|-----------|
| Exception handling | 85% | Most narrowed; NEW-07 minor gap remains |
| Test organization | 95% | Non-standard files removed; proper module mapping in place |
| Tool builder / OCP | 90% | AGENT_TOOLS constants present; dynamic import confirmed |
| Queue drain correctness | **55%** | `_drain_queues` defined and tested but never called from loop — inline paths are the actual paths |
| Security (log masking) | 80% | `_redact_tool_result` in place; newline injection unaddressed |
| File size / navigability | 40% | 8 files exceed 500-line target; 3 regressed since AUDIT-2 |
| `agent_protocol.py` | 60% | New 637-line file; no broad catches found but depth unreviewed |

---

## Remediation Plan

### Group A — Mechanical Fixes (1–3 lines each, no design risk)

All Group A changes are independent. Complete in any order. Run `make test` after each.

---

#### A-1: Narrow token budget exception (`agent.py:495`)

**File:** `cli/src/voidrift_cli/agent.py`

**Root cause:** `except Exception` conceals non-budget exceptions from `token_budget.check()`.

**Change (1 line):**
```python
# BEFORE (agent.py:495)
except Exception:

# AFTER
except BudgetExhaustedError:
```

Requires `BudgetExhaustedError` to be importable at the call site. Verify the import
at the top of `agent.py` — if not present, add:
```python
from voidrift_cli.token_budget import BudgetExhaustedError
```

**REQ impact:** None — narrows exception type, does not change observable behavior.

**Tests:** `make test -k test_agent` — no regressions expected. Add one test:
assert that a non-`BudgetExhaustedError` from `token_budget.check()` propagates
as an unhandled exception rather than silently setting `stop_reason`.

---

#### A-2: Strip newlines from env var expansion (`config.py:28–33`)

**File:** `cli/src/voidrift_cli/config.py`

**Root cause:** `_replace()` returns env var values verbatim; values with `\n` inject
fake log lines.

**Change (add 1 line to `_replace`):**
```python
# BEFORE
def _replace(m: re.Match) -> str:
    var = m.group(1)
    if ":-" in var:
        name, default = var.split(":-", 1)
        return os.environ.get(name, default)
    return os.environ.get(var, "")

# AFTER
def _replace(m: re.Match) -> str:
    var = m.group(1)
    if ":-" in var:
        name, default = var.split(":-", 1)
        value = os.environ.get(name, default)
    else:
        value = os.environ.get(var, "")
    return value.replace("\n", "").replace("\r", "")
```

**REQ impact:** SECURITY-7.2 — closes log injection via env vars. Update
REQUIREMENTS.md with a new REQ-CFG-N or update REQ-CFG-1 rationale.

**Tests:** `make test -k test_config`. Add:
- Set `MY_VAR=line1\nfake_log_entry` and expand `${MY_VAR}`. Verify the result
  contains no `\n` or `\r`.
- Verify `${VAR:-default\ninjection}` strips newlines from the default value too.

---

#### A-3: Commit `test_agent_protocol.py`

**File:** `cli/tests/test_agent_protocol.py` (currently untracked)

**Root cause:** New protocol infrastructure has tests that are not in version control.
If someone clones the repo, the tests are missing and the commit history has no record
of them.

**Change:** `git add cli/tests/test_agent_protocol.py && git commit -m "chore: track test_agent_protocol.py"`

**REQ impact:** None — housekeeping.

---

### Group B — Correctness Fix (medium effort)

#### B-1: Integrate `_drain_queues()` into `_run_loop` (NEW-01)

**File:** `cli/src/voidrift_cli/agent.py`

**Root cause:** `_drain_queues()` was extracted per REQ-ARCH-20 to be independently
unit-testable, but the inline drain blocks were never replaced. Tests pass against
the helper while production runs the inline code.

**Recommended approach — split the helper to match each inline path exactly:**

1. Rename `_drain_queues()` → `_drain_steering()`: drains only the steering queue,
   returns `list[dict]`. Exact match of the inline block at lines 472–476.

2. Add `_drain_one_followup()`: drains one item from the followup queue, returning
   `tuple[list[dict], str] | None`. Exact match of the inline block at lines 364–375.

3. Replace the inline steering block (lines 472–476) with:
   ```python
   steering = self._drain_steering()
   if steering:
       self.messages.extend(steering)
   ```

4. Replace the inline followup block (lines 364–375) with:
   ```python
   item = self._drain_one_followup()
   if item:
       msgs, drain = item
       self.messages.extend(msgs)
       if drain == "all":
           while (more := self._drain_one_followup()):
               self.messages.extend(more[0])
       _iter_log("follow_up")
       continue
   ```

5. Update tests: remove tests that call `_drain_queues()` directly; add tests that
   call `_drain_steering()` and `_drain_one_followup()` in isolation. Verify that
   `_run_loop` uses these helpers via integration tests.

**Alternative (simpler):** Delete `_drain_queues()` and its tests entirely, leaving
the inline paths as-is. This eliminates the dead-code problem at the cost of losing
the testability REQ-ARCH-20 wanted. Only acceptable if REQ-ARCH-20 is rescoped.

**REQ impact:** REQ-ARCH-20 — update to describe `_drain_steering()` and
`_drain_one_followup()` as the extracted helpers. Update REQUIREMENTS.md before
implementing.

**Tests:** Existing tests for `_drain_queues()` become tests for `_drain_steering()`
and `_drain_one_followup()`. Add integration tests that inject messages via `steer()`
and `follow_up()` and verify the loop processes them correctly.

---

### Group C — Structural Refactors (high effort, require operator approval per START.md)

These must follow the full START.md workflow: identify → REQUIREMENTS.md update →
operator approval → implement → verify → document.

---

#### C-1: Split `commands/chat.py` (AUDIT2-15, NEW-02)

**File:** `cli/src/voidrift_cli/commands/chat.py` (1060 lines)

**Root cause:** `_interactive_loop` contains 15+ nested closures, each with a distinct
responsibility. File grew 32% since AUDIT-2 identified it as critical. Every new
feature added to chat makes the split harder.

**Extraction candidates (in order of effort / risk):**

| Target | Extraction | New location |
|--------|-----------|--------------|
| Idea state machine | Pure state transitions | `_idea_state.py` or module-level class |
| Session compaction | Interacts with session only | Module-level `_compact_session()` |
| Key binding setup | prompt_toolkit config | Module-level `_build_key_bindings()` |
| `web_fetch` confirm | Named callback | Module-level `_handle_web_fetch_confirm()` |
| `ask_user` confirm | Named callback | Module-level `_handle_ask_user()` |
| Live display management | Rich Live lifecycle | Module-level `_build_live_display()` |

Do NOT try to extract everything at once. Start with the idea state machine (zero I/O)
and confirm tests pass before proceeding.

**REQ impact:** AUDIT2-15 — no new behavior. Update REQUIREMENTS.md to remove the
existing file-size note and replace with structural requirement.

**Tests:** Each extracted function must have direct unit tests. The existing integration
tests must continue to pass.

---

#### C-2: Split `commands/gather.py` pipeline stages (NEW-03)

**File:** `cli/src/voidrift_cli/commands/gather.py` (902 lines)

**Root cause:** Four pipeline stages are inlined in `_gather_from()`. No extraction
has been done since AUDIT-2.

**Extraction candidates:**

| Stage | Function signature | Dependency |
|-------|-------------------|------------|
| Triage | `_run_triage(sources, config) → triage_result` | Agent, tools |
| Context build | `_run_context_build(triage_result, config) → context` | Agent, tools |
| Source analysis | `_run_source_analysis(sources, context, config) → analyses` | ThreadPoolExecutor |
| Consolidation | `_run_consolidation(analyses, config) → artifact` | Agent, tools |

**REQ impact:** None — pure refactor. ARCHITECTURE.md gather pipeline section
should describe the four stages as named functions.

---

#### C-3: Audit and split `agent_protocol.py` (NEW-05)

**File:** `cli/src/voidrift_cli/agent_protocol.py` (637 lines)

**Root cause:** New file implementing REQ-ARCH-22, never audited. Size already at
1.3× target. `AnthropicAdapter.iter_stream()` is likely complex.

**Audit checklist:**
- [ ] Read `iter_stream()` — does it have the same mixed-concern structure that
      `_stream_response` had before the refactor?
- [ ] Check exception narrowing — no broad `except Exception` in streaming path?
- [ ] Verify `test_agent_protocol.py` covers the streaming state machine
      (think-block buffering, tool-call accumulation) not just the happy path
- [ ] Verify `OpenAIAdapter` and `AnthropicAdapter` share no duplicated logic

If `iter_stream()` is as complex as the old `_stream_response`, extract the think-block
and tool-accumulation logic as helpers before adding a third adapter.

---

## Open Backlog (from all TASK_DOCS)

Items documented in TASK_DOCS as pending or not started. Not part of this audit's
fix plan — listed for completeness.

### From FUTURE-WORK-2.md

| Task | Description | Priority |
|------|-------------|----------|
| TASK-FW-019 | Session-level cost tracker (`CostTracker`, `pricing.yml`) | P2 |
| TASK-FW-024 | Skills progressive disclosure (lazy metadata loading) | P1 |
| TASK-FW-035 | Kiro credential refresh on 401 | P3 |
| TASK-FW-042 | Concurrent session registry / `voidrift status` | P3 |
| TASK-FW-043 | LSP diagnostic feedback loop | P3 |
| TASK-FW-044 | Scheduled gather / `voidrift watch` | P3 |
| TASK-FW-045 | vLLM tool-calling parser selection | P3 |

### From FEATURES.md (open items)

| ID | Description |
|----|-------------|
| N3 | Git transient state detection (rebasing, merging mid-run) |
| L6 | Configurable verify timeout |
| L10 | LSP diagnostic feedback |
| L14 | Scheduled gather |
| L16 | Concurrent session management |
| L24 | Image input processing |
| L25 | Diagram rendering |

### From looking-forward.md (lowercase) — Verify Redesign

The entire two-stage Verify system (REQ-VF-1 through REQ-VF-16) described in
`TASK_DOCS/looking-forward.md` is unimplemented. This covers:

- Stage 1 plan agent producing self-contained test cases to `VERIFY-PLAN.md`
- Stage 2 concurrent sub-agents executing scenarios and writing bug reports
- Stage 3 aggregation into `VERIFY.md`
- Process lifecycle tools (`ProcessManager`, `wait_for_ready`)
- HTTP client with session persistence (`http_request`)
- Browser tools (evaluate Playwright vs. MCP wrappers)
- Mockup screenshot comparison

This is a significant future phase, separate from the current audit's scope.

---

## Recommended Fix Priority

Ordered by confidence impact × effort:

1. **A-3: Commit `test_agent_protocol.py`** — 1 command. Tests for new
   protocol infrastructure must be in version control immediately.

2. **A-1: Narrow token budget exception** — 1 line in `agent.py:495`.
   Trivial. Closes `except Exception` hiding bugs in `token_budget`.

3. **A-2: Strip newlines in `_expand_env`** — 2-line change in `config.py:_replace`.
   Security fix. Closes SECURITY-7.2 (carried from AUDIT-2).

4. **B-1: Integrate queue drain helpers into `_run_loop`** — Medium effort.
   Closes the tested-path ≠ executed-path gap (55% confidence → 90%+).

5. **C-3: Audit `agent_protocol.py`** — Before adding any third protocol adapter.
   Verify `iter_stream()` complexity and test coverage depth.

6. **C-1: Split `commands/chat.py`** — Start with idea state machine and session
   compaction. Do not let this file grow further.

7. **C-2: Split `commands/gather.py`** — Extract the four pipeline stage functions
   so each can be tested and modified independently.
