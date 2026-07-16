# VOIDRIFT-DEBUGGING

Guardrails for debugging VoidRift — audit logs, diagnostic patterns, and session analysis.

## Audit Logs

Every session produces two log files:
- `.voidrift/logs/<session-id>.log` — workspace: model actions, tool calls, results
- `~/.config/voidrift/logs/<session-id>.log` — global: CLI lifecycle, errors

Each line is a JSON object: `{ timestamp, level, source, message, data }`.

## Common Diagnostic Patterns

**Model not responding / empty output**
1. Check log: `grep "response" .voidrift/logs/<id>.log | tail -5`
2. Look for `usage.promptTokens` — if 0, the request never reached the model
3. Check if context exceeds `contextLimit` — model silently fails on overflow

**Tool call failing**
1. Log shows `call:<toolName>` then `result:<toolName>` with status
2. If `status: "error"` — read the output field for the error message
3. Permission denied → check policy rules and approval mode

**Context growing too fast**
1. `/stats` shows token usage per turn
2. `/context` panel shows per-layer breakdown
3. Look for large tool results that should have been compacted or cached

**Streaming UX issues**
1. Check if `onChunk` callbacks fire (log `STREAM_CHUNK_RECEIVED` events)
2. Verify `signal.aborted` isn't true prematurely
3. Check for unhandled promise rejections in the tool loop

## Session Files

For post-mortem analysis:
- `.voidrift/sessions/<id>/work.messages.json` — full conversation
- `.voidrift/sessions/<id>/system.turns.json` — turn-by-turn metadata with git SHAs

## Rules

- Never add `console.log` for debugging. Use `logger.local()` or bus events.
- Audit logger is best-effort — never crashes the harness over a logging failure.
- `stdio: ["pipe", "pipe", "pipe"]` on ALL `execSync` calls — leaked stderr corrupts Ink rendering.
- When diagnosing: read the log first, then the session files, then the source. Don't guess.

## Cross-References

- [TESTING](./VOIDRIFT-TESTING.md) — testing framework, structure
- [RELEASE](./VOIDRIFT-RELEASE.md) — build, publish flow