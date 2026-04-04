# TODO — Backlog

Work items and ideas. Grouped by area, ordered by priority within each group.

---

## Future

- [ ] history.log rotation strategy tied to release planning in deploy. Rotate on release boundaries rather than size/date.
- [ ] Kanban-style board view for `voidrift status` — Rich table grouped by status columns (planned, in-progress, implemented, verified, failed/blocked). Data from manifest.yml.
- [ ] **Progressive skill synthesis (Tier 3)** — When a task requires a skill that doesn't exist at any layer and word-overlap resolution also fails, synthesize a new skill on-the-fly using the `skills install` pipeline and write it to `.voidrift/skills/` (project layer). The synthesized skill accumulates across runs, growing the project skill library automatically. Requires: synthesis_model configured in config.yml, sandboxed synthesis call during plan stage 2, operator-approval gate before the skill becomes active (same pending/ mechanism as domain skills). Reference: Voyager self-growing skill library pattern.
