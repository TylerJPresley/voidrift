# VoidRift Development Guide

Follow this instruction: You are helping develop Project VoidRift: Local-first Agentic Development Framework.

## Context Files

Load these before starting work:
- `REQUIREMENTS.md` — Acceptance criteria and the contract for all changes
- `README.md` — Project overview, architecture, and usage

## CRITICAL: Requirements-First Workflow

**ALWAYS follow this workflow for ANY change:**

1. **Update REQUIREMENTS.md FIRST**
   - Add/modify acceptance criteria (AC-*) before implementation
   - Make ACs specific, testable, complete
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
   - cli/README.md for CLI-specific changes
   - mcp-context-server/README.md for MCP server changes
   - AGENT.md for agent behavior changes
   - CONVENTIONS.md for operational rules
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

Python monorepo with two packages:
- `cli/` — Click-based CLI providing the `voidrift` command (entry point: voidrift_cli.main:cli)
- `mcp-context-server/` — FastMCP server for project artifacts and framework resources
- `resources/` — Framework guidance files (AGENT*.md, CONVENTIONS.md, skills/, templates/)
- Three roles: Analyst, Architect, Developer
- Five phases: Gather → Plan → Develop → Automate → Verify
- Local worker models (vLLM) + cloud architect models
- Guidance: AGENT.md (playbook), CONVENTIONS.md (rulebook)
- Runtime role assignment via [ROLE: X]
- Pydantic models, Google-style docstrings, src/ layout
- Build: hatchling, VERSION file (shared), Makefile
- Tests: pytest, 202 tests across cli/tests/, mcp-context-server/tests/, and worker-cli/tests/

## When User Requests a Feature

1. "Let me add acceptance criteria to REQUIREMENTS.md first"
2. "Here's what success looks like. Does this match your intent?"
3. "Now I'll implement to satisfy these ACs"
4. "Let's verify: does this satisfy AC-X, AC-Y, AC-Z?"

## Eat Your Own Dogfood

When building the framework itself, consult `resources/skills/` and follow them. This validates the skills work in practice.

Relevant skills for framework development:
- **SYSTEMS-ENG** — CLI conventions (stdout/stderr, signals, POSIX, packaging)
- **PROD-STRATEGY** — Documentation as code, user-centric docs, onboarding, conventional commits
- **QUALITY-QA** — TDD, no completion claims without evidence, regression tests
- **ARCH-DESIGN** — API standards, health checks, state management, decision rationale
- **RELIABILITY-ENG** — Eliminate toil, observability, error budgets
- **CLOUD-OPS** — IaC standards, secrets management, environment parity

Skills are authoritative. Don't just reference them — follow them. If a skill says "use stdout for results, stderr for errors", do it. If a skill seems wrong or incomplete, raise it with the operator before changing anything.

## Change Management

After implementing, explicitly check:
- Does this affect REQUIREMENTS.md, README.md, AGENT.md, or CONVENTIONS.md?
- Update CHANGELOG.md with the change
- Run `make test` to verify 202 tests pass
- Don't consider work complete until documentation is updated
