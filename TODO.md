# Documentation Audit TODO

Discrepancies between REQUIREMENTS.md, ARCHITECTURE.md, README.md, CHANGELOG.md and the actual implementation.

## Critical: Documented but Not Implemented

- [x] **1. `plan --idea` not implemented (REQ-IDEA-5)** — Implemented. `--idea <id>` option added to plan command. Loads idea content as context, gates on `reqs:` field, injects `idea:` into task frontmatter, records in manifest, auto-archives idea when all tasks verified.

- [x] **2. Plan update mode not implemented (REQ-P-11)** — Implemented. Delta analysis stage runs when ARCHITECTURE.md + manifest.yml exist and `--overwrite` is not set. Agent receives requirements, architecture, and source file listing (filenames only), returns implemented/unimplemented classification. Delta injected into Stage 1 and Stage 3. Fresh plan and `--overwrite` skip delta. Test updated.

- [x] **3. `spec/*.md` never produced by Gather** — Removed all stale `spec/` references. Gather produces `analysis/<file>.md` — updated REQUIREMENTS.md (REQ-P-3, REQ-P-12 AC, Appendix A), README.md, system.md artifact table, verify.md prompt, plan.md prompt, filesystem.py tool description. Removed dead spec-reading code from plan.py.

- [x] **4. Gather streaming contradicts REQ-G-12** — Updated REQ-G-12 to `stream=True` with usage capture and think-tag stripping rationale. Updated V-G-3 verification entry.

## High: Documentation Inconsistencies

- [x] **5. ARCHITECTURE.md Section 3.2 streaming claim is wrong** — Rewritten to document that gather and chat use `stream=True`, while plan/develop/deploy/verify use `stream=False`. Explains rationale for each.

- [x] **6. Analysis cache path stale in REQ-CTX-5** — Fixed stale `.voidrift/cache/analyses/` reference in REQ-G-8 Stage 3. Now correctly says frontmatter `hash` in `.voidrift/analysis/<filepath>.md`. REQ-CTX-5 itself was already correct.

- [x] **7. `TASKS.md` ghost artifact** — Replaced `TASKS.md` row in system.md artifact table with `tasks/manifest.yml` and `tasks/active/TASK-{id}.md` rows.

- [x] **8. `automate.md` ghost in ARCHITECTURE.md** — Fixed to `deploy.md`. Also added `skills.md` to the list (TODO #11) and fixed "Deployd" typo (TODO #20).

- [x] **9. README Develop section stale** — Rewrote description (manifest-based dispatch, task-level concurrency from model config), updated flowchart (removed get_next_task/load arch+spec, added manifest read/dispatch), fixed Verify section references (TASKS.md/spec → arch/*.md/task files).

- [x] **10. README Project Layout lists `TASKS.md`** — Removed `TASKS.md` line (tasks/ section already lists manifest.yml + active/). Also removed duplicate `analysis/<file>.md` line.

## Medium: Missing or Stale Documentation

- [x] **11. `skills.md` prompt file not in ARCHITECTURE.md** — Fixed in TODO #8. Added `skills.md` to prompt file list.

- [x] **12. ARCHITECTURE.md skills list incomplete** — Updated to note 16 files determined dynamically, listed key skills as examples.

- [x] **13. ARCHITECTURE.md Section 3.6 duplicate numbering** — Renumbered first 3.6 (`max_context`) to 3.5. Sections now 3.1–3.9 with no gaps or duplicates.

- [x] **14. README "See Appendix C" broken reference** — Fixed broken anchor link. Table is in REQUIREMENTS.md, not README.

- [x] **15. `plan --idea` traceability chain missing (REQ-IDEA-5)** — Implemented in TODO #1. Tasks get `idea: <id>` in frontmatter, manifest records idea reference, ideas auto-archive when all derived tasks verified.

- [x] **16. No Deploy data flow in ARCHITECTURE.md** — Added Section 4.6 Deploy command data flow. Fixed duplicate 4.5 numbering (Agent prompt → 4.7, Agent loop → 4.8).

- [x] **17. Verify prompt references `TASKS.md`** — Fixed in TODO #3. Updated to `tasks/manifest.yml` and `arch/<module>.md`.

## Low: Minor Issues

- [x] **18. ARCHITECTURE.md prompt file count wrong** — Already fixed in TODO #8. Prompt list now enumerates all 8 files (system + 7 command files).

- [x] **19. README Repository Layout missing `skills.py`** — Added `skills` to commands/ listing.

- [x] **20. ARCHITECTURE.md Section 3.6 typo** — Fixed in TODO #8. "Deployd" → "Automated".

- [ ] **21. CHANGELOG structure** — Multiple `### Added` and `### Changed` sections at the same level under `[Unreleased]`. Some entries reference removed features (MCP, worker-cli, TaskStore). Consider consolidating.

- [ ] **22. `DESIGN-TEMPLATE.md` appears dead** — Exists in `resources/templates/` but is never referenced in requirements, architecture, or code. Remove or document its purpose.
