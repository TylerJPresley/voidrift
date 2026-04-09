# VoidRift Development Guide

Follow this instruction: You are helping develop Project VoidRift: The Agentic Software Engineering Framework.

## Context Files

Load these before starting work:
- `REQUIREMENTS.md` — Acceptance criteria and the contract for all changes
- `README.md` — Project overview, architecture, and usage
- `ARCHITECTURE.md` — Component design, data flows, and key decisions

## Documentation IS the Solution

Documentation is not a byproduct of code — it is half the solution. The framework produces three documents that are as important as the source code:

- **REQUIREMENTS.md** is the contract. It defines what the system does and why. Written by gather and plan.
- **ARCHITECTURE.md** is the blueprint. It guides AI agents and architects building the system. Written by plan.
- **README.md** is the user manual. If a human operator needs to know about it, it goes here. Written by plan.

**Plan owns all documentation. Develop owns source code.** Develop implements what plan designed — it does not modify documentation. If implementation diverges from the plan, re-run plan to reconcile. This separation is structural: develop agents cannot write to `.voidrift/` (REQ-ARCH-9).

The same standard applies to VoidRift itself: every change to this framework updates REQUIREMENTS.md, ARCHITECTURE.md, and README.md alongside the code. Documentation that falls behind the code is a broken product.

## CRITICAL: Change Workflow

**ALWAYS follow this workflow for ANY change:**

1. **Identify and summarize the change**
   - What is broken, missing, or needs to change? Trace the root cause — not the symptom
   - Which components, files, and REQs are affected?
   - Summarize the change and its scope for operator approval
   - If a proper fix isn't feasible, say so explicitly — get approval before adding a workaround

2. **Wait for operator confirmation before proceeding**

3. **Update REQUIREMENTS.md**
   - Load `resources/skills/ANALYSIS-REQS.md` before writing or modifying any requirement
   - Follow EARS notation, REQ identification, rationale inclusion, and BDD acceptance criteria
   - Write ACs as observable system behaviors — describe what the running system does, not what code exists or was removed. For example: "The agent executes each unique tool call once per turn" not "duplicate tool calls are not executed multiple times."

4. **Wait for operator confirmation before proceeding**

5. **Implement to satisfy ACs**
   - Write code that passes the new/modified ACs
   - Write tests for every new public function, class, and module — no exceptions
   - One test per AC at minimum. Complex logic gets edge case tests
   - Tests go in `cli/tests/` matching the source module name (e.g. `session.py` → `test_session.py`)

6. **Verify against REQUIREMENTS.md**
   - Does this satisfy all related ACs?
   - Does this break any existing ACs?

7. **Update ALL documentation — no exceptions:**
   - [ ] REQUIREMENTS.md — the contract. New/modified REQs with EARS notation, BDD acceptance criteria, V-entries. This is the source of truth for what the system does and why.
   - [ ] ARCHITECTURE.md — the blueprint. New components, data flows, design decisions. This guides AI agents and architects building the system.
   - [ ] README.md — the user manual. If a human operator needs to know about it to use the application — commands, flags, config keys, slash commands, file formats — it goes here. Read the relevant README section and confirm.
   - [ ] CHANGELOG.md — entry under Added/Changed/Fixed
   - [ ] `make test` passes — all tests pass before work is complete

8. **Build, sync, and commit incrementally**
   - `make test` — after every code change
   - `make sync` — after ANY change to `resources/` (prompts, templates, skills) — this copies resources to `~/.voidrift/resources/` where the CLI reads them
   - `make build` — when packaging changes are needed
   - Commit after each logical unit of work with AC references

9. **Self-review before calling it done**
   - Re-read the requirement and every AC — does the implementation satisfy each one?
   - Were tests written for every new public function, class, and module?
   - Open each doc from step 7 and verify the update is present — read each file directly to confirm
   - Run `make test` one final time
   - **Assess confidence explicitly.** Score your confidence that the implementation is correct (0–100%). If below 90%, close the gaps yourself first — read the code, run the tests, verify the behavior. Only raise with the operator when the gap is a preference or constraint that cannot be resolved through analysis. Common sources of low confidence: untested edge cases, mocks that don't validate real SDK/API contracts, code paths with no test coverage, error handling that hasn't been exercised.

10. **Summarize changes for operator**
   - List all files created, modified, or deleted
   - Reference the ACs satisfied
   - Note any follow-up work or open questions

**Trace the root cause before writing requirements — a contract for an unknown problem is worthless.**
**Requirements are the contract — write them before writing code.**
**Work is complete only when all documentation is current — the context files ARE the project.**
**Every implementation must be questioned. Confidence < 90% means work is not done.**

## Design Principles

**SOLID · DRY · KISS** — apply these to every implementation decision.

- **SOLID** — single responsibility, clear abstractions
- **DRY** — reusable code; shared logic lives in one place
- **KISS** — simplest solution that works; complexity must be justified by the problem

Before writing code, ask: can the problem be solved at the template or prompt layer instead? Complexity in code is often a sign that an upstream contract (prompt, schema, format) is too loose. Fix the contract first.

Remove functions, classes, and modules that are no longer called by production code, along with their tests. Dead code is debt.

This project uses these skills — load and follow them:

- `BACKEND-ENG` — Python/Click/pytest conventions for VoidRift
- `QUALITY-QA` — Test-driven development, evidence-based completion
- `ANALYSIS-REQS` — Requirements authoring (EARS, BDD, rationale)
- `ARCH-DESIGN` — Architecture decisions, component design
- `RELIABILITY-ENG` — Error handling, retry, graceful degradation
- `SECURITY-TRUST` — No hardcoded secrets, path sandboxing
- `WORKFLOW` — Agent loop patterns, tool dispatch, prompt construction

Skills are authoritative — they override general instincts. If a skill seems wrong or incomplete, raise it with the operator before changing anything.

## Safety Rules

Require operator confirmation before running:
- git reset --hard, push --force, branch -D, clean -fd, rebase, filter-branch
- rm -rf, changes to >5 files, system config changes

## Framework Context

Python CLI project:
- `cli/` — Click-based CLI providing the `voidrift` command (entry point: voidrift_cli.main:cli)
- `resources/` — Framework guidance files (skills/, templates/, prompts/)
- Six framework commands: Gather → Plan → Develop → Verify → Deploy → Chat
- A framework command can have multiple distinct agent invocations
- Local worker models (vLLM) + Kiro Gateway + cloud APIs, all as OpenAI-compatible endpoints
- Pydantic models, Google-style docstrings, src/ layout
- Build: hatchling, VERSION file (shared), Makefile
- Tests: pytest in cli/tests/

## Prompt Authoring

When writing or editing prompts in `resources/prompts/`:
- Use positive instructions. Tell the model what to do. For example: "Write the full file content" not "never write placeholder stubs."
- Keep prompts compact. Every token in the system prompt competes with the model's working memory for the task.
