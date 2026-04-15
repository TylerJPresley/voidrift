# WORK.md — TypeScript Rewrite Execution Plan

Full rewrite of VoidRift CLI from Python to TypeScript/Node with Ink TUI.

**Stack:** TypeScript, Bun, Ink (React for CLI), OpenAI SDK, Vitest, tsup/esbuild
**Spec:** REQUIREMENTS.md, ARCHITECTURE.md, Python implementation as reference
**Cutover:** Python stays until TypeScript passes all ACs

---

## Phase 1: Foundation

**Goal:** Project scaffolding, config loading, model resolution, prompt loading. Everything else depends on this.

### 1.1 Project Scaffolding

Create the project structure with Bun, TypeScript, Vitest, and tsup.

```
package.json          — bun, typescript, vitest, tsup, ink, openai, anthropic, yaml
tsconfig.json         — strict, ESM, target ES2022
vitest.config.ts      — test config
bunfig.toml           — bun settings
src/index.ts          — CLI entry point (stub)
```

**AC:** `bun run build` produces a working binary. `bun test` runs and passes with zero tests.

### 1.2 Config Loading (`src/config.ts`)

Port `cli/src/voidrift_cli/config.py`.

**Functions:**
- `loadConfig(home?: string): Config` — loads `~/.voidrift/config.yml` (or `$VOIDRIFT_HOME/config.yml`)
- `expandEnv(value: string): string` — resolves `${VAR}`, `${VAR:-default}`, `${section.key}`. Strips `\r` and `\n` from resolved values (REQ-CFG-10).
- `getMaxTokens(model: ModelConfig, stage: string): number` — returns `min(stageDefault, model.maxTokens)`. Stage keys use `command.stage` dot notation. Unknown stage falls back to 4096.
- `getBashConfig(command: string): BashConfig` — merges global bash defaults with per-command overrides.
- `getAllowedCommands(): string[]` — returns `config.allowed_commands` glob patterns.

**Types:**
```typescript
interface Config {
  modelsFile: string           // default ~/.worker-cli/models.yml
  activeContainerFile: string  // default ~/.worker-cli/.active-container
  apiKeys: Record<string, string>
  protectedPaths: string[]
  allowedCommands: string[]
  ssrfAllowList: string[]
  git: { maxDiffLines: number, maxDiffFiles: number, maxFileDiffLines: number }
  retention: { project: number, global: number }
  cache: { maxEntries: number, ttlDays: number }
  bash: BashSection
  stageMaxTokens: Record<string, number>
  skills: { synthesisModel: string, repos: string[] }
}

interface BashConfig {
  enabled: boolean
  allowedPatterns: string[]
  timeout: number       // default 120
  maxOutputLines: number // default 500
}
```

**Constants:**
- Default stage max_tokens: `{ "gather.triage": 4096, "gather.analysis": 2000, "gather.consolidation": 8192, "plan.architecture": 32768, "plan.module-arch": 16384, "plan.outline": 8192, "plan.task": 4000, "plan.delta": 4096, "plan.deps": 4096, "plan.readme": 16384, "chat.quick": 2048, "verify.plan": 32768, "verify.execute": 16384 }`
- Fallback for unknown stage: 4096

**Tests:** Config loading, env var expansion (with `\n` stripping), cross-reference expansion, getMaxTokens with model cap, getBashConfig merging.

### 1.3 Model Resolution (`src/models.ts`)

Port `cli/src/voidrift_cli/models.py` and `cli/src/voidrift_cli/agent_protocol.py` (adapter factory only).

**Functions:**
- `resolveModel(alias: string): ModelInterface` — reads models YAML, validates required fields (`base_url`, `api_key`, `model_id`), validates `protocol` is `"openai"` or `"anthropic"`, applies defaults, returns `ModelInterface`.
- `listAliases(): string[]` — returns all configured model aliases.

**Types:**
```typescript
interface ModelConfig {
  alias: string
  baseUrl: string
  apiKey: string
  modelId: string
  protocol: "openai" | "anthropic"  // default "openai"
  provider?: string                  // "anthropic", "gemini", or undefined
  maxTokens: number                  // default 16384
  maxContext?: number
  maxReadLines: number               // default 2000
  maxInputChars: number              // default 0 (unlimited)
  concurrency: number                // default 1
  fallback?: string                  // alias of fallback model
  maxInputTokens?: number            // token budget
  maxOutputTokens?: number           // token budget
}

interface ModelInterface {
  config: ModelConfig
  adapter: ProtocolAdapter  // resolved from protocol field
}
```

**Validation (REQ-MC-5):**
- Missing `base_url`, `api_key`, or `model_id` → `ConfigError` with alias and field name
- Unknown `protocol` value → `ConfigError` with valid values listed
- No field is inferred from other fields — all connection details explicit

**Tests:** Resolve valid model, missing field error, unknown protocol error, defaults inheritance, fallback field, listAliases.

### 1.4 Prompt Loading (`src/prompts.ts`)

Port `cli/src/voidrift_cli/prompts.py`.

**Functions:**
- `loadPrompt(command: string, section: string): string` — reads `resources/prompts/{command}.md`, splits by `## ` headers, returns the section body. Caches in memory per process.
- `loadTemplate(name: string): string` — reads `resources/templates/{name}.md`. Caches.

**Behavior:**
- Files loaded once per process, cached in a `Map<string, Map<string, string>>`.
- Format variables (`{spec_path}`, `{group_name}`) are NOT resolved here — caller uses string replacement.
- Missing section → throw `Error` (not silent).

**Tests:** Load known section, missing section throws, caching (second call doesn't re-read), format variables left as-is.

### 1.5 Skill Resolution (`src/skills.ts`)

Port `cli/src/voidrift_cli/skills.py`.

**Functions:**
- `findSkill(name: string, projectDir?: string): string | null` — 3-layer resolution: project (`.voidrift/skills/`) → domain (`~/.voidrift/domain-skills/`) → north star (`~/.voidrift/resources/skills/`). First match wins. Strips YAML frontmatter. Returns null if not found.
- `listSkills(projectDir?: string): SkillInfo[]` — lists all skills across all layers with source attribution.
- `availableSkillsWithDesc(): Record<string, string>` — returns `{name: description}` from frontmatter across all layers.

**Tests:** Project skill overrides north star, north star fallback, missing skill returns null, frontmatter stripped.

### 1.6 Utilities (`src/utils.ts`)

Port `cli/src/voidrift_cli/utils.ts`.

**Functions:**
- `ensureVoidriftDir(): string` — creates `.voidrift/` if missing, returns path.
- `bootRun(command: string): [string, string]` — creates log file `logs/{command}-{timestamp}.log`, returns `[logPath, runId]`.
- `appendState(cmd, modelAlias, summary, filesCreated?, analyzedFiles?)` — appends to `.voidrift/STATE.md`.
- `checkDiskSpace()` — warns if <100MB free.
- `checkRequirementsExist(): boolean` — checks `.voidrift/REQUIREMENTS.md` exists.
- `undoCommand(command: string): string[]` — reads STATE.md, removes files from last run of that command.

**Tests:** ensureVoidriftDir creates directory, bootRun creates log file, appendState appends correctly.

---

## Phase 2: Tool System

**Goal:** 10 domain tools with schemas, handlers, per-command filtering, path security, command classification.

### 2.1 Tool Registry (`src/tools/registry.ts`)

Port `cli/src/voidrift_cli/tools/registry.py` (domain schemas only).

Define 10 tool schemas in OpenAI function-calling format:

| Tool | Actions | Key Parameters |
|---|---|---|
| `file` | read, write, edit, delete, list | path, content, old_str, new_str, offset, limit, force_write |
| `http` | get, post, put, delete | url, method, headers, body, session_id |
| `shell` | *(single)* | cmd, cwd |
| `browser` | navigate, screenshot, click, get_text | url, selector, path |
| `process` | read_output | handle_id |
| `skill` | get, list | name, topic |
| `memory` | read, write, list, delete | name, content, description, scope |
| `session` | search | query, limit |
| `analyze` | code, document | path |
| `ask` | *(single)* | question, options |

Export `DOMAIN_TOOLS: ToolDef[]` concatenating all schemas.

Concurrent-safe metadata: `skill`, `memory`, `session`, `analyze` carry `concurrent_safe: true`. `file` and `http` are action-dependent (handled in agent loop).

**Tests:** Schema count is 10, each has valid structure, concurrent_safe flags correct.

### 2.2 WriteContext (`src/tools/filesystem.ts`)

Port `cli/src/voidrift_cli/tools/filesystem.py`. This is the largest tool module.

**Class: `WriteContext`**

Constructor: `new WriteContext(projectDir: string, maxReadLines?: number, maxReadBytes?: number)`

**Methods:**

`readSourceFile(path, offset?, limit?): string`
- Resolves path relative to projectDir
- Sandbox check: `resolve().startsWith(projectDir)` — blocks traversal
- Symlink check: resolve and re-check
- Pagination: if file exceeds `maxReadLines` and no explicit limit, return first `maxReadLines` lines with WARNING header containing total count and next offset
- Byte guard (REQ-FSZ-5): if UTF-8 result exceeds `maxReadBytes` (default 524288), truncate at valid boundary with marker
- Returns file content as string

`writeSourceFile(path, content, forceWrite?): string`
- Sandbox check + protected paths check
- Size guard (REQ-FSZ-2): reject if content exceeds `maxReadLines` lines
- Mtime check (REQ-D-19): if file was previously written this task and mtime differs, refuse unless `forceWrite=true`
- Snapshot before write (REQ-D-15): record original content (or null if new file)
- Create parent dirs, write file
- Increment write counter, record in session files, record mtime
- Return `"Wrote N bytes to path"`

`editSourceFile(path, oldStr, newStr, forceWrite?): string`
- Sandbox check
- Read file, find exact match of oldStr
- If multiple matches → error with count
- If no match → try whitespace-normalized match (strip leading/trailing per line)
- If still no match → error with first 3 lines of oldStr
- Replace, write back, increment write counter
- Return `"Edited path — replaced N chars with M chars"`

`deleteSourceFile(path): string`
- Sandbox check + protected paths check
- Snapshot before delete
- Delete file
- Return `"Deleted path"`

`readFrameworkFile(path, offset?, limit?): string`
- Same as readSourceFile but validates path starts with `.voidrift/`

`writeFrameworkFile(path, content): string`
- Same as writeSourceFile but validates path starts with `.voidrift/`
- No mtime check, no protected paths check

`listProjectArtifacts(): string`
- Lists `.voidrift/` directory contents recursively

**State tracking:**
- `_sourceWriteCount: number` — incremented on write/edit/delete
- `_writtenThisRun: Set<string>` — paths written this session
- `_sessionFiles: string[]` — all paths written (for STATE.md)
- `_mtimeRegistry: Map<string, number>` — mtime after each write
- `_readFiles: string[]` — paths read (for compact restoration)

**Snapshot system (thread-local in Python → per-instance in TS):**
- `_snapshots: Map<string, string | null>` — original content before first write
- `setSnapshots()`, `getSnapshots()`, `clearSnapshots()`
- `computeDiffStats(): DiffStat[]` — compare snapshots to current files
- `rollbackSnapshots()` — restore all files to pre-task state

**Constants:**
- Default `maxReadLines`: 2000
- Default `maxReadBytes`: 524288 (512KB)
- Binary extensions for git diff exclusion: `.png`, `.jpg`, `.jpeg`, `.gif`, `.ico`, `.pdf`, `.zip`, `.tar`, `.gz`, `.pyc`, `.so`, `.exe`, `.db`, `.sqlite`, `.woff`, `.woff2`, `.ttf`, `.eot`

**Tests:** Port all of `test_tools.py`, `test_filesystem.py`, `test_mtime.py`, `test_snapshot.py`. Key cases: sandbox traversal blocked, protected paths blocked, pagination with WARNING header, byte guard truncation, mtime conflict detection, edit with multiple matches error, whitespace-normalized edit fallback, snapshot rollback restores files, diff stats computation.

### 2.3 Shell Execution (`src/tools/shell.ts`)

Port `cli/src/voidrift_cli/tools/bash.py`.

**Functions:**
- `createRunCommand(config: BashConfig, globalAllowed: string[]): (cmd: string, cwd?: string) => string`
  - Returns a handler function
  - If `!config.enabled` → return error
  - If `config.allowedPatterns` non-empty → check cmd matches at least one glob pattern
  - Call `classifyCommand(cmd, globalAllowed)` → if `block` → return error
  - Execute via `child_process.execSync` or `Bun.spawn` with timeout
  - Truncate output beyond `config.maxOutputLines`
  - Return JSON `{ stdout, stderr, exit_code }`

**Tests:** Enabled/disabled, allowed patterns, blocked commands, output truncation, timeout.

### 2.4 Security (`src/tools/security.ts`)

Port `cli/src/voidrift_cli/tools/security.py`.

**Functions:**
- `classifyCommand(command: string, allowedCommands: string[]): { level: "safe" | "warn" | "block", reasons: string[] }`

**Block patterns:**
- `rm -rf /` or `rm -rf /*` — destructive recursive delete at root
- `:(){ :|:& };:` — fork bomb
- `dd if=/dev/zero` — disk overwrite
- `mkfs` — filesystem format
- `curl|bash`, `wget|sh` — remote code execution
- Writes to `/etc/`, `/boot/`, `/sys/`, `/proc/`

**Warn patterns:**
- `rm -rf` (non-root), `rm -r --force`
- `git push --force`, `git reset --hard`
- `sudo`
- `chmod -R`

**Allowed commands override:** if cmd matches any glob in `allowedCommands` → `safe`.

**Tests:** Port `test_security.py`. Each block/warn pattern tested.

### 2.5 SSRF Guard (`src/tools/ssrf.ts`)

Port `cli/src/voidrift_cli/tools/ssrf_guard.py`.

**Functions:**
- `checkSsrf(url: string, allowList: string[]): void` — throws `SSRFError` if blocked.

**Blocked ranges:**
- Link-local: `169.254.0.0/16`
- RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`
- CGNAT: `100.64.0.0/10`
- IPv6 unique-local: `fc00::/7`
- IPv6 link-local: `fe80::/10`
- IPv6 loopback: `::1/128`

**Allowed:**
- Loopback `127.0.0.0/8` — for local dev servers
- Any hostname/CIDR in `ssrfAllowList` config

**Behavior:** Resolves hostname via DNS before checking. DNS failure → `SSRFError`.

**Tests:** Port `test_ssrf.py`. Each blocked range, loopback allowed, allowlist override, DNS failure.

### 2.6 HTTP Client (`src/tools/http.ts`)

Port `cli/src/voidrift_cli/tools/http_client.py` and `cli/src/voidrift_cli/tools/web.py`.

**HTTP request handler:**
- `httpRequest(method, url, headers?, body?, sessionId?): string`
- Per-session cookie jar and auth header persistence
- `clearSessions()` — discard all sessions

**Web fetch handler (chat only):**
- `makeWebFetchHandler(mc, log, webCache): handler`
- SSRF check before fetch
- Operator confirmation via `confirmFn`
- Fetch URL, strip HTML, summarize via sub-agent (≤300 words)
- Cache summary by URL for session duration
- `set_confirm` method for swapping confirm callback

**Tests:** Session persistence, SSRF blocking, cache hit skips HTTP, operator denial.

### 2.7 Process Manager (`src/tools/process.ts`)

Port `cli/src/voidrift_cli/tools/process_manager.py`.

**Functions:**
- `startProcess(cmd, env?, cwd?): string` — returns JSON `{ handle_id, pid }`
- `stopProcess(handleId): string`
- `waitForReady(handleId, strategy, target, timeout): string` — strategies: `http`, `port`, `log_pattern`
- `readProcessOutput(handleId): string` — returns up to 500 buffered lines (newest kept on overflow)
- `stopAll()` — terminate all managed processes

**State:** Module-level registry `Map<string, ProcessHandle>`.

**Tests:** Start/stop lifecycle, readOutput buffering, waitForReady strategies, stopAll cleanup.

### 2.8 Browser (`src/tools/browser.ts`)

Port `cli/src/voidrift_cli/tools/browser.py`. Playwright-based.

**Functions:**
- `browserNavigate(url, sessionId?): string`
- `browserScreenshot(path?, sessionId?): string`
- `browserClick(selector, sessionId?): string`
- `browserGetText(selector?, sessionId?): string`
- `closeAllSessions()`, `closeSession(sessionId)`

**Tests:** Basic navigation, screenshot saves file, session isolation.

### 2.9 Tool Builder (`src/tools/builder.ts`)

Port `cli/src/voidrift_cli/tool_builder.py`.

**Functions:**
- `buildLocalTools(cmd?, projectDir?, opts?): [ToolDef[], Record<string, Handler>]`
- `filterTools(tools, allowedNames): ToolDef[]`
- `narrowSchemaActions(schema, allowedActions): ToolDef`
- `validateSchemaHandlerContract(tools, handlers): void`
- `buildToolGuidelines(tools): string`

**Per-command tool sets (from AGENT_TOOLS constants):**

| Command | Tools |
|---|---|
| gather | file (read, list), analyze |
| plan | file (read, write, edit, list) |
| develop | file (all), shell |
| chat | file, http, shell, skill, memory, session, analyze, ask |
| verify-plan | file (read, list) |
| verify-execute | file (read, write, list), http (all), shell, browser, process |

**Permission gating (chat only):** `makeWriteGuard`, `makeRunGuard`, `makeReadOutsideGuard` — wrap handlers with operator confirmation.

**Tests:** Port `test_tool_builder.py`. Per-command filtering, action narrowing, contract validation, permission guards.

---

## Phase 3: Agent Loop

**Goal:** The core agent loop — the hardest phase. API calls, tool dispatch, streaming, retry, stall detection, think-tag stripping, hooks, deduplication, concurrent batching, protocol adapters.

### 3.1 Protocol Adapters (`src/agent/protocol.ts`)

Port `cli/src/voidrift_cli/agent_protocol.py`.

**Interface: `ProtocolAdapter`**
```typescript
interface ProtocolAdapter {
  getClient(config: ModelConfig): any
  buildRequest(kwargs: Record<string, any>, provider?: string): Record<string, any>
  parseResponse(raw: any): { text: string, toolCalls: ToolCall[], finishReason: string, usage: Usage }
  iterStream(stream: AsyncIterable, logFn: (msg: string) => void): AsyncGenerator<StreamChunk>
}
```

**OpenAIAdapter:**
- `getClient`: creates OpenAI client with timeouts (connect: 30s, read: 600s, write: 60s, pool: 30s)
- `buildRequest`: passes through kwargs. Adds `stream_options: { include_usage: true }` only for known providers (`openai`, `anthropic`, `gemini`). Generic endpoints get no stream_options (REQ-ARCH-20).
- `parseResponse`: extracts text, tool_calls, finish_reason, usage from OpenAI response format
- `iterStream`: yields text tokens, accumulates tool calls, extracts usage from final chunk

**AnthropicAdapter:**
- `getClient`: creates Anthropic client with 600s timeout
- `buildRequest`: extracts system messages as top-level `system` parameter. Converts tool `parameters` → `input_schema`. Maps `tool_choice: "required"` → `{ type: "any" }`. Batches consecutive tool-result messages into single user message with `tool_result` content blocks. Adds `cache_control: { type: "ephemeral" }` to system messages (REQ-ARCH-19).
- `parseResponse`: maps `stop_reason` (`end_turn` → `stop`, `tool_use` → `tool_calls`, `max_tokens` → `length`). Extracts thinking blocks → logged as `[THINKING]`, excluded from text.
- `iterStream`: handles `content_block_start`, `content_block_delta`, `content_block_stop` events. Accumulates tool call JSON across `input_json_delta` events. Thinking blocks logged and excluded.

**Tests:** OpenAI request building (with/without stream_options by provider), Anthropic system extraction, tool schema conversion, tool_result batching, finish reason mapping, thinking block exclusion.

### 3.2 Agent Loop Core (`src/agent/loop.ts`)

Port `cli/src/voidrift_cli/agent.py`. This is ~1200 lines in Python.

**Class: `AgentLoop`**

Constructor fields:
```typescript
interface AgentLoopOptions {
  model: ModelInterface
  systemPrompt: string
  tools: ToolDef[]
  toolHandlers: Record<string, Handler>
  stream: boolean           // true for chat/gather, false for plan/develop/verify
  maxTokens: number
  logPath?: string
  showSpinner: boolean
  toolChoice?: "required" | "auto"  // default: "required" for automated, "auto" for chat
  tokenBudget?: TokenBudget
  maxTurns?: number         // hook: stop after N tool rounds
  stopCheck?: (state: LoopState) => string | null
  transformContext?: (messages: Message[]) => Message[]
  beforeToolCall?: (name: string, args: string) => string | null
  afterToolCall?: (name: string, result: string) => string
  getSteeringMessages?: (state: LoopState) => Message[]
  getFollowUpMessages?: (state: LoopState) => Message[]
}
```

**Callbacks (set by caller):**
- `onToken?: (token: string) => void` — streaming token callback
- `onProgress?: (data: ProgressData) => void` — token telemetry
- `onToolCall?: (name: string, args: string) => void` — tool call display
- `onToolResult?: (name: string, result: string) => void` — tool result notification
- `onComplete?: (stats: Stats) => void` — completion stats
- `onPayload?: (payload: any) => void` — raw API payload inspection

**Main method: `send(userMessage: string): Promise<string>`**

The loop:
1. Append user message to history
2. While tools present:
   a. Budget check (REQ-ARCH-13)
   b. Apply `transformContext` hook if set
   c. Build API request via adapter
   d. Call API with retry (see 3.3)
   e. Handle context-length errors → reactive compaction (see 3.4)
   f. Handle truncation (`finish_reason === "length"`) → max-tokens recovery (see below)
   g. Strip think tags from response text
   h. If text-only response (no tool calls):
      - Check follow-up hooks/queue → if messages, append and continue
      - Otherwise return text
   i. Stall detection (see 3.5)
   j. Deduplicate identical tool calls (see 3.6)
   k. Partition into concurrent/serial batches (see 3.6)
   l. Execute tool calls with normalization (see 3.7)
   m. Apply steering hooks/queue
   n. Check abort/budget/maxTurns/stopCheck
   o. Log `[ITERATION]`
3. Log `[LOOP_EXIT]` with cumulative token totals
4. Close client in finally block (REQ-ARCH-21)

**Max-tokens recovery (REQ-ARCH-11):**
- Text-only truncation: inject continuation prompt, retry, concatenate. Up to 2 attempts.
- Tool-call truncation: discard all tool calls, log `[MAX_TOKENS_TOOL_DISCARD]`, inject re-emit prompt.

**Think-tag stripping (REQ-ARCH-8):**
- Remove `<think>...</think>` blocks from response text
- Handle orphaned `</think>` (no opening tag) — treat preceding content as thinking
- Streaming: buffer up to 200 chars waiting for `</think>`. Flush as real content if 200 chars pass without it.
- Log stripped content as `[THINKING]`

**Thread-safe queues:**
- `steer(messages)` — external injection of steering messages (drained in bulk)
- `followUp(messages, drain?)` — external injection of follow-up messages (drained one at a time)

**LoopState (passed to hooks):**
```typescript
interface LoopState {
  messages: Message[]
  turnCount: number
  inputTokensTotal: number
  outputTokensTotal: number
  toolsCalledThisTurn: string[]
}
```

### 3.3 Retry with Backoff (`src/agent/loop.ts`)

**Constants:**
- `RETRY_MAX = 3`
- `RETRY_BASE = 1.0` seconds
- `RETRY_MULT = 2.0`
- `RETRY_CAP = 30.0` seconds
- Jitter: `delay * (0.7 + Math.random() * 0.6)` (±30%)

**Retryable:** Connection errors, HTTP 5xx, HTTP 429.
**Non-retryable:** HTTP 4xx (except 429), auth errors.
**429 with Retry-After:** Use header value (capped at 30s) instead of exponential backoff.
**Context-length errors:** Handled by reactive compaction, not retry.
**Abort-aware:** Check abort flag before each retry sleep.

**Fallback (REQ-MC-4):** When retries exhausted on 429/5xx and model has `fallback` field → resolve fallback model, close current client, retry with fallback. Max 1 level.

**Logging:** Each retry logged as `[RETRY attempt=N delay=Xs reason=REASON]`.

### 3.4 Context Management (`src/agent/context.ts`)

Port `cli/src/voidrift_cli/agent_context.py`.

**Functions:**

`snipOldToolResults(messages, maxAgeTurns = 2): Message[]`
- Returns new array (no mutation)
- Eligible: `file` tool with `action === "read"`, at least `maxAgeTurns` assistant responses after it, content > 500 chars
- Replace with placeholder: `"[snipped — N lines, use file(action='read') to re-read]"`
- `maxAgeTurns = 0` disables

`reactiveCompact(messages, client, model, logFn): Message[]`
- Triggered on context-length API errors
- Summarize oldest messages (excluding system prompt and last 4) via single API call (no tools, max_tokens 1024)
- Replace summarized messages with single assistant message containing summary
- Up to 2 attempts per agent instance
- Log `[REACTIVE_COMPACT attempt=N freed=M]`

`trimMessages(messages): Message[]`
- Remove malformed entries (empty content, orphaned tool calls without results)

### 3.5 Stall Detection (`src/agent/stall.ts`)

**Signature function:** `tcSig(toolCall): string`
- For `file` with write/edit/delete action: `"file:{path}"` (path-only, ignores content)
- For all others: `"{name}:{fullArgs}"`

**Detection:** Compare current turn's signature set against previous turn's. If any overlap → stall.

**Recovery:**
- Nudge 1-2: Inject stall-nudge message (from `resources/prompts/system.md` STALL-NUDGE section). Tools remain available.
- Nudge 3: Strip tools to only write tools (`file` with write/edit actions) + `done`. Force final call.

**Logging:** `[STALL sig=X nudge=N]`

### 3.6 Tool Execution (`src/agent/loop.ts`)

**Deduplication (REQ-ARCH-16):**
- Before execution, group tool calls by `(name, args)` signature
- Execute each unique signature once
- Map result to all tool_call IDs sharing that signature
- Log `[DEDUP] N identical calls to <name> reduced to 1`

**Batching (REQ-ARCH-16):**
- Partition calls into batches: consecutive concurrent-safe calls form one batch, others are serial
- Concurrent-safe: `file` with `action in ["read", "list"]`, `http` with `action === "get"`, tools with `concurrent_safe: true` in schema
- Concurrent batch: `Promise.all` (max 10 concurrent)
- Serial batch: one at a time
- Results returned in original tool call order

### 3.7 Argument Normalization (`src/agent/loop.ts`)

**For `file` tool:**
- Strip leading `/` and `./` from `path` argument
- Convert array `content` to newline-joined string

**Logging:** `[TOOL_NORMALIZE tool=NAME field=FIELD raw=X normalized=Y]`

### 3.8 Token Budget (`src/agent/budget.ts`)

Port `cli/src/voidrift_cli/token_budget.py`.

```typescript
class TokenBudget {
  constructor(maxInputTokens?: number, maxOutputTokens?: number)
  record(inputTokens: number, outputTokens: number): void
  checkBefore(): void  // throws BudgetExhaustedError if exceeded
  summary(): string
}
```

Accumulated unconditionally after every API response. Provider returning no usage → accumulate 0.

### 3.9 Error Tracker (`src/agent/errors.ts`)

Port `cli/src/voidrift_cli/error_tracker.py`.

```typescript
class ErrorTracker {
  record(category: string, errorType: string, message: string, taskId?: string, recoverable?: boolean): void
  hasErrors(): boolean
  summaryByCategory(): Record<string, number>
  toStateDict(): object  // for STATE.md
  writeJsonl(logPath: string): void
}
```

Categories: `api`, `tool`, `filesystem`, `parse`, `timeout`, `budget`, `context`.

### 3.10 Abort Mechanism (`src/agent/abort.ts`)

Port `cli/src/voidrift_cli/_agent_abort.py`.

```typescript
let abortRequested = false
const activeLoops = new Map<number, AgentLoop>()

function requestAbort(): void    // set flag + close all active clients
function clearAbort(): void
function isAbortRequested(): boolean
function registerLoop(loop: AgentLoop): void
function unregisterLoop(loop: AgentLoop): void
function abortAwareSleep(seconds: number): Promise<void>  // 250ms granularity
```

**Tests:** Port `test_agent.py`. Key cases: stall detection triggers nudge, dedup reduces identical calls, retry with backoff, max-tokens recovery, reactive compaction, think-tag stripping (with orphaned tags), streaming buffer flush at 200 chars, tool normalization, budget enforcement, abort interrupts sleep.

---

## Phase 4: Gather + Plan Commands

**Goal:** First two pipeline commands working end-to-end.

### 4.1 Gather Command (`src/commands/gather.ts`)

Port `cli/src/voidrift_cli/commands/gather.py` and `_gather_pipeline.py`.

**Entry:** `runGather(model, fromPath?, ideaId?, overwrite?, tokenBudget?): number`

**Four-stage pipeline (REQ-G-8):**

**Stage 1 — Triage:** Agent receives file tree, returns JSON categorizing files into: `source`, `tests`, `config`, `infrastructure`, `documentation`, `assets`. Validation pass prunes bad entries. Post-triage: display files grouped by category (REQ-G-23), prompt for uncategorized assignment (REQ-G-24), coverage check (REQ-G-22).

**Stage 2 — Context Build:** One agent per non-source category. Reads all files in category, returns ≤10 bullet summary. Summaries stored in memory, written to `analysis/context-{category}.md`.

**Stage 3 — Source Analysis:** One agent per source file, concurrent. File content injected directly into user message (zero tools for normal flow, REQ-G-19). Returns requirements-focused analysis. Large files chunked with 200-char overlap (REQ-G-13). Cached by SHA-256 content hash (REQ-CTX-5).

**Stage 4 — Consolidation:** Single agent receives all analyses + context summaries. Returns complete REQUIREMENTS.md content. Existing requirements passed as context for merge (update mode).

**Key functions to port:**
- `buildFileTree(dir, maxFiles = 500)` — respects .gitignore, excludes dot-paths
- `runTriage(model, log, analystRole, fileTree, budget, extra)` → `Record<string, string[]>`
- `runContextBuild(model, categories, readFn, log, ...)` → `Record<string, string>`
- `runSourceAnalysis(model, sourceFiles, fromPath, log, contextBlock, ...)` → `Record<string, string>`
- `runConsolidation(model, sourceReqs, contextSummaries, existingReqs, log, ...)` → `string`
- `assignUncategorized(files, categories, fileCategory, promptFn)` — pure logic, I/O via callback
- `makeCliPromptFn()` — CLI adapter with apply-to-all state

**Triage JSON parsing (REQ-G-20):** Strip ASCII control chars, repair truncated JSON by closing unmatched brackets.

**Constants:**
- `CATEGORIES = ["source", "tests", "config", "infrastructure", "documentation", "assets"]`
- `NON_SOURCE = ["tests", "config", "infrastructure", "documentation", "assets"]`
- Max files in tree: 500
- Chunk overlap: 200 chars

**Tests:** Port `test_gather.py`. Triage parsing, cache hit/miss, chunking with overlap clamping, uncategorized assignment with mock promptFn, file tree respects gitignore.

### 4.2 Plan Command (`src/commands/plan.ts`)

Port `cli/src/voidrift_cli/commands/plan.py` and `_plan_pipeline.py`.

**Entry:** `runPlan(model, overwrite?, ideaId?): number`

**Six-stage pipeline (REQ-P-1):**

**Stage 1 — Architecture:** One agent → `ARCHITECTURE.md`. System-level only: modules, contracts, constraints. YAML frontmatter with `startup_command`, `test_bootstrap`, `modules` list.

**Stage 2 — Module arch:** One agent per module → `arch/{module}.md`. Component internals, data models, interfaces. ≤4KB, signatures only.

**Stage 3 — Task outlines:** One agent per module → `tasks/outline/{module}.md`. YAML frontmatter with task list (id, title, files, depends). Brief descriptions only.

**Stage 4 — Dependency resolution:** One agent (multi-module only) → `tasks/outline/deps.yml`. Cross-module depends.

**Stage 5 — Task files:** One agent per task → `tasks/active/TASK-{id}.md`. Full task with frontmatter, user story, context, ACs, implementation notes. Skill tags validated against available skills (word-overlap resolution, REQ-P-9).

**Stage 6 — README:** One agent → `README.md`.

**Delta analysis (REQ-P-11):** When artifacts exist and not overwrite, scan source tree (filenames only) against requirements to identify implemented vs unimplemented.

**Key functions to port:**
- `dispatchAgent(model, tools, handlers, log, systemPrompt, userMessage, retryMessage, checkFn, stageLabel, stageKey, quiet?)` → `boolean`
- `extractModules(archText, dir)` → `string[]`
- `archSummary(archText, maxChars = 4000)` → `string`
- `parseOutlineTasks(outlinePath)` → `[string, TaskEntry[]]`
- `buildTaskFiles(dir, requirements, archText, ideaId?)` → `number`
- `checkReqCoverage(dir, requirements)` — warns on uncovered REQ IDs
- `availableSkillsWithDesc()` → `Record<string, string>`
- `resolveSkill(taskSkills, validSkills)` — word-overlap matching

**Post-processing:** Build `tasks/manifest.yml` from task files. Clean up `tasks/outline/` intermediates.

**Tests:** Port `test_plan.py`. Module extraction, outline parsing, skill tag resolution, req coverage check, delta analysis.

---

## Phase 5: Develop + Verify + Deploy Commands

**Goal:** Remaining pipeline commands.

### 5.1 Manifest Manager (`src/manifest.ts`)

Port `cli/src/voidrift_cli/manifest.py`.

**Class: `ManifestManager`**

```typescript
class ManifestManager {
  constructor(projectDir?: string)
  exists(): boolean
  load(): void
  save(): void
  tasks(): Record<number, TaskEntry>
  getTask(id: number): TaskEntry | null
  setStatus(id: number, status: TaskStatus): void
  hasWork(): boolean
  dispatchable(): number[]  // planned + all deps met
  summary(): Record<TaskStatus, number>
  readIdea(id: number): string | null
  ideaPath(id: number): string
}
```

**Task statuses:** `planned`, `in-progress`, `implemented`, `verified`, `failed`, `blocked`

**Transitions (REQ-TM-2):** planned→in-progress, in-progress→implemented, implemented→verified, implemented→failed, failed→in-progress, planned→blocked, blocked→planned.

**Dependency resolution (REQ-TM-3):** Dispatchable when `status === "planned"` AND all deps are `implemented` or `verified`. Failed task → transitively block dependents.

**History log:** Append one-line events to `tasks/history.log`.

**Archival (REQ-TM-6):** Verified tasks move from `active/` to `archived/`.

**Tests:** Port `test_manifest.py` (if exists) or write new. Status transitions, dependency resolution, transitive blocking.

### 5.2 Develop Command (`src/commands/develop.ts`)

Port `cli/src/voidrift_cli/commands/develop.py` and `_develop_pipeline.py`.

**Entry:** `runDevelop(worker, architect?, tokenBudget?): number`

**Dispatch loop (REQ-D-4, REQ-D-10):**
1. Find dispatchable tasks (planned + deps met)
2. Dispatch concurrently up to `model.concurrency`
3. Each task: fresh AgentLoop with task file as prompt
4. Verify writes occurred (REQ-D-5)
5. No writes → retry once → escalate to architect → mark blocked after 5 escalations

**Per-task agent setup:**
- System prompt: system context + skill content + develop TASK prompt + git context
- Tools: `file` (all actions) + `shell`
- Hooks:
  - `beforeToolCall`: done guard — reject `done` with zero writes
  - `getFollowUpMessages`: write nudge — inject "call file(action='write')" up to 2 times
  - `getSteeringMessages`: self-review — after first write, inject AC re-check instruction (once per task)
  - `transformContext`: snip old tool results

**Escalation (REQ-D-6):** Consult architect model with question + task text + requirements + architecture. Inject response into agent history.

**Task atomicity (REQ-D-15):** Snapshot before first write. Rollback all files on failure.

**Post-task (REQ-D-21):** Compare `files:` frontmatter against actual writes. Warn on missing files.

**Diff stats (REQ-D-17):** Compute per-file added/removed from snapshots.

**Lock file (REQ-D-3):** `.voidrift/.develop.lock` with PID + timestamp. Check for live PID.

**Orphaned recovery (REQ-D-16):** Reset in-progress tasks on startup.

**Git context (REQ-D-18):** Capture once per run: branch, last 5 commits, uncommitted changes (capped at 20).

**Git checkpoints (REQ-D-20):** `git stash create` before each task. Persist to `checkpoints.jsonl`.

**Interrupt handling (REQ-D-13):** Abort flag + close HTTP clients. Second Ctrl+C raises immediately.

**Tests:** Port `test_develop.py`. Done guard, write nudge, escalation, snapshot rollback, diff stats.

### 5.3 Verify Command (`src/commands/verify.ts`)

Port `cli/src/voidrift_cli/commands/verify.py` and `_verify_pipeline.py`.

**Entry:** `runVerify(worker): number`

**Stages:**

**Stage 0 — Doc verification (REQ-VF-17):** Agent reads README.md, ARCHITECTURE.md, and source code. Checks for mismatches. Writes bug reports to `bugs/DOC-N.md`.

**Stage 1 — Plan agent (REQ-VF-3):** Reads all project docs. Writes `VERIFY-PLAN.md` with self-contained test cases. Each ITEM embeds all context a sub-agent needs.

**Bootstrap:** Run `test_bootstrap` command if configured in ARCHITECTURE.md.

**Start product:** `startProcess(startup_command)` + `waitForReady`.

**Stage 2 — Concurrent sub-agents (REQ-VF-15):** One per testable ITEM. Tools: file (read, write, list), http (all), shell, browser, process. On failure: write bug report to `bugs/ITEM-N.md`.

**Stage 3 — Report (REQ-VF-5):** Write `VERIFY.md` with summary table, per-item results, verdict.

**Cleanup:** `stopAll()`, `clearSessions()`, `closeAllSessions()` in finally block.

**Tests:** Port `test_verify.py`, `test_verify_tools.py`.

### 5.4 Deploy Command (`src/commands/deploy.ts`)

Port `cli/src/voidrift_cli/commands/deploy.py`.

**Entry:** `runDeploy(worker, architect?): number`

**Steps:**
1. Determine last release tag from git
2. Read history.log since last tag
3. Agent classifies version bump (major/minor/patch)
4. Operator confirms or overrides
5. Generate changelog entry, append to CHANGELOG.md
6. Create annotated git tag `v{version}`
7. Optional IaC generation if ARCHITECTURE.md has infrastructure sections
8. Optional post_deploy hook

**Tests:** Version classification, changelog generation.

### 5.5 Git Utilities (`src/git.ts`)

Port `cli/src/voidrift_cli/git_context.py`, `git_utils.py`, `git_checkpoint.py`.

**Functions:**
- `captureGitSnapshot(dir): GitSnapshot | null` — branch, last 5 commits, changed files (capped at 20). 5s timeout. Non-git dirs return null.
- `getBoundedDiff(dir, config): DiffResult` — max total lines (2000), max files (50), max per-file (400). Binary files excluded. Truncation markers.
- `GitCheckpointManager` — `git stash create` before tasks, persist to JSONL, restore via `git checkout <ref> -- .`

**Tests:** Snapshot capture, diff truncation, checkpoint create/restore.

---

## Phase 6: Ink TUI

**Goal:** Full-screen chat TUI with Ink components. Can start in parallel with Phase 4.

### 6.1 App Layout (`src/tui/App.tsx`)

Root Ink component. Vertical layout (top to bottom):
- Conversation area (fills remaining space, scrollable)
- Separator (1-line dim rule)
- Footer (1-line persistent status bar)
- Spacer (1 empty line)
- Input (1-line text input)

Ink handles terminal state — no manual raw mode toggling. Text selection works natively.

### 6.2 Conversation Area (`src/tui/Conversation.tsx`)

Scrollable message list. Each message has a role-colored left bar:
- **Operator:** teal `┃` (`#4ec9b0`), bold white text. Preceded by dim rule.
- **Model:** blue `┃` (`#6a7ec8`), light gray text. Streaming cursor `█` while tokens arriving.
- **Tool calls:** colored bar per action type + human-friendly name + detail.
- **System:** dim italic text.
- **Stats:** dim gray, format: `(elapsed · tkns: ↓ Nk - ↑ Nk · ctx N%)`

PgUp/PgDn for scrolling. Auto-scroll to bottom on new messages.

### 6.3 Tool Call Display (`src/tui/ToolCall.tsx`)

Human-friendly names with colored left bars:
- Read/List → blue `┃` + "Read" + path (line range)
- Write → green `┃` + "Write" + path
- Edit → cyan `┃` + "Edit" + path
- Delete → red `┃` + "Delete" + path
- Shell → yellow `┃` + "Shell" + command
- HTTP → teal `┃` + "HTTP GET/POST" + URL
- Other → dim `┃` + tool name

Inline diff after write/edit: summary line (`added 3 lines, removed 1 at L22`) + colored diff (green additions, red deletions, dim context).

### 6.4 Footer (`src/tui/Footer.tsx`)

Single line, persistent:
- Left: `voidrift · {model} · ◎ {ctx%} · {mode}`
- Right: `{cwd} · ({branch})`

Context % color: teal ≤60%, yellow >60-80%, red >80%.
Mode: empty by default, shows `/gather`, `/plan`, etc. during command execution.

### 6.5 Input (`src/tui/Input.tsx`)

Single-line text input:
- Empty + idle: placeholder `ask a question or describe a task ↵`
- Empty + busy (no command): placeholder `voidrift is working · type to queue a message`
- Empty + busy (command running): placeholder `command running · /ask for questions`
- Enter submits. Backslash+Enter for multiline.

Input locking: during command execution (`state.mode` set), only `/ask` accepted.

### 6.6 Header (`src/tui/Header.tsx`)

ASCII block art in steel blue (`#5c8cc8`). Tagline in dim italic. Welcome callout box with model name, capabilities, command reference. Scrolls with conversation.

### 6.7 Thinking Indicator (`src/tui/Thinking.tsx`)

Braille spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`) in yellow with "thinking..." text. Shows immediately on submit. Resumes during mid-stream pauses (>1.5s without tokens).

### 6.8 Markdown Rendering

Use `marked` or `marked-terminal` for markdown → ANSI conversion. Progressive rendering during streaming — re-render when text length changes. Plain text fallback when no markdown markers detected.

**Tests:** Component tests with `ink-testing-library`. Render each component, verify output contains expected elements.

---

## Phase 7: Chat Session + Memory + Slash Commands

**Goal:** Session persistence, memory, idea flow, slash commands wired to pipeline commands.

### 7.1 Session Persistence (`src/session.ts`)

Port `cli/src/voidrift_cli/session.py`.

**Class: `ChatSession`**

JSONL format. Each entry: `{ id, parentId, type, timestamp }`.
- Types: `message`, `compaction`, `summary`
- Append-only. Compaction entries act as reconstruction boundaries.
- On load: reconstruct from last compaction boundary forward.
- Sanitize: strip empty content, orphaned tool calls.

**Functions:**
- `loadOrCreate(dir): ChatSession`
- `append(entry): void`
- `appendCompaction(summary): void`
- `clear(): void`
- `searchEntries(query, limit = 5): SearchResult[]` — case-insensitive substring, all entries including pre-compaction, newest first, content capped at 2000 chars.

**Session gap marker (REQ-U-23):** If >30 minutes since last message, inject gap marker on resume.

**Tests:** Port `test_session.py`. Append, restore from compaction boundary, search, gap marker.

### 7.2 Memory (`src/memory.ts`)

Port `cli/src/voidrift_cli/memory.py`.

**Class: `MemoryManager`**

Two layers: project (`.voidrift/memory/`) and global (`~/.voidrift/memory/`).
Each entry: markdown file with YAML frontmatter (`name`, `description`).
Index file `MEMORY.md` in each layer.

**Methods:**
- `read(name): string | null`
- `write(name, content, description): void`
- `list(): MemoryEntry[]`
- `delete(name): void`

Project entries override global with same name.

**Tests:** Port `test_memory.py`. Write/read, project overrides global, delete, list.

### 7.3 Chat Command (`src/commands/chat.ts`)

Port `cli/src/voidrift_cli/commands/chat.py`.

**Entry:** `runChat(model, options): void`

**Options:** `--doc`, `--style` (verbose/terse/raw), `--bare`, `--system-prompt`

**System prompt construction (REQ-RES-7):**
1. System context (`system.md` CONTEXT section)
2. Skill (ANALYSIS-REQS for chat)
3. Chat prompt (`chat.md` SYSTEM section)
4. Injected context (--doc content, memory index, git snapshot)

**Bare mode (REQ-U-17):** Only system context. `--system-prompt` replaces everything.

**Slash command dispatch:**
- `/gather [path]` → `wrapCommand(handleGather, ...)`
- `/plan` → `wrapCommand(handlePlan, ...)`
- `/develop` → `wrapCommand(handleDevelop, ...)`
- `/verify` → `wrapCommand(handleVerify, ...)`
- `/idea [id]` → idea flow
- `/done` → finalize idea
- `/compact` → context compaction
- `/ask <q>` → one-shot answer
- `/clear` → reset session
- `/help` → command list

**Context compaction (REQ-U-7, REQ-U-10):**
- `/compact`: summarize history, replace with summary, restore recent files + skills
- Auto-compact at 80% utilization
- Nudge at 70%
- Circuit breaker: disable after 3 consecutive failures

**Permission gate (REQ-U-22):** Three categories: writes, runs, reads_outside. Per-session grants.

### 7.4 Slash Command Harness (`src/commands/slashCommands.ts`)

Port `cli/src/voidrift_cli/commands/_chat_commands.py`.

**`wrapCommand(fn, args, mc, state, promptFn, log)`** — background execution with busy/mode/error management.

**Handlers:** `handleGather`, `handlePlan`, `handleDevelop`, `handleVerify` — each calls pipeline functions directly, reports via `state.addSystem()`.

### 7.5 Idea Flow (`src/commands/idea.ts`)

Port `cli/src/voidrift_cli/commands/_chat_idea.py`.

**IdeaSession:** State machine (IDLE → COLLECTING → CONFIRM_PENDING). Zero I/O — transitions and line accumulation only.

**Stages:** Intake → Exploration → Shaping → Summary. Agent drives conversation. `/done` saves to `ideas/IDEA-{id}.md` with now/next/later categorization.

**Tests:** Port `test_chat.py`, `test_chat_commands.py`. Slash command harness lifecycle, idea state transitions, session persistence, compaction.

---

## Phase 8: Doctor + CLI Polish

**Goal:** Utility commands, shell completions, error handling, CLI entry point.

### 8.1 CLI Entry Point (`src/index.ts`)

Replace Click with Commander or yargs.

**Commands:**
- `voidrift` (no args) → interactive mode
- `voidrift gather <model> [--path] [--idea] [--overwrite] [--max-input-tokens] [--max-output-tokens]`
- `voidrift plan <model> [--overwrite] [--idea]`
- `voidrift develop <model> [architect] [--max-input-tokens] [--max-output-tokens]`
- `voidrift deploy <model> [architect]`
- `voidrift verify <model>`
- `voidrift chat <model> [--doc] [--style] [--bare] [--system-prompt]`
- `voidrift status`
- `voidrift log [command] [-f] [--prune]`
- `voidrift prune [--global] [--all]`
- `voidrift unlock`
- `voidrift rollback [turn]`
- `voidrift doctor [--fix]`
- `voidrift memory list|show|delete|export`
- `voidrift skills list|search|install|approve|remove`
- `voidrift completions bash|zsh|fish`

**Interactive mode:** Numbered menu → model selection → command execution.

**Error handling:** No stack traces to user. Catch all exceptions, print clean error, exit with code.

### 8.2 Doctor (`src/commands/doctor.ts`)

Port `cli/src/voidrift_cli/doctor.py`.

**Checks:**
- Config file syntax (YAML parse)
- Models file existence and syntax
- Per-model entry validation (required fields, valid protocol)
- Skill file parseability
- Log directory writability
- Disk space (>100MB)
- Optional dependencies (tree-sitter, pymupdf equivalents)

**`--fix`:** Create missing directories, add missing skill frontmatter.

### 8.3 Status (`src/commands/status.ts`)

Rich table with task counts by lifecycle status. Idea count. No model required.

### 8.4 Other Utilities

- `log` — show/tail/prune command logs
- `prune` — cleanup project/global logs, analysis cache
- `unlock` — remove develop lock, kill process
- `rollback` — list/restore git checkpoints
- `completions` — shell completion scripts
- `memory` — list/show/delete/export memory entries
- `skills` — list/search/install/approve/remove skills

**Tests:** Port remaining test files.

---

## Phase 9: Cutover

**Goal:** TypeScript version passes all ACs. Python version archived.

### 9.1 AC Verification

Run every acceptance criterion from REQUIREMENTS.md against the TypeScript version. Document results in a verification matrix.

### 9.2 Test Parity

All Python tests have TypeScript equivalents. Full suite passes.

### 9.3 Archive

1. Move `cli/` to `legacy/python/`
2. TypeScript `src/` becomes the primary implementation
3. Update Makefile: `make setup` installs Node dependencies
4. Update README.md: installation uses `bun install`
5. Update ARCHITECTURE.md: component descriptions reference TypeScript files
6. Tag release

---

## Dependency Graph

```
Phase 1 (foundation)
  ↓
Phase 2 (tools)
  ↓
Phase 3 (agent loop)
  ↓
Phase 4 (gather + plan) ←── Phase 6 (Ink TUI) can start here in parallel
  ↓
Phase 5 (develop + verify + deploy)
  ↓
Phase 7 (chat + session + slash commands) ←── requires Phase 6
  ↓
Phase 8 (doctor + CLI polish)
  ↓
Phase 9 (cutover)
```
