# Skills Registry

The Architect reads this file during Phase 2 (Plan) to decide which skills to tag on each task line. The Developer then loads only the tagged skill files during Phase 3 (Develop), limiting context to what each task actually needs.

**Before adding a skill file to `skills/`, add an entry here.**

| Tag | Summary | File |
|-----|---------|------|
| `backend` | API services, DTOs, and repositories using Spring Boot (Java) or FastAPI (Python). | `skills/BACKEND.md` |
| `frontend` | Vue.js 3 components, composables, Vite build config, and BFF client patterns. | `skills/FRONTEND.md` |
| `infra` | AWS provisioning via CDK or Terraform; IAM, networking, and container orchestration. | `skills/INFRA.md` |
| `native` | CLI/Linux tools in Bash (simple), Python (medium), or Rust (complex); POSIX interface standards. | `skills/NATIVE.md` |
| `design` | UI/UX layout (8px grid), WCAG 2.1 AA accessibility, component hierarchy, and interaction flows. | `skills/DESIGN.md` |
| `branding` | Visual identity and tone consistency: color tokens, typography, and voice across all touchpoints. | `skills/BRANDING.md` |
| `security` | Auth (JWT RS256), input validation, secrets management, OWASP Top 10, and API hardening. | `skills/SECURITY.md` |
| `tdd` | Test-first development: write a failing test before implementing any logic. | `skills/TDD.md` |
| `debugging` | Systematic root-cause analysis: log tracing, isolation, and hypothesis-driven investigation. | `skills/DEBUGGING.md` |
| `verification` | Evidence-based completion checks before marking any task done. | `skills/VERIFICATION.md` |
| `worktrees` | Git worktree isolation for parallel feature branches without stashing or branch-switching. | `skills/WORKTREES.md` |
