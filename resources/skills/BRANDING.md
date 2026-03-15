# Skill: Branding & Visual Identity

## Core Principle
Every output — UI, copy, documentation, error message — is a brand touchpoint. Inconsistency erodes trust.

## Color System
- Use design tokens, not raw hex values. Define colors as semantic variables: `--color-primary`, `--color-surface`, `--color-danger`.
- Never introduce a color not in the defined palette without explicit approval.
- Dark mode is a first-class requirement, not an afterthought. All tokens must have light and dark variants.

## Typography
- Maximum two typefaces per project: one for headings, one for body.
- Define a type scale with named steps (xs, sm, base, lg, xl, 2xl) — do not use arbitrary pixel values.
- Line height: 1.5 for body copy, 1.2–1.3 for headings.
- Never set body text below 16px.

## Voice & Tone
- **Active voice.** "Save your changes" not "Changes will be saved."
- **Plain language.** Write at an 8th-grade reading level for general UI copy.
- **Consistent terminology.** Pick one word for each concept and use it everywhere. No synonyms.
- **Error messages:** State what happened, why, and what to do next. Never blame the user.
- **Empty states:** Use as an opportunity to guide, not just inform.

## Iconography
- Use a single icon library per project. Never mix icon families.
- Icons used without labels must have `aria-label` or `title` for accessibility.
- Icon size must align to the 8px grid (16px, 24px, 32px).

## Assets & Logo Usage
- Store brand assets in `assets/brand/` — never in `public/` or inline.
- Do not stretch, recolor, or modify logos without explicit approval.
- Maintain minimum clear space around logos equal to the logo's cap-height.

## Red Flags
- Hardcoded hex colors in component files
- Mixed icon libraries in the same view
- Copy that uses different terms for the same concept
- Modifying brand assets without noting the change in the ADR
