# Looking Forward

Strategic direction for future framework command development. This document contains the full architecture, requirements, and task breakdown for the redesigned Verify system. The core Verify implementation (REQ-VF-1 through REQ-VF-16) is complete on `feat/verify-command`. Mockup verification and plan integration tests remain open.

---

## Framework Command Responsibilities

Clear separation — each framework command has one job:

| Command | Responsibility |
|---|---|
| Plan | Architecture, task breakdown, design advice |
| Develop | All code changes |
| Verify | Run the system, test requirements, report bugs |
| Chat | Interactive review, debugging assistance using Verify reports |

Verify never touches source code. When it finds a failure, it collects as much evidence as possible and writes a bug report. Develop picks up the bug as a task. This keeps the feedback loop clean and each framework command accountable for its own domain.

---

## Verify: Requirements-Driven Acceptance Testing

### Vision

Verify is a two-stage command that mirrors Develop in structure.

**Stage 1 — Test Planning Agent:**
Receives all project documentation — REQUIREMENTS.md, user stories, ARCHITECTURE.md, TASKS.md, spec files, mockups. Cross-references everything and produces `.voidrift/VERIFY-PLAN.md`: a set of self-contained test cases, each one a complete prompt ready to hand to a sub-agent with no further assembly.

**Stage 2 — Sub-agents (concurrent):**
One sub-agent per test case. Each receives only its test case — the requirement, context, credentials, scenario steps, and observation instructions are all embedded by the plan agent. The sub-agent executes the scenario, and if it fails, collects all available evidence and writes a bug report to `.voidrift/bugs/<ITEM-ID>.md`. Sub-agents do not fix anything.

**Stage 3 — Report:**
Orchestrator collects results, writes `.voidrift/VERIFY.md` summarizing all outcomes with links to individual bug reports for failures.

```
Stage 1 — Plan agent:
  Reads: REQUIREMENTS.md, user stories, ARCHITECTURE.md, TASKS.md, spec/, mockups
  Thinks: what are all the ways to test this system?
  Writes: .voidrift/VERIFY-PLAN.md (self-contained test cases)

Stage 2 — Execution (concurrent sub-agents):
  For each test case in VERIFY-PLAN.md:
    spawn sub-agent with the test case as its full context
    sub-agent:
      executes scenario
      PASS → returns result + evidence
      FAIL → collects all available evidence:
               stack traces, error messages
               request/response details
               process stdout/stderr
               timestamps
               browser screenshots (if UI)
               relevant log excerpts
             writes .voidrift/bugs/<ITEM-ID>.md
             returns FAIL + path to bug report

Stage 3 — Report:
  Collect all results
  Write .voidrift/VERIFY.md (summary with bug report links)
  Write STATE.md entry
```

### Self-Contained Test Cases (VERIFY-PLAN.md)

The plan agent writes each test case as a complete, ready-to-execute prompt. The orchestrator hands the test case verbatim to the sub-agent — no further assembly, no template interpolation.

```markdown
# Verify Plan

Generated: <timestamp>
Project: <name>
Startup: <startup_command>
Bootstrap: <test_bootstrap or "none">

---

### ITEM-1

You are a QA agent verifying one requirement against a running system.
Your job is to execute the scenario and report results. Do not modify any source code.

**Requirement:** REQ-X — WHEN a new user submits valid registration data,
THE SYSTEM SHALL return 201 with the created user object.

**User story:** As a visitor, I want to create an account so that I can access the system.

**System context:** REST API running at http://localhost:8000.
Auth: JWT via POST /api/auth/login {email, password}.

**Scenario:**
1. POST /api/register with payload: {email: "test@example.com", password: "Test1234!", name: "Test User"}
2. Assert: 201 response
3. Assert: response body contains id, email, name fields
4. Assert: email matches the submitted value

**Expected result:** 201 with user object containing submitted fields.

**If this fails:** Collect all available evidence — full request, full response,
any error message or stack trace from process output, timestamps.
Write a detailed bug report.

---

### ITEM-2

You are a QA agent verifying one requirement against a running system.
Your job is to execute the scenario and report results. Do not modify any source code.

**Requirement:** REQ-Y — WHEN an authenticated admin requests the user list,
THE SYSTEM SHALL return 200 with an array of user objects.

**User story:** As an admin, I want to view all users so that I can manage accounts.

**System context:** REST API running at http://localhost:8000.
Auth: JWT via POST /api/auth/login {email, password}.

**Test credentials:** Admin — email: admin@test.local, password: test-admin-pass
(pre-seeded by bootstrap).

**Scenario:**
1. POST /api/auth/login with admin credentials → extract JWT token
2. GET /api/admin/users with header Authorization: Bearer <token>
3. Assert: 200 response
4. Assert: response body is a JSON array
5. Assert: each element contains id, email, role fields

**Expected result:** 200 with user array.

**If this fails:** Collect all available evidence — full request and response for
each step, JWT payload (decoded), any error or stack trace from process output,
timestamps, HTTP status codes. Write a detailed bug report.

---

### ITEM-3 [SKIP]

Requirement: REQ-Z — THE SYSTEM SHALL be intuitive.
Reason: Non-testable — qualitative requirement. Requires human review.
```

### Bug Report Format (.voidrift/bugs/ITEM-N.md)

Each failing test case produces one bug report. This is the artifact Develop picks up as a task input and Chat uses for debugging assistance.

```markdown
# Bug Report — ITEM-2

**Date:** <timestamp>
**Run:** verify-20260401-143022
**Requirement:** REQ-Y — Admin user list endpoint
**Status:** FAIL

## What Was Tested

GET /api/admin/users with authenticated admin session.

## Scenario Steps Executed

1. POST /api/auth/login
   Request: {"email": "admin@test.local", "password": "test-admin-pass"}
   Response: 200 {"token": "eyJ..."}

2. GET /api/admin/users
   Request headers: Authorization: Bearer eyJ...
   Response: 403 {"error": "Forbidden"}

## Expected vs Actual

Expected: 200 with user array
Actual: 403 Forbidden

## Process Output at Time of Failure

```
[2026-04-01 14:31:05] auth middleware: role check failed for /admin/users
[2026-04-01 14:31:05] user role=undefined, required=admin
```

## Stack Trace

None emitted — 403 returned by middleware before handler reached.

## Screenshots

None — HTTP scenario, no UI.

## Timestamps

- Login request: 14:31:04.812
- Admin request: 14:31:05.001
- Failure recorded: 14:31:05.023

## Notes

The JWT was issued successfully (200 on login) but the role claim appears to be
undefined in the token payload. This may indicate the seed script is not
persisting the admin role correctly, or the login handler is not including
the role claim when building the JWT.

Decoded JWT payload: {"sub": "admin@test.local", "role": null, "exp": 1743520265}
```

### VERIFY.md Format

```markdown
# Verify Report

Run: verify-20260401-143022
Completed: <timestamp>
Verdict: FAIL

## Summary

| Total | Passed | Failed | Skipped |
|-------|--------|--------|---------|
| 12    | 10     | 1      | 1       |

## Results

### ITEM-1 — REQ-X — User registration ✓ PASS
Evidence: POST /api/register → 201 {"id": "abc123", "email": "test@example.com", "name": "Test User"}

### ITEM-2 — REQ-Y — Admin user list ✗ FAIL
Bug report: [bugs/ITEM-2.md](bugs/ITEM-2.md)
Summary: 403 Forbidden — JWT role claim is null, admin middleware rejects request

### ITEM-3 — REQ-Z — System is intuitive — SKIPPED
Reason: Non-testable, requires human review

## Verdict

FAIL — 1 failure. See bug reports for details.
Bug reports written to .voidrift/bugs/.
```

### Chat Integration

When the operator asks Chat to look at Verify results, Chat reads VERIFY.md and individual bug reports via `read_framework_file`. The bug reports contain structured, full-fidelity evidence — request/response pairs, decoded tokens, process output, timestamps. Chat can help the operator understand the root cause and advise on a fix, which then becomes a task for Develop.

Chat does not automatically load Verify artifacts on session start.

### Automate

Automate becomes a deployment pipeline executor — an agent that takes built artifacts and deploys them to a configured target environment, runs smoke checks, and wires up CI/CD. Deferred until the deployment target model is defined.

---

## Architecture

### Components

```
commands/verify.py            — Orchestrator: plan stage, spawn sub-agents, collect results, write report
tools/process_manager.py      — Start/stop/wait/read processes; cleanup guarantee
tools/http_client.py          — Stateful HTTP client; named session management
resources/prompts/verify.md   — Command prompt: plan agent instructions + sub-agent instructions
```

### Data Flow

```
Verify orchestrator
  │
  ├─ reads REQUIREMENTS.md, ARCHITECTURE.md, TASKS.md, spec/*, mockups
  │
  ├─ Stage 1: Plan agent
  │    receives: all project documentation
  │    produces: .voidrift/VERIFY-PLAN.md (self-contained test cases)
  │    tools: cmd="verify-plan"
  │
  ├─ executes test_bootstrap (if configured)
  ├─ ProcessManager.start() → process handle
  ├─ ProcessManager.wait_ready()
  │
  ├─ Stage 2: for each test case in VERIFY-PLAN.md (concurrent):
  │    spawn sub-agent with test case as full context
  │    tools: cmd="verify-execute"
  │    PASS → collect result + evidence
  │    FAIL → sub-agent writes .voidrift/bugs/<ITEM-ID>.md
  │            collect result + bug report path
  │
  ├─ Stage 3: write .voidrift/VERIFY.md
  ├─ write STATE.md entry
  └─ ProcessManager.stop_all() → cleanup (try/finally)
```

### Tool Sets

**Plan agent — `cmd="verify-plan"`:**

| Tool | Purpose |
|---|---|
| `read_framework_file` | Read REQUIREMENTS.md, ARCHITECTURE.md, TASKS.md, spec files |
| `read_source_file` | Read source when reasoning about testability |
| `write_framework_file` | Write VERIFY-PLAN.md |

**Sub-agent — `cmd="verify-execute"`:**

| Tool | Purpose |
|---|---|
| `read_framework_file` | Read architecture context |
| `write_framework_file` | Write bug report to .voidrift/bugs/ |
| `read_process_output(handle)` | Read from running process |
| `http_request(method, url, headers, body, session_id)` | HTTP scenarios |
| `run_command(cmd, cwd)` | CLI scenarios |
| `browser_navigate / screenshot / click / get_text` | UI scenarios |

Sub-agents do not have `read_source_file`, `write_source_file`, `start_process`, or `stop_process`. They interact with the running system. They do not read or touch source code.

### Process Lifecycle

The product process is started once by the orchestrator before Stage 2, shared across all sub-agents via injected handle reference, and stopped in a `try/finally` block. Sub-agents receive the handle as part of their context.

### Authentication

**Track 1 — Agent-created sessions:** Sub-agents with auth preconditions create sessions via registration or login. Credentials are local to the sub-agent.

**Track 2 — Test bootstrap:** Orchestrator runs `test_bootstrap` before Stage 2. Credentials are embedded in each test case by the plan agent.

---

## Requirements

*EARS notation per ANALYSIS-REQS skill. REQ-VF prefix.*

### Plan Integration

**REQ-VF-1:** WHEN the Plan command generates ARCHITECTURE.md for a project with a runnable entry point, THE SYSTEM SHALL include a `startup_command:` field.
- Given a web API project, When Plan generates ARCHITECTURE.md, Then `startup_command:` is present.

**REQ-VF-2:** WHEN the Plan command detects authentication requirements, THE SYSTEM SHALL include `test_bootstrap:` in ARCHITECTURE.md AND a test harness implementation task in TASKS.md.
- Given an auth system is present, When Plan generates TASKS.md, Then a test harness task exists.

### Verify Artifacts

**REQ-VF-3:** WHEN Stage 1 completes, THE SYSTEM SHALL have written `.voidrift/VERIFY-PLAN.md` containing one self-contained test case per testable scenario. Each test case SHALL be a complete prompt including: requirement text, user story context, system context, test credentials (if applicable), numbered scenario steps, expected result, and evidence collection instructions. Non-testable criteria SHALL appear as SKIP items with reason.
- *Rationale:* Self-contained test cases eliminate context assembly in the orchestrator. The plan agent does that work once; sub-agents receive ready-to-execute prompts.
- Given 10 criteria (8 testable, 2 qualitative), When VERIFY-PLAN.md is written, Then 8 test cases and 2 SKIP items are present.

**REQ-VF-4:** WHEN a sub-agent encounters a failing scenario, THE SYSTEM SHALL write `.voidrift/bugs/<ITEM-ID>.md` containing: timestamp, run ID, requirement reference, scenario steps executed with full request/response detail, expected vs. actual result, process output at time of failure, any stack traces, screenshots (if UI scenario), and agent notes on likely cause.
- *Rationale:* Bug reports are the primary artifact for Develop and Chat. Full-fidelity evidence in a structured file means no re-running is needed to understand the failure.
- Given a scenario fails, When the bug report is written, Then it contains all evidence fields.

**REQ-VF-5:** WHEN Stage 3 completes, THE SYSTEM SHALL have written `.voidrift/VERIFY.md` containing: summary table (total/passed/failed/skipped), per-item result with evidence for passes and bug report link for failures, and a Verdict line.
- Given 1 failure exists, When VERIFY.md is written, Then the failure entry links to the bug report file.

**REQ-VF-6:** WHEN Verify completes, THE SYSTEM SHALL write a STATE.md entry: command, run ID, timestamp, verdict, items total/passed/failed/skipped.

**REQ-VF-7:** Sub-agents SHALL NOT modify source files. The `write_source_file` tool SHALL NOT be included in the `cmd="verify-execute"` tool set.
- *Rationale:* Verify's responsibility is observation and reporting. Code changes are Develop's responsibility. Structural enforcement via tool set ensures this boundary is never crossed.

### Process Lifecycle

**REQ-VF-8:** THE SYSTEM SHALL provide `start_process(cmd, env, cwd)` returning an opaque handle with buffered stdout/stderr capture.

**REQ-VF-9:** THE SYSTEM SHALL provide `wait_for_ready(handle, strategy, target, timeout)` with strategies `http`, `port`, and `log_pattern`. Timeout SHALL stop the process and raise.

**REQ-VF-10:** THE SYSTEM SHALL guarantee process cleanup in a `try/finally` block in the orchestrator regardless of sub-agent outcome.

**REQ-VF-11:** THE SYSTEM SHALL provide `read_process_output(handle)` returning up to 500 buffered lines and `run_command(cmd, cwd)` returning stdout/stderr/exit_code synchronously.

### HTTP Tool

**REQ-VF-12:** THE SYSTEM SHALL provide `http_request(method, url, headers, body, session_id)` with per-session cookie and auth header persistence. Multiple named sessions per sub-agent SHALL be supported. Sessions SHALL be discarded when the sub-agent completes.

### Verify Agent Behavior

**REQ-VF-13:** THE SYSTEM SHALL construct Stage 1 and Stage 2 system prompts using four-layer construction: `system.md` + QUALITY-QA skill + `resources/prompts/verify.md` + injected context.

**REQ-VF-14:** The Stage 1 plan agent SHALL cross-reference REQUIREMENTS.md, user stories, ARCHITECTURE.md, TASKS.md, and spec files when deriving test cases. Each test case SHALL embed all context a sub-agent needs to execute without reading any additional documents.
- *Rationale:* Sub-agents have minimal scope by design. All context assembly happens in Stage 1 so sub-agents can stay focused on execution.

**REQ-VF-15:** Sub-agents SHALL run concurrently up to the configured concurrency limit (shared with Develop command config). Each sub-agent starts with a clean message history.

**REQ-VF-16:** THE SYSTEM SHALL pass `cmd="verify-plan"` and `cmd="verify-execute"` to `build_local_tools()`. The `cmd="verify-execute"` tool set SHALL NOT include `read_source_file`, `write_source_file`, `start_process`, or `stop_process`.

---

## Task Breakdown

### Module: Plan Integration

- [x] Add `startup_command:` and `test_bootstrap:` to `resources/templates/ARCHITECTURE-TEMPLATE.md`
- [x] Update `resources/prompts/plan.md` to populate `startup_command:` from project type and entry point
- [x] Update `resources/prompts/plan.md` to generate test harness task when auth is present
- [ ] Write tests: `startup_command:` present for web/API/CLI types [QUALITY-QA]
- [ ] Write tests: test harness task generated when auth detected [QUALITY-QA]

### Module: Process Lifecycle Tools

- [x] Design `ProcessManager`: `start()`, `stop()`, `wait_for_ready()`, `read_output()`, `stop_all()` [SYSTEMS-ENG]
- [x] Implement `cli/src/voidrift_cli/tools/process_manager.py`
- [x] Implement `start_process` tool: subprocess with ring-buffered output
- [x] Implement `stop_process` tool: SIGTERM → SIGKILL after 5s
- [x] Implement `wait_for_ready` tool: `http`, `port`, `log_pattern` strategies
- [x] Implement `read_process_output` tool: 500-line buffer, newest on truncation
- [x] Implement `run_command` tool: synchronous, stdout/stderr/exit_code
- [x] Write tests: lifecycle, capture, SIGKILL fallback, readiness strategies, timeout [QUALITY-QA]

### Module: HTTP Tool

- [x] Design `SessionManager`: session_id keyed, cookie + auth header persistence, run-scoped
- [x] Implement `cli/src/voidrift_cli/tools/http_client.py`
- [x] Implement `http_request` tool with session support
- [x] Implement cookie persistence per session
- [x] Implement multi-session isolation and cleanup
- [x] Write tests: persistence, isolation, inheritance, cleanup [QUALITY-QA]

### Module: Browser Tools

- [x] Evaluate Playwright vs. browser automation libraries; select approach (Playwright, soft dependency)
- [x] Implement `browser_navigate`, `browser_screenshot`, `browser_click`, `browser_get_text`
- [x] Implement session scoping and cleanup
- [x] Write tests: navigation, capture, interaction, cleanup [QUALITY-QA]

### Module: Tool Registration

- [x] Add `cmd="verify-plan"` to `build_local_tools()`: `read_framework_file`, `read_source_file`, `write_framework_file`
- [x] Add `cmd="verify-execute"` to `build_local_tools()`: `read_framework_file`, `write_framework_file`, `read_process_output`, `http_request`, `run_command`, browser tools — no source file tools, no process lifecycle tools
- [x] Write tests: tool set composition for both verify commands [QUALITY-QA]

### Module: Verify Command Prompt

- [x] Write `resources/prompts/verify.md` [QUALITY-QA] [ANALYSIS-REQS]
  - Stage 1 instructions: read all docs, cross-reference, write self-contained test cases to VERIFY-PLAN.md
  - Stage 2 instructions: execute scenario, assert expected result, collect evidence on failure
  - Evidence collection instructions: full request/response, process output, stack traces, screenshots, timestamps, decoded tokens, agent notes
  - Bug report format specification
  - Explicit instruction: do not modify source code under any circumstances

### Module: Verify Command Orchestrator

- [x] Rewrite `cli/src/voidrift_cli/commands/verify.py` [ARCH-DESIGN] [RELIABILITY-ENG]
  - Stage 1: create plan agent, inject all docs, run, confirm VERIFY-PLAN.md written
  - Execute test_bootstrap if configured
  - Start product, wait for readiness
  - Stage 2: read VERIFY-PLAN.md, spawn sub-agents concurrently (reuse develop concurrency config)
  - Each sub-agent: inject test case text as full context, collect result
  - Stage 3: aggregate results, write VERIFY.md, write STATE.md entry
  - Stop product in finally block
- [x] Write integration tests: full flow, mock process, mock agents [QUALITY-QA]
- [x] Write tests: cleanup on sub-agent exception [QUALITY-QA]
- [x] Write tests: concurrent sub-agent execution respects concurrency limit [QUALITY-QA]
- [x] Write tests: sub-agent cannot call write_source_file (tool set enforcement) [QUALITY-QA]
- [x] Write tests: VERIFY-PLAN.md, VERIFY.md, bug report format correctness [QUALITY-QA]

### Module: Mockup Verification

- [ ] Define convention: `.voidrift/mockups/<REQ-ID>.png`
- [ ] Update Gather to copy design files to `.voidrift/mockups/`
- [ ] Plan agent: detect mockup files, embed screenshot + comparison instructions in test case
- [ ] Sub-agents with UI scenarios: navigate, screenshot, include in bug report if mismatch
- [ ] Write tests: detection, embedding, graceful skip [QUALITY-QA]

### Module: Documentation

- [x] Update REQUIREMENTS.md: replace REQ-V-1–4 with formal REQ-VF entries
- [x] Update ARCHITECTURE.md: Verify component, data flow, startup_command field, bug report artifacts
- [x] Update README.md: Verify as two-stage QA with bug reports
- [x] Update CHANGELOG.md

---

## Open Questions

1. **Browser automation.** Playwright vs. browser automation libraries. Evaluate dependency weight.

2. **Mockup format.** PNG only to start.

3. **Test isolation.** `test_bootstrap` resets ALL state once before Stage 2. Per-scenario reset is a future improvement.

4. **Non-runnable project types.** Libraries fall back to running the project's own test suite. Plan agent detects from ARCHITECTURE.md and generates appropriate test cases.

5. **Multimodal for mockup comparison.** Non-multimodal models skip mockup items, note in VERIFY.md.

6. **Sub-agent result schema.** Define the structured return value: `{item_id, status, evidence, bug_report_path}`.

7. **Bug report lifecycle.** Bug reports persist across Verify runs. Define whether a new run overwrites or archives prior reports — likely archive by run ID.
