---
id: IDEA-8
status: draft
category: now
created: 2026-05-11
---

# Modes & Governance

## Summary
A single system that ties together the context window partition, mode cycling, and context compaction. They are interdependent — modes change the governance prompt, compaction preserves governance, and mode switching rebuilds governance.

## Description

### Context Window Partition
The context window is divided into two strictly isolated layers:

- **Governance Layer** (never compacted) — Contains: system prompt, active mode prompt, memory index, git snapshot. This is the orchestrator-seeded content that defines the agent's purpose and constraints.
- **Work Layer** (compactable) — Contains: user messages, model responses, tool call results. This is the agent-generated content from conversation.

### Modes
Each mode loads its own governance prompt and sets permissions:

| Mode | Prompt | ApprovalMode | Write Scope |
|------|--------|-------------|-------------|
| chat | chat-prompt.md | DEFAULT | All (with confirmation) |
| plan | plan-prompt.md | PLAN | None (read-only) |
| dev | dev-prompt.md | DEFAULT | All (with confirmation) |
| idea | idea-prompt.md | PLAN | `.voidrift/ideas/` only |
| cr | cr-prompt.md | PLAN | `.voidrift/changes/` only |

SHIFT+TAB cycles through modes. Each mode switch rebuilds the governance layer with the new prompt. The system prompt, memory index, and git snapshot are preserved across mode switches.

### Context Compaction
Compaction (via `/compact` or auto at 80% utilization) summarizes the work layer and replaces it with a structured summary. The governance layer is preserved unchanged — including the active mode's prompt, memory index, and git snapshot. If the session has only the governance layer (no work history), compaction shows "Nothing to compact."

### Integration
- Mode A → compaction → governance preserved → mode B → governance rebuilt with mode B prompt → compaction → governance preserved again. The stateful governance is the thread that persists across modes and compactions.
- When mode switches, the mode prompt in governance is replaced but the memory index and git snapshot remain.
- When a session compacts, it preserves governance as-is but summarizes the work layer.

## Acceptance Criteria
- Given chat mode, WHEN `/compact` runs, THEN work history is summarized but the chat-mode prompt and governance content are preserved.
- Given SHIFT+TAB pressed in chat mode, WHEN mode cycles to plan, THEN plan-prompt.md replaces chat-prompt.md in governance.
- Given a plan mode session at 80% utilization, WHEN a message is sent, THEN auto-compact runs before processing.
- Given plan mode, WHEN the agent attempts to write source code, THEN the write is denied.
- Given dev mode, WHEN the agent writes a file, THEN normal confirmation flow applies.
