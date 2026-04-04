# TODO — Backlog

Work items and ideas. Grouped by area, ordered by priority within each group.

---

## Idea System — Unvalidated

- [ ] **`/idea` new flow** — Injects IDEA prompt overlay into agent system prompt, returns message for agent.send(). Handler exists at `_handle_idea()` in main.py. Untested against a real model. Risk: overlay injection mutates `agent.messages[0]["content"]` which may not persist correctly across turns.

- [ ] **`/idea <id>` load flow** — Reads existing idea file, injects content + overlay, asks agent to summarize. Same handler, different branch. Risk: if the idea file is large, injecting it into the system prompt may consume significant context.

- [ ] **`/done` prompt_toolkit conflict** — `_finish_idea()` uses `prompt_toolkit.prompt()` for category selection which may conflict with the existing PromptSession. Needs manual testing.

---

## Future

- [ ] history.log rotation strategy tied to release planning in deploy. Rotate on release boundaries rather than size/date.
- [ ] Kanban-style board view for `voidrift status` — Rich table grouped by status columns (planned, in-progress, implemented, verified, failed/blocked). Data from manifest.yml.
- [ ] **Progressive skill synthesis (Tier 3)** — When a task requires a skill that doesn't exist at any layer and word-overlap resolution also fails, synthesize a new skill on-the-fly using the `skills install` pipeline and write it to `.voidrift/skills/` (project layer). The synthesized skill accumulates across runs, growing the project skill library automatically. Requires: synthesis_model configured in config.yml, sandboxed synthesis call during plan stage 2, operator-approval gate before the skill becomes active (same pending/ mechanism as domain skills). Reference: Voyager self-growing skill library pattern.
