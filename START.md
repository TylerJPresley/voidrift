# VoidRift Development Guide

Follow this instruction: You are helping develop Project VoidRift: Local-first Agentic Development Framework.

## Context Files

Load these before starting work:
- `REQUIREMENTS.md` — Acceptance criteria and the contract for all changes
- `README.md` — Project overview, architecture, and usage

## CRITICAL: Requirements-First Workflow

**ALWAYS follow this workflow for ANY change:**

1. **Update REQUIREMENTS.md FIRST**
   - Load `resources/skills/ANALYSIS-REQS.md` before writing or modifying any requirement
   - Follow EARS notation, REQ identification, rationale inclusion, and BDD acceptance criteria
   - Get user confirmation before proceeding

2. **Implement to satisfy ACs**
   - Write code that passes the new/modified ACs
   - Test against each AC as you go

3. **Verify against REQUIREMENTS.md**
   - Does this satisfy all related ACs?
   - Does this break any existing ACs?
   - REQUIREMENTS.md is the test suite - all ACs must pass

4. **Update documentation**
   - README.md for framework-level changes
   - ARCHITECTURE.md for component, data flow, or design decision changes
   - CHANGELOG.md for all notable changes

5. **Commit with AC references**

**NEVER implement first and update requirements later. Requirements are the contract.**

## No Bandaids

Don't patch symptoms — find root causes. When something breaks:

1. **Diagnose** — Identify the actual problem, not just the visible symptom
2. **Explain** — Tell the operator what's wrong and why
3. **Propose** — Present a real fix (or options) and get approval before coding
4. **Implement** — Write minimal, correct code that addresses the root cause

If a proper fix isn't feasible (e.g. upstream bug), say so explicitly and get operator approval before adding a workaround. Label workarounds in code with the reason and what would remove them.

## Safety Rules

NEVER run without confirmation:
- git reset --hard, push --force, branch -D, clean -fd, rebase, filter-branch
- rm -rf, changes to >5 files, system config changes

ALWAYS:
- Verify bash syntax before committing scripts
- Keep commits atomic with clear messages
- Ask before breaking changes

## Communication

- Direct and concise
- Explain reasoning
- Ask clarifying questions
- Technical language for developers
- Practical implementations

## Framework Context

Python monorepo with three packages:
- `cli/` — Click-based CLI providing the `voidrift` command (entry point: voidrift_cli.main:cli)
- `worker-cli/` — Click-based CLI providing the `worker` command for GPU node management
- `resources/` — Framework guidance files (skills/, templates/, prompts/)
- Five framework commands: Gather → Plan → Develop → Automate → Verify
- Per-command prompts replace static role files — a command can have multiple distinct agent invocations
- Local worker models (vLLM) + Kiro Gateway + cloud APIs, all as OpenAI-compatible endpoints
- Pydantic models, Google-style docstrings, src/ layout
- Build: hatchling, VERSION file (shared), Makefile
- Tests: pytest across cli/tests/, worker-cli/tests/

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

When building the framework itself, consult `resources/skills/` and follow them. This validates the skills work in practice.

Relevant skills for framework development:
- **ANALYSIS-REQS** — Requirements authoring, EARS notation, BDD acceptance criteria, traceability
- **SYSTEMS-ENG** — CLI conventions (stdout/stderr, signals, POSIX, packaging)
- **ARCH-DESIGN** — Component design, API contracts, state management, decision rationale
- **QUALITY-QA** — TDD, no completion claims without evidence, regression tests
- **RELIABILITY-ENG** — Eliminate toil, observability, retry logic, error budgets
- **PROD-STRATEGY** — Documentation as code, user-centric docs, onboarding, conventional commits
- **CLOUD-OPS** — Container lifecycle, secrets management, SSH operations, environment parity
- **WORKFLOW** — Atomic commits, worktree isolation, verifiable units of work

Skills are authoritative. Don't just reference them — follow them. If a skill says "use stdout for results, stderr for errors", do it. If a skill seems wrong or incomplete, raise it with the operator before changing anything.

## Prompt Authoring

When writing or editing prompts in `resources/prompts/`:
- Use positive instructions only. Tell the model what to do, not what to avoid. Negative instructions ("NEVER", "do NOT", "don't") waste context tokens and are less effective than clear positive direction.
- Keep prompts compact. Every token in the system prompt competes with the model's working memory for the task.

## Change Management

After implementing, explicitly check:
- Does this affect REQUIREMENTS.md, README.md, or ARCHITECTURE.md?
- Update CHANGELOG.md with the change
- Run `make test` to verify all tests pass
- Don't consider work complete until documentation is updated
