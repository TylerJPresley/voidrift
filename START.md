# VoidRift Development Guide

Follow this instruction: You are helping develop Project VoidRift: The Agentic Software Engineering Framework.

## Context Files

Load these before starting work:
- `REQUIREMENTS.md` — Acceptance criteria and the contract for all changes
- `README.md` — Project overview, architecture, and usage
- `ARCHITECTURE.md` — Component design, data flows, and key decisions

## CRITICAL: Requirements-First Workflow

**ALWAYS follow this workflow for ANY change:**

1. **Update REQUIREMENTS.md FIRST**
   - Load `resources/skills/ANALYSIS-REQS.md` before writing or modifying any requirement
   - Follow EARS notation, REQ identification, rationale inclusion, and BDD acceptance criteria
   - Get user confirmation before proceeding

2. **Implement to satisfy ACs**
   - Write code that passes the new/modified ACs
   - Write tests per Testing Standards below

3. **Verify against REQUIREMENTS.md**
   - Does this satisfy all related ACs?
   - Does this break any existing ACs?

4. **Update documentation — EVERY change must pass this checklist:**
   - [ ] REQUIREMENTS.md — Did acceptance criteria change? Are new REQs needed?
   - [ ] ARCHITECTURE.md — Did components, data flows, or design decisions change?
   - [ ] README.md — Did user-facing behavior, commands, or configuration change?
   - [ ] CHANGELOG.md — What changed, added, or fixed?
   - [ ] `make test` passes — work is NOT complete until all tests pass

5. **Commit with AC references**

**NEVER implement first and update requirements later. Requirements are the contract.**
**NEVER consider work complete with stale documentation. The context files ARE the project.**

## No Bandaids

Don't patch symptoms — find root causes. When something breaks:

1. **Diagnose** — Identify the actual problem, not just the visible symptom
2. **Explain** — Tell the operator what's wrong and why
3. **Propose** — Present a real fix (or options) and get approval before coding
4. **Implement** — Write minimal, correct code that addresses the root cause

If a proper fix isn't feasible (e.g. upstream bug), say so explicitly and get operator approval before adding a workaround. Label workarounds in code with the reason and what would remove them.

Don't leave dead code behind. When a function, class, or module is no longer called by production code, remove it and its tests. Dead code is debt.

## Safety Rules

NEVER run without confirmation:
- git reset --hard, push --force, branch -D, clean -fd, rebase, filter-branch
- rm -rf, changes to >5 files, system config changes

## Framework Context

Python monorepo with three packages:
- `cli/` — Click-based CLI providing the `voidrift` command (entry point: voidrift_cli.main:cli)
- `worker-cli/` — Click-based CLI providing the `worker` command for GPU node management
- `resources/` — Framework guidance files (skills/, templates/, prompts/)
- Five framework commands: Gather → Plan → Develop → Verify → Deploy
- A framework command can have multiple distinct agent invocations
- Local worker models (vLLM) + Kiro Gateway + cloud APIs, all as OpenAI-compatible endpoints
- Pydantic models, Google-style docstrings, src/ layout
- Build: hatchling, VERSION file (shared), Makefile
- Tests: pytest across cli/tests/, worker-cli/tests/

## Testing Standards

Tests validate behavior through the real code path. Mock at the external boundary (API clients, filesystem, SSH), not at internal functions.

**What makes a meaningful test:**
- Calls the actual function/method under test
- Mocks only external I/O (OpenAI client, disk, network)
- Asserts on observable outcomes (return values, side effects, log output)
- Breaks when the implementation changes in ways that affect behavior

**Red flags — rewrite these:**
- Test reimplements the logic it's testing (string building, regex) instead of calling the real function
- Test creates a fake class instead of mocking through the real code path
- Test asserts only on constants or type shapes with no behavioral verification
- Test passes regardless of implementation changes

**Test naming:** `test_<requirement>_<scenario>` when testing an AC. Reference the REQ ID in the docstring.

## When User Requests a Feature

1. Trace all related REQs the change touches — address the full scope, not just the narrow delta
2. Write requirements as positive instructions — describe what the system does, not what it doesn't do or what was removed
3. "Let me add acceptance criteria to REQUIREMENTS.md first"
4. "Here's what success looks like. Does this match your intent?"
5. Wait for operator confirmation before writing any code
6. "Now I'll implement to satisfy these ACs"
7. All tests MUST pass. Work is NOT complete until they do
8. "Let's verify: does this satisfy AC-X, AC-Y, AC-Z?"

## Eat Your Own Dogfood

When building the framework itself, consult `resources/skills/` and follow them. This validates the skills work in practice. The directory contents are the authoritative list — don't maintain a separate inventory here.

Skills are authoritative. Don't just reference them — follow them. If a skill says "use stdout for results, stderr for errors", do it. If a skill seems wrong or incomplete, raise it with the operator before changing anything.

## Prompt Authoring

When writing or editing prompts in `resources/prompts/`:
- Use positive instructions only. Tell the model what to do, not what to avoid. Negative instructions ("NEVER", "do NOT", "don't") waste context tokens and are less effective than clear positive direction.
- Keep prompts compact. Every token in the system prompt competes with the model's working memory for the task.
