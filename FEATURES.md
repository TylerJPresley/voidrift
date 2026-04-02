# Feature List — Now, Next, Later

*Derived from: LOOKING-FORWARD.md (Claude Code source analysis, 2026-03-31)*
*Criteria: Now = the framework has bugs or blind spots that cause failures. Next = the framework wastes resources or the operator can't see what's happening. Later = extends capabilities or polishes edges.*

---

## NOW — Fix What Breaks

These are reliability gaps in the orchestration layer. Agents fail, data corrupts, or the pipeline produces bad output because of these.

### N1. Max Output Token Recovery
When an agent hits the output token limit, the response silently truncates. A half-written ARCHITECTURE.md cascades into bad TASKS.md cascades into bad develop output.
- Detect `stop_reason: "max_tokens"` in the agent loop
- Inject "Resume directly — no apology, no recap. Pick up mid-thought." as a user message
- Retry up to 2 times
- For stages with known long output (plan architecture, gather final pass), start with higher `max_tokens` via stage defaults
- *Source: LOOKING-FORWARD §1*

### N2. TaskStore File Locking
`task_store.complete()` reads, modifies, and writes TASKS.md — not atomic. With 8 concurrent module workers, two completing simultaneously corrupt the file.
- Add `fcntl.flock()` or `.tasks.lock` file on all TaskStore write operations
- Retry with backoff (30 retries, 5-100ms) matching the pattern from Claude Code
- *Source: LOOKING-FORWARD §14*

### N3. Pre-Write File Snapshots & Rollback
When a develop task writes 3 of 5 files before stalling, the project is in an inconsistent state. No rollback.
- Before each `write_source_file`, read current content into a per-task snapshot dict
- If task is retried or blocked, restore all snapshots for that task
- Clear snapshots on successful task completion
- *Source: LOOKING-FORWARD §12*

### N4. Retry-After Header & Jitter
When 50 concurrent gather agents hit 429, they all retry at the same intervals — thundering herd.
- Parse `retry-after` header on 429 responses, use as delay instead of fixed backoff
- Fall back to exponential if header absent
- Add ±30% jitter to all retry delays
- For concurrent gather agents, stagger initial request dispatch
- *Source: LOOKING-FORWARD §11*

### N5. Git Transient State Detection
If an operator is mid-rebase and runs `voidrift develop`, git operations fail with confusing errors.
- Add to develop preflight: check for `.git/MERGE_HEAD`, `.git/REBASE_HEAD`, `.git/CHERRY_PICK_HEAD`
- If any exist, exit with "Git operation in progress — complete it before running develop."
- *Source: LOOKING-FORWARD §13*

### N6. Agent Loop Transition Logging
When debugging a failed command run, the log shows API calls and tool results but not WHY each iteration happened. Was it a tool call? A stall nudge? A retry?
- Add `transition_reason` field to every agent loop iteration log entry
- Values: `tool_call`, `stall_nudge_1`, `stall_nudge_2`, `force_done`, `retry`, `max_tokens_recovery`
- Include in structured log alongside existing dialog logging
- *Source: LOOKING-FORWARD §1*

---

## NEXT — Stop Wasting Resources, Start Seeing What's Happening

These are orchestration inefficiencies and observability gaps. The framework works but spends more tokens and time than necessary, and the operator can't see what agents are doing.

### X1. Context Window Management (Chat)
Chat sessions fill context silently until the API errors. No automatic management, no recovery.
- Auto-compact at 80% utilization, warn at 70%
- Circuit breaker: stop retrying after 3 consecutive compact failures
- Post-compact restoration: re-inject the last 3 accessed framework files and active skills
- Structured compact prompt: require file names, code snippets, pending tasks, current work with quotes (not generic summarization)
- *Source: LOOKING-FORWARD §3*

### X2. Pre-Loaded Context Injection (Develop)
Develop agents spend 1-2 tool call rounds loading `arch/<module>.md` and `spec/<module>.md`. The framework already knows what they need.
- In `_develop_module`, pre-read module arch and spec files
- Inject content in the user message alongside the task text
- Keep `read_framework_file` available for additional context the agent discovers it needs
- Saves ~100 API round-trips over a 50-task session
- *Source: LOOKING-FORWARD §4*

### X3. Surgical Edit Tool
`write_source_file` sends entire file content even for one-line changes. 2000 output tokens for a 10-token change.
- Add `edit_source_file(path, old_str, new_str)` to the develop command tool set
- Include fuzzy matching for whitespace tolerance
- Model chooses between `write_source_file` (new files, full rewrites) and `edit_source_file` (modifications)
- *Source: LOOKING-FORWARD §5*

### X4. Multi-Agent Progress Dashboard
When develop runs 8 concurrent module workers, the operator sees interleaved progress lines. No way to tell which module is stuck.
- Maintain per-module status dict: `{module, task: "3/7", elapsed, context%, status}`
- Display as a Rich table that updates in-place for concurrent mode
- Single progress line with module context for sequential mode
- *Source: LOOKING-FORWARD §16*

### X5. Cost & Cache Tracking
Operators don't know how much a command run costs or whether prompt caching is working.
- `CostTracker` class accumulating per-model token usage (input, output, cache_read, cache_creation)
- Write summary to STATE.md on completion
- Display in command summary: `▸ Cost: ~$0.42 (claude: 150K↓ / 12K↑ · 85% cache hit)`
- Calculate estimated USD for cloud models using published pricing
- *Source: LOOKING-FORWARD §17*

### X6. Prompt Cache Optimization
Gather runs 50+ concurrent agents with the same system prompt. If the prefix varies by one byte, we pay 50x cache_creation cost.
- Verify byte-identical system prompts across concurrent agents within a command
- For Anthropic models, add `cache_control` breakpoints between static layers (1-3) and dynamic layer (4)
- Log `cache_read_input_tokens` vs `cache_creation_input_tokens` to verify efficiency
- *Source: LOOKING-FORWARD §10*

### X7. Structured Error Summaries
When a gather run hits 3 context length errors across 50 files, the operator greps through a 10K-line log.
- Add structured error summary to STATE.md entries: `errors: [{type, count, stage, files}]`
- Enrich API error log entries with model alias, endpoint URL, HTTP status, response body excerpt
- *Source: LOOKING-FORWARD §18*

### X8. Diff Stats Per Task
After a develop session completes 15 tasks, no summary of what changed.
- Track files written per task via `write_source_file` calls
- On task completion, compute diff stats from pre-write snapshots
- Add file manifest to TASKS-DONE.md: `<!-- files: src/api.py(+45/-12), src/models.py(+30/-0) -->`
- *Source: LOOKING-FORWARD §19*

### X9. External Modification Detection
If an operator edits a file while develop is running, the agent's next write silently overwrites their changes.
- Record mtime after each `write_source_file`
- On subsequent writes to the same path, compare mtime
- If changed, return warning in tool result: "File was modified externally since last write."
- *Source: LOOKING-FORWARD §5*

### X10. Concurrent Tool Execution
Serial tool execution doubles latency when an agent reads two files in the same turn.
- Add `is_concurrent_safe` property to tool definitions (reads=True, writes=False)
- Partition tool calls into concurrent/serial batches
- Execute concurrent batches with `asyncio.gather()`
- *Source: LOOKING-FORWARD §2*

---

## LATER — Extend the Framework

These are new capabilities, hardening for edge cases, and infrastructure improvements. The framework works and is observable — these make it better.

### L1. Model Fallback
Optional `fallback` field in `models.yml`. After retries exhausted on 429/503, switch to fallback for remainder of command run. Log the switch.
- *Source: LOOKING-FORWARD §15*

### L2. SSRF Guard for Verify
Add to verify's `http_request` tool: block requests to private IP ranges (10.x, 172.16-31.x, 192.168.x, 169.254.x, 100.64.x). Allow loopback for testing local servers.
- *Source: LOOKING-FORWARD §20*

### L3. Kiro Gateway Credential Refresh
On 401 from Kiro Gateway, re-read the credential source file and retry once before raising.
- *Source: LOOKING-FORWARD §11*

### L4. Git Diff Safety Limits
Cap `git diff HEAD` parsing at 50 files / 1MB. If exceeded, log warning and report "changes detected" without full diff.
- *Source: LOOKING-FORWARD §13*

### L5. Analysis Cache Pruning
Add to `voidrift prune`: scan `.voidrift/analysis/` and remove entries for source files that no longer exist in the project.
- *Source: LOOKING-FORWARD §25*

### L6. Verify Command Timeout Config
Configurable timeout for `run_command`: default 30s, max from `config.yml`.
- *Source: LOOKING-FORWARD §21*

### L7. Lazy Skill Metadata Loading
`list_skills_metadata()` returns names + descriptions from frontmatter without loading full content. Use for `list_skills` tool in chat.
- *Source: LOOKING-FORWARD §8*

### L8. Context Snip for Automated Commands
After a tool result has been processed by the model, replace content with `[result: 2847 lines from src/main.py]`. Keeps conversation flow, frees context.
- *Source: LOOKING-FORWARD §3*

### L9. Task IDs for Stable Identification
Add sequential IDs to task blocks: `- [ ] #1 <summary>`. Match by ID in `complete()` instead of text.
- *Source: LOOKING-FORWARD §14*

### L10. `voidrift doctor`
Self-diagnosis command: `~/.voidrift/` structure, config validity, model endpoint reachability, resource file completeness, disk space.
- *Source: LOOKING-FORWARD §31*

### L11. LSP Diagnostic Feedback Loop
After develop writes a file, optionally start an LSP server and inject diagnostics into agent context. Self-correction loop before moving to next task.
- *Source: LOOKING-FORWARD §29*

### L12. Project Memory System
`.voidrift/memory/` directory where chat writes learned preferences and decisions. Injected into chat system prompts alongside skills.
- *Source: LOOKING-FORWARD §9*

### L13. Chat Session Persistence
Save message history to `.voidrift/chat-sessions/`. Add `/resume` to reload last session. Requires message sanitization on restore.
- *Source: LOOKING-FORWARD §23*

### L14. VCR Test Fixtures
Record/replay API responses for integration tests. Hash request inputs for fixture filenames. CI fails on missing fixtures.
- *Source: LOOKING-FORWARD §26*

### L15. Scheduled Gather (`voidrift watch`)
Monitor git commits, trigger incremental gather on changed files. Lock-based ownership.
- *Source: LOOKING-FORWARD §30*

### L16. Side Question (`/quick`)
One-shot sub-agent sharing parent's prompt cache. No tools, 1-turn limit. Quick answers without polluting main context.
- *Source: LOOKING-FORWARD §32*

### L17. Task Dependencies
Optional `depends:` metadata on task blocks. Orchestrator checks before dispatching. Skip if dependency incomplete.
- *Source: LOOKING-FORWARD §33*

### L18. Concurrent Session Registry
Extend `voidrift status` to show active sessions across terminals via PID file scanning.
- *Source: LOOKING-FORWARD §24*

### L19. Skill Tool Restrictions
`allowed_tools` in skill frontmatter for domain skills that should be read-only.
- *Source: LOOKING-FORWARD §8*

### L20. Chat Output Styles
`--style verbose/terse` flag for chat that adjusts system prompt instructions.
- *Source: LOOKING-FORWARD §28*

### L21. Max Read Bytes Guard
Optional `max_read_bytes` in `config.yml` as secondary guard for files with very long lines.
- *Source: LOOKING-FORWARD §6*
