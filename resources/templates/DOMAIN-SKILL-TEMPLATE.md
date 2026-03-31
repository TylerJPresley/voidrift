# Domain Skill Template

<!--
DOMAIN SKILL AUTHORING GUIDE
=============================

PURPOSE
A domain skill gives agents specific knowledge about a technology, platform, or API.
It answers: "How do we do this correctly in this domain?"

It is NOT:
- A tutorial or step-by-step recipe
- A north-star skill (those live in resources/skills/ and answer "what does good look like?")
- A requirements document
- A list of API signatures or version-specific syntax

It IS:
- Principles that hold true regardless of version
- Constraints that are non-obvious or commonly violated
- Failure modes worth knowing before you encounter them
- Integration guidance that saves an agent from a wrong turn

LENGTH
Match the existing north-star skills in density — concise enough to load into context
without waste. 1-2 pages. If it feels long, cut implementation detail first.

FORMAT
Use the sections below. Remove sections that genuinely don't apply.
Keep bullet labels bold. One idea per bullet.

WHAT TO EXCLUDE
- Version-specific syntax ("use X in v3.2+") — prefer principles over syntax
- Content that duplicates a north-star skill (ARCH-DESIGN, QUALITY-QA, etc.)
- Step-by-step setup instructions — those belong in task context or documentation
- Anything that will be wrong in 12 months

WHEN SYNTHESIZING FROM EXTERNAL SOURCES
Read the source material for signal, then write fresh in VoidRift's voice.
Do not copy-paste. External skills are often recipes — extract the principle behind
the recipe, not the recipe itself.
-->

---

<!--
FRONTMATTER (required)
All skill files must begin with YAML frontmatter. The `name` field is the lookup
key used by get_skill() and voidrift skills install. The `description` must be
≤200 characters — it appears in list_skills() and search results.
-->

---
name: SKILL-NAME
description: One-sentence description of what domain this covers and when an agent should use it. Max 200 characters.
---

# Domain: [Technology / Platform Name] ([SKILL-NAME])

<!--
SKILL-NAME: uppercase, hyphenated. Examples: FASTAPI, GOOGLE-DOCS, AWS-CDK, STRIPE.
This name is what operators pass to get_skill() and voidrift skills install.
-->

## Overview

<!--
One short paragraph. What this domain covers, when an agent should apply this skill,
and what problem space it addresses. Not a sales pitch — orient the agent.
-->

[What this technology is, what it's for, and when this skill applies.]

## Core Principles

<!--
The north-star guidance specific to this domain. What does good look like here?
These should hold true across versions and implementations.
Aim for 3-6 bullets. If you have more, you're probably writing recipes.
-->

- **[Principle Name]:** [What it means and why it matters in this domain.]
- **[Principle Name]:** [What it means and why it matters in this domain.]
- **[Principle Name]:** [What it means and why it matters in this domain.]

## Key Constraints

<!--
Non-obvious constraints specific to this technology. Things an experienced
practitioner knows that a general-purpose agent would not assume.
Rate limits, auth scoping, quota behaviors, consistency models, etc.
-->

- **[Constraint Name]:** [What the constraint is and what it means for implementation.]
- **[Constraint Name]:** [What the constraint is and what it means for implementation.]

## Common Failure Modes

<!--
What goes wrong and why. Not how to fix it step by step — what to watch for
and what the root cause usually is.
-->

- **[Failure Mode]:** [What it looks like, why it happens, how to avoid it.]
- **[Failure Mode]:** [What it looks like, why it happens, how to avoid it.]

## Integration Points

<!--
How this domain connects to other systems, framework commands, or concerns.
Cross-cutting implications — security, observability, error handling at the boundary.
Only include if genuinely non-obvious for this domain.
-->

- **[Concern]:** [How this domain intersects with it and what that means.]
