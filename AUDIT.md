# VoidRift Codebase Audit — Pass 4

Audit of the codebase after the 2026-04-09 through 2026-04-13 development session.
Verified against current REQUIREMENTS.md, ARCHITECTURE.md, and START.md workflow.

Test baseline: **792 passing, 1 pre-existing failure** (`make test`, 2026-04-13).

---

## Pass 3 Resolution Status

| Item | Description | Status |
|------|-------------|--------|
| A-1 | Narrow token budget exception (`agent.py`) | ✅ FIXED — uses `BudgetExhaustedError` |
| A-2 | Strip newlines in `_expand_env` (`config.py`) | ✅ FIXED — `.replace("\n", "").replace("\r", "")` |
| A-3 | Commit `test_agent_protocol.py` | ✅ FIXED — committed and tracked |
| B-1 | Integrate queue drain helpers into `_run_loop` | ✅ FIXED — `_drain_steering()` and `_drain_one_followup()` called from loop |
| C-1 | Split `commands/chat.py` | ✅ FIXED — extracted `_chat_display.py` (372), `_chat_idea.py` (157), `_chat_compact.py` (175). Main file reduced from 1060 → 681 lines |
| C-2 | Split `commands/gather.py` | ✅ FIXED — extracted `_gather_pipeline.py` (581). Main file reduced from 902 → 367 lines |
| C-3 | Audit `agent_protocol.py` | ⚠️ PARTIAL — file exists at 634 lines, tests committed, but no deep review of `iter_stream()` complexity |
| AUDIT2-14 | `_handle_stall()` and `_drain_queues()` extracted | ✅ FIXED — replaced by `_drain_steering()` and `_drain_one_followup()` |
| AUDIT2-15 | Split `commands/chat.py` | ✅ FIXED — see C-1 above |
| SECURITY-7.2 | `_expand_env` newline injection | ✅ FIXED — see A-2 above |

---

## Changes Made This Session

### Bug Fixes & Infrastructure
| Change | REQ | Files |
|--------|-----|-------|
| Abort-aware interrupt handling | REQ-D-13 | `agent.py` |
| Done guard + write nudge for develop | REQ-D-5 | `agent.py`, `develop.py`, `develop.md` |
| Verify `_read_arch_field` quote stripping | — | `verify.py` |
| Session gap marker on resume | REQ-U-23 | `chat.py` |
| Chat thinking indicator + empty response | REQ-UI-14 | `chat.py`, `_chat_display.py` |

### Framework Quality (TASKS F1–F10)
| Change | REQ | Files |
|--------|-----|-------|
| Task-scoped ACs in PLAN-TASK | REQ-P-16 | `plan.md` |
| Develop self-review with confidence | REQ-D-22 | `develop.py` |
| Develop reads before writing | REQ-D-23 | `develop.md` |
| REQ traceability through plan pipeline | REQ-P-17 | `plan.md`, `plan.py` |
| Develop file list verification | REQ-D-21 | `develop.py` |
| Gather triage coverage check | REQ-G-22 | `gather.py` |
| Doc verification in verify Stage 0 | REQ-VF-17 | `verify.py`, `verify.md` |
| Chat read-first instruction | REQ-U-24 | `system.md` |
| Chat propose-before-writing | REQ-U-25 | `system.md` |
| Chat post-action summary | REQ-U-26 | `system.md` |
| `delete_source_file` tool | REQ-D-24 | `filesystem.py`, `registry.py`, `develop.py` |
| PLAN-TASK specs-not-code prompt | — | `plan.md` |

### Documentation
| Change | Files |
|--------|-------|
| START.md rewritten as generic dev guide | `START.md` |
| Prompt authoring moved to ARCHITECTURE.md | `ARCHITECTURE.md` §3.24 |
| Design decisions §3.25–3.30 added | `ARCHITECTURE.md` |
| TASKS.md created with F1–F10 | `TASKS.md` |

---

## File Size Summary

| File | Lines | vs. Pass 3 | Status |
|------|-------|------------|--------|
| `agent.py` | 1094 | −39 | Over target — abort extracted to `_agent_abort.py` |
| `main.py` | 290 | **−460** | ✅ Under target after split |
| `commands/plan.py` | 423 | **−313** | ✅ Under target after split |
| `commands/chat.py` | 681 | **−379** | ✅ Under target after split |
| `agent_protocol.py` | 634 | −3 | Over target — never deeply audited |
| `commands/develop.py` | 231 | **−384** | ✅ Under target after split |
| `commands/verify.py` | 589 | +59 | Over target — Stage 0 added |
| `commands/_gather_pipeline.py` | 581 | 0 | Over target (extracted from gather) |
| `ui.py` | 535 | +11 | Over target |
| `tools/registry.py` | 485 | +15 | Near target — delete tool added |
| `commands/skills.py` | 445 | 0 | Under target ✓ |
| `tools/filesystem.py` | 413 | +19 | Under target ✓ |
| `tool_builder.py` | 389 | +74 | Under target ✓ |
| `commands/_chat_display.py` | 372 | 0 | Under target ✓ (extracted) |
| `commands/gather.py` | 367 | **−535** | ✅ Under target after split |
| `commands/_chat_compact.py` | 175 | 0 | Under target ✓ (extracted) |
| `commands/_chat_idea.py` | 157 | 0 | Under target ✓ (extracted) |

**Improvements:** `chat.py` dropped from 1060 → 681 (−36%). `gather.py` dropped from 902 → 367 (−59%). Both splits were done before this session.

**Still over target:** `agent.py` (1133), `main.py` (750), `plan.py` (736), `agent_protocol.py` (634), `develop.py` (615), `verify.py` (589), `_gather_pipeline.py` (581), `ui.py` (535).

---

## Remaining Open Items

### HIGH Priority

#### OPEN-01 — `agent.py` at 1133 lines (2.3× target)

⚠️ PARTIAL — Extracted `_agent_abort.py` (62 lines) containing abort mechanism, loop registry, and abort-aware sleep. `agent.py` reduced to 1094 lines. Remaining methods (`_run_loop`, streaming, retry, tool execution) are tightly coupled to `AgentLoop` instance state — further extraction requires a larger refactor (mixins or parameter-passing pattern). 796 tests pass.

#### OPEN-02 — `agent_protocol.py` at 634 lines — depth unreviewed

✅ REVIEWED (Pass 4 deep review). No bugs or design issues found. No broad `except Exception` catches. `iter_stream()` in both adapters is linear state machine — not as complex as the old `_stream_response`. No duplicated logic between adapters. Two test coverage gaps closed: `_convert_messages` tool batching and OpenAI `iter_stream` partial think-tag detection. 64 tests now cover the file. Split recommended when a third adapter is added — not before.

### MEDIUM Priority

#### OPEN-03 — `main.py` at 750 lines

✅ FIXED — Extracted `_main_utils.py` (491 lines) containing all utility commands: status, log, prune, unlock, rollback, doctor, memory, completions. `main.py` reduced to 290 lines. Commands registered via `cli.add_command()`. 796 tests pass.

#### OPEN-04 — `plan.py` at 736 lines

✅ FIXED — Extracted `_plan_pipeline.py` (317 lines) containing all helper functions: `dispatch_agent`, `check_req_coverage`, `extract_modules`, `arch_summary`, `parse_outline_tasks`, `format_task_entry`, `build_task_files`, skill helpers, and source file listing. `plan.py` reduced to 423 lines. 796 tests pass.

#### OPEN-05 — Pre-existing test failure

`cli/tests/test_config.py::TestGetMaxTokens::test_task_stage` — ✅ FIXED. Test was reading real `~/.voidrift/config.yml` which had `plan.task: 16384` overriding the built-in 4000. Fixed by isolating all config tests with `monkeypatch` pointing to an empty temp config.

### LOW Priority

#### OPEN-06 — `develop.py` at 615 lines

✅ FIXED — Extracted `_develop_pipeline.py` (409 lines) containing `_dispatch_loop`, `_run_task`, and `_consult_architect`. `develop.py` reduced to 231 lines. 796 tests pass.

#### OPEN-07 — `verify.py` at 589 lines

Grew with Stage 0 doc verification. Manageable but approaching threshold.

---

## Confidence Assessment

| Area | Confidence | vs. Pass 3 | Reasoning |
|------|-----------|------------|-----------|
| Exception handling | 90% | +5% | A-1 fixed; no new broad catches introduced |
| Test organization | 95% | 0% | All test files tracked and properly named |
| Tool builder / OCP | 95% | +5% | `delete_source_file` added cleanly via registry pattern |
| Queue drain correctness | 90% | **+35%** | `_drain_steering` and `_drain_one_followup` called from loop |
| Security (log masking) | 95% | **+15%** | Newline injection fixed (A-2); `_redact_tool_result` in place |
| File size / navigability | 55% | **+15%** | chat.py and gather.py split; 8 files still over target |
| `agent_protocol.py` | 90% | **+30%** | Deep review complete; 64 tests; no issues found |
| Plan pipeline quality | 80% | NEW | REQ traceability, task-scoped ACs, coverage check |
| Develop task quality | 85% | NEW | Self-review, reads-before-writes, file list check, done guard |
| Chat UX | 80% | NEW | Read-first, propose, summarize, thinking indicator, gap marker |
| Verify completeness | 85% | NEW | Doc verification Stage 0, quote fix |

---

## Recommended Next Actions

1. **OPEN-05: Fix pre-existing test failure** — `test_config.py::TestGetMaxTokens::test_task_stage`. Quick investigation to determine if test or code is wrong.
2. **OPEN-02: Deep review `agent_protocol.py`** — before adding Gemini native adapter.
3. **OPEN-01: Split `agent.py`** — extract retry, streaming, and tool execution modules.
4. **OPEN-04: Split `plan.py`** — extract stage functions like gather pipeline.
