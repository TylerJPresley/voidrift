---
id: IDEA-6
status: draft
category: now
created: 2026-04-23
reqs: []
---

# Vibe Execution State

## User Story

As an operator, I want a "vibe" execution state that auto-approves writes and shell while keeping governance loaded, so that I can rapidly prototype with framework guidance and formalize later.

## Context

Three execution states: plan (read-only), chat (confirmation required), vibe (auto-approve). SHIFT+TAB cycles through them. Governance (modes, skills, standards) stays active in all states — vibe doesn't skip governance, it skips confirmation prompts.

No CR/task workflow required in vibe mode. The operator builds fast, then uses `import` or `analyze` to formalize the codebase into VoidRift's workflow when ready.

## Acceptance Criteria

- [ ] Given vibe state, When the agent writes a file, Then no confirmation prompt is shown
- [ ] Given vibe state, When the agent runs a shell command, Then no confirmation prompt is shown
- [ ] Given vibe state with a mode loaded, When the agent works, Then governance content (skills, personality) is still in the system prompt
- [ ] Given vibe state, When the agent works, Then no CR or task artifacts are required
- [ ] Given SHIFT+TAB pressed, When cycling states, Then the order is chat → plan → vibe → chat
- [ ] Given vibe state, When the footer renders, Then it shows `[vibe]` or `[vibe|mode]`

## Affected Modules

@voidrift/modes, @voidrift/tui, @voidrift/governance

## Notes

- Gemini core has `ApprovalMode.YOLO` which auto-approves everything — may be usable as the base but VoidRift needs governance enforcement on top
- Vibe mode is the on-ramp for new projects and POCs
- After vibing, `voidrift import .` or `voidrift analyze` formalizes the work
