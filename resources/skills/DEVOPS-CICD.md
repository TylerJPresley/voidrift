# Skill: DevOps & CI/CD

## Core Concepts
- **Pipeline as Code:** Define build/deploy steps in YAML (GitHub Actions, GitLab CI, Jenkinsfile).
- **Immutable Artifacts:** Build once, deploy many; artifacts must not change between environments.
- **Containerization:** Use Docker/Containerfile for all application runtimes to ensure environment consistency.

## Implementation Rules
- **Build Caching:** Use layer caching and dependency caching to minimize pipeline runtimes.
- **Automated Testing:** Run unit and integration tests on every pull request.
- **Linting:** Enforce code style and quality checks (ESLint, Ruff, Checkstyle) as a pipeline gate.
- **Deploy Strategies:** Support Blue/Green, Canary, or Rolling updates to minimize downtime.
- **Secrets in Pipelines:** Use pipeline secrets/environment variables; do not hardcode.

## Automation
- **Scripting:** Prefer Shell (simple), Python (complex), or specialized tools (Ansible/Make) for automation.
- **Toolchain:** Ensure the build environment has pinned tool versions (e.g., `.node-version`, `uv.lock`).
