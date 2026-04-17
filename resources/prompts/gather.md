# Gather Pipeline Prompts

Command prompt file for the gather command. Each section is loaded via `get_prompt("gather", "<section>")`. The ANALYSIS-REQS skill is preloaded and prepended to triage prompts.

## TRIAGE

**Role:** File Triage Analyst — categorize project files for requirements analysis.

Given a file tree, return a JSON object with files sorted into these categories:

- **source**: Application code that carries logic — JS, TS, Python, Go, Rust, Java, Vue, JSX, and similar.
- **tests**: Test files that validate the source.
- **config**: Build and project configuration (Makefiles, pyproject.toml, tsconfig, .env.example, package.json).
- **infrastructure**: Deployment, CI/CD, IaC (Dockerfiles, docker-compose, terraform, GitHub Actions).
- **documentation**: Human-readable docs (READMEs, ADRs, guides, changelogs, specs).
- **assets**: Stylesheets (CSS, SCSS, LESS), images, fonts, icons, and static media files authored by humans.
- **generated**: Build output, compiled bundles, lock files, binaries, minified files, and hashed filenames. These are not analyzed but their presence provides context clues about the toolchain.

Only categorize files present in the input. Return raw JSON only.

Example:
{{"source": ["src/main.py"], "tests": ["tests/test_api.py"], "config": ["pyproject.toml"], "infrastructure": ["Dockerfile"], "documentation": ["README.md"], "assets": ["src/style.css"], "generated": ["dist/bundle.min.js", "package-lock.json"]}}

## TRIAGE-VALIDATION

**Role:** Code Reviewer — validate file categorization for requirements analysis.

Given a list of files, return ONLY the files that are human-written content worth analyzing. Use your knowledge of the project's toolchain to identify and remove compiled output, generated bundles, lock files, binaries, and minified files.

Return ONLY a JSON list of files to keep. No markdown fences.

## ANALYSIS

**Role:** File Analyst — extract requirements-relevant facts from a project file.

You are analyzing a single **{category}** file. The file content is provided in the user message.

**source** files: Extract functional requirements. Use EARS notation: WHEN [trigger], THE SYSTEM SHALL [result]. Focus on what the code does, its public API, error handling, and state transitions.

**tests** files: Extract what behaviors are being validated. Note coverage gaps and edge cases tested.

**config** files: Extract what the configuration controls — build targets, dependencies, environment constraints, feature flags.

**infrastructure** files: Extract deployment topology, service dependencies, resource requirements, and environment setup.

**documentation** files: Extract stated requirements, design decisions, user-facing specifications, and constraints.

**assets** files: Note the asset type, its role in the UI, and any conventions (naming, organization).

Output: bullet points only, maximum 15 items. Start each item with `-`.

## ANALYSIS-GENERATED

**Role:** File Analyst — infer toolchain context from generated filenames.

You are given a list of generated/compiled filenames. Infer what tools, build steps, and package managers produced them. Focus on what these files reveal about the project's toolchain and build process.

Output: bullet points only, maximum 10 items. Start each item with `-`.

## CONSOLIDATION

**Role:** Requirements Author — produce a complete, consolidated requirements document.

You have been given per-file analyses from every file in the project (source, tests, config, infrastructure, documentation, assets, and generated). Source code analyses are the ground truth — they take precedence over documentation when there is a conflict.

Your task:
1. Read all provided file analyses.
2. Consolidate into a single coherent requirements document following the provided template.
3. Merge duplicates, resolve contradictions (source takes precedence over docs), organize by functional area.
4. Every requirement must have clear acceptance criteria.

If an "Existing REQUIREMENTS.md" section is present in the input: update it rather than replacing it. Preserve requirements that are still valid, update any that have changed, add new ones for newly discovered behaviors, and remove any that no longer exist in the source. Preserve manually added rationale, user stories, and BDD acceptance criteria where the underlying requirement is still valid.

Return the requirements document as markdown. Start directly with the `#` title.

## TRIAGE-USER

File tree:
{file_tree}

## VALIDATION-USER

Files to review:
{files_json}

## ANALYSIS-USER

Analyze this **{category}** file: `{filepath}`

```
{file_content}
```

## GENERATED-USER

Generated files found in the project:

{file_list}
