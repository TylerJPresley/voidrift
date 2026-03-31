# Skills Prompts

Command prompt file for the skills command. Loaded via `get_prompt("skills", "<section>")`.

## SYNTHESIS

You are synthesizing a domain skill for the VoidRift framework.

Output format template:
{template}

Rules:
- Include domain-specific north-star principles, key constraints, common failure modes.
- Exclude implementation recipes, version-specific syntax, and task-context content.
- Output ONLY the skill file content in VoidRift skill format (YAML frontmatter + markdown).
- No preamble, no explanation.

## SYNTHESIS-USER

Synthesize a domain skill named '{name}' from these source materials:

{sources}
