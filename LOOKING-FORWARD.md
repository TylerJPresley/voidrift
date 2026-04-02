# Looking Forward — Lessons from Claude Code for Agentic Software Engineering

*Generated: 2026-03-31 · Source: Claude Code `src/` (2,100+ files) · Lens: What does a production agentic system teach us about building VoidRift?*

VoidRift is an agentic software engineering framework. This document analyzes Claude Code's architecture through three questions:
1. **Agent reliability** — How do you make agents fail less and recover better?
2. **Orchestration intelligence** — How do you spend fewer tokens, less time, and make smarter decisions about what agents do?
3. **Operator visibility** — How do you let the human see what's happening, intervene when needed, and trust the system?

---

## I. THE AGENT LOOP — How They Run Agents

### 1. Query Loop as State Machine

Their agent loop (`query.ts`, 1,700 lines) is a `while(true)` async generator with explicit mutable state and named transition reasons. Each iteration runs a pipeline:

1. **Snip compact** — Remove old tool call/result pairs surgically
2. **Microcompact** — Trim content within tool results (time-based expiry or cache-editing API)
3. **Context collapse** — Project a collapsed view over message history (reversible, non-destructive)
4. **Autocompact** — Full summarization if still over threshold
5. **Blocking limit check** — Preempt the API call if context is irrecoverably over limit
6. **API call with streaming** — Stream tokens, dispatch tools as they arrive
7. **Recovery checks** — prompt-too-long, max_output_tokens, media errors, stop hooks
8. **Tool execution** — Concurrent-safe tools in parallel, writes serial
9. **Attachment injection** — Memory, diagnostics, skill discovery, queued commands
10. **Continue or return** — Named transition reason recorded

State is carried in a `State` object with fields: `messages`, `toolUseContext`, `autoCompactTracking`, `maxOutputTokensRecoveryCount`, `hasAttemptedReactiveCompact`, `maxOutputTokensOverride`, `pendingToolUseSummary`, `stopHookActive`, `turnCount`, `transition`. Every `continue` site writes a new `State` with a `transition.reason`:

- `collapse_drain_retry` — Context collapse freed space, retry the API call
- `reactive_compact_retry` — Reactive compaction ran, retry
- `max_output_tokens_escalate` — Bumped from 8K to 64K, retry same request
- `max_output_tokens_recovery` — Injected "Resume directly" continuation, retry (up to 3x)
- `stop_hook_blocking` — A hook blocked continuation, injected error, retry
- `token_budget_continuation` — User-specified token budget not yet met, continue

**Framework impact for VoidRift:** Our agent loop is a simple send→receive→tool→repeat cycle. We have stall detection and retry, but no multi-stage recovery. When a gather final pass truncates at `max_tokens`, we lose half the REQUIREMENTS.md with no recovery. When context fills during a long chat session, we have no automatic management — the operator must manually `/compact`.

**What to build:**
- Named `transition_reason` on every loop iteration, logged to the command log. Makes post-mortem debugging possible without reading thousands of lines.
- `max_tokens` stop reason handling: inject "Resume directly — no apology, no recap" and retry up to 2 times. This is a pipeline reliability issue — truncated architecture docs cascade into bad tasks.
- Escalating token limits: start conservative, bump on first truncation. Saves tokens on short responses, scales up when needed.

### 2. Streaming Tool Executor

Their `StreamingToolExecutor` (`services/tools/StreamingToolExecutor.ts`) is a concurrent job scheduler for tool calls:

- Tools declare `isConcurrencySafe()` — the framework doesn't guess
- Concurrent-safe tools (reads) execute in parallel as they stream in
- Non-concurrent tools (writes) execute exclusively — no other tool runs alongside
- Results are buffered and emitted in the order tools were received (preserves API message ordering)
- A sibling abort controller kills parallel tools when one errors, without aborting the parent query
- Discarded on streaming fallback — orphaned tool results from a failed attempt are never yielded

The `toolOrchestration.ts` layer partitions tool calls into batches: consecutive read-only tools form a concurrent batch, write tools form serial batches. Max concurrency configurable (default 10).

**Framework impact:** Our tool execution is serial. When a develop agent reads `arch/backend.md` and `spec/backend.md` in the same turn, we execute them sequentially. For cloud models where each tool result triggers a new API call, this doubles the latency for no reason.

**What to build:**
- Add `is_concurrent_safe` property to tool definitions now (reads=True, writes=False)
- When multiple tool calls arrive in one response, partition into concurrent/serial batches
- Execute concurrent batches in parallel with `asyncio.gather()`
- Sibling abort: if one tool in a batch errors, cancel the others

### 3. Context Window as Managed Resource

They have four distinct context management strategies, each solving a different scale of pressure:

**Microcompact** (`services/compact/microCompact.ts`): Operates on individual tool results. Two modes:
- *Time-based*: If the gap since the last assistant message exceeds a threshold (cache expired), clear old tool result content — the prefix will be rewritten anyway
- *Cache-editing*: Uses Anthropic's cache_edits API to delete tool results from the cached prefix without invalidating it. Tracks which tools have been sent to the API, only deletes after they've been cached.

**Snip compact** (`services/compact/snipCompact.ts`): Removes entire old tool call/result pairs from history. More surgical than full compaction — preserves conversation flow, just removes the heavy content.

**Context collapse** (`utils/collapseReadSearch.ts`): A *read-time projection* over message history. Consecutive read/search tool calls are collapsed into summary groups ("Read 5 files, searched 3 patterns"). Non-destructive — the original messages still exist, the collapsed view is computed on each iteration. Reversible.

**Autocompact** (`services/compact/autoCompact.ts`): Full summarization when context exceeds threshold (context window minus 13K buffer). Circuit breaker: stops after 3 consecutive failures. Post-compact restoration: re-reads up to 5 recently accessed files (capped at 5K tokens each, 50K total), re-injects skills (5K/skill, 25K total budget).

**Session memory compaction** (`services/compact/sessionMemoryCompact.ts`): Separate from conversation compaction. Manages what the agent *remembers* across compactions — preserves a minimum number of text-block messages (default 5) and minimum token count (default 10K) from recent history, even when autocompact runs.

**The compact prompt** (`services/compact/prompt.ts`): Their summarization prompt is 200+ lines of structured instructions. It requires: primary request/intent, key technical concepts, files and code sections with snippets, errors and fixes, all user messages verbatim, pending tasks, current work with direct quotes, and optional next step. The `<analysis>` block is a scratchpad that gets stripped — only the `<summary>` reaches context.

**Framework impact:** We have one layer: manual `/compact`. No automatic management, no surgical removal, no post-compact restoration. For chat sessions, context fills silently until the API errors. For automated commands, agents that read many files accumulate context until they fail.

**What to build:**
- **Auto-compact for chat**: Trigger at 80% utilization, warn at 70%. Circuit breaker after 3 failures.
- **Post-compact restoration**: Re-inject the last 3 accessed framework files and active skills after compaction. Without this, the model is blind after compact.
- **Lightweight snip for automated commands**: After a tool result has been processed (model's next response references it), replace content with `[result: 2847 lines from src/main.py]`. Keeps flow, frees context.
- **Structured compact prompt**: Our `/compact` summarization should follow their pattern — require file names, code snippets, pending tasks, current work with quotes. Generic summarization loses critical detail.

---

## II. TOOL & CONTEXT ARCHITECTURE — How They Feed Agents

### 4. Attachment System as Context Assembly Pipeline

Their attachment system (`utils/attachments.ts`, 127K) is not just "injecting files." It's a context assembly pipeline that decides what context to inject, when, and how much. Attachments are user-role messages injected alongside the actual user message. Types include:

- File content (recently edited files, with diff snippets)
- IDE selections (what the user is looking at)
- Memory files (CLAUDE.md, project memories)
- LSP diagnostics (errors/warnings from language servers after file edits)
- Agent listings (available sub-agents — moved here from tool descriptions to avoid cache busts)
- Skill content (invoked skills, with delta tracking — only inject what changed)
- Plan content (current plan state)
- Task lists (todo items)
- Queued commands (user input that arrived mid-turn)
- Tool search results (deferred tool schemas)

Key pattern: **delta attachments**. They track what was injected on the previous turn and only inject what changed. Agent list didn't change? Don't re-inject. New skill activated? Inject just that skill. This prevents context bloat from repeated injection.

**Framework impact:** Our develop agents spend 1-2 tool call rounds loading `arch/<module>.md` and `spec/<module>.md`. The framework already knows what context the agent needs — making the agent ask for it wastes time and tokens. For a 50-task develop session, that's 100 extra API round-trips.

**What to build:**
- Pre-load `arch/<module>.md` and `spec/<module>.md` content in `_develop_module`. Inject in the user message alongside the task text. Keep `read_framework_file` available for additional context.
- For chat: track injected context per turn. On skill change, inject only the delta.

### 5. Surgical Edits vs Full Rewrites

Their `FileEditTool` does string replacement (old_str → new_str) with:
- Fuzzy matching (`findActualString`) for whitespace/quote differences
- Quote style preservation (maintains the file's existing convention)
- File mtime tracking (detects external modifications between reads and writes)
- LSP diagnostic clearing (tells the language server to re-check the edited file)
- Per-edit diff computation for display

**Framework impact:** Our `write_source_file` sends the entire file content through the API, even for a one-line change. For a 500-line file, that's ~2000 output tokens for a 10-token change. Over a 50-task develop session with mostly modifications (not new files), this could be 100K+ wasted output tokens.

**What to build:**
- Add `edit_source_file(path, old_str, new_str)` to the develop command tool set
- Include fuzzy matching for whitespace tolerance
- Track file mtime: warn if file was modified externally since last write

### 6. File Read Limits & Pagination

Their `FileReadTool` has layered limits:
- Max file size: 256KB (stat check before read — cheap)
- Max output tokens: 25K (token count after read — expensive but accurate)
- They tested truncation vs throwing on overflow and **reverted truncation** — it increased mean token usage because models get partial content and make more calls

Our pagination approach (return partial + warning + instructions) is actually better than both of their approaches. It gives the model agency to request more content. **Keep our approach.**

**What to build:**
- Consider adding `max_read_bytes` as a secondary guard for files with very long lines (a 2000-line file with 500-char lines is very different from 2000 lines with 50-char lines)

### 7. Tool Search — Lazy Schema Loading

When MCP tools exceed 10% of the context window, they defer tool loading. Deferred tools are sent with `defer_loading: true` — the model sees a one-line description but not the full schema. The model calls `ToolSearchTool` to discover the full schema when needed.

**Framework impact:** Our tool set is small (4-8 per command). Not a problem today. But verify (REQ-VF-16) has the largest tool set — monitor schema overhead as we add browser tools.

---

## III. SKILLS, MEMORY & KNOWLEDGE — How Agents Learn

### 8. Skills Architecture

Their skill system has 6 sources: policy settings, user settings, project settings, plugins, bundled, MCP. Skills have rich frontmatter: name, description, whenToUse, allowedTools, model override, hooks, paths (file pattern matching), effort level, context (inline vs fork).

Key patterns:
- **Lazy loading**: Frontmatter parsed at startup, full content loaded on invocation. `list_skills` is cheap, `get_skill` is expensive.
- **Tool restrictions per skill**: A skill can specify `allowedTools` — invocation only has access to certain tools. A read-only analysis skill can't accidentally write files.
- **Conditional activation**: Skills activate based on file paths — editing a `.tsx` file activates the React skill.
- **Deduplication via realpath**: Handles symlinked skill directories.

**What to build:**
- `list_skills_metadata()` that returns names + descriptions from frontmatter without loading full content
- Consider `allowed_tools` in skill frontmatter for domain skills that should be read-only
- Realpath deduplication in `find_skill()`

### 9. Memory System — Persistent Cross-Session Knowledge

Three-tier memory architecture:
- **MEMORY.md entrypoint** (max 200 lines, 25KB) — indexes topic files. Truncation with warning when exceeded.
- **Topic files** — detailed knowledge organized by subject
- **Agent memory** — per-agent persistent memory with scopes: user (global), project (shared via VCS), local (machine-specific, not committed)

Memory types are structured: preferences, conventions, decisions, facts. Explicit guidance on what NOT to save (implementation details better suited to task context).

**Framework impact:** After running gather + plan + develop, the framework has learned things about the project that are lost between sessions. "This project uses FastAPI with SQLAlchemy," "the operator prefers explicit error handling," "tests should use pytest-asyncio." This knowledge could inform future runs.

**What to build (future):**
- `.voidrift/memory/` directory where chat can write learned preferences
- Memory files injected into chat system prompts alongside skills
- Automated commands don't write memories — only chat (where the operator is actively teaching)

### 10. Prompt Cache Optimization

Their system prompt has an explicit `SYSTEM_PROMPT_DYNAMIC_BOUNDARY` marker. Everything before it uses `scope: 'global'` for cross-request caching. They moved the agent list from tool descriptions (which busted the tool-schema cache on every MCP change) to attachment messages — saving 10.2% of fleet cache_creation tokens.

Cache break detection (`services/api/promptCacheBreakDetection.ts`) tracks: system prompt hash, per-tool schema hash, model, betas, cache control settings. When `cache_read_input_tokens` drops, it diffs previous vs current state and generates human-readable diffs identifying exactly what changed.

**Framework impact:** Gather runs 50+ concurrent source analysis agents with the same system prompt. If the shared prefix is byte-identical, Anthropic caches it once and all 50 agents get cache hits. If it varies by one byte, we pay 50x.

**What to build:**
- Verify byte-identical system prompts across concurrent agents
- For Anthropic models, add `cache_control` breakpoints between static layers (1-3) and dynamic layer (4)
- Log `cache_read_input_tokens` vs `cache_creation_input_tokens` to verify cache efficiency

---

## IV. RELIABILITY & RECOVERY — How They Handle Failure

### 11. Retry Architecture

Their retry system (`services/api/withRetry.ts`) classifies errors with different strategies:

| Error | Strategy | Rationale |
|-------|----------|-----------|
| Connection error | Full retries (10), exponential backoff | Transient network |
| HTTP 429 | Respect `retry-after` header | Server knows when capacity returns |
| HTTP 529 (overloaded) | Max 3 retries, foreground only | Background queries bail to reduce amplification |
| HTTP 401 | Refresh OAuth token, retry once | Token expiry |
| HTTP 413 (prompt too long) | Non-retryable | Content problem, not transient |
| AWS credential error | Refresh credentials, retry | Credential rotation |

Key insight: **foreground vs background distinction**. User-blocking queries retry aggressively. Background queries (summaries, classifiers) bail immediately on overload to reduce gateway amplification during capacity cascades.

**Framework impact:** Our retry (REQ-ARCH-10) uses fixed exponential backoff for everything. When 50 concurrent gather agents all hit 429 simultaneously, they all retry at the same intervals — thundering herd.

**What to build:**
- Parse `retry-after` header on 429, use as delay
- Add ±30% jitter to all retry delays
- For concurrent agents, stagger initial requests
- For Kiro Gateway, re-read credential file on 401, retry once

### 12. Pre-Write Snapshots & Rollback

Their `fileHistory.ts` snapshots every file before modification. Max 100 snapshots per session, keyed by message ID. Supports undo/rewind to any previous state. Computes insertions/deletions per file for diff display.

**Framework impact:** When a develop task writes 3 of 5 files before stalling, the project is in an inconsistent state. The next task may depend on the incomplete output. The framework should be able to roll back a failed task.

**What to build:**
- Before each `write_source_file`, read current content into a per-task snapshot dict
- If task is retried or blocked, restore all snapshots for that task
- On successful completion, clear snapshots and compute diff stats

### 13. Git Safety

Their `gitDiff.ts` has explicit safety limits: max 50 files, 1MB total diff, 400 lines per file, 500 files before skipping details. Detects transient git states (merge/rebase/cherry-pick) and skips operations.

**What to build:**
- Git state check in develop preflight: block during merge/rebase/cherry-pick
- Cap `git diff HEAD` parsing at 50 files / 1MB
- Add file manifest to TASKS-DONE.md entries

### 14. TaskStore Locking

Their task system uses file locking with 30 retries (5-100ms backoff) for concurrent access. High water mark prevents ID reuse. Tasks have `blocks`/`blockedBy` arrays for dependency tracking.

**Framework impact:** Our `task_store.complete()` reads, modifies, and writes TASKS.md — not atomic. With 8 concurrent module workers, two completing simultaneously could corrupt the file.

**What to build:**
- `fcntl.flock()` or `.tasks.lock` file on all TaskStore write operations
- Consider task IDs for stable identification (match by ID, not text)
- Future: `depends:` metadata for cross-module dependency tracking

### 15. Model Fallback

On 429/503 after all retries, they switch to a configured fallback model. Clear partial state, strip model-specific content (thinking signatures), log the switch.

**What to build:**
- Optional `fallback` field in `models.yml`
- After retries exhausted on 429/503, switch for remainder of command run

---

## V. OPERATOR VISIBILITY — How They Show What's Happening

### 16. Multi-Agent Progress Dashboard

Their swarm UI shows per-agent status, task ownership, coordinator delegation state. Notification folding merges progress updates. The status line shows model, context %, cost, worktree, permission mode.

**Framework impact:** This is the core observability gap. When develop runs 8 concurrent module workers, the operator sees interleaved progress lines. No way to tell which module is stuck, which is progressing, or how context is being consumed. The operator is orchestrating a fleet of agents — they need a dashboard, not a log stream.

**What to build:**
- Per-module status dict: `{module, task: "3/7", elapsed, context%, status}`
- Rich table that updates in-place for concurrent mode
- Single progress line with module context for sequential mode

### 17. Cost & Token Tracking

Per-model token tracking (input, output, cache_read, cache_creation), USD cost calculation, session persistence. Stats store uses reservoir sampling for histograms (p50/p95/p99).

**What to build:**
- `CostTracker` accumulating per-model usage during command runs
- Write to STATE.md on completion
- Display in summary: `▸ Cost: ~$0.42 (claude: 150K↓ / 12K↑ · 85% cache hit)`

### 18. Structured Error Summaries

JSONL error logs enriched with timestamp, session ID, URL, HTTP status, server message. Buffered writes (flush every 1s or 50 entries).

**What to build:**
- Structured error summary in STATE.md: `errors: [{type, count, stage, files}]`
- Enrich API error log entries with model alias, URL, status, response excerpt

### 19. Diff Stats Per Task

Lines added/removed per file per tool call. Change attribution (which agent modified which files).

**What to build:**
- Track files written per task. On completion, compute diff stats from snapshots.
- Add to TASKS-DONE.md: `<!-- files: src/api.py(+45/-12), src/models.py(+30/-0) -->`

---

## VI. SECURITY & SAFETY — Boundaries for Agentic Systems

### 20. SSRF Guard

Blocks private/link-local/CGNAT ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64.x). Allows loopback (127.x) for local dev. Handles IPv4-mapped IPv6.

**What to build:** Add to verify's `http_request` tool. Block private IP ranges, allow loopback.

### 21. Command Security

AST-based bash command parsing for security analysis. Splits compound commands, strips env var prefixes, detects output redirections, validates path constraints. Sandbox integration. Configurable timeouts (default + max).

**What to build:** Configurable timeout for verify's `run_command` (default 30s, max from config.yml).

### 22. Permission Architecture

Multi-source rules (policy, user, project, CLI, session). Modes: plan (read-only), auto (classifier decides), default (ask for writes). Denial tracking with fallback to prompting. Speculative permission checks for performance.

**Framework impact:** Our structural approach (tool set fixed at command init) is simpler and more reliable for automated commands. Their runtime system exists because they have an interactive user. **Keep our approach for automated commands.** For chat `web_fetch`, add denial count tracking.

---

## VII. SESSION & STATE MANAGEMENT

### 23. Session Restore & Recovery

Full state restoration: messages, file history, attribution, context collapse commits, todos, worktree sessions, model overrides. Message sanitization on restore: filter orphaned thinking blocks, unresolved tool uses, whitespace-only messages. Turn interruption detection with auto-continue.

**What to build (future):**
- Chat session persistence to `.voidrift/chat-sessions/`
- Message sanitization on restore
- Develop interrupted task detection on startup

### 24. Concurrent Session Registry

PID files in `~/.claude/sessions/`. Tracks session kind (interactive, background, daemon), status (busy, idle, waiting). Enables `claude ps`.

**What to build:** Extend `voidrift status` to show active sessions across terminals.

### 25. Cleanup & Retention

Configurable cleanup period (default 30 days). Cleans: old logs, error logs, tool results, stale worktrees. File-lock-based to prevent concurrent cleanup.

**What to build:** Add to `voidrift prune`: remove `.voidrift/analysis/` entries for deleted source files.

---

## VIII. TESTING & DEVELOPMENT INFRASTRUCTURE

### 26. VCR Test Fixtures

Record/replay API responses. Hash request inputs for fixture filenames. CI fails on missing fixtures. Development records on miss.

**What to build (future):** VCR mode for the agent loop. Record to `cli/tests/fixtures/`, replay in tests.

### 27. Forked Agent Architecture

Fork subagents inherit parent's full conversation context and system prompt for prompt cache sharing. All `tool_result` blocks replaced with placeholders so fork children produce byte-identical API request prefixes. Key principles from their prompt:
- **"Don't peek"** — Don't read fork output mid-flight. Trust the completion notification.
- **"Don't race"** — Never fabricate or predict fork results.
- **"Writing a fork prompt"** — Since the fork inherits context, the prompt is a *directive*, not a briefing.

**Framework impact:** Our concurrent gather agents already follow these principles structurally (separate agents, no shared state). But the "don't peek" principle should be documented for concurrent develop module workers.

### 28. Output Styles

Pluggable styles that inject system prompt instructions: "Explanatory" (educational insights), "Learning" (pauses for user code). Plugin-provided styles.

**What to build (low priority):** `--style verbose/terse` for chat.

---

## IX. FUTURE CAPABILITIES

### 29. LSP Diagnostic Feedback Loop

After a develop agent writes a file, an LSP server reports syntax/type errors. Injecting diagnostics creates a self-correction loop — the agent fixes errors before moving to the next task. Their "passive feedback" pattern injects diagnostics as attachment messages without the model requesting them.

### 30. Scheduled Gather (`voidrift watch`)

Monitor git commits, trigger incremental gather on changed files. Lock-based ownership (one session owns the scheduler). Missed task detection on startup. Jittered execution.

### 31. `voidrift doctor`

Self-diagnosis: config validity, model reachability, resource completeness, disk space. Structured output with fix recommendations.

### 32. Side Question (`/quick`)

One-shot sub-agent sharing parent's prompt cache. No tools, 1-turn limit. Answers quick questions without polluting main context.

### 33. Task Dependencies

`depends:` metadata on task blocks. Orchestrator checks dependencies before dispatching. If dependency incomplete, skip and process next task.

---

## PRIORITY RANKING

### P0 — Agent Reliability (pipeline breaks without these)
1. **Max output tokens recovery** (§1) — Truncated docs cascade through the pipeline
2. **TaskStore file locking** (§14) — Data corruption with concurrent workers
3. **Pre-write file snapshots** (§12) — Rollback on task failure
4. **Retry-after + jitter** (§11) — API citizenship for concurrent agents
5. **Git transient state detection** (§13) — Preflight safety

### P1 — Orchestration Intelligence (wasted tokens/time without these)
6. **Context window management** (§3) — Auto-compact, snip, post-compact restore
7. **Pre-loaded context injection** (§4) — Eliminate tool call round-trips in develop
8. **Surgical edit tool** (§5) — Token efficiency for file modifications
9. **Prompt cache optimization** (§10) — Cost reduction for cloud models
10. **Concurrent tool execution** (§2) — Latency reduction

### P2 — Operator Visibility (flying blind without these)
11. **Agent loop transition logging** (§1) — Debuggable command logs
12. **Multi-agent progress dashboard** (§16) — See what concurrent workers are doing
13. **Cost & cache tracking** (§17) — Informed model selection
14. **Diff stats per task** (§19) — Task accountability
15. **Structured error summaries** (§18) — Post-mortem without log archaeology

### P3 — Framework Hardening
16. **External modification detection** (§5) — Trust preservation
17. **SSRF guard for verify** (§20) — Network safety
18. **Model fallback** (§15) — Run completion resilience
19. **Kiro credential refresh** (§11) — Transparent token rotation
20. **Git diff safety limits** (§13) — Memory safety
21. **Analysis cache pruning** (§25) — Disk hygiene

### P4 — Future Capabilities
22-33: LSP feedback, project memory, chat persistence, VCR fixtures, scheduled gather, doctor command, side questions, session registry, task dependencies, output styles, compact prompt structure.
