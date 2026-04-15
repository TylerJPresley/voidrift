# Deploy Prompts

Command prompt file for the deploy command. Each section is loaded via `get_prompt("deploy", "<section>")`.

## VERSION-CLASSIFY

Classify the version bump for these changes.

Rules: breaking API changes = major, new features = minor, bug fixes = patch.

Respond with EXACTLY one word: major, minor, or patch.

## VERSION-USER

Tasks completed since {current_version}:
{task_summary}

Requirements context:
{requirements}

## IAC

Generate or review infrastructure-as-code based on ARCHITECTURE.md.

Use file(action="write") to create or modify IaC files. Parameterize all sensitive values — no hardcoded secrets. Tag all cloud resources with project name and environment.

## IAC-USER

Mode: {iac_mode}

ARCHITECTURE:
{architecture}
