# VoidRift Blueprint Amendments

Tracks deviations, additions, and refinements made during implementation
that go beyond or differ from what `blueprint.md` specifies.

---

## AMD-001: Config file naming
- **Blueprint says**: `models.json` for model config
- **We decided**: Single `config.json` at both levels (global + local override)
- **Reason**: User preference — simpler, one file for everything

## AMD-002: read_file incremental loading
- **Blueprint says**: read_file reads raw file text with truncation
- **We added**: `offset` and `limit` parameters for incremental chunk reading
- **Reason**: Large files (2000+ lines) get truncated and models can't work with them. Incremental loading lets the model read in manageable chunks.

## AMD-003: Tool execution loop in direct chat
- **Blueprint says**: Streaming engine translates chunks, orchestration routes nodes
- **We added**: Tool execution loop in `directChat` — executes tool calls, feeds results back as ToolMessages, re-calls model until it responds with text
- **Reason**: Blueprint describes the architecture but not the mechanical loop needed to actually execute tools and return results to the model. This is implicit in any agent loop.

## AMD-004: Deduplication in tool loop
- **Blueprint says**: (not specified)
- **We added**: If model repeats the exact same tool call, break the loop
- **Reason**: Prevents infinite loops when model gets stuck calling the same tool repeatedly

## AMD-005: Post-tool-loop response nudge
- **Blueprint says**: (not specified)
- **We added**: After tool loop exhausts, add system message telling model to respond based on results
- **Reason**: Some models don't generate text after receiving tool results without explicit instruction to do so

## AMD-006: Four-Layer Progressive Content Discovery
- **Blueprint said**: Dynamic Progressive Disclosure via TF-IDF keyword index
- **We updated**: Blueprint now specifies a four-layer pipeline: RAG Vector Index → AST Code-Map → Flash Summarization → Surgical read_file
- **Reason**: TF-IDF alone can't handle semantic discovery at scale across mixed content types. RAG provides content-agnostic discovery, AST provides code structure, Flash summarization provides intent-aware comprehension, and surgical reads provide implementation access.

## AMD-007: focusedFiles stores summaries, not raw text
- **Blueprint said**: focusedFiles holds "max 3 full-text source files"
- **We decided**: focusedFiles stores Flash summaries + tracked read ranges (LRU, token-budget-aware eviction)
- **Reason**: Loading full file text into context is wasteful. Summaries with line-range pointers let the model understand files without paying full token cost, then surgically read only what it needs.

## AMD-008: suggestedContext slot (RAG pre-load)
- **Blueprint said**: (not specified)
- **We added**: `suggestedContext` in the Workspace Partition — ephemeral RAG results injected proactively each turn, evicted next turn unless acted upon
- **Reason**: Proactive discovery saves tool-call round trips. Labeling it as "may not be relevant" prevents the model from treating heuristic results as authoritative.

## AMD-009: Token-budget-based eviction for focusedFiles
- **Blueprint said**: Max 3 files, LRU eviction
- **We added**: Dual eviction — count limit (max 3) AND token budget ceiling (8000 tokens)
- **Reason**: Three large file summaries could still blow the workspace partition budget. Token-aware eviction prevents this.

## AMD-010: summarizeThreshold config field
- **Blueprint said**: (not in config schema)
- **We added**: `summarizeThreshold` (default 500 lines) — files under this size are pinned in full rather than summarized
- **Reason**: Summarizing a 50-line file wastes a Flash model call when the raw content is cheaper than the summary.

## AMD-011: editor config field
- **Blueprint said**: (not in config schema)
- **We added**: `editor` field in config for preferred text editor
- **Reason**: Needed for `/templates` override workflow that spawns the system editor.

## AMD-012: Custom retry with exponential backoff
- **Blueprint said**: Natively leverages LangChain's retry mechanisms
- **We implemented**: Custom `streamWithRetry` with exponential backoff (3 retries, 1s base)
- **Reason**: LangChain's built-in retry doesn't cover streaming failures cleanly. Custom retry gives us control over backoff timing and abort signal handling.

## AMD-013: Utility Panel terminology and design contract
- **Blueprint says**: Mixed terminology — "overlay", "interactive TUI overlay", "bordered TUI panel"
- **We decided**: The canonical term is **utility panel**. All slash-command-triggered TUI views rendered in the footer area are utility panels.
- **Reason**: Consistent vocabulary across code, docs, and conversation. Reserves naming space for future inline panel types.

### Utility Panel Design Contract

All utility panels MUST conform to these standards:

**Visual:**
- Single border, color `#5a6aa8`
- `paddingX={1} paddingY={1}`
- Bold title as first line
- Dimmed footer hint line showing available keybindings
- Keybinding hints format: bold cyan key label + plain description
- Empty states: dimmed placeholder text

**Base keybindings (every panel):**
- `esc` — always closes, returns to input line (or back to previous view if in detail)
- `↑/↓` — navigate items
- `enter` — primary action on selected item
- `←/→` — cycle between pages (if tabbed)
- `del` — destructive action (with `y/n` confirmation)
- `a` — activate selected item
- `d` — deactivate selected item
- `c` — create new item

**List navigation (panels with selectable items):**
- `▸` cursor on selected item, two-space indent on others
- Selected item highlighted with `#4ec9b0`

**Page navigation (multi-page/tabbed panels):**
- `←/→` — cycle between pages
- Tab bar rendered below the title
- Active page: bold + underline + `#4ec9b0` color
- Inactive pages: bold, no color
- Pages separated by double-space

**Discovery panels (panels listing registered assets like agents, skills, templates):**
- Must show the discovered filesystem paths (tilde-relative) for each item
- Plugin-registered items show `(built-in)` as location

**List panels with metadata (prompts, templates, agents, skills):**
- Header row with column labels, 2-char indent to align with list cursor
- Full-width `dimColor` divider under header
- Each item row: `▸`/indent + label (padded) + metadata columns
- Description line below each item (2-char indent, dimColor)
- Very dim (`#333333`) separator between items
- Full-width `dimColor` separator after last item (matches header divider)
- Locations section showing workspace and global directories
- Footer keybindings
- Column: "Override" — shows which level is active (`default`, `global`, `workspace`)
- Agents show `Override (config/prompt)` with both statuses: `default / workspace`
- `enter` on list → opens detail view (does NOT open editor directly)

**Detail view (override cascade):**
- Shown when `enter` is pressed on a list item
- Title: bold item label
- Description: dimColor, below title, no indent
- Table with columns: Level (17 pad), Status (12 pad), Path
- Three rows: Default, Global, Workspace (lowest to highest priority)
- Default row: no cursor prefix, not selectable. Shows `(built-in)` as path.
- Global/Workspace rows: selectable with `▸` cursor
- Status: `active` if that level is currently resolving, `—` otherwise
- Path: only shown if the file exists on disk
- `enter` on a selectable row: creates the file if missing, opens in editor
- `esc` returns to the list view (does NOT close the panel)
- Agents have two sections (Config + Prompt), each with their own cascade table
- Blank line between section title and its table

## AMD-014: Declarative Agent Manifests & Streamlined Registry
- **Blueprint says**: hardcoded Stateful Mode Cycler (`chat`, `plan`, `vibe`) alongside independent system prompt personas (`Architect`, `Coder`, `Auditor`).
- **We decided**: Collapse **Modes** and **Personas** into a single concept: **Interactive Agents** (human-facing TUI sessions, e.g., `chat`, `plan`, `vibe`, `idea`). Introduce **Task Agents** (headless background workers, e.g., `develop`, `verify`, `import`) for worktree actions. All agents are defined via a unified JSON schema, resolved in a three-tier cascade: Core (built-in), Plugin (installed), and Custom (local/global `.json` config files). Default the routing model tier to `"auto"` (managed by the harness Model Router) and omit custom keyboard shortcuts.
- **Reason**: Prevents state explosion and eliminates 90% redundant overlap between modes and personas. Enables zero-code user customization via local JSON overrides committed directly to git at `<workspace>/.voidrift/agents/*.json`. Decouples cognitive definitions from core harness systems.

### Authoritative Agent Manifest Example

```json
{
  "$schema": "https://voidrift.dev/schemas/agent.v1.json",
  "id": "voidrift-dev",
  "name": "VoidRift Developer",
  "description": "Agent specialized in developing the VoidRift monorepo",
  "type": "interactive",
  
  // --- Cognitive Layer ---
  "modelTier": "auto",                  // Default: Harness Model Router decides the tier on the fly
  "prompt": "You are helping develop Project VoidRift. Use blueprint.md as a steering document...",
  "tools": [
    "fs_read",
    "fs_write",
    "execute_bash",
    "grep",
    "glob"
  ],

  // --- Governance & Security Layer ---
  "approvalMode": "prompt",             // "prompt" (confirm writes), "deny" (read-only), or "autonomous" (vibe)
  "allowedTools": [
    "fs_read",
    "grep",
    "glob"
  ],
  "toolsSettings": {
    "fs_write": {
      "allowedPaths": [
        "./**",
        "~/.kiro/**"
      ]
    },
    "execute_bash": {
      "autoAllowReadonly": true
    }
  },

  // --- Context & RAG Layer ---
  "resources": [
    "file://./blueprint.md",
    "file://./amendments.md"
  ],

  // --- Operator Interface Layer ---
  "welcomeMessage": "Ready to work on Project VoidRift. What are we building today?"
}
```


### Tool Configuration Distinction: `tools` vs `allowedTools`

- **`tools` (Cognitive Capability):** Model-facing array of registered tools. Bound directly to the LLM client on startup so the model knows they exist and how to invoke them.
- **`allowedTools` (Security Clearance):** Harness-facing whitelist of pre-approved tools. When the model invokes a tool listed in `allowedTools` (e.g., `fs_read`), the harness executes it automatically. If a tool is listed in `tools` but omitted from `allowedTools` (e.g., `fs_write` or `execute_bash`), any invocation is intercepted by the Interactive Permission Gate, suspending execution to await manual operator approval (`y/n`).


### Workspace Resource Resolution: `resources`

- **Context Seeding (Zero-Turn Warm Startup):** On agent initialization, the harness resolves the URIs listed in the `resources` array (e.g., `file://./blueprint.md`), parses their contents (or Flash summaries if above `summarizeThreshold`), and injects them directly into the Workspace Partition. This seeds the model's environment with crucial context before the first user message is sent.
- **Eviction Protection:** Unlike volatile conversational history (Work Partition) which is summarized during auto-compaction, files registered under `resources` are treated as immutable context anchors. They are never evicted or summarized during compaction, ensuring they remain at 100% fidelity throughout the entire session.


### Fine-Grained Tool Parameters: `toolsSettings`

- **`fs_write.allowedPaths` (Write Sandboxing):** Restricts the scope of any file-modifying tools using glob patterns (e.g., `./**` for the workspace). The harness interceptor validates the target path *before* executing the tool, immediately aborting the call and returning an error if it falls outside the whitelisted directories.
- **`execute_bash.autoAllowReadonly` (Interactivity Optimization):** Bypasses the user permission gate for safe, read-only terminal commands (e.g., `git status`, `ls`, `cat`), reducing approval fatigue while retaining interactive checks for mutating commands (e.g., `rm`, `npm install`).


### Agent-to-Agent Delegation: Invocable Task Agents

To manage background concurrency and specialized execution, the harness represents all registered **Task Agents** as strongly-typed, invocable tools within the main **Interactive Agent's** schema.

#### The Tool Calling Delegation Flow:

1. **Interactive Session:** The developer engages with the main Interactive Agent in the TUI.
2. **Intent & Delegation:** When a specific engineering task is required, the primary agent generates a tool call: `run_task_agent("ui-builder", { component: "NavBar" })`.
3. **Execution Interception:** The Harness Runner intercepts the call, checks the `AgentRegistry` to load the `"ui-builder"` manifest, and provisions an isolated Git worktree.
4. **Headless Execution:** The `"ui-builder"` Task Agent runs to completion autonomously inside the worktree.
5. **Clean Result Return:** The harness collects the output (such as a Git diff or test report), tears down the worktree, and injects the result back into the main conversation as a standard, high-fidelity `ToolMessage`.

This keeps the massive log footprint of background operations completely outside the primary conversation context, preserving prompt caches and protecting the token budget.

#### Dynamic Tool Schema Binding:

On startup, the harness queries the `AgentRegistry` to build a strongly-typed schema for the `run_task_agent` tool:

```json
{
  "name": "run_task_agent",
  "description": "Delegate a background, isolated engineering task to a specialized task agent.",
  "parameters": {
    "type": "object",
    "properties": {
      "agentId": {
        "type": "string",
        "enum": ["summarizer", "ui-builder", "tester", "importer"], // Whitelisted from Registry
        "description": "The ID of the specialized task agent to run."
      },
      "arguments": {
        "type": "object",
        "description": "Task-specific arguments (e.g., target paths, instructions)."
      }
    },
    "required": ["agentId", "arguments"]
  }
}
```


#### Parallel Execution & Mutex Concurrency Scheduler:

The harness supports executing multiple background **Task Agents in parallel** across separate Git worktrees. To prevent write collisions and file conflicts, the harness orchestrates execution through a central **Path-Mutex Concurrency Scheduler**:
- **Worktree Isolation:** Each parallel Task Agent is assigned a unique UUID and provisioned in an independent folder under `.voidrift/worktrees/subagent-<uuid>`.
- **Path-Mutex Locking (`locks.json`):** Prior to execution, the scheduler checks if the target paths requested by the task intersect with any active path locks. If the paths are disjoint, the task agent launches instantly in parallel.
- **Queue Scheduling (`lock_queue.json`):** If a requested path is already locked, the task is placed in a FIFO queue. Once the blocking Task Agent completes and releases its locks, the scheduler automatically triggers a queue sweep to launch the next compatible background tasks.

## AMD-015: Dynamic Three-Tier Model Router & Escalation Loop
- **Blueprint says**: Unified model connection adapter factory (resolving local model config JSON) alongside a high-level three-tier conceptual layout (Flash, Utility, Dense).
- **We decided**: Fully implement a dynamic **Model Router** middleware layer inside the harness. When an agent's manifest declares `"modelTier": "auto"`, the Model Router dynamically routes tasks based on a native three-step classification engine. Furthermore, the Model Router implements an active **Escalation Loop** at the turn level—if a lower-tier model (e.g., Utility) fails a compiler test or verification run, the harness automatically escalates the session's active LangChain adapter to the Dense tier to handle the recovery. Once resolved, the session de-escalates to save token budgets.
- **Reason**: Standard libraries like LangChain only provide raw provider clients—they do not handle dynamic model swaps, task classification, or state-preserving escalation loops. Managing this in the harness core allows for cheap, low-latency local execution (Flash/Utility) while reserving heavy cloud models (Dense) for complex bug resolution, all without developer intervention.

### Triage Classification Engine
To determine the starting tier for a turn without adding latency, the Model Router applies these lightweight checks *before* making any LLM calls:
1. **Intent Checks:** Trivial operations (listing files, summaries, search) route instantly to the local **Flash** tier.
2. **Scoping Checks:** Tasks requiring writes across multiple files bypass Flash and route to **Utility**.
3. **Budget Checks:** If focused files or compiler traces exceed a 12,000-token window, the router escalates directly to **Dense** to ensure superior reasoning capabilities.


### Why the "Auto" Strategy is Robust & High-Confidence

The `"modelTier": "auto"` approach provides enterprise-grade capabilities with zero developer overhead due to three key architectural pillars:
- **Sub-Millisecond Heuristic Triage (0ms Latency):** Unlike semantic LLM classifiers that add costly API calls and latency, VoidRift's router uses deterministic metadata (prompt length, lock sets, focused files) to resolve the optimal model tier instantly with 100% predictability.
- **Dynamic Gear Shifting:** The developer interacts with a singular, consistent TUI agent while the router handles "gear shifts" under the hood—running cheap local weights for simple checks, and only pulling in cloud horsepower when actively navigating compiler errors.
- **Fail-Safe Escalation Guard:** The `shouldEscalate` threshold acts as an absolute safety net. If a local model fails a task verification or encounters repetitive diagnostic errors, the router hot-swaps to the Dense model on the next turn, mathematically guaranteeing the session cannot remain stuck.









## AMD-016: Session Persistence (Brain Directory)
- **Blueprint says**: `session_state.json` single-file serialization with `TurnStateJSON` schema
- **We decided**: Replace with a flat directory of namespaced files at `.voidrift/sessions/<session-id>/` that mirror the partition architecture. Harness writes all files automatically after each turn.
- **Reason**: Single JSON blobs are fragile, unreadable, and don't support per-partition recovery. Individual files are human-inspectable, crash-safe, and enable surgical rollback of specific partitions.

### Session Directory Structure

```
.voidrift/sessions/<session-id>/
  system.metadata.json      ← session id, start time, workspace root, model assignments
  system.stats.json         ← token usage, timing, tool success rates
  system.turns.json         ← turn boundaries, git checkpoint SHAs, active agent per turn
  system.tools.log          ← tool execution audit trail
  governance.persona.md     ← current compiled persona
  governance.skills.json    ← currently loaded skill ids
  governance.tools.json     ← currently bound tool list
  workspace.plan.md         ← active plan
  workspace.focused.json    ← focused files with summaries/ranges
  workspace.memory.json     ← loaded memory ids
  work.messages.json        ← conversation history
  work.diagnostics.md       ← active errors
```

### Write Rules
- Harness writes all files — no agent or model writes to this directory
- Written atomically after each `TURN_COMPLETE` event
- `system.turns.json` accumulates (array of turn snapshots with git SHA + active agent id)
- All other files are overwritten with current state each turn

### Recovery
- **Crash recovery**: Load the session directory on `/resume` to restore full state
- **Rewind**: Read `system.turns.json` to get the target turn's snapshot, restore each partition file to that state, `git reset --hard` to the matching checkpoint SHA
- **Agent switch**: Clear `work.messages.json`, update `governance.*` files, workspace stays intact
