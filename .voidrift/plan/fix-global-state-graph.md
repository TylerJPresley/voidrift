---
priority: now
description: Remove global mutable state from src/orchestration/graph.ts
rationale: Module-level setters (_workspaceRoot, _cache, _scheduler, _planManager) break concurrency, make tests order-dependent, and violate DIP. This is the highest-impact fix.
---

## Problem
`graph.ts` has module-level mutable state:
```ts
let _workspaceRoot = process.cwd();
let _cache: IndexCache | null = null;
let _scheduler: any = null;
let _planManager: any = null;
```
With setter functions that must be called in order by tests. No concurrent workspaces possible.

## Fix
1. Remove all module-level state variables
2. Add workspaceRoot, cache, scheduler, planManager to `OrchestrationInput` interface
3. Update all callers to pass these through
4. Update `setWorkspaceRoot`, `setScheduler`, `setPlanManager` to be no-ops or remove them
5. Update `executeToolCall` to receive dependencies from input, not globals

## Acceptance Criteria
- No module-level mutable state in graph.ts
- All dependencies flow through `OrchestrationInput`
- Tests no longer need to call setters in order
- Concurrent workspaces are possible
