# Chat-Guided Commands — Design Document

## Vision

Chat becomes the unified interface. Slash commands (`/gather`, `/plan`, `/develop`, `/verify`) run framework pipelines interactively with operator checkpoints at every stage. CLI commands remain for batch/CI use. Both approaches coexist.

The operator can vibe code anything in free-form chat, or invoke structured pipelines via slash commands. The model suggests the right next step when appropriate.

## Key Decisions

1. **Framework orchestrates, models do leaf work, operator steers.** The framework code controls pipeline flow, checkpoints, and state. Models handle individual tasks (triage, analysis, task writing). The operator makes decisions at checkpoints.

2. **Small models can't orchestrate.** They do focused leaf work within pipeline stages. The framework handles everything between stages.

3. **Capable models self-orchestrate in free-form chat.** The CHAT-ROLE system prompt instructions (read first, propose, wait, summarize) work with capable models. No structural enforcement needed.

4. **Slash commands don't touch the chat context window.** Pipeline stages run as independent subagents with fresh context. The chat session stays clean.

5. **The model needs to know slash commands exist.** The system prompt lists available commands so the model can suggest the right next step (e.g. "Requirements updated. Run `/plan` to generate architecture and tasks.").

6. **All system output is dim.** Visual hierarchy: operator input (normal), model responses (normal), system/framework messages (dim).

7. **Triage shows full file listing.** Categorized files displayed grouped by category. Uncategorized files shown with assignment prompt.

8. **Requirements preview shows stats, not fragments.** Line count, section count, requirement count — not a truncated file preview.

## Slash Commands

### /gather <path>

Interactive requirements gathering with stage checkpoints:

1. Build file tree → show file count
2. Triage → show categorized files, assign uncategorized
3. Context build → show categories processed
4. Source analysis → show per-file progress
5. Consolidation → show stats, confirm before writing

### /plan

Interactive architecture and task planning:

1. Architecture → show module list, confirm
2. Module arch → show per-module progress, confirm
3. Task outlines → show task summary, confirm
4. Task files → generate, show coverage check
5. README → generate

### /develop

Interactive task execution:

1. Show task list and order
2. Per-task progress display
3. Self-review results per task
4. File list verification results per task

### /verify

Interactive verification:

1. Doc verification → show mismatches
2. Test planning → show test cases
3. Test execution → show results as they complete
4. Report → show summary

## System Prompt Changes

- CHAT-ROLE lists available slash commands with descriptions
- Model suggests next command when appropriate

## Future Work

- `/model <alias>` — switch models mid-session
- Idea → CR (Change Request) → Task lifecycle
- Decision tracking across sessions
- Command progress persistence (resume mid-pipeline)

## Implementation Order

1. Gather triage display fix (existing CLI — show full file listing, list uncategorized files)
2. Uncategorized file assignment UX (CLI prompt for existing gather, slash command for chat)
3. CHAT-ROLE prompt alignment with START.md workflow (diagnose → propose → approve → implement → summarize)
4. `/gather` slash command
5. `/plan` slash command
6. System prompt updates (slash command awareness, dim system output)
7. `/verify` slash command
8. `/develop` slash command

## Open Questions

- Should guided mode use the chat session's model or allow specifying a different model per command?
- How does session persistence work with guided mode state?
- Should `/develop` and `/verify` be fully interactive or just delegate to the existing CLI commands with better output?
