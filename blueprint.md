# VoidRift: Decoupled Subsystem Architecture

This document defines the architectural blueprint of **VoidRift** at a high-level feature and conceptual block level. 

Rather than building a vertical stack, the system is modeled as a **Composition Root & Event-Driven Subsystem Architecture**. The application container acts as a central coordinator that wires together parallel, decoupled features through a central **Event Bus** and modular **Registries**.

---

## Executive Summary: What We Are Building (Decoupled AI Engineering Harness)

If you are inheriting or building upon this repository, this section serves as your 2-minute elevator pitch. It explains **what** VoidRift is, **why** it is architected this way, and **how** its modular layers interact without requiring you to read the full technical blueprint.

### 1. What is VoidRift?
VoidRift is a **highly decoupled, model-agnostic monorepo AI engineering harness** designed to run as a local developer tool. It combines an advanced multi-agent orchestrator with a premium, local-first interactive Terminal User Interface (TUI) built in React and Ink. 

Unlike standard vertically integrated AI platforms, VoidRift does not hardcode specific engineering workflows, API wire formats, or project management methodologies. Instead, the core harness is a **pure composition root** that coordinates general LLM routing, filesystem watching, in-memory caching, and terminal blitting, while allowing custom engineering lifecycles (like Ideas, Change Requests, and Tasks) to register dynamically as **Plugin Addons**.

#### The Sovereign Developer Philosophy (Local-First & Model Agnostic)

VoidRift is built from the ground up on a liberating engineering philosophy: **a developer's workspace should be a sovereign, secure, and predictable environment, completely free from rate limits, massive API price tags, and cloud lock-in.** 

*   **Cloud-Grade Local Sovereignty**: VoidRift brings cloud-grade agent orchestration directly into your local terminal. It is built strictly for the working engineer who needs to execute complex multi-agent coding loops without worrying about rate limits or expensive monthly subscriptions.
*   **Total Model Independence**: The harness abstracts the model connectivity layer, allowing it to run local, open-weight models (powered by your own local GPU via Ollama, vLLM, or Llama.cpp) and elite cloud models (such as DeepSeek, Gemini, Anthropic, or OpenAI) alike.
*   **Rate-Limit & Cost Freedom**: You can run 100-turn engineering loops all day long locally for $0 with zero rate-limit anxiety. When you do route highly complex tasks to cloud APIs, VoidRift's tail-end prefix caching (ascending volatility serialization) ensures you only pay pennies per session.
*   **An Engineering Tool, Not a Toy**: VoidRift doesn't try to replace the developer behind a black-box. It acts as a highly precise, secure "compiler" and keyboard-driven TUI dashboard, putting absolute control and safety directly in the hands of the operator.

---

### 2. The "Why" (The Core Challenges We are Solving)
Modern AI coding agents face three critical performance and safety boundaries when running on local filesystems:
*   **Prompt Cache Starvation**: AI models are expensive and slow if they must re-read entire codebases and technical guidelines on every turn. Placing mutable elements (like user inputs or live files) *upstream* of static rules invalidates the API provider's prompt prefix-caches, causing massive token bills and latency hangs.
*   **Write Collisions & Git Corruption**: When multiple subagents are spawned concurrently to solve disjoint sub-tasks, they easily collide, overwrite each other's work, and corrupt the main Git directory if they operate in the same workspace.
*   **Single-Threaded Event Loop Choking**: Heavy processes like Walkers, Language Server Protocol (LSP) indexing, child subprocess streams, and TUI redrawing can easily choke Node's single-threaded runtime, causing frozen frames and laggy user inputs.

---

### 3. The "How" (Our Five Architectural Pillars)
VoidRift resolves these issues with five defensive architectural paradigms:
1.  **Pure Composition Root & Event Bus**: `@voidrift/core` registers capabilities dynamically. Parallel systems never call each other directly; instead, they communicate through a central asynchronous **Event Bus**.
2.  **Three-Partition Context Partitioning**: Segregates context into static *Governance* (immutable guidelines), semi-dynamic *Workspace* (focused files, plan roadmaps), and volatile *Work* (recent chat history, linter errors). Serializing this context from least volatile at the top to most volatile at the tail guarantees **up to 90% prompt cache reuse** across turns.
3.  **Path-Mutex Concurrency Scheduler**: Spawns concurrent subagents in physically isolated Git worktrees under `<workspace>/.voidrift/worktrees/<uuid>`. The engine matches requested targets against a persistent lock ledger (`locks.json`). Disjoint changes run in parallel; overlapping targets queue sequentially in a persistent FIFO `lock_queue.json`, guaranteeing a **100% conflict-free Git merge loop** upon verification.
4.  **Asynchronous Promise Gating**: Suspends dangerous operations (like file writes and shell execution) using native JavaScript Promises. A pending tool yields execution back to Node's microtask queue, allowing the TUI to remain responsive while waiting for the developer's keyboard confirmation.
5.  **Dynamic Progressive Disclosure**: Uses an in-memory TF-IDF keyword relevance index to dynamically load only relevant guidelines (skills) and memory summaries into the prompt based on focused files and keywords, immediately unloading them when the task finishes to keep subsequent turns lightweight.

---

## 1. System Feature Index (Subsystem & Tool Summary)

This index provides a compact, high-level map of the entire harness feature set, showing exactly which subsystem owns each baseline capability, safeguard, and context-saving tool:

1. **Subsystem 1 (Application Container)**:
   - `[CORE]` The Environment Bootstrap Loader (Resolves workspace credentials and config).
   - `[CORE]` The Workspace File System Watcher (Active background re-indexing of file changes).
2. **Subsystem 2 (Model Connectivity)**:
   - `[CORE]` The Unified Model Adapter Factory (Resolves configurations and instantiates standardized LangChain clients).
   - `[CORE]` The Dynamic Three-Tier Model Router (Classifying and routing tasks between Flash, Utility, and Dense models).
3. **Subsystem 3 (Capability Subsystem)**:
   - `[CORE]` The Git Safeguard (Workspace dirty checks and auto-stash/checkpointing).
   - `[CORE]` The Workspace Code-Map Generator (Repo Map) (AST code layout mapping).
   - `[CORE]` The Progressive Disclosure Skill Registry (Dynamically hiding advanced tools to prevent prompt bloat).
   - `[CORE]` The Harness-Level Template & Prompt Service (Unified rendering registry & override cascade for files and system prompts).
4. **Subsystem 4 (Security Subsystem)**:
   - `[CORE]` The Interactive Permission Gate (TUI loop suspension and confirmation gate).
   - `[CORE]` The Stateful Mode Cycler (Cycling `chat`, `plan`, and `vibe` via `SHIFT+TAB`).
5. **Subsystem 5 (Operator Interface)**:
   - `[CORE]` The Output Truncator & ANSI Stripper (formatting logs and cutting large terminal scrolls).
   - `[CORE]` The Token Budget Watcher (Real-time context ratio visualization).
   - `[CORE]` The Input Lock (Freezing terminal typing during streams).
   - `[CORE]` The Tab Autocompletion Engine (Inline command and path autocomplete).
   - `[CORE]` The Audit Logger & Telemetry Monitor (Local logging of latency and token consumption metrics).
6. **Subsystem 6 (Agent Session)**:
   - `[CORE]` The Three-Partition Context Manager (Governance, Workspace, and Work partitions via Context Progressive Disclosure).
   - `[CORE]` The Prompt Cache Optimizer (Static prompt caching alignment).
   - `[CORE]` The Conversational History Compactor (Sliding-window compaction of the Work Partition).
   - `[CORE]` The Turn Serializer (Real-time JSON session persistence).
   - `[CORE]` The Session Exception Guard (API error catches to prevent UI lockups).
   - `[CORE]` The Two-Layer Memory Registry (Project vs. Global memory index with relevance scoring).

---

## 2. Architectural Pipeline & Layer Interaction

VoidRift organizes its execution pipeline into six distinct, modular layers. Instead of forcing a monolithic prompt or single execution loop, the harness coordinates operator interaction, multi-agent scheduling, context recycling, safe local operations, and physical model connectivity:

```text
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                       1. OPERATOR INTERFACE (TUI)                       │
    │  User Input (TAB Mode Swap) ◄──► Live Streams, Stats, Theme Engine      │
    └────────────────────────────────────┬────────────────────────────────────┘
                                         │ USER_INPUT Event
                                         ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                  2. MULTI-AGENT ORCHESTRATION (LangGraph)               │
    │  [Active State Graph] ──► Entry Router splits:                          │
    │    ├── Direct Chat (Bypass)                                             │
    │    └── Active Task: [Architect Agent] ──► [Engineer] ──► [Auditor]      │
    │  *Custom Agents* dynamically loaded from Global JSON Config.            │
    └────────────────────────────────────┬────────────────────────────────────┘
                                         │ Sets Node, Persona, & Allowed Tools
                                         ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │             3. PROGRESSIVE DISCLOSURE & CONTEXT PIPELINE                │
    │  [Three-Partition Context Manager] formats payload dynamically:          │
    │                                                                         │
    │  a) GOVERNANCE PARTITION (Immutable Rules & Guidelines)                 │
    │     ├── activePersona (Current active agent prompt instructions)        │
    │     └── activeSkills (YAML Frontmatter auto-discovered framework guides)│
    │                                                                         │
    │  b) WORKSPACE PARTITION (Semi-Dynamic Task Context)                     │
    │     ├── activePlan (Markdown implementation roadmap)                    │
    │     ├── focusedFiles (LRU Cache: max 3 full-text source files)          │
    │     └── activeMemory (Stage 1 Metadata Index. Stage 2 load/unload)      │
    │                                                                         │
    │  c) WORK PARTITION (Volatile History & Errors)                          │
    │     ├── messages (Episodic history compactor maintains budget)          │
    │     └── diagnostics (Transient linter outputs - cleared on test Pass)   │
    └────────────────────────────────────┬────────────────────────────────────┘
                                         │ Assembles & binds narrow tools
                                         ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │              4. DYNAMIC TOOL BINDING & EXECUTION LAYER                  │
    │  [Progressive Tool Registry] binds narrow schema sets to active node:   │
    │    ├── plan mode / Architect ──► Read-only tools                        │
    │    ├── Engineer Agent ─────────► Full Mutate + Execute tools            │
    │    └── Auditor Agent ──────────► Test execution only (No writes)        │
    └────────────────────────────────────┬────────────────────────────────────┘
                                         │ Evaluated actions
                                         ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │               5. SOURCE ISOLATION & SCHEDULE MUTEX (Git)                │
    │  [Worktree Concurrency Engine] schedules subagents via activeLocks:     │
    │    ├── Disjoint Targets ──► Asynchronous parallel git worktrees         │
    │    └── Overlapping Targets ──► Synchronous queued sequential execution   │
    └────────────────────────────────────┬────────────────────────────────────┘
                                         │ Safe physical executions
                                         ▼
    ┌─────────────────────────────────────────────────────────────────────────┐
    │                  6. MODEL CONNECTIVITY KERNEL (Adapters)                │
    │  [Three-Tier Router] escalates/routes payload via LangChain:           │
    │    ├── Flash (Scout/Local) ──► Utility (Collaborator) ──► Dense (Cloud) │
    │    └── Target Models: Gemini, Claude, Qwen Coder, Ollama Local          │
    └─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. System Topology & Event Flow

The application container initializes the parallel modules and wires them together through a central message bus. Subsystems do not import or call each other directly; they communicate by publishing and subscribing to lifecycle events.

```
                  ┌────────────────────────────────────────┐
                  │           Application Container        │
                  │            [Composition Root]          │
                  └───────────────────┬────────────────────┘
                                      │
            ┌───────────────┬─────────┴─────────┬───────────────┐
            │               │                   │               │
            ▼               ▼                   ▼               ▼
     ┌─────────────┐ ┌─────────────┐     ┌─────────────┐ ┌─────────────┐
     │  Operator   │ │    Model    │     │ Capability  │ │ Security &  │
     │  Interface  │ │ Connectivity│     │  Registry   │ │ Governance  │
     │ (TUI/Console)││  (Adapters) │     │   (Tools)   │ │  (Policies) │
     └──────┬──────┘ └──────┬──────┘     └──────┬──────┘ └──────┬──────┘
            │               │                   │               │
            └───────────────┼─────────┬─────────┼───────────────┘
                            │         │         │
                            ▼         ▼         ▼
                  ┌────────────────────────────────────────┐
                  │             Central Event Bus          │
                  │   [Token Stream, Confirms, Errors]     │
                  └───────────────────┬────────────────────┘
                                      ▼
                  ┌────────────────────────────────────────┐
                  │             Agent Session              │
                  │         [Active State & History]       │
                  └───────────────────\────────────────────┘
```

---

## 4. High-Level Subsystem Breakdown & Tool Nesting

To maintain ultimate clarity, every capability, safeguard, and tool in VoidRift is nested directly under the conceptual subsystem that owns it, and explicitly labeled as **`[CORE]`** (native to the base harness).

---

### Subsystem 1: The Application Container (Composition Root)
*   **The Concept**: The bootstrap shell of the harness. Its only job is to initialize the central Event Bus, instantiate the parallel feature modules, and inject them into the active Agent Session. It acts as the composition point that starts the application without hardcoding dependencies between individual subsystems.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE]` The Environment Bootstrap Loader**
    *   *Trigger*: Fires automatically once during process startup.
    *   *Action*: Locates and reads `<workspace>/.voidrift/models.json` or `~/.config/voidrift/models.json`, resolves environment variables nested inside API keys, and registers them.
    *   *Outcome*: Zero-config startup for the developer.
    *   *Rationale*: Decouples workspace settings from user-specific credentials by loading global configurations first, preventing developers from accidentally committing sensitive API keys to public repositories.
*   **`[CORE]` The Workspace File System Watcher**
    *   *Trigger*: Runs continuously in the background.
    *   *Action*: Monitors local directories for file additions, modifications, or deletions, automatically triggering the vector indexer to keep semantic memory perfectly fresh.
    *   *Outcome*: Ensures the model's codebase knowledge remains synchronized with external editor saves or git branch switches in real-time.
    *   *Rationale*: Automatically synchronizes changes made by external text editors (like VS Code or Helix) directly into the agent's memory index without requiring manual reload commands.
*   **`[CORE]` The Harness Boot Clean-up Guard (G-02)**
    *   *Trigger*: Runs automatically once during application bootstrap.
    *   *Action*: Scans `<workspace>/.voidrift/worktrees/` for orphaned/stale Git worktrees left by previous process terminations.
        *   **Metadata Evaluation**: Each active subagent worktree maintains a `.meta.json` containing the executing subagent's process ID (`pid`) and creation timestamp (`createdAt`).
        *   **Cross-Platform Process-Alive Verification**: Queries the host operating system process table for the registered PID using a non-throwing signal probe.
            ```javascript
            let isAlive = false;
            try {
              // Signal 0 tests process existence without terminating it on POSIX and Windows
              process.kill(pid, 0);
              isAlive = true;
            } catch (err) {
              // ESRCH indicates the process does not exist; other errors indicate it is running under another owner
              isAlive = (err.code !== 'ESRCH');
            }
            ```
        *   **2-Hour Time-to-Live (TTL) Safety Buffer**: If a PID is determined to be dead (or if `.meta.json` is missing/corrupted), a 120-minute safety buffer (based on the worktree directory's creation time) is enforced. If `ageInMinutes < 120`, the directory is preserved to prevent race conditions during rapid system boots or transient process lags.
        *   **Pruning Execution**: Stale worktrees older than the TTL with dead PIDs are programmatically removed via `git worktree remove --force <path>` and cleaned with `git worktree prune`.
        *   **Lock Release**: Purges matching entries from the active session's lock states (`activeLocks`) to instantly release write-access bounds.
    *   *Outcome*: Ensures the harness starts in a clean, predictable state across runs, completely preventing stale file locks or directory leaks.
    *   *Rationale*: Automatically repairs the workspace state on startup after system crashes or forced exits, preventing dangling temporary files, crashed git worktrees, or locked files from poisoning future runs.

---

### Subsystem 2: The Model Connectivity Subsystem (Adapters & Routing)
*   **The Concept**: A provider-agnostic Model Connectivity Gateway. Rather than writing custom serialization or API wrappers, VoidRift leverages the unified LangChain `BaseChatModel` interface and standard message classes (`SystemMessage`, `HumanMessage`, `AIMessage`, `ToolMessage`). The subsystem is completely decoupled from provider wire formats: it exposes a standard factory that dynamically instantiates, configures, and swaps LLM clients based on active workspace configurations and user instructions.
*   **Unified BaseChatModel Integration**: Connects dynamically to any compliant provider adapter:
    *   **OpenAI-Compatible (`ChatOpenAI`)**: Integrates with local vLLM instances (Ollama, vLLM), as well as third-party APIs (Groq, DeepSeek, Fireworks).
    *   **Anthropic Native (`ChatAnthropic`)**: Connects directly to the Messages API for high-reasoning, long-context tasks.
    *   **Google Gemini (`ChatGoogleGenAI` / `ChatVertexAI`)**: Accesses Gemini models directly for high-throughput, static system instructions.
*   **Harness-Driven Network Resilience**: Natively leverages LangChain's retry mechanisms (exponential backoff on rate-limit errors) and configurable timeouts, safeguarding TUI rendering loops from dropped connection hangs.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE] The Unified Model Adapter Factory`**
    *   *Trigger*: Fires automatically during workspace bootstrap or dynamic `/model` selection.
    *   *Action*: Resolves configuration schemas from the local `<workspace>/.voidrift/models.json` or global `~/.config/voidrift/config.json`, matches the active `protocol`, instantiates the corresponding LangChain adapter, and registers it as the active executor in the Agent Session.
    *   *Rationale*: Standardizes all API communications using LangChain's unified classes, ensuring the core agent logic is 100% provider-agnostic and that switching providers (e.g., from local Qwen to Anthropic Claude) requires zero codebase changes.
    *   *Provider-Specific Configuration Field Mapping Matrix*:
        To ensure the schema validation is strictly bounded by the `protocol` selection, the table below defines every valid parameter inside the `models` block, its data type, and which providers it is allowed or required to map to at runtime:

        | Field | Type | Required | Allowed Protocols | Target SDK Translation |
        | :--- | :--- | :--- | :--- | :--- |
        | **`protocol`** | `"openai" \| "anthropic" \| "google"` | Yes | All | Directs factory routing (instantiates transport layer). |
        | **`model`** | `string` | Yes | All | **Pass-Through Payload Identifier** (forwarded directly to API without internal parsing). |
        | **`contextLimit`** | `number` | Yes | All | Hard tokens ceiling for budget calculations. |
        | **`baseUrl`** | `string` | Yes | All | Destination endpoint (must be explicitly declared; e.g. official cloud endpoint or local host). |
        | **`apiKeyEnv`** | `string` | No | All | Env var name resolved dynamically to `apiKey`. |
        | **`temperature`** | `number` | No | All | Controls generation creativity (default `0.2`). |
        | **`maxOutputTokens`** | `number` | No | All | Standardizes `max_tokens` / `maxTokensToSample` constructor parameters. |
        | **`topP`** | `number` | No | All | Nucleus sampling parameter. |
        | **`topK`** | `number` | No | `google`, `anthropic` | Limits top-K token selection bounds. |
        | **`additionalHeaders`** | `Record<string, string>` | No | `anthropic` | Injected into API request headers (e.g., custom cache breakpoints). |
    *   *Design Separation of Concerns*: To prevent duplicate metadata setups across workspaces, **all master model configurations (protocols, providers, context limits) and the default tier selections (`flash`, `utility`, `dense`) are declared globally** in the user's global config `~/.config/voidrift/config.json`. Project-level token costs are excluded from tracking, as API providers do not supply cost structures dynamically. The local config at `<workspace>/.voidrift/models.json` is **strictly optional** and used only when a specific workspace needs to override the default global tier mappings or configuration parameters.
    *   *Specification: Global `~/.config/voidrift/config.json` (Default Setup)*:
        ```json
        {
          "tiers": {
            "flash": "qwen-local",
            "utility": "claude-sonnet",
            "dense": "claude-opus"
          },
          "models": {
            "qwen-local": {
              "provider": "openai",
              "model": "qwen2.5-coder-7b-instruct",
              "baseUrl": "http://localhost:11434/v1",
              "apiKeyEnv": "OLLAMA_API_KEY",
              "contextLimit": 32768,
              "temperature": 0.2
            },
            "claude-sonnet": {
              "provider": "anthropic",
              "model": "claude-3-5-sonnet-latest",
              "apiKeyEnv": "ANTHROPIC_API_KEY",
              "contextLimit": 200000,
              "temperature": 0.0
            },
            "claude-opus": {
              "provider": "anthropic",
              "model": "claude-3-opus-latest",
              "apiKeyEnv": "ANTHROPIC_API_KEY",
              "contextLimit": 200000,
              "temperature": 0.2
            }
          }
        }
        ```
    *   *Specification: Local `<workspace>/.voidrift/models.json` (Optional Workspace Overrides)*:
        ```json
        {
          "tiers": {
            "flash": "local-llama"
          },
          "models": {
            "local-llama": {
              "provider": "openai",
              "model": "llama-3-8b-instruct",
              "baseUrl": "http://localhost:8080/v1",
              "apiKeyEnv": "LOCAL_API_KEY",
              "contextLimit": 8192,
              "temperature": 0.1
            }
          }
        }
        ```
    *   *Outcome*: Flawless model-agnostic modularity. Adding a new LLM provider requires only instantiating a standard LangChain wrapper class.
*   **`[CORE] The Dynamic Three-Tier Model Router`**
    *   *Trigger*: Fires automatically whenever the orchestrator prepares a new LLM generation turn or schedules a sub-task.
    *   *Action*: Classifies the incoming task's complexity, scope, and context requirements, then dynamically routes execution payloads through a three-tier model framework:
        
        | Tier | Role | Targets | Core Task Types |
        | :--- | :--- | :--- | :--- |
        | **Flash** | The Scout | Fast, cheap (local) | File reads, directory globs, text summarizations, web scrapes, basic markdown formatting. |
        | **Utility** | The Collaborator | Mid-tier local MoE | Chat interactions, codebase analysis, code reviews, and medium-sized refactoring tasks. |
        | **Dense** | The Architect | Heavy cloud model | Long-term planning, multi-file architecture design, deep debugging, and complex feature implementation. |

    *   *Task Classification & Tier Routing Logic*:
        ```text
        USER_INPUT Arrives
               │
               ▼
        ┌─────────────────────────────────┐
        │  Signal 1: What node is active? │
        └─────────────────────────────────┘
               │
               ├── Auditor ──────────────────────────────► FLASH
               │
               ├── Engineer ──────────────────────────────► UTILITY
               │
               └── Architect / No active task yet
                          │
                          ▼
               ┌──────────────────────────┐
               │ Signal 2: What mode?     │
               └──────────────────────────┘
                          │
                          ├── plan ───────────────────────► DENSE
                          │
                          └── chat / vibe
                                     │
                                     ▼
                          ┌───────────────────────────┐
                          │ Signal 3: How complex?    │
                          └───────────────────────────┘
                                     │
                                     ├── Simple / short ─► FLASH
                                     ├── Medium ─────────► UTILITY
                                     └── Large / multi-file► DENSE
        ```

    *   *Escalation & Delegation (G-04)*:
        *   *Delegation*: The Utility (Collaborator) model acts as the supervisor, dynamically delegating simple, read-only sub-tasks (e.g., "summarize this file") to the Flash (Scout) model.
            ```text
            UTILITY running ──► "summarize these 5 files"
                                      │
                        ┌─────────────┼─────────────┐
                        ▼             ▼             ▼
                     FLASH          FLASH         FLASH
                   (file 1)        (file 2)      (file 3) ...
                        └─────────────┼─────────────┘
                                      ▼
                              results back to UTILITY
            ```
        *   *Escalation*: If a lower-tier model discovers a task requires wider context, deeper reasoning, or has hit persistent verification errors, the harness serializes a complete `EscalationState` snapshot and executes an ascending tier transition.
            ```text
            FLASH (Context / Error) ──► escalate ──► UTILITY
            UTILITY (Context / Error) ──► escalate ──► DENSE
            ```
        *   **The `EscalationState` JSON Schema**:
            Governs the structure of the transition payload saved to memory when a task escalates, ensuring state preservation and preventing token/context sequence gaps.
            ```json
            {
              "$schema": "http://json-schema.org/draft-07/schema#",
              "title": "EscalationState",
              "type": "object",
              "required": ["escalationId", "timestamp", "sourceTier", "targetTier", "triggerReason", "originalNode", "sessionState"],
              "properties": {
                "escalationId": { "type": "string" },
                "timestamp": { "type": "integer" },
                "sourceTier": { "type": "string", "enum": ["flash", "utility", "dense"] },
                "targetTier": { "type": "string", "enum": ["flash", "utility", "dense"] },
                "triggerReason": {
                  "type": "object",
                  "required": ["code", "message"],
                  "properties": {
                    "code": { "type": "string", "enum": ["CONTEXT_OVERFLOW", "REPEATED_AUDIT_FAILURE", "API_EXCEPTION", "MANUAL_ESCALATION"] },
                    "message": { "type": "string" },
                    "metrics": {
                      "type": "object",
                      "properties": {
                        "tokenCount": { "type": "integer" },
                        "limit": { "type": "integer" },
                        "failureCount": { "type": "integer" }
                      }
                    }
                  }
                },
                "originalNode": { "type": "string" },
                "sessionState": {
                  "type": "object",
                  "required": ["activePlan", "focusedFiles", "messagesSnapshot"],
                  "properties": {
                    "activePlan": { "type": "string" },
                    "focusedFiles": { "type": "array", "items": { "type": "string" } },
                    "messagesSnapshot": {
                      "type": "array",
                      "items": {
                        "type": "object",
                        "required": ["role", "content"],
                        "properties": {
                          "role": { "type": "string", "enum": ["system", "user", "assistant", "tool"] },
                          "content": { "type": "string" },
                          "toolCalls": { "type": "array", "items": { "type": "object" } }
                        }
                      }
                    }
                  }
                }
              }
            }
            ```
        *   **Escalation Pipeline & Injection Rule**:
            1. **Pre-Turn Analysis**: The router evaluates context consumption (via G-05) and linter error count. If tokens exceed `85%` of `sourceTier.contextLimit` OR Node failures exceed `2` consecutive counts, escalation triggers.
            2. **Snapshot Creation**: The harness serializes the state to the above `EscalationState` JSON structure.
            3. **Adapter Swap**: Instantiates the LangChain adapter matching `targetTier` (Utility or Dense).
            4. **Context Injection**: Inserts a high-priority system instruction at the head of the volatile Work Partition:
               `[SYSTEM ESCALATION NOTICE]: Execution transitioned from ${sourceTier} to ${targetTier} for ${originalNode} node due to ${triggerReason.code}. Please resume work smoothly.`
    *   *Outcome*: Drastically reduces execution latency and cuts API costs by reserving expensive cloud compute only for complex design work.
    *   *Rationale*: Optimizes context usage, execution speeds, and operational costs by delegating simple tasks to cheap local models (Flash) and reserving heavy, expensive cloud intelligence (Dense) only for high-complexity architectural decisions.
*   **`[CORE] The Standardized Event-Streaming Engine`**
    *   *Trigger*: Fires dynamically when a LangGraph node invokes a standardized `.stream()` call on a resolved model adapter.
    *   *Action*: Orchestrates chunk translation and argument accumulation, translating raw, provider-specific HTTP streaming chunk structures into standard harness events:
        1.  **Unified Chunk Schema**: Converts disparate payloads (OpenAI, Anthropic, Gemini candidate streams) into a single, predictable event structure containing a `type` (`"content"`, `"tool_call"`, or `"done"`) and the resolved target payload.
        2.  **Tool-Call Accumulator Protocol**: Because API providers emit tool call arguments as partial fragmented tokens over the stream, the engine accumulates these partial blocks internally and only yields the completed tool call block when the stream terminates.
        3.  **Graceful Stream Exception Mapping**: Intercepts mid-stream network dropouts, rate-limiting HTTP errors, and API connection terminations, converting them into standardized error payloads to prevent terminal blitting hangs.
    *   *Outcome*: Ensures the Operator TUI and core graph nodes receive a single, predictable, and robust stream of complete events, completely shielding the rendering layers from raw JSON fragments or provider API changes.
    *   *Rationale*: Sanitizes and standardizes disparate provider streaming protocols into a single, high-fidelity contract while isolating the TUI rendering loop from partial JSON parsing crashes.

---

### Subsystem 3: The Capability Subsystem (Tools & Safeties)
*   **The Concept**: A modular registry for local actions. Tools are registered as individual, standalone plugins. The agent loop queries this registry to discover available capabilities and route execution payloads to the appropriate handler.

#### Unified Action-Space & Tool Registration Guidelines

To maintain absolute security, context efficiency, and safe terminal execution, any tool integrated into VoidRift's core capability registry must adhere to the following four architectural design principles:

1.  **The Safe Primitive Contract (Surgical Mutation Only)**: 
    *   *filesystem mutations*: Blind overwrites are strictly prohibited. File edits must be designed around a **Surgical Block-Replacement Schema** (providing exact search target blocks and replacement contents) to prevent models from truncating or corrupting codebase files.
    *   *terminal command execution*: Terminal commands via `execute_command` must run as isolated subprocesses with hardcoded execution timeouts (defaulting to 30,000ms) to prevent hanging background loops from locking the harness.
2.  **Context Isolation & Token Hygiene (Asset Stripping)**: 
    *   *ingestion tools*: Tools that read text into the prompt context (specifically `read_file` and `web_fetch`) must actively strip out non-semantic token bloat:
        *   *Terminal Output*: Must strip all ANSI escape color/formatting codes.
        *   *Web Payloads*: Must parse HTML directly into plain Markdown, completely stripping heavy CSS styles, script tags, images, and non-semantic headers.
    *   *truncation guidelines*: Ingest tools must enforce a strict maximum lines cutoff (e.g. keeping first and last 50 lines) to prevent massive compiler dumps or heavy documentation from devouring the context budget.
3.  **Progressive Handoff (Dynamic Bindings)**: 
    *   *narrow tool schemas*: Tool schemas must never be bound statically. The harness must dynamically select and bind specific, restricted tool subsets using `BaseChatModel.bind_tools()` matching the active LangGraph node (Architect, Engineer, Auditor) and sandbox mode. This prevents models from experiencing tool selection hallucinations (e.g. the Architect attempting to execute a bash command).
4.  **The Permission Gate Mandate**: 
    *   *interception rule*: Any tool classified as an **Active Mutation** (`write_file`, `edit_file`) or **System Execution** (`execute_command`) must programmatically trigger the central Event Bus to suspend the execution loop. The tool cannot execute until the Operator Interface returns an explicit approval signal.

---

#### Action-Space & Tool Security Mapping Matrix

The table below defines every native capability registered in the harness action space, its operational category, its core responsibility, and its safety profile:

| Tool Name | Action Layer | Core Responsibility | Safety Profile (Approval Gate) |
| :--- | :--- | :--- | :--- |
| **`read_file`** | File Operations | Reads raw file text from the workspace. | **Auto-Approved** (Read-Only) |
| **`glob_files`** | File Operations | Scans the workspace directory using glob patterns. | **Auto-Approved** (Read-Only) |
| **`write_file`** | File Operations | Creates a new file or overwrites an empty target. | **Gated** (Active Mutation) |
| **`edit_file`** | File Operations | Performs surgical search-and-replace block edits. | **Gated** (Active Mutation) |
| **`execute_command`** | System Execution | Runs terminal commands (tests, compilers, linters). | **Gated** (Active Execution) |
| **`web_search`** | Web Discovery | Queries search engines for library documentation. | **Auto-Approved** (Read-Only) |
| **`web_fetch`** | Web Discovery | Fetches a URL, stripping HTML and assets to Markdown. | **Auto-Approved** (Read-Only) |
| **`lsp_definition`** | LSP Navigation | Resolves definition locations using Language Server. | **Auto-Approved** (Read-Only) |
| **`lsp_references`** | LSP Navigation | Locates symbol references/occurrences across project. | **Auto-Approved** (Read-Only) |
| **`lsp_hover`** | LSP Navigation | Retrieves type signatures and signatures hover tips. | **Auto-Approved** (Read-Only) |
| **`spawn_subagent`** | Orchestration | Spawns background subagents in isolated worktrees. | **Gated** (Resource Provisioning) |
| **`connect_mcp_server`** | External Bridge | Connects dynamically to local/remote MCP servers. | **Gated** (External Integration) |

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE]` The Git Safeguard (Source Control Guard)**
    *   *Trigger*: Fires automatically right before any model-called file-writing tool (`write_file` or `edit_file`) executes.
    *   *Action*: Runs a local Git status check. If uncommitted changes exist, it warns the developer or creates an automatic stash/temporary checkpoint commit.
    *   *Outcome*: Absolute protection against model-generated code regressions.
    *   *Rationale*: Establishes an automated "undo" safety net by stashing or checkpointing unstaged work before executing unsafe model writes, protecting the developer's manual contributions from destructive overwrites.
*   **`[CORE] The Workspace Code-Map Generator (Repo Map)`**
    *   *Trigger*: Fires automatically on session startup.
    *   *Action*: Scans the workspace files and AST structures to compile a highly compressed, token-efficient structure tree (excluding function bodies).
    *   *Outcome*: Gives the model complete high-level project awareness for under 1,000 tokens, avoiding the cost of reading entire source files prematurely.
    *   *Rationale*: Compiles a structural, AST-based layout of the entire codebase, giving the model top-level repository awareness for under 1,000 tokens and eliminating the prompt bloat of reading raw files prematurely.
*   **`[CORE] The Progressive Disclosure Tool Registry`**
    *   *Trigger*: Fires whenever a LangGraph node activates or the active sandbox mode changes.
    *   *Action*: Dynamically binds a targeted, minimal subset of tool schemas to the active node persona using LangChain's `.bind_tools()`. This keeps the action-space context footprint under 1.5k tokens and prevents model tool selection hallucinations.
    *   *Rationale*: Restricts the visible tool schemas on a per-node and per-mode basis, preventing models from hallucinating execution tools during planning phases and keeping tool prompt overhead minimal.
    *   *Persona & Mode Dynamic Tool Binding Matrix*:
        
        | Mode / Active Node | Allowed Tool Schemas | Scope & Boundaries |
        | :--- | :--- | :--- |
        | **`plan` mode (Any Node)** | `read_file`, `glob_files`, `web_search`, `web_fetch`, LSP navigation, read-only MCP | **Strict Sandbox**: All mutation (write/edit) and terminal execution tool schemas are completely unloaded. |
        | **`Architect` Node** (Chat/Vibe) | `read_file`, `glob_files`, `web_search`, `web_fetch`, LSP navigation, read-only MCP | **Read & Design Only**: Loaded tools focus strictly on repository research. No file mutators or shell triggers are visible. |
        | **`Engineer` Node** (Chat/Vibe) | `read_file`, `glob_files`, `write_file`, `edit_file`, `execute_command`, LSP tools, all MCP | **Full Workspace Control**: Full mutators and terminal command executions are loaded. |
        | **`Auditor` Node** (Chat/Vibe) | `read_file`, `execute_command` (limited to test/linter runners), `lsp_diagnostics` | **Strict Local Oracle**: Mutation and web search tools are completely unloaded to isolate local test executions. |

*   **`[PLUGIN] The Progressive Disclosure Skill Manager`**
    *   *Trigger*: Fires on session startup (for registry indexing) and on every conversational turn (for dynamic context injection).
    *   *Action*: Natively implements the **Hybrid Context Anchor Engine** using a zero-maintenance **YAML Frontmatter Auto-Discovery** pattern:
    *   *Rationale*: Dynamically injects technology guidelines (e.g., React or Prisma standards) based on the specific files in focus, preventing the prompt window from being choked by hundreds of lines of irrelevant documentation.
        *   **Folder-Scoped Skill Directory Specification**: To enforce asset co-location and self-containment, each registered skill is isolated into its own dedicated subdirectory (e.g., `skills/{skill_name}/`). This allows custom templates and safety definitions to live directly alongside the guidelines:
            *   `SKILL.md` (Required): Primary markdown file containing the YAML triggers frontmatter and the target technical prompt guidelines.
            *   `templates/` (Optional): Directory of boilerplate code snippets and coding blueprints that the Engineer agent dynamically reads to build new components.
            *   `rules.json` (Optional): Schema validation rules, style parameters, or syntax assertions checked programmatically by the Auditor.
        *   **YAML Frontmatter Indexing**: On startup, the manager parses the header of all `SKILL.md` files in `<workspace>/.voidrift/resources/skills/` and local `<workspace>/.voidrift/skills/` paths to build an in-memory trigger index (mapping file extensions, explicit filenames, and keywords to skills) in under 5ms:
            ```yaml
            ---
            name: NextJS App Router Guidelines
            description: RSC and App Routing standards
            triggers:
              extensions: [".tsx", ".jsx"]
              files: ["next.config.js"]
              keywords: ["nextjs", "server component", "layout", "page"]
            ---
            ```
        *   **Hybrid Anchor Resolution**: On every turn, the manager evaluates the active session context:
            1.  *File Anchors*: Extracts extensions and names of all files currently inside `focusedFiles`.
            2.  *Task Anchors*: Scans the active step in `activePlan` and the last user input for registered keywords.
        *   **Governance Partition Injection**: Merges matching skills and injects the curated, relevant markdown guides directly into the **activeSkills** slot inside the Governance Partition.
    *   *Outcome*: Ensures framework-specific guidelines (e.g., Next.js rendering tips, Prisma indexing rules) are loaded dynamically and exactly when needed, keeping the baseline Governance Partition lightweight, cheap, and extremely precise.
*   **`[CORE] The Model Context Protocol (MCP) Integration Engine (G-12)`**
    *   *Trigger*: Fires automatically during bootstrap or on a dynamic `/mcp connect` request.
    *   *Action*: Spawns and manages stdio-based external MCP server child processes, implementing active stderr crash monitors, robust signal shutdown handlers, and dynamic translation of MCP tool schemas to LangChain definitions.
        *   **Subprocess stdio Supervisor**:
            For each registered MCP server inside `mcp.json` or `config.json`, the supervisor spawns a dedicated node process:
            ```typescript
            import { spawn, ChildProcess } from 'child_process';
            
            interface MCPServer {
              name: string;
              process: ChildProcess;
              status: 'connected' | 'disconnected' | 'error';
              errorLog: string[];
            }
            ```
            - **stdio IPC Pipe**: The host maps stdin/stdout streams to process JSON-RPC requests/responses natively.
            - **Stderr Crash Monitoring**: Spies on the subprocess `stderr` stream. If recurrent exceptions or stack traces are emitted, it automatically updates the connection status to `'error'`, pushes diagnostics to the log cache, and dispatches a TUI event.
            - **Graceful Shutdown Lifecycles**: Registers handlers for `process.on('exit')`, `SIGINT`, and `SIGTERM`. Sends standard JSON-RPC `shutdown` and `exit` notifications to all sub-processes, forcefully falling back to `SIGKILL` only if the child process fails to exit within a 1.5-second grace window.
        *   **Dynamic Tool Schema Translation**:
            The engine executes a `tools/list` JSON-RPC query to pull the MCP server's exposed tools. It dynamically parses and maps the dynamic JSON schemas into native LangChain `DynamicStructuredTool` definitions:
            - **Naming Isolation**: Namespaces the generated tools (e.g. `mcp_${serverName}_${toolName}`) to prevent collision with native core primitives.
            - **Zod Translator Hook**: Converts raw JSON-Schema properties (including arrays, nested objects, and strings) into Zod validator schemas:
              ```typescript
              import { DynamicStructuredTool } from '@langchain/core/tools';
              
              const langchainTool = new DynamicStructuredTool({
                name: `mcp_${serverName}_sqlite_query`,
                description: mcpTool.description,
                schema: convertJsonSchemaToZod(mcpTool.inputSchema),
                func: async (args) => {
                  return await mcpClient.callTool(mcpTool.name, args);
                }
              });
              ```
            - This converted tool is automatically registered in the progressive tool space for active LangGraph node binding.
    *   *Outcome*: Flawless runtime integration with any external MCP-compliant server (databases, web indexing engines, local scripts) without process restarts.
    *   *Rationale*: Implements stdio-based JSON-RPC process lifecycle supervision and dynamic schema-to-schema translation to leverage the open-source MCP ecosystem in a fully isolated, secure environment.
*   **`[CORE] The Git Worktree Orchestration & Concurrency Engine (G-06)`**
    *   *Trigger*: Fires automatically when a model invokes the `spawn_subagent` tool.
    *   *Action*: Coordinates concurrent and sequential subagent tasks using isolated Git worktrees and a persistent file-locking mutex queue scheduler.
    *   *Rationale*: Allows concurrent subagent tasks to run in parallel without colliding or generating Git merge conflicts by isolating their execution spaces into physical, disjoint file-locked directories.
        *   **Persistent Lock Ledger (`locks.json`)**:
            The harness maintains a persistent, atomic JSON database at `<workspace>/.voidrift/locks.json` containing active subagent locking transactions:
            ```json
            {
              "activeLocks": [
                {
                  "lockId": "lock-uuid",
                  "subagentId": "subagent-uuid",
                  "pid": 49201,
                  "lockedPaths": ["src/server.ts", "package.json"],
                  "acquiredAt": 1779805501854
                }
              ]
            }
            ```
        *   **Path Intersection Mutex Logic**:
            When a subagent requests mutation on `requestedPaths`, the engine checks if any requested path overlaps with currently `lockedPaths`. 
            *   *Overlap Rule*: A path overlaps if it is identical, or if one path is a parent directory of another (e.g., locking `src/` blocks a subagent attempting to mutate `src/components/button.tsx`).
            *   **Asynchronous Parallelism**: If there is *no* overlap, the engine acquires locks, appends them to `locks.json`, provisions an isolated physical Git worktree (`git worktree add -b sub-branch-<uuid> <workspace>/.voidrift/worktrees/<uuid>`), and executes the subagent asynchronously in the background.
            *   **Queueing Mutex (`lock_queue.json`)**: If *any* target path overlaps, execution is suspended, and the task is serialized into a persistent FIFO queue file at `<workspace>/.voidrift/lock_queue.json`:
                ```json
                {
                  "queue": [
                    {
                      "taskId": "task-uuid",
                      "subagentId": "subagent-uuid",
                      "requestedPaths": ["src/server.ts"],
                      "spawnPayload": {
                        "prompt": "Refactor router endpoints",
                        "role": "Engineer",
                        "worktreePath": ".voidrift/worktrees/subagent-uuid"
                      },
                      "queuedAt": 1779805501900
                    }
                  ]
                }
                ```
        *   **Release & Queue Dispatch Cycle**:
            Upon subagent task completion (successful merge or safe abortion):
            1. The engine strips its locks from `locks.json`.
            2. Triggers a **Queue Sweep**: Reads `lock_queue.json` in FIFO order. For each queued task, if its `requestedPaths` no longer intersect with remaining active locks, it is popped from the queue, its locks are acquired, and its Git worktree execution is launched asynchronously.
            3. Dispatches a `LOCKS_UPDATED` event to the central event bus to refresh active tasks in the Operator TUI.
        *   **Handoff & Merge Loop**: On verification pass, the engine tears down the worktree (`git worktree remove`), merges the sub-branch cleanly back into main (guaranteed conflict-free due to the path mutex), and purges its file locks.
        *   **Subagent Git Merge Conflict Fallback Policy (G-13)**:
            Although the Path Mutex ensures disjoint subagent operations, merge conflicts can still occur due to concurrent developer commits or external branch updates. The engine implements a strict safety fallback protocol to protect code assets and release write boundaries:
            1.  **Conflict Detection**:
                Upon calling `git merge sub-branch-<uuid> --no-commit --no-ff`, if Git returns a non-zero exit code or emits conflict markers, the engine halts the merge.
            2.  **Merge Abort**:
                Instantly rolls back the dirty merge on the main working directory to restore repository cleanliness:
                `git merge --abort`
            3.  **Preservation Stash**:
                Creates a persistent developer recovery branch from the subagent's sub-branch:
                `git branch recovery/subagent-<uuid> sub-branch-<uuid>`
            4.  **Worktree Backup**:
                Commits any remaining untracked or uncommitted work inside the isolated worktree directly to the recovery branch:
                `git -C .voidrift/worktrees/<uuid> add -A`
                `git -C .voidrift/worktrees/<uuid> commit -m "subagent-recovery-checkpoint"`
            5.  **Teardown & Cleanup**:
                Forcefully removes the worktree (`git worktree remove --force .voidrift/worktrees/<uuid>`), sweeps references (`git worktree prune`), and completely deletes the active locks from `locks.json` to prevent path starvation.
            6.  **Incident Dispatch**:
                Emits a `SUBAGENT_MERGE_CONFLICT` event to the Event Bus containing the recovery branch name, conflicted paths, and the original task instruction, prompting the TUI to render a prominent warning modal overlay for the developer.
    *   *Outcome*: Enforces absolute context isolation across concurrent subagent tasks while mathematically eliminating the risk of Git merge conflicts.


*   **`[CORE] The Harness-Level Template & Prompt Service (G-14)`**
    *   *Trigger*: Fires automatically during document generation turns (files) or when compiling LLM agent prompts (system instructions).
    *   *Action*: Orchestrates the caching, retrieval, compilation, and routing of unified layout assets:
        *   **Dynamic Asset Categories**:
            *   *Document Templates* (e.g. `dev/task`, `dev/idea`): Rendered with session telemetry and saved as physical markdown files in the workspace.
            *   *Agent Prompts* (e.g. `prompts/plan-arch`, `prompts/develop-task`): Rendered with session telemetry and dynamically injected into the **Governance Partition** of the prompt context.
        *   **The Registration Registry**: Exposes core registration hooks (`core.templates.register(key, type, defaultContent, sourcePlugin)`) for plugins to declare their packaged defaults on startup.
        *   **The Override Resolution Cascade**: Resolves asset requests by checking local and global directories before falling back to in-memory code fallbacks:
            *   *For Document Templates*:
                1. Workspace Override: `<workspace>/.voidrift/templates/{key}.md` (highest priority).
                2. Global User Override: `~/.config/voidrift/templates/{key}.md` (mid priority).
                3. Plugin Default: The registered in-memory fallback (lowest priority).
            *   *For Agent Prompts*:
                1. Workspace Override: `<workspace>/.voidrift/prompts/{key}.md` (highest priority).
                2. Global User Override: `~/.config/voidrift/prompts/{key}.md` (mid priority).
                3. Plugin Default: The registered in-memory fallback (lowest priority).
        *   **YAML Frontmatter Metadata & Configuration Parsing**:
            The service programmatically parses the YAML frontmatter block (enclosed by `---`) at the head of every template/prompt file prior to rendering:
            *   *For Document Templates*: Evaluates frontmatter properties dynamically to stamp document metadata (e.g. `id: TASK-N`, `priority: now`, `created_at: ISO-DATE`) into the written files.
            *   *For Agent Prompts*: Serves as **Agent Configuration Governance**. The frontmatter block declares the agent's runtime parameters (e.g. `tier: dense`, `temperature: 0.1`, `allowed_tools: ["read_file", "glob_files"]`), which the core engine automatically extracts to route model adapters and bind progressive tool schemas at runtime.
        *   **Programmable Frontmatter Mutations & YAML Schema Validation Guardrails**:
            To allow dynamic state management and operator customization, the frontmatter of "known" workflow documents (such as Ideas, Change Requests, and Tasks) is completely mutable and editable:
            *   *Metadata Management*: Operators can edit frontmatter variables manually (in their editor) or programmatically (e.g. updating task statuses, adding skill rules, or declaring intra-module dependency lists).
            *   *Two-Phase Validation Gates (On-Save)*: To prevent syntax errors or malformed parameters from choking the engine, the core registers strict validation gates for each known document type:
                1. *YAML Syntax Gate*: Validates that the saved text is structurally valid YAML.
                2. *Schema Property Gate*: Validates the parsed JavaScript object's properties (types, ranges, and required keys) against standard validation schemas (e.g. ensuring `depends` is a list of integers).
            *   *Soft Diagnostic Reports*: When a filesystem watcher save event is detected on disk or a tool attempts to write a known document, the core triggers this on-save validation. If any gate fails, the harness halts the merge/ingestion and emits a detailed, non-crashing diagnostic warning report in the Operator Interface showing the exact line and structural error details.
        *   **Automatic Context Enrichment**: During render, the service automatically merges and injects standard telemetry and environmental properties:
            * `harness.version` (active CLI engine version).
            * `harness.timestamp` (active turn ISO timestamp).
            * `workspace.root` (absolute repository path).
            * `workspace.basename` (project name directory).
            * `git.branch` (currently active Git branch).
            * `git.sha` (current commit short SHA hash).
            * `session.uuid` (active agent session ID).
            * `session.model` (active model adapter string).
    *   *Outcome*: Total, runtime customizability over both output file formats and LLM agent instructions, keeping configurations completely decoupled from core harness logic.

### Subsystem 4: The Security Subsystem (Governance & Policies)
*   **The Concept**: An independent safety interceptor sitting on the Event Bus. It evaluates proposed actions against defined security profiles (e.g., safe read-only operations vs. destructive modifications) and suspends the execution loop to request approval.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE]` The Interactive Permission Gate (Approval Manager) (G-07)**
    *   *Trigger*: Fires automatically right before any unsafe model-called tool (`write_file`, `edit_file`, or `execute_command`) runs.
    *   *Action*: Intercepts the execution flow and suspends the tool execution via an asynchronous JavaScript Promise, publishing a confirmation request to the Event Bus and resolving it based on operator TUI actions without blocking Node's event loop.
        *   **Asynchronous Promise Suspension Mechanic**:
            To pause tool progression without choking Node's single-threaded event loop, mutator tools return an asynchronous Promise that maps to an in-memory `pendingRequests` registry:
            ```typescript
            interface PendingRequest {
              resolve: (approved: boolean) => void;
              reject: (err: Error) => void;
              toolCall: {
                id: string;
                toolName: string;
                arguments: Record<string, any>;
              };
              requestedAt: number;
            }
            const pendingRequests = new Map<string, PendingRequest>();
            ```
        *   **Interception Execution Flow**:
            1. Upon tool invocation, the handler generates a unique `requestId` (UUID) and publishes a `TOOL_CONFIRMATION_REQUEST` to the Event Bus.
            2. The handler then yields thread control by awaiting a new Promise, preserving its microtask state:
               ```typescript
               const approved = await new Promise<boolean>((resolve, reject) => {
                 pendingRequests.set(requestId, {
                   resolve,
                   reject,
                   toolCall: { id: requestId, toolName, arguments: args },
                   requestedAt: Date.now()
                 });
               });
               ```
            3. The main thread continues to execute completely unblocked, allowing the passive TUI to render, listen for keystrokes, or process parallel background network metrics.
        *   **Resolution and Resumption Flow**:
            1. The TUI captures `TOOL_CONFIRMATION_REQUEST` and renders the prompt overlay modal.
            2. When the operator accepts (`y`) or rejects (`n`), the TUI emits a `TOOL_CONFIRMATION_RESPONSE` event containing `{ requestId, approved: boolean }`.
            3. The Bootstrap Loader captures the response, deletes the registry entry, and triggers the stored resolve hook:
               ```typescript
               const pending = pendingRequests.get(requestId);
               if (pending) {
                 pendingRequests.delete(requestId);
                 pending.resolve(approved);
               }
               ```
            4. If `approved` is true, the tool continues to write/execute. If `approved` is false, it halts and returns a standardized error string: `"Error: Operation rejected by user permission gate."`, feeding the model a graceful failure context.
    *   *Outcome*: Ensures no destructive changes land on the developer's system without explicit consent, while maintaining high-fidelity, non-blocking asynchronous execution.
    *   *Rationale*: Suspends the central event loop before executing any filesystem mutations or shell commands, ensuring the developer maintains complete control over the safety of their local environment.
*   **`[CORE] The Stateful Mode Cycler`**
    *   *Trigger*: Fires when the developer presses `SHIFT+TAB` in the Operator Interface, cycling forward through the three modes.
    *   *Action*: Cycles the harness through three core execution modes, dynamically swapping system instruction templates and updating tool execution boundaries:
    *   *Rationale*: Synchronizes the active user persona and harness security parameters to match the operator's current task phase (`plan` for safe roadmap drafting, `chat` for standard interaction, `vibe` for autonomous coding).

        | Mode | Permission Gate | Write Tools | Description |
        | :--- | :--- | :--- | :--- |
        | **`plan`** | N/A — writes blocked entirely | ❌ Disabled | Read-only planning sandbox. Architect produces `activePlan`. No file writes or shell execution permitted. Operator must switch to `chat` or `vibe` to execute. |
        | **`chat`** | ✅ ON — approval prompt before each unsafe call | ✅ Available | Full tool access. The Interactive Permission Gate intercepts `write_file`, `edit_file`, and `execute_command` calls for explicit operator approval before execution. |
        | **`vibe`** | ❌ OFF — fully autonomous | ✅ Available | Full tool access, no interruptions. All tool calls execute immediately without approval prompts. |

    *   *Outcome*: Provides a highly specialized, task-driven sandbox environment. Each mode switch rebuilds the active prompt context dynamically while preserving the structural session memory. The typical operator workflow is: author a plan in `plan` mode, then switch to `chat` or `vibe` to execute it.

---

### Subsystem 5: The Operator Interface Subsystem (TUI & Headless Output)
*   **The Concept**: A view layer that subscribes to the Event Bus. It is entirely passive: it renders text streams, maps status indicators, and draws prompt confirmation overlays. When running in interactive mode, it displays the visual TUI; when running in headless mode, it maps the same stream events straight to standard console output.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE] The Output Truncator & ANSI Stripper`**
    *   *Trigger*: Processes the raw execution output returned by `execute_command` or `web_fetch` before it is returned to the model.
    *   *Action*: Strips out terminal ANSI color codes and progress characters, then truncates large logs (keeping only the first and last 50 lines).
    *   *Outcome*: Prevents verbose test scrolls or heavy HTML code from devouring the model's active context window.
    *   *Rationale*: Sanitizes and truncates huge terminal dumps or compiler logs before returning them to the model, preventing verbose output scrolls from overwhelming the agent's context window.
*   **`[CORE]` The Token Budget Watcher**
    *   *Trigger*: Runs in real-time as tokens stream or messages are complete.
    *   *Action*: Measures active session token usage against the model's context window limit and calculates the color-coded state (green, yellow, red) for the footer status bar.
*   **`[CORE] The Tab Autocompletion Engine`**
    *   *Trigger*: Fires when the developer presses `TAB` while typing inside the Operator Interface command input field.
    *   *Action*: Intercepts the input cursor stream and dynamically resolves the word currently under the cursor:
        *   *Command Autocompletion*: If the cursor is on the first word (starting with `/`), queries the Slash Command Registry to autocomplete command matches (like `/templates`, `/memory`, or `/resume`).
        *   *Path/Filename Autocompletion*: If the cursor is on an argument string (e.g. typing a file path to `/import` or `/diff`), queries the active in-memory directory index (kept warm by the background Workspace File System Watcher) to find matching files and directories in the workspace, autocompleting them inline.
        *   *Multi-Match Carousel*: If multiple matching file candidates exist, cycles through candidates on subsequent `TAB` keypresses, rendering a subtle, horizontal dropdown overlay directly beneath the typing field showing available matches.
    *   *Outcome*: Fluid, terminal-native typing speed matching developer shell muscle memory.
    *   *Rationale*: Combines the filesystem watcher's indexing logic with TUI input streams to provide instant autocompletion for commands and local code paths, keeping typing fluid.
    *   *Outcome*: Visual alert to the developer as the session approaches context limits.
    *   *Rationale*: Provides real-time visual warnings of prompt-to-context ratios in the TUI footer, preventing unexpected context window overflows or model generation cutoffs.
*   **`[CORE]` The Input Lock (Concurrency Guard)**
    *   *Trigger*: Fires automatically when a `USER_INPUT` event is published.
    *   *Action*: Visually disables the terminal input prompt and ignores all keyboard keystrokes while the model stream is active.
    *   *Outcome*: Prevents the developer from typing and submitting overlapping messages that would corrupt the session state.
    *   *Rationale*: Freezes keyboard input during active model streams, preventing race conditions where user text and model responses interleave and corrupt the conversation state.
*   **`[CORE]` The Audit Logger & Telemetry Monitor (Dual-Layer Logging)**
    *   *Trigger*: Captures events asynchronously throughout the entire execution loop.
    *   *Action*: Orchestrates a rigid **Dual-Layer Logging Specification** dividing application events into two strictly segregated scopes:
    *   *Rationale*: Separates local developer audit trails from global runtime error telemetry, ensuring codebase mutations are fully trackable locally while engine crashes don't pollute the repository.
        *   **Level 1: Local Project Audit Log (`<workspace>/.voidrift/logs/session-<uuid>.log`)**:
            - *Scope*: Local workspace and model interactions.
            - *Details*: Records chronological conversation turns, exact model prompts/completions (the full raw token payloads), git worktree provisions, file mutations, tool execution results, and linter diagnostics.
            - *Outcome*: Ensures complete, local accountability for everything written or executed inside the workspace.
        *   **Level 2: Global CLI System Log (`~/.config/voidrift/logs/error.log`)**:
            - *Scope*: Harness application errors and telemetry.
            - *Details*: Records low-level CLI/TUI crashes, model connectivity timeouts, API authentication issues, theme engine failures, and startup bootstrapping exceptions.
            - *Outcome*: Provides standard telemetry logs for debugging the CLI engine and model configurations without cluttering the local workspace.
    *   *Outcome*: Total operational transparency for both project-level edits and global system stability.

---

### Subsystem 6: The Agent Session (Active State & Memory)
*   **The Concept**: The state tracker. It enforces VoidRift's **Context Progressive Disclosure** directive by dividing the active prompt context window into three logical, decoupled partitions — keeping safety rules, workspace state, and conversational history each isolated, manageable, and compactable independently.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE] The Three-Partition Context Manager`**
    *   *Trigger*: Pre-formats the active prompt payload before every LLM invocation.
    *   *Action*: Natively implements VoidRift's **Context Progressive Disclosure** directive by dividing the context window into three logical, decoupled partitions, balancing strict safety, workspace awareness, and low-token runtime compactions:
    *   *Rationale*: Implements Context Progressive Disclosure by separating static governance, dynamic workspace maps, and volatile history, preventing token window exhaustion while keeping rules and file contexts intact.
        ```text
        [Agent State Graph Schema - Three-Partition Context Architecture]
         ├── 1. Governance Partition (Immutable & Rules-Driven)
         │    ├── activePersona ──► System instruction prompt for the active role (Architect/Coder/Auditor).
         │    ├── activeMode ─────► Sandbox boundary and approval rules (chat, plan, vibe).
         │    └── activeSkills ───► Dynamically loaded markdown skill/prompt guides (Next.js, Prisma guidelines) relevant to focused files.
         ├── 2. Workspace Partition (Semi-Dynamic & Context-Driven)
         │    ├── activePlan ─────► The persistent step-by-step markdown implementation roadmap.
         │    ├── focusedFiles ───► Raw, full-text contents of files currently under edit/review.
         │    ├── workspaceCodeMap► Ultra-compressed folder tree index (LSP tools resolve details).
         │    ├── activeMemory ───► Memory topics directory index (relevance-loaded on-demand).
         │    └── gitStatus ──────► Local workspace checkpoint or active source control state.
         └── 3. Work Partition (Volatile & Compactable)
              ├── messages ───────► Chronological conversation log of turns and tool results.
              └── diagnostics ────► Transient compile/linter errors captured in-flight.
        ```
    *   *Unified Context Recycling Policy*:
        To prevent context window bloat and keep token usage in check, every dynamic context slot implements a strict loading and unloading strategy:
        
        | Partition Slot | Disclose / Load Trigger | Unload / Recycle Trigger | Action Driver |
        | :--- | :--- | :--- | :--- |
        | **Memory** (`activeMemory`) | Model calls `load_memory(id)` | Model calls `unload_memory(id)` | **Model-Driven** |
        | **Skills** (`activeSkills`) | Environment File/Keyword Anchor match | Match no longer active | **Harness-Driven (Auto)** |
        | **Focused Files** | File edited or model focuses it | Exceeds focus buffer limit (max 3) | **Hybrid / LRU Cache** |
        | **Diagnostics** | Test or compilation build fails | Auditor node sets `Pass` | **Harness-Driven (Auto)** |

    *   *Outcome*: Ensures core identities, security sandboxes, and active files are never lost or corrupted during history compactions, while keeping the volatile Work Partition completely isolated and summarizable when token usage exceeds boundaries.
*   **`[CORE] The Prompt Cache Optimizer (Prompt Cache Alignment)`**
    *   *Trigger*: Formats the active prompt payload on every conversation turn.
    *   *Action*: Places static prompts, instructions, and workspace layout diagrams at the absolute beginning of the message history (inside the Governance Layer).
    *   *Outcome*: Aligns the payload with API providers' static boundaries to trigger cheap, low-latency prompt caching automatically.
*   **`[CORE] The Conversational History Compactor (Episodic Summary Compactor) (G-09)`**
    *   *Trigger*: Fires automatically when conversation token usage in the **Work Layer** exceeds 75% of context limits.
    *   *Action*: Condenses older conversation turns in the Work Layer while keeping the most recent 10 turns at full fidelity, utilizing protective metadata filters and a structured summarization template.
        *   **Protective Metadata Filters**:
            Before serializing the older turns for compaction, the engine sweeps history to extract and preserve critical system state tokens. These are **strictly prohibited** from being simplified or discarded:
            1.  *Unresolved Diagnostics*: Active compiler errors, failing test traces, or stack exceptions.
            2.  *Active Tool Hooks*: Execution process parameters or active environmental override tags.
        *   **The Summarization Prompt Template**:
            The engine executes a fast, background utility model call utilizing this strict prompt template to generate the chronological episodic recap:
            ```markdown
            You are the VoidRift Conversational History Compactor.
            Your job is to condense the provided older conversation history into a highly dense, bullet-point chronological summary, while explicitly preserving all structural metadata, errors, and critical commands.

            ### INSTRUCTIONS:
            1. Maintain a chronological list of actions taken, decisions made, and files modified.
            2. Identify and preserve all active, unresolved compiler/linter error messages and exceptions verbatim under the "UNRESOLVED DIAGNOSTICS" header.
            3. Identify and preserve any crucial environment properties, tool credentials, or user-supplied instructions that govern the remaining tasks under the "ACTIVE PARAMETERS" header.
            4. DO NOT write conversational filler. Keep the output extremely dense and formatted as markdown.

            ### PAST CONVERSATION TO SUMMARIZE:
            ${serializedPastTurns}

            ### OUTPUT FORMAT:
            # Session Summary: Turn [X] to [Y]
            - **Activity Log**:
              - [Bullet points of chronological engineering progress...]
            - **Files Touched**:
              - [List of files and specific changes made...]
            - **Unresolved Diagnostics**:
              - [Verbatim error snippets or "None" if all tests passed...]
            - **Active Parameters**:
              - [Key environment parameters or instructions...]
            ```
        *   **Handoff Insertion Loop**:
            1. The newly compiled summary replaces the original `[0 to Y]` turns in the active `messages` array as a single `SystemMessage` labeled `[HISTORICAL SESSION RECAP]`.
            2. The uncompacted, full-fidelity `recentTurns` (last 10 turns) are appended directly after the recap to maintain chronological cache-friendly continuity.
    *   *Outcome*: Prevents the active history token size from growing exponentially over long sessions while ensuring vital system context is never truncated.
    *   *Rationale*: Condenses older conversation turns into compact summaries while preserving recent turns, preventing linear history growth from exhausting the remaining token window over long sessions.
*   **`[CORE]` The Turn Serializer (Session State Writer) (G-10)**
    *   *Trigger*: Fires automatically on the `TURN_COMPLETE` event.
    *   *Action*: Serializes the active message array, graph node states, memory locks, and file watch tokens, writing them to a local JSON session log file `<workspace>/.voidrift/session_state.json`.
        *   **The `TurnStateJSON` Schema**:
            Governs the exact structure of the session transaction checkpoint to guarantee absolute state replication on recovery:
            ```json
            {
              "$schema": "http://json-schema.org/draft-07/schema#",
              "title": "TurnStateJSON",
              "type": "object",
              "required": ["sessionId", "turnIndex", "timestamp", "gitState", "harnessState", "graphState", "contextSnapshot"],
              "properties": {
                "sessionId": { "type": "string" },
                "turnIndex": { "type": "integer" },
                "timestamp": { "type": "integer" },
                "gitState": {
                  "type": "object",
                  "required": ["currentBranch", "checkpointSha", "isDirty"],
                  "properties": {
                    "currentBranch": { "type": "string" },
                    "checkpointSha": { "type": "string" },
                    "isDirty": { "type": "boolean" }
                  }
                },
                "harnessState": {
                  "type": "object",
                  "required": ["activeMode", "activeLocks"],
                  "properties": {
                    "activeMode": { "type": "string", "enum": ["plan", "chat", "vibe"] },
                    "activeLocks": { "type": "array", "items": { "type": "string" } }
                  }
                },
                "graphState": {
                  "type": "object",
                  "required": ["activeNode", "currentNodeState"],
                  "properties": {
                    "activeNode": { "type": "string" },
                    "currentNodeState": {
                      "type": "object",
                      "properties": {
                        "retryCount": { "type": "integer" },
                        "lastExecutionStatus": { "type": "string" }
                      }
                    }
                  }
                },
                "contextSnapshot": {
                  "type": "object",
                  "required": ["governance", "workspace", "work"],
                  "properties": {
                    "governance": {
                      "type": "object",
                      "required": ["loadedSkills"],
                      "properties": {
                        "loadedSkills": { "type": "array", "items": { "type": "string" } }
                      }
                    },
                    "workspace": {
                      "type": "object",
                      "required": ["activePlan", "focusedFiles"],
                      "properties": {
                        "activePlan": { "type": "string" },
                        "focusedFiles": { "type": "array", "items": { "type": "string" } }
                      }
                    },
                    "work": {
                      "type": "object",
                      "required": ["messages", "diagnostics"],
                      "properties": {
                        "messages": {
                          "type": "array",
                          "items": {
                            "type": "object",
                            "required": ["role", "content"],
                            "properties": {
                              "role": { "type": "string" },
                              "content": { "type": "string" },
                              "toolCalls": { "type": "array", "items": { "type": "object" } }
                            }
                          }
                        },
                        "diagnostics": { "type": "string" }
                      }
                    }
                  }
                }
              }
            }
            ```
        *   **Re-hydration Recovery Protocol**:
            Upon executing `/resume`, the bootstrap loader:
            1. Reads `session_state.json` and validates it against the `TurnStateJSON` schema.
            2. Restores the active git branch and performs a hard git reset to `checkpointSha` if needed.
            3. Injects the three-partition snapshot variables directly into the orchestrator graph, restoring full conversational state.
    *   *Outcome*: Automatic transaction-level state saving across process restarts, enabling flawless session recovery.
    *   *Rationale*: Automatically saves session state to disk on every turn, protecting conversational progress against process crashes, power failures, or unexpected network dropouts.
*   **`[CORE]` The Session Exception Guard (Error Handler)**
    *   *Trigger*: Intercepts uncaught exceptions thrown during stream generation or tool execution.
    *   *Action*: Catches LangChain network or API errors, pushes a clean error block to the active conversation history, publishes an `ERROR_OCCURRED` event to notify the TUI, and triggers the Input Lock to release control.
    *   *Outcome*: Prevents process crashes or permanent TUI lockups during dropped API connections.
    *   *Rationale*: Intercepts API failures, connection losses, and rate limits gracefully, injecting readable error messages into the chat history rather than crashing the TUI process.
*   **`[PLUGIN] The Two-Layer Memory Registry`**
    *   *Trigger*: Session startup (indexing) and conversational turn complete.
    *   *Action*: Maintains both **Project-level memory** (`<workspace>/.voidrift/memory/`) and **Global memory** (`~/.config/voidrift/memory/`) using a highly disciplined **Two-Stage Progressive Disclosure** lifecycle:
        *   **YAML Frontmatter Indexing**: Memory files are written by the agent as markdown containing context headers:
            ```yaml
            ---
            id: mem-db-pool-01
            title: Connection Pool Limit in Serverless Environments
            summary: Limits prisma client pool size to 1 to prevent DB exhaustion.
            context:
              extensions: [".ts", ".js"]
              files: ["schema.prisma", "prisma.ts"]
              keywords: ["prisma", "pool", "exhaustion", "serverless"]
            ---
            ```
        *   **Stage 1: Discovered (Metadata Indexing & TF-IDF Ranking) (G-11)**:
            On turn startup, the registry executes a lightweight, in-memory **TF-IDF Term Frequency-Inverse Document Frequency** relevance-scoring and keyword indexing sweep across all registered memory metadata headers. This avoids loading slow, bulky vector embedding models on the main Node thread:
            1.  **Collection Indexing**:
                On boot, the manager registers all memory headers in `<workspace>/.voidrift/memory/` and `~/.config/voidrift/memory/` into a standard collection:
                ```typescript
                interface MemoryDoc {
                  id: string;
                  title: string;
                  summary: string;
                  keywords: string[];
                  files: string[];
                  extensions: string[];
                  rawText: string; // Flat concatenation of title + summary + keywords
                }
                ```
            2.  **Query Generation**:
                Builds a multi-anchor search query `q` containing:
                - Tokenized terms from the last user input message.
                - Current step strings in the `activePlan`.
                - Filenames and extensions inside `focusedFiles`.
            3.  **TF-IDF Scoring Formula**:
                For query term `t` and document `d` in collection `D`:
                - *Term Frequency (TF)*: `TF(t, d) = count of t in d.rawText / total terms in d.rawText`
                - *Inverse Document Frequency (IDF)*: `IDF(t, D) = ln(1 + (total documents in D / count of documents containing t))`
                - *Relevance Weight Multipliers*:
                  - If `t` matches a term in `d.keywords` exactly: multiply term score by `2.5`.
                  - If query contains a file extension matching `d.extensions`: multiply score by `3.0`.
                  - If query contains a filename matching `d.files`: multiply score by `4.0` (direct match anchor).
                - *Total Score*: `Score(q, d) = Sum_over_terms_t ( TF(t, d) * IDF(t, D) * Multiplier )`
            4.  **Ranking & Injection**:
                Sorts the collection in descending order of `Score(q, d)`. Filters out documents scoring below `0.1` and loads the top `K` results (default `topK = 5`) into `activeMemoryIndex` inside the Governance Partition as lightweight metadata cards (ID, title, summary), consuming `<150` tokens.
        *   **Stage 2: Disclosed (Model-Controlled Load/Unload)**: The model is provided two native primitive tools:
            *   `load_memory(id)`: Fetches the full-text body of a discovered memory and injects it into the `activeMemory` Workspace Partition.
            *   `unload_memory(id)`: Purges the full-text body from the active context immediately.
    *   *Outcome*: Gives the model complete, active control over its own context budget. If the model loads a memory and realizes it is irrelevant to the active task, it unloads it, keeping subsequent turns completely free of context pollution.
    *   *Rationale*: Implements a two-stage relevance index that lets the model dynamically load and unload context on-demand, preventing token bloat while keeping vital historical learnings discoverable.

---

## 5. File System Architecture & Directory Layout

To prevent configuration drift, namespace collisions, and bootstrap conflicts, VoidRift maintains a strict separation of concerns between local project workspaces and global system configurations:

### A. The Project Working Directory: `<workspace>/.voidrift/`
This folder is created locally within each workspace root directory, containing project-specific configurations, memories, and session logs. Rather than forcing a blanket ignore, VoidRift supports a flexible Git integration policy, giving developers direct control over their `.gitignore` configurations:

*   **Workspace Configuration (`<workspace>/.voidrift/config.json`)**: *[Optional to Commit]* Workspace-specific overrides (tier mappings, model endpoints, tool timeouts, MCP servers). Deep-merges over global config. Committing this allows teams to share unified workspace setups.
*   **Active Session Registry (`<workspace>/.voidrift/sessions/`)**: *[Recommended to Git-Ignore]* Stores transaction-level JSON history for active and historical turns specific to this repository (`session-<uuid>.json`). Prevents polluting source control with volatile session logs.
*   **Project Semantic Memory (`<workspace>/.voidrift/memory/`)**: *[Optional to Commit]* Houses local vector/keyword indexes and serialized episodic learned lessons unique to this codebase's development journey.
*   **Volatile Caches & Telemetry Logs (`<workspace>/.voidrift/cache/`)**: *[Must be Git-Ignored]* Temporary stores such as the Workspace Code-Map AST cache, transient tool logs, and cost/telemetry audit files.
*   **Project Audit Logs (`<workspace>/.voidrift/logs/`)**: *[Recommended to Git-Ignore]* Local storage for transaction-level session logs and raw model interaction histories (`session-<uuid>.log`).

### B. The Global CLI Directory: `~/.config/voidrift/`
This folder resides in the user's home directory. It contains all settings, templates, and cross-project knowledge that govern the entire harness installation.

*   **Global Harness Configuration (`~/.config/voidrift/config.json`)**: Holds the primary user settings, global model catalog specifications (protocols, providers, context limits, and token cost pricing rates), global model API keys, default endpoints, custom TUI theme overrides, and tool approval boundaries.
*   **Global Episodic Memory (`~/.config/voidrift/memory/`)**: Houses cross-project learned lessons and architectural patterns accumulated over time across all workspaces.
*   **Global Session Registry Tracker (`~/.config/voidrift/history.json`)**: An index tracking all active workspaces and their historical session IDs, allowing session recovery from any directory path.
*   **Global Prompt & Persona Resources (`~/.config/voidrift/resources/`)**: Centralized editable prompt files, system instruction templates, and custom mode definitions.
*   **Global System Logs (`~/.config/voidrift/logs/`)**: Stores CLI/TUI application error logs (`error.log`) and core system crash dumps.
*   **Global Custom Agents Registry (`~/.config/voidrift/agents/`)**: Folder containing custom, developer-configured agent subdirectories. This allows developers to dynamically extend the baseline engineering graph with custom analytical or auditing personas (e.g., Security, Performance, or Documentation Specialists) without modifying core engine source code.

### C. Folder-Scoped Resource Specification (Self-Contained Agents & Skills)

To enforce **Asset Co-location** and **Self-Containment**, both custom agents and skills in VoidRift are packaged as isolated, multi-file folders rather than flat single files. This ensures that all configurations, prompts, and dynamic triggers are fully portable, independent, and easily distributed:

#### 1. Self-Contained Agent Folder Structure
Custom agent personas reside in dedicated folders under either local `<workspace>/.voidrift/agents/{agent_name}/` or global `~/.config/voidrift/agents/{agent_name}/`:
*   **`agent.json`** (Required): Declares structural metadata for the agent:
    *   *Properties*: `name` (string), `description` (string), `defaultModelTier` (`"flash" \| "utility" \| "dense"`), and `allowedTools` (array of tool names).
*   **`prompt.md`** (Required): Contains the raw, multi-line system prompt instruction payload injected into the `activePersona` partition slot when the agent node activates.
*   **`memory/`** (Optional): A localized directory holding agent-specific vector files or key-value index caches to populate custom memory contexts.

#### 2. Self-Contained Skill Folder Structure
Coding guidelines and technical standards reside in dedicated folders under local `<workspace>/.voidrift/skills/{skill_name}/`, global `~/.config/voidrift/skills/{skill_name}/`, or shared `~/.config/voidrift/shared/skills/{skill_name}/`:
*   **`SKILL.md`** (Required): Primary guidelines document starting with the standard YAML triggers frontmatter (extensions, file triggers, keywords) followed by the raw technical advice injected dynamically into `activeSkills`.
*   **`templates/`** (Optional): Directory of boilerplate coding patterns, configuration templates, or mock scripts that the Engineer agent can dynamically retrieve to accelerate development.
*   **`rules.json`** (Optional): Declarative syntax, format, or schema rules parsed and checked programmatically by the Auditor node to verify compliance.

---

## 6. The Slash Command Registry

Slash commands are executed directly in the Operator Interface terminal input line. They allow the operator to manage the harness session, view performance metrics, and perform local-only actions without consuming LLM context window budget.

*   **`/help` — Interactive Help Overlay**
    *   *Action*: Launches a three-page TUI overlay. Pages are cycled with `←/→` or `tab`, displayed as a tab bar at the top of the panel (`general`, `commands`, `shortcuts`):
        *   **General Page** — Identity & Session Info:
            *   A brief tagline describing the harness capabilities (codebase understanding, permissioned edits, terminal command execution).
            *   *Version*: The active harness version string.
            *   *Account*: The authenticated user identity and provider plan (e.g., `tjpresley@gmail.com (Google AI Pro)`).
            *   *Workspace*: The short-form tilde-relative path to the active workspace root.
            *   *Project*: The full absolute path to the active project directory.
            *   *Conversation*: The UUID of the active session.
            *   *Quick Reference*: A brief tip surface (e.g., `Type / to see available commands`).
        *   **Commands Page** — Slash Command Directory:
            *   A scrollable list of every slash command registered in the VoidRift command registry, each showing its name, optional aliases, and a one-line description of its action. Populated dynamically from the core and plugin command registries at runtime.
        *   **Shortcuts Page** — Keyboard Reference:
            *   A scrollable reference table of all global TUI keybindings defined for VoidRift, organized by context (Input, Navigation, Panels, Session). Populated from the VoidRift keybinding registry, reflecting any custom keybinding overrides the operator has configured.
        *   **TUI Keybindings**:
            *   `↑/↓`: Scroll within the active page.
            *   `←/→` or `tab`: Cycle between the General, Commands, and Shortcuts pages.
            *   `esc`: Close the overlay and return to the main input line.
    *   *Outcome*: A self-contained reference panel exposing session identity, the full command registry, and the complete keyboard shortcut map without leaving the TUI.

*   **`/model [alias]` — Interactive Model Switcher**
    *   *Action*: Behavior depends on whether an alias argument is provided:
        *   **With alias** (e.g., `/model qwen-local`): Immediately assigns the named model to **all three tier roles** (`[d,u,f]`) simultaneously without opening the TUI overlay. This is the fastest way to point the entire harness at a single model for local or offline sessions.
        *   **Without alias**: Launches an interactive TUI overlay listing every registered model from the active global and workspace configurations, with their currently assigned tier roles rendered inline:
            *   **Model Inventory**: Displays all available models as a navigable list. Each model entry shows its display name and a bracketed tier tag (`[d]` = Dense, `[u]` = Utility, `[f]` = Flash) for all roles it is currently assigned to. Models with no active role assignment render with no tag.
            *   **Role Assignment Hotkeys**: Allows the operator to instantly reassign individual tier roles without navigating any sub-menus:
                *   `d`: Assigns the highlighted model as the active **Dense** tier.
                *   `u`: Assigns the highlighted model as the active **Utility** tier.
                *   `f`: Assigns the highlighted model as the active **Flash** tier.
            *   **Multi-role Support**: A single model may hold multiple tier roles simultaneously (e.g., `[u,f]` denotes it serves as both Utility and Flash), allowing compact local setups that route all non-Dense tasks to a single model.
            *   **TUI Keybindings**:
                *   `↑/↓`: Navigate through the full registered model list.
                *   `enter`: Immediately set the highlighted model as the active model for the current session's default tier.
                *   `d` / `u` / `f`: Assign the highlighted model to the Dense, Utility, or Flash tier respectively.
                *   `esc`: Dismiss the overlay and return to the main input line without saving changes.
    *   *Outcome*: Real-time, role-aware model management — a single alias argument for a quick all-role swap, or the full interactive overlay for granular per-tier assignment.
*   **`/stats` — Session Analytics Panel**
    *   *Action*: Opens a bordered TUI panel rendering four grouped sections of real-time session telemetry:
        *   **Session Summary**:
            *   Session UUID (truncated identifier for the active run).
            *   Total wall-clock duration of the active session.
            *   Total turn count (complete operator-to-model round trips).
        *   **Performance Breakdown**:
            *   *Wall Time*: Total elapsed clock time.
            *   *API Time*: Cumulative time spent waiting on model network responses, expressed as an absolute duration and a percentage of wall time.
            *   *Tool Time*: Cumulative time spent executing local tool calls, expressed as an absolute duration and a percentage of wall time.
        *   **Tool Execution Summary**:
            *   *Calls*: Total tool invocations with inline success (✓) and error (✗) counts.
            *   *Success Rate*: Overall tool call success percentage.
        *   **Per-Model Usage Table**: A columnar breakdown of token consumption and throughput for every model active in the session:

            | Column | Description |
            | :--- | :--- |
            | **Model** | Model name and provider label (e.g., `qwen2.5-coder-32b (local)`). |
            | **Turns** | Number of generation turns driven by this model. |
            | **Input** | Total input tokens sent to this model across all turns. |
            | **Output** | Total output tokens generated by this model. |
            | **Cache** | Total prompt cache hit tokens reused (shown as `—` if provider does not support caching). |
            | **tok/s** | Average generation throughput in tokens per second. |

            A bold **Total** row aggregates all values across all active models.
        *   **Context Utilization**: Color-coded ratio indicator (green / yellow / red) showing active token usage as a percentage of the model's context limit, with the raw token count and limit displayed inline.
        *   **TUI Keybindings**:
            *   `↑/↓`: Scroll through the panel if content exceeds terminal height.
            *   `esc`: Close the panel and return to the main input line.
    *   *Outcome*: Complete operational transparency for diagnosing latency bottlenecks, tool reliability, prompt cache effectiveness, and per-model token costs.
*   **`/context` — Interactive Context Visualizer**
    *   *Action*: Launches an interactive TUI overlay panel displaying a rich visual representation of the active token budget and prompt allocation ratios:
        *   **Context Usage Matrix Grid**: Renders a dynamic block-character grid (colored circles mapping active segments vs. empty squares mapping remaining free space) representing prompt load status in real-time.
        *   **Token Allocation by Category**: Lists color-coded token weight percentages split across:
            *   *User Messages* (raw operator input history).
            *   *Agent Responses* (completed model completions).
            *   *Tool Calls & Payloads* (arguments and returned outputs).
            *   *System Prompts & Tools* (Governance guidelines and schema budgets).
            *   *Subagents* (allocated background thread context buffers).
            *   *Free Space* (available workspace headroom).
            *   *Checkpoint Buffer* (summarized data excluded from context window budget).
        *   **Disclosed Asset Directory**: Lists all active local/global files, custom scratch scripts, and loaded guidelines currently inside the prompt, showing their individual file path and precise token size.
        *   **Active Checkpoints Directory**: Displays transaction checkpoints (supporting `/rewind` triggers) indicating which turns are currently cached versus those summarized.
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the visual directory of active loaded assets and checkpoints.
            *   `enter`: Select a specific asset or checkpoint to inspect detailed token breakdowns.
            *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Immediate, granular visual telemetry for debugging context bloat, managing prompt cache optimization, and managing active technical resources.
*   **`/diff [option]` — Interactive Code Diff Viewer**
    *   *Action*: Operates in two distinct modes depending on whether it is triggered automatically by system writes or invoked manually by the operator:
        *   **Inline Tool Approval Gate (System-Triggered)**: Intercepts all file mutations (such as `write_file` or `edit_file`) in real-time. It computes a unified git diff and renders it directly inline inside the TUI message stream (using syntax-highlighted red/green borders). The TUI freezes keyboard input and prompts the developer for explicit permission (`Approve changes? [y/n]`) before the physical file is written.
        *   **Manual Diff Viewport Overlay (Operator-Triggered)**:
            *   *Workspace Scope (Default `/diff`)*: Spawns a full-screen scrollable TUI overlay piping `git diff --color=always` into an internal styled viewport. This lets the operator review the cumulative state of all uncommitted workspace changes.
            *   *Turn Scope (`/diff --turn` / `-t`)*: Filters the Git diff tree to display *only* the modifications made by the agent's tool executions during the current conversational turn, isolating them from any manual edits in the workspace.
        *   **TUI Keybindings**:
            *   `↑/↓` or `pgup/pgdn`: Scroll through the active diff output.
            *   `esc` or `ctrl+c`: Close the overlay and return to the main input line.
    *   *Outcome*: Absolute code-mutation transparency. Enables operators to audit the model's physical writes turn-by-turn and enforce strict permission gates before code touches the file system.
*   **`/tools` — Capability Discovery**
    *   *Action*: Lists all registered tools available to the model under the currently active execution mode (`chat`, `plan`, `vibe`).
    *   *Outcome*: Immediate auditing of the active security permission boundary.
*   **`/skills` — Skill Registry**
    *   *Action*: Launches an interactive TUI overlay to list, discover, and inspect dynamically registered coding guidelines and technology standards:
        *   **Discovered Paths**: Scans and registers `SKILL.md` definition files at:
            *   *Workspace Scope*: `<workspace>/.voidrift/skills/{skill_name}/SKILL.md`
            *   *Global Scope*: `~/.config/voidrift/skills/{skill_name}/SKILL.md`
            *   *Shared Scope*: `~/.config/voidrift/shared/skills/{skill_name}/SKILL.md`
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the list of visual discovered skills.
            *   `enter`: Open and view the detailed markdown rules and triggered constraints of the selected skill.
            *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Instant auditing of which tech-stack rules and guidelines are currently loaded or available for dynamic prompt injection.
*   **`/agents` — Dynamic Agent Manager**
    *   *Action*: Launches an interactive TUI overlay to list, configure, toggle, and terminate background agent personas:
        *   **Creation Templates**: Generates structural `agent.json` configuration blocks at:
            *   *Workspace Scope*: `<workspace>/.voidrift/agents/{agent_name}/agent.json`
            *   *Global Scope*: `~/.config/voidrift/agents/{agent_name}/agent.json`
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the visual **Available Agents** directory list.
            *   `enter`: Select an agent to inspect details or toggle its active activation state in the orchestration graph.
            *   `k`: Instantly kill a running background subagent process and prune its locked file boundaries.
            *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Total, runtime control over custom agent personalities, dynamic orchestration paths, and background task cancellation.
*   **`/mcp` — MCP Server Manager**
    *   *Action*: Launches an interactive TUI overlay to list, configure, connect, and disconnect MCP (Model Context Protocol) servers registered with the harness:
        *   **Server Inventory**: Displays the full directory of currently configured MCP servers, their connection status (`connected`, `disconnected`, `error`), and the tool schemas they expose.
        *   **Configuration Paths**:
            *   *Workspace Scope*: `<workspace>/.voidrift/mcp.json`
            *   *Global Scope*: `~/.config/voidrift/mcp.json`
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the MCP server list.
            *   `enter`: Open available actions for the selected server (Connect, Disconnect, Inspect exposed tool schemas, Remove).
            *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Runtime management of all external MCP integrations without requiring session restarts or config file edits.
*   **`/ideas` — Interactive Ideas Manager**
    *   *Action*: Launches an interactive TUI overlay panel displaying the full directory of registered PM ideas (ID, Title, Priority, Status, Age).
    *   *TUI Keybindings*:
        *   `↑/↓`: Navigate the registered ideas list.
        *   `enter`: Swaps active mode to `idea`, flushes prior conversational context, and loads the selected idea into Workspace focus.
        *   `n` (New Idea): Spawns a blank idea file, flushes context, and opens the intake chat.
        *   *TUI Panel State*: Switches the TUI to `idea` mode, clears all prior context, and loads the new blank idea into focus.
        *   `d` (Delete): Safely deletes the highlighted idea file from disk.
        *   `esc`: Close the overlay and return to the main input line.
    *   *Outcome*: Instant requirement retrieval, creation, and pruning from a single, unified panel dashboard.

*   **`/templates` — Dynamic Template & Prompt Manager**
    *   *Action*: Launches an interactive TUI overlay panel displaying a complete catalog of registered document layouts and agent prompt instructions:
        *   **Interactive Table Columns**:
            *   *Template Key*: Unique identifier (e.g. `dev/task`, `prompts/plan-arch`).
            *   *Type*: Segregates the layout usage (`Document` for physical files vs. `Prompt` for LLM system instructions).
            *   *Source*: Registering plugin or core module (e.g. `@voidrift/plugin-dev`, `[CORE]`).
            *   *Status*: Renders active override state as `[default]` (in-memory standard), `[override: local]` (workspace file), or `[override: global]` (global user file).
            *   *Overriding Path*: Tilde-relative path of the overriding file on disk.
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the registered template and prompt list.
            *   `enter`: Open a split-pane text viewport showing a preview of the asset compiled with mock telemetry data.
            *   `o` (Override Local): Spawns the default system text editor on the local workspace override path:
                * For Document: `<workspace>/.voidrift/templates/{key}.md`
                * For Prompt: `<workspace>/.voidrift/prompts/{key}.md`
                * Auto-instantiates with default content if the target file is missing.
            *   `g` (Override Global): Spawns the default system text editor on the global user override path:
                * For Document: `~/.config/voidrift/templates/{key}.md`
                * For Prompt: `~/.config/voidrift/prompts/{key}.md`
                * Auto-instantiates with default content if the target file is missing.
            *   `d` (Delete Override): Deletes the currently active local or global override file, performing a cascading fallback (Local $\rightarrow$ Global $\rightarrow$ Packaged Default).
            *   `esc`: Close the overlay and return to the main input line.
    *   *Outcome*: Total operational control over both file formatting layouts and LLM agent instructions, allowing real-time prompt engineering and revert paths directly from the TUI console.

*   **`/compact` — Manual History Compaction**
    *   *Action*: Manually triggers conversational history compaction, compressing older conversational turns inside the Work Layer into a chronological recap while leaving the Governance Layer untouched.
    *   *Outcome*: Reclaims valuable context window space on-demand.
*   **`/clear` — State Reset**
    *   *Action*: Deletes the active session JSON log from disk and resets the conversational history, returning the harness to a pristine boot state.
    *   *Outcome*: Starts a clean chat sheet instantly.
*   **`/resume` — Conversation Browser**
    *   *Action*: Launches an interactive TUI overlay presenting the full searchable conversation history index across all scoped sessions. The overlay renders two tabbed views (cycled with `tab`):
        *   **CLI Tab**: Lists conversations native to the VoidRift CLI harness.
        *   **Antigravity Tab**: Lists conversations sourced from the broader Antigravity conversation index.
        *   **Conversation Inventory**: Each entry in the list displays:
            *   A `[CURRENT]` marker on the active session.
            *   A truncated conversation title (inferred or manually renamed).
            *   A step count (total turns in the session).
            *   A relative timestamp of the last interaction (e.g., `29m ago`, `2d ago`).
        *   **Search**: A real-time fuzzy search bar to filter the conversation list by title keywords.
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the conversation list.
            *   `←/→`: Page through multi-page conversation listings.
            *   `enter`: Resume the selected conversation, restoring its serialized session state.
            *   `f2`: Rename the selected conversation title inline.
            *   `ctrl+delete`: Permanently delete the selected conversation and purge its session log from disk.
            *   `tab`: Switch between the CLI and Antigravity tab views.
            *   `esc`: Dismiss the overlay or clear the active search query.
    *   *Outcome*: Full session lifecycle management — operators can navigate, restore, rename, or permanently discard any prior conversation from a single interactive panel.
*   **`/rewind [turn]` — Conversational & Codebase Rollback Engine**
    *   *Action*: Performs a stateful transaction rollback, restoring both the episodic message history and the physical workspace codebase to a previous completed checkpoint:
        *   **With Turn Argument** (e.g., `/rewind 3`): Truncates the active conversational history precisely to the end of Turn 3, purging all subsequent messages and tool execution logs. It then programmatically triggers the Git Safeguard to perform a hard reset (`git reset --hard voidrift-checkpoint-turn-3`), reverting all codebase files to that exact transaction checkpoint.
        *   **Without Turn Argument**: Launches an interactive TUI overlay presenting a reverse-chronological directory of all completed turns in the active session:
            *   *Turn Ledger Index*: Each entry displays the turn index, a truncated summary of the user prompt for that turn, and a confirmation indicator showing if a Git checkpoint is cached on disk.
            *   *TUI Keybindings*:
                *   `↑/↓`: Navigate through the completed turns directory list.
                *   `enter`: Execute the rollback, instantly reverting both the chat memory and the codebase files to the selected turn.
                *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Total fault tolerance. If the agent enters a hallucination loop, introduces linter errors, or makes unwanted file writes, the operator can instantly revert both the conversation and the codebase back to a pristine previous checkpoint in under a second.
*   **`/memory` — Interactive Memory Manager**
    *   *Action*: Launches an interactive TUI overlay presenting a scoped, browsable index of all persisted memory entries across the two-layer registry. The overlay renders two tabbed views (cycled with `tab`):
        *   **Workspace Tab**: Lists all memory entries stored under `<workspace>/.voidrift/memory/`, scoped to the active project.
        *   **Global Tab**: Lists all memory entries stored under `~/.config/voidrift/memory/`, shared across all workspaces.
        *   **Memory Inventory**: Each entry in the list displays:
            *   The memory `id` (e.g., `mem-db-pool-01`).
            *   The memory `title` (human-readable summary label).
            *   Its current load state: `[loaded]` if currently injected into the active context, or untagged if in metadata-only Stage 1 state.
            *   A relative timestamp of when the memory was last written or updated.
        *   **Search**: A real-time fuzzy search bar to filter memory entries by title, keyword, or extension trigger.
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the memory list.
            *   `enter`: Open the full-text body of the selected memory entry for inspection.
            *   `l`: Load the selected memory into the active `activeMemory` Workspace Partition slot for immediate context injection.
            *   `u`: Unload the selected memory from the active context, purging it from the Workspace Partition.
            *   `n`: Create a new memory entry interactively, prompting for title, summary, and trigger criteria.
            *   `ctrl+delete`: Permanently delete the selected memory entry from disk.
            *   `tab`: Switch between the Workspace and Global memory scopes.
            *   `esc`: Dismiss the overlay or clear the active search query.
    *   *Outcome*: Complete operator control over the agent's long-term recall buffers — inspecting, loading, unloading, creating, and purging memory entries across both workspace and global scopes from a single interactive panel.
*   **`/tasks` — Background Task & Process Monitor**
    *   *Action*: Launches a full-screen, interactive TUI overlay to monitor, inspect, and supervise all active, queued, or recently executed asynchronous tasks and parallel subagent threads:
        *   **Task Ledger Directory**: Displays a scrollable columnar list of all background operations:
            *   *ID / PID*: The system process ID or the subagent's UUID.
            *   *Type*: Categorized by task runner type (e.g., `subagent`, `shell-command`, `fetch`).
            *   *Description*: Shows the active terminal command string (e.g. `npm run test`) or the subagent's target branch and locked file boundaries.
            *   *Duration*: Absolute elapsed wall-clock running time of the task.
            *   *Status*: Real-time status indicator (`queued` ──► `running` ──► `completed` [✓] or `failed` [✗]).
        *   **TUI Keybindings**:
            *   `↑/↓`: Navigate through the active task list.
            *   `enter`: Opens a split-pane text viewport showing real-time `stdout`/`stderr` streams or the subagent's active thought trace logs.
            *   `k` or `ctrl+x`: Instantly terminates the highlighted task (kills system shell PIDs or shuts down the background subagent, pruning its Git worktree and purging its file locks from `activeLocks`).
            *   `esc`: Dismiss the overlay menu and return to the main input line.
    *   *Outcome*: Complete operational control and process supervision over concurrent agent executions, background test/build loops, and path-locking mutex queues from a single console dashboard.
*   **`/goal [instruction]` — Autonomous Execution Loop**
    *   *Action*: Bypasses the TUI's interactive permission gate to execute a complex multi-turn instruction completely automatically. The harness loops through the LangGraph multi-agent orchestration cycle, writing code, executing builds, and running diagnostics, and will not terminate until the Auditor node sets `Pass` or a safety budget is exceeded:
        *   **Autonomous Pipeline Sequence**:
            1. *Orchestration Graph Entry*: The Entry Router parses the goal instruction and triggers the Architect node to compile `activePlan`.
            2. *Permission Gate Bypass*: All file write and command execution tools are programmatically auto-approved for the duration of the goal (equivalent to running inside a secure git branch/worktree under a locked sandbox).
            3. *Execution & Verification Loop*: The Engineer implements plan steps, builds, and hands off to the Auditor. The Auditor runs verification tests. If tests fail, the Auditor sets `Rework` and pipes linter diagnostics back to the Engineer.
            4. *Autonomous Termination*: The loop breaks and returns control to the TUI only when the Auditor sets `Pass` (which merges the changes and completes the turn) or the safety budget (maximum 15 turns or 500k tokens) is exhausted.
        *   **TUI Keybindings**:
            *   `ctrl+c` or `k`: Instantly interrupts the autonomous goal execution loop, halts all background processes, and preserves the active worktree for standard operator debugging.
            *   `esc`: Minimizes the active goal status panel to the TUI background, allowing the operator to use the chat prompt while the goal runs asynchronously (monitored via `/tasks`).
    *   *Outcome*: Completely handoff-free development. The operator can define a complex architectural objective and walk away; the harness will iteratively write, build, test, and correct its own errors until it has mathematically verified that the task is 100% correct.
*   **`/schedule [cron/delay] "[instruction]"` — Background Timer & Scheduled Task Cron**
    *   *Action*: Registers an asynchronous background task to execute a specific prompt or linter command either on a recurring cron interval or after a one-shot countdown timer:
        *   **Operational Formats**:
            *   *Recurring Cron Job*: Takes a standard 5-field cron syntax (e.g. `/schedule "*/30 * * * *" "run tests"`), registering it inside the TUI Harness Task Scheduler.
            *   *One-Shot Delay Timer*: Takes a standard duration sequence (e.g. `/schedule --delay 15m "run verification"`), launching the task exactly once after the timer expires.
        *   **Asynchronous Background Execution**: When the trigger fires, the harness spawns a background subagent, provisions an isolated Git worktree, locks write boundaries in `activeLocks`, bypasses TUI permission prompts, and writes session outputs to the local project audit logs under `<workspace>/.voidrift/logs/`.
        *   **TUI Supervisor Integration**: All active schedules, cron jobs, and countdown timers are monitored, suspended, or terminated directly from the `/tasks` Ledger Directory panel.
    *   *Outcome*: Automated local workspace operations and background repository audits. Enables VoidRift to perform routine test runs, structural AST code-map updates, or scheduled code analysis completely in the background without blocking the active interactive console chat.
*   **`/exit` — Session Termination**
    *   *Action*: Safely serializes the final active turn and exits the TUI process.
    *   *Outcome*: Graceful shutdown.

---

## 7. The Central Event Lifecycle

Communication across these feature modules is governed by six high-level lifecycle events:

1.  `USER_INPUT`: Published by the Operator Interface when the developer submits a prompt, telling the Agent Session to start a new execution turn.
2.  `TOKEN_STREAM`: Published by the Model Connectivity module, carrying real-time text fragments from the active stream. The Operator Interface renders these tokens as they arrive.
3.  `TOOL_CONFIRMATION_REQUEST`: Published by the Security Subsystem when an unsafe tool is proposed. It carries the tool name, arguments, and diff details, prompting the Operator Interface to render an approval overlay.
4.  `TOOL_CONFIRMATION_RESPONSE`: Published by the Operator Interface when the developer approves or denies a blocked action, signaling the Security Subsystem to resume or abort.
5.  `ERROR_OCCURRED`: Published by the Agent Session when an API connection or execution exception is caught, telling the Operator Interface to display the error inline and release the Input Lock.
6.  `TURN_COMPLETE`: Published by the Agent Session when the model completes its response and no further tools are queued, triggering the Session State writer to persist the chat logs to disk.

---

## 8. LangGraph Multi-Agent State-Graph Schema

VoidRift's agent execution cycle is governed by a **LangGraph StateGraph** — a directed, conditional graph of three specialized node personas sharing a single typed state object. Each node reads from and writes to that shared state; conditional edges route execution forward based on state slot values.

### 8.1 Shared State Schema

The state object is the single source of truth passed between all nodes:

| Slot | Type | Owner | Description |
|---|---|---|---|
| `activePlan` | `string \| null` | Architect (write) | Step-by-step markdown implementation plan. Null until the Architect node populates it. |
| `focusedFiles` | `string[]` | Engineer (write) | Absolute paths of files currently under active edit or review. |
| `diagnostics` | `string \| null` | Auditor (write) | Raw compiler/linter output captured after Engineer execution. |
| `routingFlag` | `Pass \| Rework \| null` | Auditor (write) | Routing decision produced by the Auditor. Null during Architect and Engineer phases. |
| `messages` | `BaseMessage[]` | All nodes (append) | Chronological log. Utilizes the standard LangGraph `messagesStateReducer` (append-only) to prevent node transitions from overwriting the turn history. |
| `activeMode` | `plan \| chat \| vibe` | Harness (write) | Active sandbox boundary set by `TAB`. `plan` = read-only, no writes; `chat` = full access + permission gate ON; `vibe` = full access + permission gate OFF. |
| `activePersona` | `string` | Harness (write) | The system prompt injected into the Governance Partition for the currently active node. |

### 8.2 Node Personas

#### `Architect` — Design & Planning Node
*Evaluates the operator's intent and produces or revises the implementation plan.*

*   **Responsibilities**: Reads the full request, assesses scope, creates or updates `activePlan` with discrete, auditable steps.
*   **Allowed Tools**: `read_file`, `glob_files`, `web_search`.
*   **Prohibited**: `write_file`, `edit_file`, `execute_command`. The Architect cannot touch the file system or shell.
*   **Exits when**: `activePlan` is written and the node signals completion.

#### `Engineer` — Execution Node
*Performs the file edits and shell operations required to implement `activePlan`.*

*   **Responsibilities**: Iterates through `activePlan` steps, performs targeted `write_file`/`edit_file` calls, runs build or test commands via `execute_command`, and appends paths to `focusedFiles`.
*   **Allowed Tools**: `read_file`, `glob_files`, `write_file`, `edit_file`, `execute_command`.
*   **Prohibited**: Modifying `activePlan`. The Engineer executes the plan; it does not revise it.
*   **Exits when**: All plan steps for the current turn are executed.

#### `Auditor` — Verification Node
*Validates Engineer output and produces the routing decision.*

*   **Responsibilities**: Reads `focusedFiles`, runs diagnostics (`execute_command` in read-only/test mode), captures output into `diagnostics`, and sets `routingFlag`.
*   **Allowed Tools**: `read_file`, `execute_command` (test/lint invocations only).
*   **Prohibited**: `write_file`, `edit_file`. The Auditor never mutates the workspace.
*   **Exits when**: `routingFlag` is set to `Pass` or `Rework`.

### 8.3 Conditional Routing Edges

To remain fast and reliable in multi-turn, fluid conversations, VoidRift's entry router splits incoming turns into either a lightweight **Direct Chat Path** or a structured **Active Task Path** based on active task context:

1. **Direct Chat Path (Bypass)**: If `activePlan` is null and `activeMode` is not `plan`, the user's message is processed as a standard conversational turn. No node transitions or multi-agent graphs are activated.
2. **Active Task Path (Orchestrated)**:
   * **Entry Route**: The user's input determines which node boots up:
     * *Plan / Design Intent* (or `activePlan` is null & mode is `plan`) ──► **Architect Node**
     * *Execution Intent* (or continuation of active plan) ──► **Engineer Node**
     * *Verification / Test Intent* (explicit test instruction) ──► **Auditor Node**
   * **Execution Loop**:
     * **Architect** writes/updates the plan ──► exits to operator (in `plan` mode) or hands off to **Engineer**
     * **Engineer** executes step edits ──► always transitions to **Auditor**
     * **Auditor** verifies results and sets the `routingFlag`:
       * `Rework` ──► returns to **Engineer with diagnostics** injected into the Work Partition.
       * `Pass` ──► transitions to **END** (publishes `TURN_COMPLETE`, serializes state, and releases the Input Lock).
---

## 9. Core Extension & Plugin Hook Specification

To keep the Core Harness (`@voidrift/core`) 100% generic, lightweight, and extensible, all specialized workflows and domain schemas are segregated out of the core package. Plugins integrate with the Composition Root on startup by receiving the core instance and interacting with standardized registration and service interfaces.

### 9.1 The Plugin Registration Interface (Plugin-to-Core)
Plugins utilize the following core-exposed methods to register hooks, extend active state, and wire custom capabilities:
*   **`registerCommand`**: Registers custom slash commands into the Operator Interface command router.
    *   *Parameters*: Command string name (e.g., `/develop`), help description, and an async handler callback that receives argument tokens, active session state, and the Event Bus.
*   **`registerSandboxMode`**: Overrides system instruction templates and tool constraints dynamically.
    *   *Parameters*: Mode string name (e.g., `cr`), a custom system prompt template, and a path-guard predicate function (takes a target absolute path and returns a boolean value defining if file-writing tools are allowed to mutate that path).
*   **`registerGraphNode`**: Programmatically injects a custom node into the LangGraph state graph.
    *   *Parameters*: Unique node name (e.g., `Architect`), agent persona instructions, an array of allowed tool schema names, and the node's async execution handler.
*   **`registerGraphEdge`**: Wires custom routing edges between graph nodes.
    *   *Parameters*: Source node name, target node name, and a conditional routing function that evaluates session state to determine the transition.
*   **`subscribeEvent`**: Registers event interceptors on the Event Bus.
    *   *Parameters*: Event type key (e.g., `ON_BEFORE_TOOL`, `ON_TURN_END`), and an event handler callback to inspect or transform context.

### 9.2 The Core Service Interface (Core-to-Plugin)
The core harness exposes execution primitives and system utilities that plugins invoke to perform safe operations:
*   **`spawnSubagent`**: Provisions resources for background parallel agent tasks.
    *   *Parameters*: Target Git branch name, array of absolute file write boundaries.
    *   *Returns*: Background agent session handle. This service dynamically provisions isolated Git worktrees under `<workspace>/.voidrift/worktrees/` and registers boundaries in `activeLocks`.
*   **`executeCommand`**: Runs safe, sandboxed subprocess commands.
    *   *Parameters*: Terminal command string, working directory, process execution timeout.
    *   *Returns*: Sanitized stdout/stderr text block (with ANSI codes stripped and outputs truncated).
*   **`getWorkspaceMap`**: Compiles repository AST structure.
    *   *Returns*: Compressed, token-efficient repository AST code-map tree.
*   **`emitEvent`**: Dispatches custom notifications or progress updates.
    *   *Parameters*: Event key, payload dictionary. Allows commands to publish stream progress to the Operator TUI.

### 9.3 Comprehensive Event Bus Registry Directory
To allow plugins to dynamically react to, intercept, or enrich the harness lifecycle, the central Event Bus orchestrates a rigid suite of events. Plugins subscribe to these keys via `subscribeEvent` or trigger them via `emitEvent`:

| Event Key | Trigger Timing | Payload Parameters | Architectural Use Case |
| :--- | :--- | :--- | :--- |
| **`SESSION_START`** | Fires once during Composition Root bootstrap initialization. | `workspaceRoot` (string), `globalConfig` (object). | Initializing background plugin servers, establishing database channels, or scanning pre-flight toolchains. |
| **`SESSION_END`** | Fires immediately before the main application process exits. | `sessionDurationMs` (number), `exitCode` (number). | Cleaning up custom docker containers, tearing down lingering background daemons, or saving plugin logs. |
| **`USER_INPUT_RECEIVED`** | Fires when the operator submits a text query in the TUI/console. | `input` (string), `timestamp` (number). | Intercepting, auditing, or mutating user messages before they reach the orchestration graph. |
| **`MODE_CHANGED`** | Fires when the Operator Interface cycles active security parameters. | `previousMode` (string), `newMode` (string). | Dynamically adjusting tool schema permissions, swapping active rules, or loading custom technical guidelines. |
| **`NODE_TRANSITION`** | Fires when the LangGraph StateGraph switches active execution contexts. | `fromNode` (string), `toNode` (string), `stateSnapshot` (object). | Updating visual TUI indicators (e.g. loading animations), displaying stage progressions, or injecting node context. |
| **`STREAM_CHUNK_RECEIVED`** | Fires incrementally as raw adapter stream tokens are yielded. | `type` (`"content" \| "tool_call"`), `chunk` (string \| object). | Rendering live token words to the operator in real-time, striping formatting, or monitoring argument progress. |
| **`BEFORE_TOOL_EXECUTE`** | Fires immediately before a registered tool primitive runs. | `toolName` (string), `arguments` (object), `sessionState` (object). | Auditing parameters, enforcing custom security layers, or mutating/denying execution dynamically. |
| **`AFTER_TOOL_EXECUTE`** | Fires immediately after a tool execution finishes. | `toolName` (string), `arguments` (object), `status` (`"success" \| "error"`), `output` (string). | Post-processing command outputs, capturing diagnostics, or updating local state caches. |
| **`WORKSPACE_CHANGED`** | Fires when the File System Watcher detects file changes. | `filePaths` (string[]), `changeType` (`"create" \| "update" \| "delete"`). | Auto-indexing codebase structures, fresh AST mapping updates, or refreshing focused files metadata. |
| **`STATE_SERIALIZED`** | Fires when the Turn Serializer saves session state to disk. | `filePath` (string), `persistedState` (object). | Syncing development logs, backing up task records, or publishing state-change webhooks. |

---

## 10. The Development Workflows Extension (`@voidrift/plugin-dev`)

The software engineering workflows, change-tracking schemas, and development-specific lifecycle states are implemented as a decoupled addon inside `@voidrift/plugin-dev`. On startup, this plugin registers its custom nodes, mode sandboxes, and commands into `@voidrift/core` via the dynamic hook registry.

### 10.1 Development Workflow Objects (State Schemas)
The development plugin introduces three highly structured markdown and YAML state files stored inside the repository to track the engineering lifecycle:
*   **Ideas (`<workspace>/.voidrift/ideas/IDEA-<id>.md`)**: Captures PM-level briefs, feature concepts, and requirements.
*   **Change Requests / CRs (`<workspace>/.voidrift/changes/CR-<id>.md`)**: Defines the systems architecture plan, file change boundaries, test specs, and dependency trees.
*   **Tasks (`<workspace>/.voidrift/tasks/TASK-<id>.md`)**: Atomic, single-file code changes linked directly to an active CR.

### 10.2 The Custom Mode Sandboxes
The development plugin overrides the Core Harness's security boundaries to strictly enforce safety and focus during planning, design, and execution turns:
*   **`idea` Mode**: System prompt shifts to PM. Writing tools (`write_file`/`edit_file`) are locked dynamically by the harness to *only* allow modifications inside `<workspace>/.voidrift/ideas/`.
*   **`cr` Mode**: System prompt shifts to Architect. Writing tools are locked strictly to `<workspace>/.voidrift/changes/`.
*   **`dev` Mode**: System prompt shifts to Engineer. Writing tools are locked strictly to the files declared in the active CR's `focusedFiles` array, preventing the model from wandering or corrupting unrelated files.

### 10.3 The 5-Stage Dev Command Pipeline
The plugin registers five high-level slash commands to automate the entire engineering lifecycle:
*   **`/import [path]`**: Scans a codebase directory or single file and generates a clean structural import report.
*   **`/analyze --idea <id>`**: Spawns a PM agent to evaluate an active Idea, assess architectural fit, and automatically decompose it into CRs and Tasks.
*   **`/develop --cr <id>`**: Spawns isolated Engineer subagents inside concurrent Git worktrees to implement each Task declared inside a target CR.
*   **`/verify --cr <id>`**: Spawns Auditor subagents to test the acceptance criteria of a finished CR in the worktree, producing a markdown verification report.
*   **`/deploy --cr <id>`**: Commits the verified changes, generates a markdown changelog, tags the commit, and executes the deployment scripts.

### 10.4 PM Idea Mode & Interactive `/ideas` Manager

The `@voidrift/plugin-dev` package registers a standard **`idea` Sandbox Mode** and the interactive **`/ideas` TUI Manager** to govern the early intake, exploration, and categorization of software requirements.

#### 1. The `idea` Sandbox Mode & Context Boundaries

*   **Mode Trigger**: Hitting `SHIFT+TAB` cycles the active harness mode into `idea` mode.
*   **The Clean-Slate Invariant**: Swapping to `idea` mode automatically flushes the active `focusedFiles` array cache and clears any active plans from the Workspace Partition, ensuring a 100% clean, empty slate for a new ideation session.
*   **Strict Tool-Locking Gate**: The progressive tool registry restricts file-writing primitives (`write_file` / `edit_file`) to *strictly* allow mutations under `<workspace>/.voidrift/ideas/`. All other filesystem directories are locked.
*   **The One-Idea-in-Context Invariant**: To prevent token contamination and keep LLM context clean, the harness enforces a strict *single active idea* boundary. Loading an idea instantly flushes all prior conversational history (`messages` list) and focused files from the active session, keeping ONLY the single target idea in context.

#### 2. The `/ideas` TUI Command Manager

*   **Action**: Entering `/ideas` (or `/idea`) in the command bar launches a bordered TUI panel listing all recorded ideas in the manifest catalog:
    *   **Table Columns**: Displays Idea ID (e.g. `IDEA-01`), Title, Priority (`now` | `next` | `later`), Status (`intake` | `shaping` | `approved` | `planned`), and Created At relative age.
*   **TUI Keybindings**:
    *   `↑/↓`: Navigate through the recorded ideas directory list.
    *   `enter` (Load & Focus):
        1. Swaps the active harness mode to `idea` mode.
        2. Enforces the *One-Idea-in-Context* boundary by purging all active messages and focused files.
        3. Loads the selected `IDEA-[id].md` file into active Workspace focus.
        4. Closes the TUI overlay to begin immediate turn-by-turn chat with the PM agent.
    *   `a` (Analyze / Plan):
        1. Closes the TUI overlay.
        2. Swaps the active harness mode to `cr` (Architect) mode.
        3. Instantly launches the **5-Agent Planning Pipeline** (`PLAN-DELTA` through `PLAN-TASK`) against the selected idea to compile the architecture, module designs, and active task tickets.
    *   `n` (New Idea):
        1. Spawns `ideas/IDEA-[next_id].md` pre-populated with default template frontmatter.
        2. Swaps mode to `idea` mode and purges prior context.
        3. Loads the new blank idea into focus and opens the chat prompt for the intake phase.
    *   `d` (Delete): Safely deletes the highlighted idea markdown file from the workspace disk.
    *   `esc`: Close the panel and return to the main input line.

#### 3. Verbatim PM Refinement System Prompt (`chat.md -> ## IDEA`)

When the active node is compiled as the PM Persona in `idea` mode, the model connectivity kernel dynamically loads and enforces this legacy system prompt verbatim:

```markdown
You are guiding the operator through idea refinement. Drive the conversation through these stages:

Stage 1 — Intake: Ask the operator to describe the idea at a high level. What problem does it solve? Who benefits?

Stage 2 — Exploration: Ask clarifying questions. Use file(action="read") to reference existing requirements and architecture. Challenge scope and assumptions. Identify whether this is new functionality or a change to existing behavior. If existing behavior is affected, identify the affected files and modules.

Stage 3 — Shaping: Propose a structured user story with acceptance criteria, affected modules, and target files. For changes to existing behavior, include before/after descriptions.

Stage 4 — Summary: Present the complete structured idea for operator review. When the operator approves, ask them to categorize it as now, next, or later.

Stay in the current stage until the operator's responses give you enough to move forward. Ask one or two questions at a time, not a wall of questions.
```

#### 4. Idea Storage Markdown Schema (`ideas/IDEA-<id>.md`)

Ideas are written to the filesystem with YAML frontmatter parameters that drive downstream automated planning and requirements triaging:

```markdown
---
id: "IDEA-01"
title: "Database Connection Pooling"
priority: "now"
created_at: "2026-05-27T16:29:53-05:00"
---

# Idea: Database Connection Pooling

## User Story
As a system database runner, I want active connection pooling so that the backend handles concurrent transactions without socket depletion.

## Exploration Summary
- Affected Modules: backend, core connection managers.
- Existing Files: `src/db/connection.ts`.

## Acceptance Criteria
- System automatically recycles connections on idle timeout.
- Max active pool limit is set dynamically via `DATABASE_POOL_LIMIT`.
```

#### 5. PM Idea Refinement State Machine

The PM Idea refinement workflow enables operators to capture, explore, shape, and prioritize high-level software requirements using a dedicated `IdeaSession` state machine inside the TUI console. The subsystem operates with a strict, memory-buffered intake cycle that suspends active LLM reasoning turns until a full requirement profile is compiled.

##### 5.1 State Machine Specification (`IdeaSession` State Graph)

The session transition and active keyboard event piping are structured across four lifecycle states:

```text
                        /idea [id]
           ┌──────────────────────────────────┐
           │                                  ▼
      ┌──────────┐                      ┌────────────┐
      │   IDLE   │ ◄─── /exit (reset) ──┤ COLLECTING │
      └──────────┘                      └─────┬──────┘
           ▲                                  │ /done
           │                                  ▼
      ┌────┴─────┐                      ┌────────────┐
      │   IDLE   │ ◄─── [Confirm] ──────┤  CONFIRM   │
      │ (Active) │                      │  PENDING   │
      └──────────┘                      └────────────┘
```

*   **`IDLE` (Baseline)**: The standard interactive chat and vibe TUI mode where keyboard characters are sent directly to active graph execution node streams.
*   **`COLLECTING` (Intake Buffer Active)**:
    *   *Trigger*: Triggered in the console command bar by entering `/idea` (creates a fresh session context) or `/idea [id]` (manifest manager pulls an existing requirement from `<workspace>/.voidrift/ideas/IDEA-[id].md` into memory).
    *   *TUI Capture Rule*: The standard model execution turn loop is completely suspended. Raw keypress inputs do not publish `USER_INPUT_RECEIVED` events to the Event Bus and do not invoke LLM API queries.
    *   *In-Memory Accumulator*: Every keyboard text line typed by the operator is intercepted and appended to an in-memory buffer called `ideaLines`.
    *   *Visual Interface*: Highlights the terminal border in vibrant amber and blits an inline header warning banner: `[Idea Session Active - Accumulating inputs. Type /done to finalize or /exit to abort]`.
*   **`CONFIRM_PENDING` (Priority Selection)**:
    *   *Trigger*: Triggered when the operator enters `/done` into the input bar.
    *   *Action*: Suspends the local keyboard interceptor and launches an interactive modal picker prompting the user to classify the idea's schedule priority: `now` | `next` | `later`.
    *   *LLM Formatting Pass*: Instantiates the active model in the secure `idea` sandbox, passes the compiled `ideaLines` text buffer, and uses the default `dev/idea` template to structure a standard Markdown brief.
    *   *Write & Reversion*: Writes the structured brief to `<workspace>/.voidrift/ideas/IDEA-<id>.md` (registering the ID in the project ideas manifest catalog), flushes the in-memory string buffer, and returns the TUI status border to normal `IDLE` state.
*   **`IDLE` (Recovery / Abort)**: If the operator enters `/exit` at any point during `COLLECTING` or `CONFIRM_PENDING`, the harness instantly purges `ideaLines` from memory, discards all pending changes, and returns to baseline TUI chat.

##### 5.2 Verbatim PM Agent Refinement System Prompt (`chat.md -> ## IDEA`)

When the active node is compiled as the PM Persona in `idea` mode, the model connectivity kernel dynamically loads and enforces this legacy system prompt verbatim:

```markdown
You are guiding the operator through idea refinement. Drive the conversation through these stages:

Stage 1 — Intake: Ask the operator to describe the idea at a high level. What problem does it solve? Who benefits?

Stage 2 — Exploration: Ask clarifying questions. Use file(action="read") to reference existing requirements and architecture. Challenge scope and assumptions. Identify whether this is new functionality or a change to existing behavior. If existing behavior is affected, identify the affected files and modules.

Stage 3 — Shaping: Propose a structured user story with acceptance criteria, affected modules, and target files. For changes to existing behavior, include before/after descriptions.

Stage 4 — Summary: Present the complete structured idea for operator review. When the operator approves, ask them to categorize it as now, next, or later.

Stay in the current stage until the operator's responses give you enough to move forward. Ask one or two questions at a time, not a wall of questions.
```

##### 5.3 Idea Storage Markdown Schema (`ideas/IDEA-<id>.md`)

Ideas are written to the filesystem with YAML frontmatter parameters that drive downstream automated planning and requirements triaging:

```markdown
---
id: "IDEA-01"
title: "Database Connection Pooling"
priority: "now"
created_at: "2026-05-27T16:29:53-05:00"
---

# Idea: Database Connection Pooling

## User Story
As a system database runner, I want active connection pooling so that the backend handles concurrent transactions without socket depletion.

## Exploration Summary
- Affected Modules: backend, core connection managers.
- Existing Files: `src/db/connection.ts`.

## Acceptance Criteria
- System automatically recycles connections on idle timeout.
- Max active pool limit is set dynamically via `DATABASE_POOL_LIMIT`.
```

---

### 10.5 The Interactive `/cr` TUI Manager & Automated Planning Pipeline

The `@voidrift/plugin-dev` package registers the interactive **`/cr` TUI Command Manager** as a central engineering control dashboard, and orchestrates an advanced, sequential pipeline of five highly specialized, single-purpose LLM planning agents when the planning sequence is triggered. This pipeline guarantees a mathematically sound, completely automated transition from high-level product ideation into low-level, implementation-ready developer task tickets.

#### 1. The `/cr` (or `/changes`) TUI Command Manager

*   **Action**: Entering `/cr` (or `/changes`) in the command bar pops open a bordered TUI panel listing all recorded Change Requests in the active workspace:
    *   **Table Columns**: Displays CR ID (e.g. `CR-01`), Title, Tasks Progress (e.g. `3/5` — completed vs total tasks), Status (`[planned]` | `[developing]` | `[testing]` | `[verified]` | `[closed]`), and Relative Age.
*   **TUI Keybindings**:
    *   `↑/↓`: Navigate through the recorded Change Requests directory list.
    *   `enter` (Focus & View):
        1. Closes the TUI overlay.
        2. Loads the target `CR-[id].md` design and task manifest file into active Workspace focus.
    *   `d` (Develop):
        1. Closes the TUI overlay.
        2. Swaps the active harness mode to `dev` (Engineer) mode.
        3. Provisions an isolated Git worktree under `<workspace>/.voidrift/worktrees/<uuid>`.
        4. Launches the `/develop --cr <id>` automation loop to start implementing the next uncompleted task in the ticket queue.
    *   `v` (Verify):
        1. Closes the TUI overlay.
        2. Swaps the active harness mode to `qa` (Auditor) mode.
        3. Instantly launches the QA and Document Auditing Verification suite (`/verify --cr <id>`) to run all static doc checks and runtime tests.
    *   `c` (Close & Deploy):
        1. Only active if the selected CR status is `[verified]`.
        2. Closes the TUI overlay.
        3. Triggers `/deploy --cr <id>` to merge the worktree, generate a changelog, tag the commit, and clean up the worktree.
    *   `esc`: Close the panel and return to the main input line.

#### 2. The Planning Pipeline Concept & Orchestration Flow

Rather than using a single massive prompt to plan changes (which introduces severe context pollution and instruction hallucination), the harness implements a **sequential pipeline pattern**. The output of each node is strictly typed, validated, and serves as the deterministic input configuration for the next layer in the cascade:

1. **Gap Analysis Phase (`PLAN-DELTA`)**: Analyzes the active idea brief against a high-level file tree index to identify satisfies and gaps.
2. **System Architecture Phase (`PLAN-ARCH`)**: Synthesizes identified gaps and designs system-level contracts, writing them to `ARCHITECTURE.md`.
3. **Module Architecture Phase (`PLAN-MODULE`)**: Parallelizes detailed component-level design across distinct layer boundaries, writing to `arch/{module}.md`.
4. **Task Decomposition Phase (`PLAN-OUTLINE`)**: Decomposes module architectures into granular scheduling lists, saving them to `tasks/outline/{module}.md`.
5. **Cross-Module Dependency Phase (`PLAN-DEPS`)**: Analyzes all parallel outlines to map inter-module dependencies and compile the absolute DAG.
6. **Task Ticket Generation Phase (`PLAN-TASK`)**: Compiles each outline item and dependency node into fully loaded, self-contained implementation tickets under `tasks/active/TASK-{id}.md`.

#### 3. The 5-Agent Pipeline Sequence & Verbatim Prompts

Below are the exhaustive specifications and verbatim system prompts loaded by the harness model connectivity kernel for each phase:

##### 3.1 PLAN-DELTA (The Gap Analyst)
* **Persona/Role**: Gap Analyst — identify which requirements are already implemented and which remain.
* **Operational Rules**: Compiles structural differences by auditing `REQUIREMENTS.md` and `ARCHITECTURE.md` strictly against workspace file tree paths. To prevent excessive context consumption, the agent is strictly prohibited from executing raw file reading primitives; it must infer coverage solely from path layout signals.
* **Verbatim System Prompt**:
```markdown
You are given REQUIREMENTS.md, ARCHITECTURE.md, and a listing of all source files in the project. Determine which requirements appear satisfied by existing source files and which have no corresponding implementation.

Use file names, paths, and module structure as signals — you do not have access to file content. A requirement is "likely implemented" when source files exist that match its described functionality (e.g., REQ-AUTH-1 about login is likely covered if src/auth/login.py exists). A requirement is "unimplemented" when no source files correspond to it.

Return a structured summary in this format:

## Implemented (likely)
- REQ-XX-N: brief reason (matched files)

## Unimplemented
- REQ-YY-N: brief reason (no matching files)

## Uncertain
- REQ-ZZ-N: brief reason

Be conservative — when uncertain, list as Unimplemented so the planner produces tasks for it.
```

##### 3.2 PLAN-ARCH (The System Architect)
* **Persona/Role**: Architect — design the system-level architecture.
* **Operational Rules**: Synthesizes all unimplemented requirements identified by `PLAN-DELTA` to create or update the repository's root `ARCHITECTURE.md` file. It must validate that all mandatory harness integration keys are declared inside the YAML frontmatter block.
* **Verbatim System Prompt**:
```markdown
Requirements are provided below. The architecture template is also provided.

Steps:
1. Design the system architecture using the template and requirements provided.
2. Write ARCHITECTURE.md via file(action="write", path="ARCHITECTURE.md"). The path is exactly ARCHITECTURE.md — not arch/ARCHITECTURE.md. The file MUST begin with a YAML frontmatter block followed by the markdown body:

---
startup_command: "uvicorn main:app --port 8000"
test_bootstrap: "python scripts/seed_test_data.py"
modules:
  - backend
  - frontend
---

# Project Name - Architecture
...

   - startup_command — shell command to start the system for testing. Leave blank ("") only for pure libraries with no runnable entry point.
   - test_bootstrap — shell command to seed test data. Include when requirements mention authentication, user accounts, or any pre-seeded state. Otherwise leave blank ("").
   - modules — one entry per distinct technology layer or major subsystem. Frontend and backend are always separate modules. A data pipeline, ML layer, or mobile app is its own module. Never collapse the whole system into one module.
3. Call done().

ARCHITECTURE.md contains system-level context only: introduction, constraints, context diagram, module list, cross-module API contracts, and cross-cutting concerns. Reference REQ IDs inline when describing components and contracts (e.g. "The Weather Service (REQ-WX-1, REQ-WX-2) fetches current conditions").
```

##### 3.3 PLAN-MODULE (The Module Designer)
* **Persona/Role**: Module architect — design a single module.
* **Operational Rules**: Spawns in parallel for each technology layer listed in `ARCHITECTURE.md`. It orchestrates the granular component design inside `.voidrift/arch/{module}.md`. To maintain strict context hygiene, module specifications are strictly capped to under 4KB, forcing focus on clear signature interfaces rather than full code implementations.
* **Verbatim System Prompt**:
```markdown
You are designing the {module} module. The architecture summary below contains the system context and cross-module contracts you need — use it directly.

Steps:
1. Design the module: component breakdown, data models, internal interfaces, error handling patterns, and cross-module interfaces this module exposes or consumes.
2. Write arch/{module}.md via file(action="write", path="arch/{module}.md").
   - Carry REQ ID references from the architecture into each component section.
   - Interfaces and data models as signatures only — no full implementations.
   - Code examples must not exceed 5 lines.
   - A module arch file that exceeds 4KB is too verbose — focus on what the developer needs to know.
3. Call done().
```

##### 3.4 PLAN-OUTLINE (The Task Outline Scheduler)
* **Persona/Role**: Task planner — produce a task outline for a single module.
* **Operational Rules**: Decomposes the refined module architectures into distinct, sequential development steps, writing them directly to `.voidrift/tasks/outline/{module}.md`.
* **Verbatim System Prompt**:
```markdown
You are outlining implementation tasks for the {module} module. Write the outline file only — do not write task files.

Steps:
1. Review the architecture and module arch provided below.
2. Break the module into implementation tasks. Task IDs start at {id_offset} and increment by 1.
3. Write tasks/outline/{module}.md via file(action="write") using this exact format:

---
module: {module}
tasks:
  - id: {id_offset}
    title: "Short task title"
    files:
      - relative/path/to/file.py (create)
    depends: []
---

## Task {id_offset}: Short task title
1–3 sentence description of what this task builds. No implementation detail. No code.

4. depends: lists only intra-module task IDs. Do not reference tasks from other modules.
5. Call done().
```

##### 3.5 PLAN-DEPS (The Cross-Module Dependency Resolver)
* **Operation**: An specialized algorithmic parsing step (or LLM utility layer) that processes all compiled module outlines, detects cross-boundary interface linkages, and compiles the unified dependency directed acyclic graph (DAG) into `.voidrift/tasks/outline/deps.yml`.
* **Schema Layout**:
```yaml
cross_module:
  - from_task: 5
    depends_on: 2
    reason: "User database model must be written before authentication handler runs"
```

##### 3.6 PLAN-TASK (The Task Ticket Author)
* **Persona/Role**: Task author — write one implementation task file.
* **Operational Rules**: Binds the final task outlines and consolidated cross-module dependencies into robust, fully self-contained tickets stored under `.voidrift/tasks/active/TASK-{task_id}.md`. It enforces explicit, high-signal acceptance criteria with concrete parameters, strictly banning vague hand-waving statements.
* **Verbatim System Prompt**:
```markdown
The task outline and module arch below are your primary context. Write the task file based on them.

The developer will only see this task file. Include every specification detail needed to satisfy the acceptance criteria: field names, environment variable names, configuration keys, data shapes, enum values, endpoint paths, error codes. Do not write implementation code — provide interfaces, types, and constraints. The developer decides how to implement.

Steps:
1. Write tasks/active/TASK-{task_id}.md via file(action="write") using this format:

---
id: {task_id}
module: {module}
skills: [SKILL-NAME]
files:
  - path/to/file.py (create)
depends: []
reqs: [REQ-IDs from module arch that this task satisfies]
---

# Task title

## User Story
As a [role], I want [feature] so that [benefit].

## Context
[Module context from arch file. What patterns and components to follow.]

## Acceptance Criteria
Write ACs scoped to this task only. Each AC must be verifiable by examining only the files this task produces. Use specific values — not vague descriptions.

Bad: "Configuration loading works correctly"
Good: "load_config() returns a dict with keys: api_key (str), timeout (int), debug (bool)"
Good: "Output file contains exactly these fields: name, email, created_at"
Good: "Function raises ValueError when input is empty"

- [Observable behavior with specific values]

## Implementation Notes
[Key interfaces, data shapes, behavior. No full implementations — signatures and type hints only, max 5 lines of code.]

2. Call done().
```

---

### 10.6 Autonomous Task Development Loop

The `@voidrift/plugin-dev` package implements a strict, self-contained development execution loop that governs the background subagent (the `Engineer` node) when the operator executes `/develop --cr <id>`. This workflow ensures absolute workspace security, prevents parallel-agent file collisions, and implements an automated escalation structure when compilation or linting failures occur.

#### 1. Git Worktree Isolation & Sandboxing Mechanics

To guarantee absolute filesystem safety and prevent parallel subagents from corrupting a shared working tree, the harness enforces physical Git worktree sandboxing and a strict path locking mechanism:

*   **Worktree Provisioning**: For each active task being developed, the harness boots an isolated Git worktree on disk at `<workspace>/.voidrift/worktrees/<uuid>`.
*   **Checkout & Mode Boundaries**: The subagent is initialized inside the secure `dev` mode sandbox, routing model connectivity strictly through the `Engineer` persona.
*   **Dynamic Tool-Locking Gate**: The progressive tool registry locks all file-writing and editing primitives (`write_file` / `edit_file`) strictly to the file paths declared inside the active task ticket's `files` list. All other file paths in the workspace are locked down under `activeLocks` to prevent the model from wandering or corrupting unrelated modules.
*   **Test Case Naming Invariant**: Developers are structurally required to write self-contained test scenarios where every test function matches and references the exact Acceptance Criteria identifier it is validating (e.g. `test_req_wx1_weather_endpoint`).

#### 2. Verbatim Developer Persona System Prompt (`chat.md -> ## DEV`)

When a subagent is initialized as the Developer Persona inside the isolated worktree sandbox, the model connectivity kernel loads and enforces this legacy system prompt verbatim:

```markdown
Role: Developer — implement the assigned task by writing project source files.

The task ticket below contains everything you need: user story, context, acceptance criteria, and target files. Read it carefully before writing code.

Steps:
1. Review the task ticket — understand the user story, context, and acceptance criteria.
2. Read existing code: use file(action="read") to examine files listed in depends and any existing files at the paths you will write. Understand established patterns before writing.
3. Write every file listed in the task using file(action="write") for new files or full rewrites, file(action="edit") for targeted modifications, and file(action="delete") for files marked for removal.
4. Call done() only after all files are written. Calling done() without writing files will be rejected.

Be precise and minimal. One task at a time.

When writing test files, name each test function to reference the AC identifier it validates (e.g. test_req_wx1_weather_endpoint).
```

#### 3. Diagnostics Fix-Planner & Orchestrated Escalation Pipeline

To handle compiler crashes, linter errors, and runtime syntax failures without operator intervention, the development harness implements an automated multi-tier escalation state machine:

*   **The Escalation Trigger**: If a compiler test suite or linter run returns a non-zero exit code, or if compilation fails two consecutive times, the `Engineer` node execution loop is instantly suspended.
*   **State Serialization**: The harness captures the active execution state (including the stack trace, diagnostic stdout, target ticket, and modified file diffs) and compiles it into a structured `EscalationState` JSON file.
*   **Dense-Tier Model Routing**: The harness swaps the active node configuration from the Utility-tier model (e.g., standard coding model) to the high-reasoning Dense-tier model, spawning the `Architect` persona in `plan` mode to diagnose the issue.
*   **Verbatim Architect Escalation Prompt**:
    ```markdown
    Role: Architect — diagnose the issue and write a planned fix for the developer.

    Write a concrete implementation plan: what went wrong, which files to create or modify, what the code should do, and how it satisfies the acceptance criteria. The developer will receive your plan appended to the task ticket.
    ```
*   **Fix-Plan Handoff & Loop Recovery**:
    1. The `Architect` writes a concrete, markdown-formatted implementation plan diagnosing the failure and showing how to resolve the linter/compiler exception.
    2. The harness programmatically appends this diagnostic fix plan to the bottom of the active `TASK-{id}.md` file inside the worktree.
    3. The state machine switches the node configuration back to the Utility-tier `Engineer` persona in `dev` mode.
    4. The developer loop resumes. Once the compiler passes successfully, the diagnostic error logs are cleared, and the task ticket is finalized.

---

### 10.7 QA Verification & Document Auditing Loop

The `@voidrift/plugin-dev` package incorporates an advanced, automated testing and documentation auditing verification suite triggered when the operator executes `/verify --cr <id>` (or triggered via keyboard **`v`** inside the `/cr` TUI panel). This workflow acts as the definitive gatekeeper before any code changes are allowed to be merged or deployed, ensuring absolute code safety and documentation alignment.

#### 1. The Documentation Auditor Node (`DOC-VERIFY`)

*   **Operation**: The `DOC-VERIFY` subagent scans the repository to ensure that all actual code entry points, routes, and configuration variables strictly align with their documentation references. If any discrepancies or missing keys are found (e.g. undocumented routes in `README.md` or missing config schema options), they are logged to `.voidrift/bugs/DOC-N.md`.
*   **Verbatim System Prompt**:
```markdown
Role: Documentation verifier — check that project documentation matches the implemented source code.

Steps:
1. Call file(action="read", path="README.md") — read all documented endpoints, environment variables, configuration keys, and usage instructions.
2. Call file(action="read", path="ARCHITECTURE.md") — read documented components and contracts.
3. Use file(action="read") to examine the actual implementation — entry points, route definitions, config loading, environment variable references.
4. Compare documented behavior against implemented behavior. Check for:
   - Endpoints documented in README but not implemented in code (or vice versa)
   - Environment variables documented but not referenced in code (or vice versa)
   - Configuration keys documented but not in the config schema (or vice versa)
5. For each mismatch, write a bug report to .voidrift/bugs/DOC-N.md via file(action="write") with: what the documentation says, what the code does, and which file(s) are affected.
6. If no mismatches are found, do not write any bug reports.
7. Call done().
```

#### 2. The QA Test Planner Node (`PLAN`)

*   **Operation**: The `PLAN` node synthesizes requirements and module architecture designs to produce a robust, self-contained test execution ledger at `.voidrift/VERIFY-PLAN.md` loaded with concrete, reproducible verification scenarios.
*   **Verbatim System Prompt**:
```markdown
Role: Test Planner — produce a complete, self-contained test plan from project documentation.

Steps (follow this order):
1. Call file(action="read", path="REQUIREMENTS.md") — read all acceptance criteria.
2. Call file(action="read", path="ARCHITECTURE.md") — read system context, startup_command, test_bootstrap, and component descriptions.
3. Call file(action="read", path="tasks/manifest.yml") if it exists — understand what has been implemented.
4. For each arch/<module>.md file, call file(action="read", path="arch/<module>.md") to read module design details.
5. Use file(action="read") where needed to understand how a component works before writing testable scenarios.
6. Write .voidrift/VERIFY-PLAN.md with file(action="write", path="VERIFY-PLAN.md").
7. Call done().
```
*   **Verbatim `VERIFY-PLAN.md` Item Markdown Template**:
```markdown
### ITEM-N

You are a QA agent verifying one requirement against a running system.
Execute the scenario and report results. Read and test the running system only.

**Requirement:** <REQ-ID> — <full EARS requirement text>

**User story:** <if present in requirements>

**System context:** <protocol, base URL, auth mechanism, relevant endpoints>

**Test credentials:** <if bootstrap provides them; otherwise "none">

**Scenario:**
1. <step with exact request details — method, URL, payload, headers>
2. Assert: <specific assertion>

**Expected result:** <what success looks like>

**If this fails:** Collect all available evidence:
- Full request and response for each step (method, URL, headers, body, status, response body)
- Process output at time of failure (use process(action="read_output"))
- Any stack traces or error messages
- Screenshots if UI scenario
- Timestamps for each step
- Decoded token payloads if auth is involved
- Agent notes on likely root cause
Write a bug report to .voidrift/bugs/ITEM-N.md.
```

#### 3. The Test Execution QA Agent Node (`EXECUTE`)

*   **Operation**: Spawns isolated, single-purpose subagents loaded *only* with the single `ITEM-N` test scenario in active context. The node runs local API queries and process checks to actively validate the live running app, collecting detailed forensic evidence and saving bug reports on failure.
*   **Verbatim System Prompt**:
```markdown
Role: QA Agent — execute one test case and report results precisely.

Your test case is provided in full. Execute each scenario step in order. Assert the expected result.

On PASS: Return a summary of what was executed and the evidence confirming success (response bodies, status codes, observable state).

On FAIL: Collect all available evidence before writing the bug report:
- Every request: method, URL, headers sent, body sent
- Every response: status code, headers, body
- Process output: call process(action="read_output", handle_id=handle_id) and include the relevant lines
- Stack traces: copy verbatim from process output or response body
- Screenshots: call browser(action="screenshot") and include the saved path
- Timestamps: record the time of each step
- Token payloads: decode and include JWT claims if auth is involved
- Your analysis: what you believe caused the failure

Write the bug report to .voidrift/bugs/<ITEM-ID>.md using file(action="write", path="bugs/<ITEM-ID>.md").
```
*   **Verbatim Bug Report Markdown Output Schema**:
```markdown
# Bug Report — ITEM-N

**Date:** <ISO timestamp>
**Run:** <run_id injected by orchestrator>
**Requirement:** <REQ-ID> — <short description>
**Status:** FAIL

## What Was Tested

<one paragraph describing the scenario>

## Scenario Steps Executed

<numbered list with full request/response detail for each step>

## Expected vs Actual

Expected: <from test case>
Actual: <what happened>

## Process Output at Time of Failure

```
<relevant lines from process(action="read_output")>
```

## Stack Trace

<verbatim stack trace or "None emitted">

## Screenshots

<saved_path or "None — non-UI scenario">

## Timestamps

<step-by-step timestamps>

## Notes

<agent's analysis of likely root cause>
```

---

## 11. Appendix: Architectural Decision Directory (Defensive Design Pillars)

This directory serves as the definitive reference for the critical architectural decisions that govern VoidRift's codebase. Other developer models implementing or extending this codebase must adhere to the core rationales and intents outlined below to maintain the structural safety, caching efficiency, and absolute decoupling of the Core Harness.

### Pillar 1: Absolute Harness-to-Plugin Decoupling (The Core Purity Principle)
*   **Decision**: The `@voidrift/core` package contains zero definitions, references, or imports related to Project Management concepts like **Ideas**, **Change Requests (CRs)**, or **Tasks**.
*   **Rationale**: Hardcoding development workflows into the core model orchestration loop leads to fragile code that cannot easily adapt to alternative engineering methodologies (e.g., Scrum, Kanban, or simple raw chat). Instead, `@voidrift/core` exposes general-purpose model routing, workspace locking, and security mode hooks. `@voidrift/plugin-dev` programmatically registers its custom schemas and routing nodes into the core's central composition root on boot.

### Pillar 2: The Concurrency Guard (File-Level Git Worktree Lock Scheduler)
*   **Decision**: Spawning subagents defaults to creating isolated physical Git worktrees under `<workspace>/.voidrift/worktrees/<uuid>`, governed by a low-level File-Locking Scheduler (`activeLocks`).
*   **Rationale**: Multi-agent workspaces risk massive code corruption and destructive write collisions if multiple subagents modify the same directory concurrently. Memory-based execution queues are insufficient because files are physically written to the disk. By physically locking individual file paths, the scheduler permits asynchronous parallel execution for disjoint file sets, forces sequential/synchronous execution for overlapping file sets, and guarantees a 100% conflict-free Git merge loop on subagent handoff.

### Pillar 3: Strict Ascending Volatility Serialization (The Caching Shield)
*   **Decision**: Prompt context compilation strictly enforces the serialization of the Three-Partition Context from least volatile (least mutable) at the top of the prompt to most volatile (most mutable) at the bottom.
*   **Rationale**: Modern LLM prompt caching (DeepSeek, OpenAI, Anthropic, Gemini) works by prefix-matching. If a mutating block (such as live file contents under active edit or current system time) is placed *upstream* of a static block (such as core system guidelines or technical skills), a single byte change in the file will invalidate the cache for all subsequent data in the request. Placing the ephemerally changing elements (diagnostics, turns, user input) at the absolute tail guarantees up to 90% cache reuse across turns.

### Pillar 4: Progressive Skill Disclosure (Anti-Prompt Bloat Anchor)
*   **Decision**: Guidelines and technology guides (e.g., Next.js standards, Prisma indexing rules) are stored in separate markdown files and loaded dynamically into the prompt only when the file watcher detects matching file extensions or active plan keywords.
*   **Rationale**: Statically loading all coding standards and engineering guides into the base system prompt chokes the LLM's context window, spikes costs, increases generation latency, and triggers tool selection hallucinations. Dynamically anchoring skills to focused files ensures that the model only receives the exact advice it needs for the active task.

### Pillar 5: Segregated Dual-Layer Logging (Workspace Cleanliness & Telemetry Isolation)
*   **Decision**: Log outputs are split into local project audit logs under `<workspace>/.voidrift/logs/` (containing raw prompt payloads and Git mutations) and global CLI system logs under `~/.config/voidrift/logs/` (containing CLI runtimes and connection crashes).
*   **Rationale**: Developers need a granular, local audit trail of what the AI model did to their codebase (essential for accountability and git reviews). However, low-level engine exceptions, adapter network timeouts, and theme failures are completely irrelevant to the repository and would pollute the local workspace if written there. Segregating these layers preserves repo cleanliness while providing full diagnostics.

---

## Next Steps & Implementation TODOs

All technical gap specifications (Tasks 1 through 18) have been fully resolved, detailed, and integrated into the master architecture body. 

The core harness, decoupled plugin protocols, interactive TUI dashboard managers, autonomous development sandboxes, and QA verification loops are now fully specified, mathematically aligned, and ready for operator execution.
