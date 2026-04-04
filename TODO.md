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

- [ ] **8. `automate.md` ghost in ARCHITECTURE.md** — Section 2.2 lists `automate.md` as a command prompt file. No such file exists — the command was renamed to `deploy`. Update the architecture doc.

- [ ] **9. README Develop section stale** — Flowchart and description say "Multi-module projects run modules concurrently" and "local models run 1 module at a time, cloud/gateway models run up to 8 concurrently." Implementation dispatches at the task level (REQ-D-10) and concurrency comes from the model's `concurrency` field. Update README.

- [ ] **10. README Project Layout lists `TASKS.md`** — Should reference `tasks/manifest.yml` and `tasks/active/TASK-*.md` instead.

## Medium: Missing or Stale Documentation

- [ ] **11. `skills.md` prompt file not in ARCHITECTURE.md** — `resources/prompts/skills.md` exists and is used by the synthesis pipeline but isn't listed in the prompt file inventory in Section 2.2.

- [ ] **12. ARCHITECTURE.md skills list incomplete** — Lists 7 skills (SYSTEMS-ENG, QUALITY-QA, etc.). Actual `resources/skills/` has 16 files including BACKEND-ENG, WEB-ENG, WEB-RESEARCH, MOBILE-ENG, ML-ENG, GAME-ENG, EMBEDDED-ENG, DATA-ENG, AI-ETHICS, SECURITY-TRUST, WORKFLOW. Update the list or say "determined dynamically from directory contents".

- [ ] **13. ARCHITECTURE.md Section 3.6 duplicate numbering** — Two sections numbered "3.6" (`max_context in config` and `Tool choice modes`). Fix numbering.

- [ ] **14. README "See Appendix C" broken reference** — README says "See Appendix C" for the model table but has no Appendix C. The table is only in REQUIREMENTS.md. Fix or remove the reference.

- [x] **15. `plan --idea` traceability chain missing (REQ-IDEA-5)** — Implemented in TODO #1. Tasks get `idea: <id>` in frontmatter, manifest records idea reference, ideas auto-archive when all derived tasks verified.

- [ ] **16. No Deploy data flow in ARCHITECTURE.md** — Section 4 has data flows for Gather, Plan, Develop, Idea, Verify, and Agent loop but no Deploy section.

- [x] **17. Verify prompt references `TASKS.md`** — Fixed in TODO #3. Updated to `tasks/manifest.yml` and `arch/<module>.md`.

## Low: Minor Issues

- [ ] **18. ARCHITECTURE.md prompt file count wrong** — Says "6 files". Actual count is 7-8 (system, gather, plan, develop, chat, deploy, verify, skills).

- [ ] **19. README Repository Layout missing `skills.py`** — Lists `commands/` contents as "gather, plan, develop, deploy, verify" but directory also has `skills.py`.

- [ ] **20. ARCHITECTURE.md Section 3.6 typo** — "Deployd commands" should be "Automated commands".

- [ ] **21. CHANGELOG structure** — Multiple `### Added` and `### Changed` sections at the same level under `[Unreleased]`. Some entries reference removed features (MCP, worker-cli, TaskStore). Consider consolidating.

- [ ] **22. `DESIGN-TEMPLATE.md` appears dead** — Exists in `resources/templates/` but is never referenced in requirements, architecture, or code. Remove or document its purpose.
