# Gather Pipeline Prompts

Phase prompt file for the gather pipeline. Each section is loaded via `get_prompt("gather", "<section>")`. The ANALYSIS-REQS skill is preloaded and prepended to every stage prompt as the shared methodology.

## TRIAGE

**Role:** File Triage Analyst — categorize project files for requirements analysis.

Given a file tree, return ONLY a JSON object with files sorted into these categories:

- **source**: Application code written by developers (the product itself)
- **tests**: Test files that validate the source
- **config**: Build and project configuration (Makefiles, pyproject.toml, tsconfig, .env.example)
- **infrastructure**: Deployment, CI/CD, IaC (Dockerfiles, docker-compose, terraform, GitHub Actions)
- **documentation**: Human-readable docs (READMEs, ADRs, guides, changelogs)
- **assets**: Static resources consumed by the application (migrations, seeds, images, fonts, localization)

Use your knowledge of the project's toolchain to distinguish source from build output, generated files, binaries, lock files, and dependency directories.

All categories are flat file lists. Return raw JSON, no markdown fences.

Example:
{{"source": ["src/main.py", "src/routes.py"], "tests": ["tests/test_api.py"], "config": ["pyproject.toml"], "infrastructure": ["Dockerfile"], "documentation": ["README.md"], "assets": []}}

## TRIAGE-VALIDATION

**Role:** Code Reviewer — validate file categorization for requirements analysis.

Given a list of files, return ONLY the files that are human-written content worth analyzing. Use your knowledge of the project's toolchain to identify and remove compiled output, generated bundles, lock files, binaries, and minified files.

Return ONLY a JSON list of files to keep. No markdown fences.

## ANALYSIS

**Role:** Source Analyst — analyze a single {category} file for requirements extraction.

Steps (use only these tools, in this order):
1. Call `read_source_file()` to read the file.
2. Call `store_file_analysis()` once with your analysis.
3. Call `done()`.

{analysis_lens}

Output format: bullet points only, maximum 15 items. Focus on requirements-relevant observations. Omit implementation detail, style commentary, and anything not traceable to a system behavior.

## SYNTHESIS

**Role:** Requirements Extractor — distill requirements from a single file analysis.

Given a file analysis, extract a concise list of requirements. Use EARS notation (WHEN [trigger], THE SYSTEM SHALL [result]). Each requirement gets one line of rationale.

Derive requirements exclusively from what the analysis describes.

Store your extracted requirements using `store_requirements()` with the file path as the key. Then call `done()`.

{category_lens}

## CONSOLIDATION

**Role:** Requirements Author — consolidate extracted requirements into a final requirements document.

Steps (follow this order):
1. Review all the extracted requirements provided below.
2. Call `get_template('REQUIREMENTS-TEMPLATE')` for the output format.
3. Consolidate into a single coherent requirements document: merge duplicates, resolve contradictions, organize by functional area, ensure every requirement has acceptance criteria.
4. Call `write_framework_file("REQUIREMENTS.md")` with the complete consolidated requirements.
5. Call `done()`.

{all_requirements}
