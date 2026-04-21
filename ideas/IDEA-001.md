---
id: IDEA-001
status: draft
category: next
created: 2026-04-18
reqs: []
---

# Decision Tracking Across Sessions

## User Story

As an operator, I want the agent to remember architectural and design decisions made during chat, so that future sessions don't re-litigate resolved questions or contradict prior choices.

## Context

The current memory system (REQ-MEM-1 through REQ-MEM-3) persists facts, conventions, and preferences. But decisions are different from facts — a decision has a rationale, alternatives considered, and a date. When an operator says "we decided to use JWT over sessions because of stateless scaling," that's not just a fact to store — it's a decision with context that should be traceable.

Currently, the agent can write memory entries via `memory(action="write")`, but there's no structured decision format. Decisions get buried in general memory or lost entirely after compaction.

Related requirements:
- REQ-MEM-1: two-layer memory system
- REQ-MEM-2: memory index injected into chat prompt
- REQ-MEM-3: memory tools in chat
- REQ-CHAT-4: compaction — decisions made before a compaction boundary can be lost
- REQ-PS-2: STATE.md records command outcomes but not conversational decisions

The DESIGN-CHAT-GUIDED.md noted this as future work: "Decision tracking across sessions."

## Acceptance Criteria

- [ ] The agent can record a decision with: title, rationale, alternatives considered, date, and affected components
- [ ] Decisions are stored separately from general memory (e.g., `.voidrift/decisions/` or a `decisions` scope in memory)
- [ ] The decision index is injected into the agent's system prompt alongside the memory index
- [ ] Decisions survive compaction — they are restored after `/compact` like files and skills
- [ ] `voidrift memory` (or a new `voidrift decisions` command) can list, show, and delete decisions
- [ ] When the agent is about to make a choice that conflicts with a recorded decision, it surfaces the conflict

## Affected Modules

- `memory.ts` — extend or parallel structure for decisions
- `chat.ts` — decision injection into system prompt, restoration after compaction
- Possibly a new `decisions.ts` module if the format diverges enough from memory

## Notes

- Should decisions live in memory with a `type: decision` frontmatter field, or in a separate directory? Separate directory keeps them queryable without polluting the memory index.
- The "conflict detection" AC is the hardest — requires the agent to reason about whether a new choice contradicts a prior decision. May be prompt-level rather than structural.
- Consider whether decisions should be project-only (no global layer) since they're inherently project-specific.
- Relationship to STATE.md: STATE.md records what commands ran; decisions record why choices were made. Complementary, not overlapping.
