# VOIDRIFT-PROMPTS

Development guidelines for VoidRift's prompt architecture.

## What is `core.rules`

The behavioral contract loaded every turn. Governs HOW the model acts — not what features exist.

## What Belongs in `core.rules`

- **Universal** — applies on every turn regardless of task
- **Behavioral** — about conduct, not feature usage
- **Brief** — imperative, one line per rule

The test: "Would this rule matter on a 'hello' turn?" If yes → core.

Belongs:
- Role and confidence
- Directive vs Inquiry
- Scope discipline
- Context switching
- Conciseness
- Safety
- Retry protocol

## What Does NOT Belong in `core.rules`

- Feature workflows (→ builtin skill)
- Tool usage patterns (→ builtin skill)
- Multi-step processes (→ builtin skill)
- Code examples with ✅/❌ (→ skill)
- Domain knowledge (→ workspace skill)

## Writing Rules

- Imperative voice: "Do X", "Never Y"
- One concept per bullet
- No code blocks
- No examples
- Target: 40-60 lines total

## Feature Pointers

Each core VoidRift feature gets ONE brief pointer in `core.rules` — enough for awareness, not competence:

```
✅ "Planning: Persistent task tracking. Use add_plan(), read_plan(), update_plan()."
❌ Three paragraphs explaining the planning workflow with priority lanes
```

The pointer makes the model AWARE the feature exists. The builtin skill (loaded on demand) makes it COMPETENT to use it.

## Other Prompts

- **Agent personas** (chat, plan, vibe) — define the agent's role and mode. Brief. Don't repeat core.rules.
- **Compact prompt** — instructions for the episodic summarizer. Standalone.
- **Overridable** — all prompts can be overridden via `.voidrift/prompts/` or `~/.config/voidrift/prompts/`

## The Boundary Problem

If the model ignores a rule in `core.rules`, the fix is NOT to repeat it louder. The fix is:
1. Move the guidance to a builtin skill that triggers at the right moment
2. Add mechanical enforcement in the harness (mid-turn budget checks, permission gates)
3. Accept that smaller models have adherence limits — escalate when precision matters
