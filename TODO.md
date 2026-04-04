# TODO — Backlog

Work items that need doing. Grouped by area, ordered by priority within each group.

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

---

## Documentation Audit (2026-04-04) — Complete

All 22 items resolved. See git history for details.

- [x] 1. `plan --idea` (REQ-IDEA-5) — implemented
- [x] 2. Plan update mode (REQ-P-11) — implemented (delta analysis)
- [x] 3. `spec/*.md` ghost — removed all references
- [x] 4. REQ-G-12 streaming — updated to match `stream=True`
- [x] 5. ARCHITECTURE.md streaming claim — fixed
- [x] 6. Analysis cache path — fixed stale reference
- [x] 7. `TASKS.md` ghost — replaced in system.md
- [x] 8. `automate.md` ghost — fixed to `deploy.md`
- [x] 9. README Develop section — rewritten for task-level dispatch
- [x] 10. README Project Layout `TASKS.md` — removed
- [x] 11. `skills.md` missing from ARCHITECTURE.md — added (in #8)
- [x] 12. Skills list incomplete — updated to 16 files
- [x] 13. Section 3.6 duplicate — renumbered
- [x] 14. Appendix C broken link — fixed
- [x] 15. `plan --idea` traceability — implemented (in #1)
- [x] 16. Deploy data flow missing — added
- [x] 17. Verify prompt `TASKS.md` — fixed (in #3)
- [x] 18. Prompt file count — fixed (in #8)
- [x] 19. README missing `skills.py` — added
- [x] 20. "Deployd" typo — fixed (in #8)
- [x] 21. CHANGELOG structure — consolidated
- [x] 22. `DESIGN-TEMPLATE.md` dead — removed
