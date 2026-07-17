# VOIDRIFT-CONTEXT

Guardrails for working on VoidRift's context system.

## Architecture

Four layers, ascending volatility:
1. **Agent** — persona, tool schemas, bound skills, discovery indexes. Changes only on agent switch.
2. **Orbit** — active plan, triggered skills, loaded memories. Changes ~5% of turns.
3. **Drift** — focused file summaries, git status. Changes on tool use.
4. **Void** — messages, diagnostics, turn context. Changes every turn.

## Rules

- Never move volatile data into a stable layer. Messages stay in Void. File state stays in Drift.
- The ordering maximizes prompt prefix cache reuse. Don't reorder layers.
- Drift files are SUMMARIES. Never put full file content in Drift — that's what `read_file` returns directly to Void.
- `focusedFiles` has a budget cap (3 files, 8000 tokens). Eviction is FIFO. Don't increase without measuring.
- Tool schemas go in Agent because they never change mid-session. Measured, not guessed.
- `getTokenCount()` must use actual `JSON.stringify` length for schemas, not estimates.

## Compaction

- Fires at 75% budget. Keeps last 10 turns at full fidelity.
- Never compact tool results that contain active error diagnostics.
- `retention.turnsDecayAfterCount` (default 20) proactively summarizes old turns before budget pressure hits.

## Token Estimation

- Use `Math.ceil(text.length / 4)` for estimates.
- Use model-reported `promptTokens` from response when available.
- Never guess tool schema size — measure it: `JSON.stringify(TOOL_SCHEMAS).length / 4`.

## Progressive Disclosure

- Skill discovery index = one-line summaries (Agent layer, cheap)
- Full skill content loads into Orbit only when triggered
- Memory index = lightweight metadata. Full body loads on demand.
- File map = structural overview. Full file via read_file on demand.
