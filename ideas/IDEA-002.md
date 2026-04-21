---
id: IDEA-002
status: draft
category: next
created: 2026-04-18
reqs: []
---

# Command Progress Persistence (Resume Mid-Pipeline)

## User Story

As an operator, I want a long-running command (gather, plan, develop) to be resumable after interruption, so that I don't lose completed pipeline stages when a session is killed or a model call fails mid-run.

## Context

Currently, each framework command runs as a single session. If interrupted mid-pipeline:
- **Gather:** triage and context-build results are lost; the whole pipeline restarts
- **Plan:** completed architecture stages are lost; all 6 stages re-run
- **Develop:** the lock file is cleaned up (REQ-D-2), orphaned in-progress tasks are recovered (REQ-D-7), and per-task rollback handles partial writes (REQ-D-6) — develop already has the most resilience

The gap is in gather and plan, which have no intermediate artifact persistence. Each stage writes to memory dicts owned by the CLI orchestrator, and those dicts are lost on process exit.

Related requirements:
- REQ-ARCH-8: fresh context per agent, shared state passed explicitly by orchestrator — the orchestrator state is what needs persisting
- REQ-G-2: 4-stage gather pipeline — triage and context-build results are in-memory only
- REQ-P-1: 6-stage plan pipeline — stages 1-4 produce artifacts (ARCHITECTURE.md, arch/*.md, outline files) that survive; stage 5 (task files) is partially resumable since manifest tracks completion
- REQ-D-2, REQ-D-7: develop already has lock + orphan recovery
- REQ-PS-1: all artifacts in .voidrift/ — stage outputs that write to disk are already resumable; the gap is in-memory intermediate state

The DESIGN-CHAT-GUIDED.md noted this as future work: "Command progress persistence (resume mid-pipeline)."

## Acceptance Criteria

- [ ] Gather: WHEN interrupted after triage completes, re-running gather resumes from context-build without re-triaging
- [ ] Gather: WHEN interrupted after context-build completes, re-running resumes from source analysis
- [ ] Plan: WHEN interrupted after architecture stage, re-running plan resumes from module arch without re-running architecture
- [ ] Plan: WHEN interrupted mid-task-file generation, re-running plan resumes from the first ungenerated task
- [ ] Resume state is stored in `.voidrift/` as a checkpoint file, not in process memory
- [ ] `--overwrite` clears checkpoint state and forces a full restart
- [ ] Stale checkpoints (from a different REQUIREMENTS.md hash) are detected and invalidated with a warning

## Affected Modules

- `gather.ts` — write triage and context-build results to `.voidrift/gather-checkpoint.json` after each stage
- `plan.ts` — detect existing stage artifacts and skip completed stages; task file generation already partially resumable via manifest
- `manifest.ts` — task manifest already tracks per-task status; plan resume can read it

## Notes

- Plan is closer to resumable than gather — stages 1-4 write to disk (ARCHITECTURE.md, arch/*.md, outline files). The main gap is detecting which stages are complete vs stale.
- A content hash of REQUIREMENTS.md stored in the checkpoint would let the system detect when inputs changed and invalidate the checkpoint automatically.
- Develop is already the most resilient command. The priority order is: gather resume > plan resume > develop (already handled).
- The open question from DESIGN-CHAT-GUIDED.md: "Should `/develop` and `/verify` be fully interactive or just delegate to the existing CLI commands with better output?" — for this idea, the answer is: delegate to CLI commands but add checkpoint awareness to the CLI layer.
- Consider whether checkpoint files should be committed to git or gitignored. They're ephemeral state, so `.gitignore` is the right call.
