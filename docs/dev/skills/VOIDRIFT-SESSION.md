# VOIDRIFT-SESSION

Guardrails for working on VoidRift's session persistence and lifecycle.

## Architecture

- `src/session/brain.ts` — SessionBrain: writes state per turn, lists/loads sessions
- `src/session/serializer.ts` — TurnSerializer: full JSON snapshot (legacy, used by /resume)
- `src/safeguards/checkpoint.ts` — GitCheckpointer: auto-commits on TURN_COMPLETE
- `src/session/compactor.ts` — history compaction at 75% budget

## State Location

All session state: `.voidrift/sessions/<session-id>/`

| File | Contents |
|------|----------|
| `system.metadata.json` | sessionId, startTime, turnCount |
| `system.turns.json` | per-turn snapshots (timestamp, agentId, gitSha) |
| `governance.persona.md` | active persona text |
| `governance.skills.json` | bound/active skill counts |
| `governance.tools.json` | active tool list |
| `workspace.plan.md` | active plan content |
| `workspace.focused.json` | focused files (path, ranges) |
| `work.messages.json` | full conversation messages |
| `work.diagnostics.md` | active diagnostics |

## Rules

- Brain writes on every `TURN_COMPLETE` event. Don't call `save()` manually elsewhere.
- Messages in `work.messages.json` are the source of truth for `/resume`.
- Checkpointer creates git commits ONLY when workspace is dirty. Don't force empty commits.
- Compaction preserves: last 10 turns, unresolved errors, active parameters.
- `--resume` flag on CLI loads the most recent session (or by ID).
- `loadSession()` replaces current context messages + plan + diagnostics. Clean swap.
- Session ID is a random 8-char UUID prefix. Generated once at startup in `cli.ts`.

## Lifecycle

```
startup → createEngine() → SessionBrain(sessionId) → brain.attach() → [turns] → shutdown → brain.save()
```

- `attach()` subscribes to `TURN_COMPLETE` on the bus
- Each turn: brain saves all partitions to their files
- On resume: `brain.loadSession(id, context)` hydrates the context manager

## Git Checkpointing

- Tags: `voidrift-checkpoint-turn-<N>`
- Rollback: `/rewind <N>` → `git reset --hard` to that checkpoint
- Only on the working branch. Never touches other branches.
