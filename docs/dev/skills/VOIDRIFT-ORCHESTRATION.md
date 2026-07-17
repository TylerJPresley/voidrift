# VOIDRIFT-ORCHESTRATION

Guardrails for working on VoidRift's orchestration layer.

## Architecture

- `src/turn.ts` — Event-driven turn orchestrator. Publishes `TURN_BEFORE`/`TURN_AFTER`, invokes model.
- `src/orchestration/graph.ts` — `directChat()` is the core tool execution loop
- `src/orchestration/tool-binding.ts` — dynamic tool selection, BASELINE_TOOLS, contextual query
- `src/orchestration/tool-registry.ts` — tool executor registry
- `src/orchestration/scheduler.ts` — background exec, delays, cron
- `src/orchestration/run.ts` — autonomous `/run` loop (Ralph Loop)
- `src/orchestration/guardrails.ts` — mechanical enforcement (advisory + blocking)
- `src/orchestration/preflight.ts` — utility model classifiers (tool selection only)
- `src/tasks/registry.ts` — named reusable task definitions
- `src/worktree/engine.ts` — git worktree isolation for subagents
- `src/events/bus.ts` — central typed event bus with `publishAndWait`

## Event-Driven Turn Flow

`turn.ts` is a thin orchestrator. All enrichment/reaction is handled by subscribers.

```
executeTurn():
  1. clearTurnContext()
  2. Extract images + add user message (inline)
  3. Resolve tier + de-escalation (inline)
  4. await bus.publishAndWait("TURN_BEFORE")
  5. Compile prompt
  6. await runTurn() → directChat() → tool loop
  7. Record result to context (inline)
  8. await bus.publishAndWait("TURN_AFTER")
  9. Return result
```

## TURN_BEFORE Subscribers (registered in bootstrap/cli.ts)

| Order | Subscriber | Priority | What it does |
|-------|-----------|----------|--------------|
| 1 | Message decay | high | Compacts old turns when count > retention.turnsDecayAfterCount |
| 2 | Context pressure | high | Injects budget warning at 50%/80% |
| 3 | Skill resolution | normal | Loads triggered skills + inheritance from previous turn |

## TURN_AFTER Subscribers (registered in bootstrap/cli.ts)

| Order | Subscriber | Priority | What it does |
|-------|-----------|----------|--------------|
| 1 | Context summary | normal | Generates one-sentence recap, stores on message |
| 2 | Escalation check | high | Handles escalate/deescalate tool calls + auto-escalation |

## Tool Loop Contract (`directChat`)

- Max 10 tool rounds per turn, extendable via continuation check (model asked "continue or done?" at limit).
- Max 3 extensions (theoretical max 40 rounds). The 60% context budget check is the real safety valve.
- Each round: stream model → extract tool calls → execute → feed results back.
- Deduplication: identical call signatures don't re-execute. Cache clears after mutations (write/edit/execute).
- Continuation nudge: if model stops after round > 1 with <200 chars, ask it to continue once.
- Mid-turn budget at 60%: inject wrap-up directive and break.
- Output token enforcement: if remaining output budget < 50% of maxOutput, inject write-to-file directive.
- Dynamic tool re-binding: if `search_tools` activates new tools mid-turn, client is re-bound on next round.
- Recovery loop: partial `tool_call_chunks` detected → expand toolbelt → nudge retry.
- XML rejection: if model emits raw XML tool calls (vLLM parser failure), reject with correction message and retry. Do NOT silently parse malformed output — make the model correct itself.
- Struggle signal: model expresses write intent without tool call → emits STRUGGLE_DETECTED event.

## Tool Selection (single preflight call)

One utility-model call per turn selects tools from the TOC:
- Reads `recentSummaries` and `recentTools` from conversation chain (last N turns via `contextLookbackTurns`)
- Builds contextual query: user message + summaries + active plan
- BASELINE_TOOLS (15) always bound: read, write, execute, research, plan, self-management
- Classifier adds exotic tools on demand: orchestration, MCP, memory, scheduling
- On-demand TOC in system prompt shows model what exotic tools exist (activatable via `search_tools`)

## Rules

- Never block the main turn with synchronous subagent execution unless `maxConcurrentAgents` is 1 and the agent is explicitly synchronous.
- Subagents get their own `directChat` call with isolated history (empty). They don't share the parent's conversation.
- Worktree isolation: subagents operate in `.voidrift/worktrees/<id>/` with path-mutex locking.
- The scheduler fires callbacks on the event bus (`USER_INPUT`). It doesn't call `directChat` directly.
- `run_task_agent` and `spawn_subagent` are handled INSIDE `graph.ts` because they need the orchestration context. All other tools go through `tool-registry.ts`.
- Adding new turn-level behavior = register a subscriber to `TURN_BEFORE` or `TURN_AFTER`. Do NOT modify `turn.ts`.

## Background Execution

- `backgroundExec` spawns a child process with stdio pipes. Non-blocking.
- Results accumulate in `task.output`. Poll with `check_task(id)`.
- `killAll()` on shutdown sends SIGTERM to all running processes.

## Run Loop

- Loops `directChat` up to 25 turns until model outputs `<!-- GOAL_COMPLETE -->`.
- Dense tier only. Not for routine work.
- No user interaction. Model must make all decisions autonomously.

## Fallback Chain

- If primary model fails, `client.withFallbacks()` tries the next tier.
- Only activates if tiers resolve to different models.
