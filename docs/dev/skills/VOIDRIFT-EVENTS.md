---
name: "VOIDRIFT-EVENTS"
description: "Rules and reference for VoidRift's event-driven architecture"
triggers:
  keywords: ["event", "bus", "publish", "subscribe", "TURN_BEFORE", "TURN_AFTER"]
  files: ["bus.ts"]
agents: []
active: true
---

# VoidRift Event System

## The Rule

**If state changed, emit.** Every mutation to shared state publishes an event. Subscribers decide if they care.

## When to Emit

| Situation | Action |
|-----------|--------|
| Data or process changed | Emit specific event with payload |
| Multiple related mutations in one operation | Emit one event per logical change, OR one coarse `*_CHANGED` event |
| Internal bookkeeping within a single function | Don't emit |
| Read/query (no mutation) | Don't emit |

## Event Granularity Rules

1. **Specific events** when the payload carries useful data that subscribers need without querying state (e.g., `FILE_FOCUSED` with path and token cost).
2. **Coarse `*_CHANGED` events** when there's no discrete operation to emit from, or when subscribers always want the full current state anyway (e.g., `TOOLSET_CHANGED`).
3. **Never duplicate** — don't emit both a specific AND a generic event for the same mutation. Pick one.

## Event Naming Convention

```
NOUN_VERB (past tense)
```

Examples: `FILE_FOCUSED`, `MODEL_ESCALATED`, `TURN_CANCELLED`, `PLAN_ITEM_ADDED`

For coarse signals: `NOUN_CHANGED` — `SKILLS_CHANGED`, `TOOLSET_CHANGED`

## Adding a New Event

1. Add to `EventType` union in `src/events/bus.ts`
2. Add typed payload to `EventPayloadMap`
3. Add `bus.publish()` call at the mutation point
4. Update the events table in `docs/PLUGINS.md`
5. The test `tests/events/coverage.test.ts` will fail if an event is defined but never published

## Bus API

```ts
// Fire-and-forget (informational, non-blocking)
bus.publish("EVENT_NAME", payload);

// Awaitable (lifecycle events where subscribers must complete first)
await bus.publishAndWait("TURN_BEFORE", payload);
```

Use `publishAndWait` ONLY for `TURN_BEFORE` and `TURN_AFTER`. Everything else is fire-and-forget.

## Priority (Metadata Only)

```ts
bus.subscribe("EVENT", handler, { priority: "normal" });
```

| Priority | Use case |
|----------|----------|
| critical | User interrupts, safety blocks |
| high | Failures, corrections, budget pressure |
| normal | Standard processing (default) |
| low | Scheduled cleanup, entropy scans |
| background | Diagnostics, telemetry |

Priority does NOT change execution order. Subscribers run in FIFO registration order. Priority is metadata for future routing and UI highlighting.

## Subscriber Rules

- Internal features register in `src/bootstrap/cli.ts` — they run first (FIFO)
- Plugins register via `api.subscribeEvent()` — they run after internals
- A throwing subscriber is caught and logged — doesn't kill the turn
- Keep handlers fast (<100ms for local work)
- If your handler needs async work that shouldn't block the turn, use fire-and-forget `bus.publish` internally

## Do NOT

- Emit events from within other event handlers (event storms)
- Use events for control flow (if X then do Y — use direct function calls)
- Create events that nothing subscribes to "just in case"
- Emit the same event twice for the same mutation
- Put large data (file contents, full responses) in payloads — use references (paths, IDs)
- Silently fix malformed model output — reject and correct. The model learns from in-context feedback. Silent parsing hides problems.
