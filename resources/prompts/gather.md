# Gather Pipeline Prompts

Phase prompt file for the gather pipeline. Each section is loaded via `get_prompt("gather", "<section>")`. The ANALYSIS-REQS skill is preloaded and prepended to every stage prompt as the shared methodology.

## TRIAGE

Given a file tree, return ONLY a JSON object with:
- "groups": a dict mapping logical boundary names to lists of relative file paths.
  Auto-detect boundaries from directory structure (e.g. frontend/, backend/, api/, shared/).
  For single-application codebases, use one group named after the project.

INCLUDE ONLY these three categories:
1. Source files — code written by developers
2. Documentation — READMEs, design docs, specs
3. Configuration — env files, Dockerfiles, CI/CD, build configs

You MUST NOT include:
- Files with content hashes in their names (e.g. index-CW8_b_Xi.js) — these are compiled build output
- Lock files (package-lock.json, poetry.lock, Gemfile.lock, etc.)
- Binary files and images (.png, .jpg, .gif, .ico, .woff, .ttf)
- Dependency directories (node_modules, vendor, target, __pycache__)
- Generated HTML in build/static/dist directories
- Minified or bundled files

Use your knowledge of the project's language and toolchain to decide.
Return raw JSON, no markdown fences.

Example: {{"groups": {{"backend": ["backend/main.py"], "frontend": ["frontend/src/App.vue"]}}}}

## TRIAGE-VALIDATION

You are a strict code reviewer. Given a list of files selected for source code analysis, remove any that should NOT be analyzed:
- Compiled/bundled files (hashed filenames like index-CW8_b_Xi.js)
- Lock files (package-lock.json, poetry.lock, etc.)
- Binary files and images (.png, .jpg, .gif, .ico, .woff, .ttf)
- Generated build output (files in static/assets/, dist/, build/ directories)
- Minified files

Return ONLY a JSON list of files that SHOULD be kept. No markdown fences.

## ANALYSIS

Read the file, then call store_file_analysis() with a thorough summary following the ANALYSIS-REQS methodology.

Your summary MUST cover:
- Purpose and business intent (outcomes over mechanisms)
- Key components, functions, classes, and their responsibilities
- Dependencies and external integrations
- Data flows and state management
- Configuration parameters and environment variables
- Error handling patterns
- Requirements implied by the code (use EARS notation: WHEN [trigger], THE SYSTEM SHALL [result])

You have get_skill() and list_skills() if you need additional context.

## SYNTHESIS

You are writing detailed requirements for the '{group_name}' component.
Steps:
1. Call get_template('REQUIREMENTS-TEMPLATE') for the output format.
2. Call get_skill('PROD-STRATEGY') for guidance.
3. Call write_file() EXACTLY ONCE to write the COMPLETE requirements to '{spec_path}'.
4. Call done() when finished.
Do NOT call the same tool more than once.

CRITICAL: Be THOROUGH and DETAILED.
- Every endpoint, component, data flow, config parameter, and error behavior must be a requirement.
- Each requirement needs specific acceptance criteria.
- Do not summarize or abbreviate.

After calling done(), summarize the key requirements for {group_name}.

{group_context}

## SYNTHESIS-SINGLE

You are writing comprehensive requirements from file analysis summaries.
Steps:
1. Call get_template('REQUIREMENTS-TEMPLATE') for the output format.
2. Call get_skill('PROD-STRATEGY') for guidance.
3. Call write_file() EXACTLY ONCE to write the COMPLETE requirements to '{target_rel}'.
4. Call done() when finished.
Do NOT call the same tool more than once.

CRITICAL: Be THOROUGH and DETAILED.
- Every endpoint, component, data flow, config parameter, and error behavior must be a requirement.
- Each requirement needs specific acceptance criteria.
- Do not summarize or abbreviate.

After calling done(), summarize the key requirements.

{group_context}

## OVERVIEW

You are writing a project-level requirements overview.
The project has multiple components, each with its own spec file.
Steps:
1. Call get_template('REQUIREMENTS-TEMPLATE') for the output format.
2. Call get_skill('ANALYSIS-REQS') for methodology guidance.
3. Call write_file() EXACTLY ONCE to write the COMPLETE overview to '{target_rel}'.
4. Call done() when finished.

The overview must cover:
- System purpose and scope
- How the components interact (API contracts, shared config, data flow)
- Deployment topology
- Cross-cutting concerns (auth, logging, monitoring, error handling)
- References to spec files: {spec_refs}

After calling done(), summarize the project architecture.

{specs_context}
