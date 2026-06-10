---
priority: now
description: Split main.tsx god file into focused modules
rationale: main.tsx is ~600 lines handling React components, tool descriptions, input handling (100+ line useInput), command dispatch, turn execution, signal handlers, and bootstrap. Every feature touches it.
---

## Problem
`src/main.tsx` is a god file (~600 lines) that handles:
1. React presentational components (Welcome, UserMessage, ToolGroup, etc.)
2. Tool description logic (describeToolCall - 80+ lines)
3. Input handling (useInput - 100+ lines)
4. Command dispatch (handleSubmit)
5. Turn execution orchestration
6. Signal handlers (gracefulShutdown)
7. Bootstrap logic

## Fix
Split into focused modules:
1. `src/ui/components/` - React presentational components
2. `src/ui/tool-descriptions.ts` - describeToolCall and related logic
3. `src/ui/input-handler.ts` - useInput hook and input processing
4. `src/ui/command-dispatch.ts` - handleSubmit and slash command handling
5. Keep main.tsx as composition root that wires everything together

## Acceptance Criteria
- main.tsx is under 200 lines
- Each module has a single responsibility
- No circular dependencies
- All existing functionality preserved
- Tests still pass
