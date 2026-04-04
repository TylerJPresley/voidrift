# VoidRift Development Guide

Follow this instruction: You are helping develop Project VoidRift: The Agentic Software Engineering Framework.

## Context Files

Load these before starting work:
- `REQUIREMENTS.md` — Acceptance criteria and the contract for all changes
- `README.md` — Project overview, architecture, and usage
- `ARCHITECTURE.md` — Component design, data flows, and key decisions

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
   - Write requirements as positive instructions — describe what the system does, not what it doesn't do or what was removed

4. **Wait for operator confirmation before proceeding**

5. **Implement to satisfy ACs**
   - Write code that passes the new/modified ACs
   - Write tests per Testing Standards below

6. **Verify against REQUIREMENTS.md**
   - Does this satisfy all related ACs?
   - Does this break any existing ACs?

7. **Update documentation — EVERY change must pass this checklist:**
   - [ ] REQUIREMENTS.md — Did acceptance criteria change? Are new REQs needed?
   - [ ] ARCHITECTURE.md — Did components, data flows, or design decisions change?
   - [ ] README.md — Did user-facing behavior, commands, or configuration change?
   - [ ] CHANGELOG.md — What changed, added, or fixed?
   - [ ] `make test` passes — work is NOT complete until all tests pass

8. **Build, sync, and commit incrementally**
   - `make test` — after every code change
   - `make sync` — after ANY change to `resources/` (prompts, templates, skills) — this copies resources to `~/.voidrift/resources/` where the CLI reads them
   - `make build` — when packaging changes are needed
   - Commit after each logical unit of work with AC references

9. **Summarize changes for operator**
   - List all files created, modified, or deleted
   - Reference the ACs satisfied
   - Note any follow-up work or open questions

**NEVER skip change identification. You can't write requirements until you understand the problem.**
**NEVER implement first and update requirements later. Requirements are the contract.**
**NEVER consider work complete with stale documentation. The context files ARE the project.**

## Design Principles

**SOLID · DRY · KISS** — apply these to every implementation decision.

- **SOLID** — single responsibility, clear abstractions, avoid unnecessary coupling
- **DRY** — reusable code; shared logic lives in one place, not copied across files
- **KISS** — simplest solution that works; complexity must be justified by the problem

Before writing code, ask: can the problem be solved at the template or prompt layer instead? Complexity in code is often a sign that an upstream contract (prompt, schema, format) is too loose. Fix the contract first.

Don't leave dead code behind. When a function, class, or module is no longer called by production code, remove it and its tests. Dead code is debt.

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

NEVER run without confirmation:
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
- Use positive instructions only. Tell the model what to do, not what to avoid. Negative instructions ("NEVER", "do NOT", "don't") waste context tokens and are less effective than clear positive direction.
- Keep prompts compact. Every token in the system prompt competes with the model's working memory for the task.
