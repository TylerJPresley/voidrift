# VoidRift: Decoupled Subsystem Architecture

This document defines the architectural blueprint of **VoidRift** at a high-level feature and conceptual block level. 

Rather than building a vertical stack, the system is modeled as a **Composition Root & Event-Driven Subsystem Architecture**. The application container acts as a central coordinator that wires together parallel, decoupled features through a central **Event Bus** and modular **Registries**.

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
4. **Subsystem 4 (Security Subsystem)**:
   - `[CORE]` The Interactive Permission Gate (TUI loop suspension and confirmation gate).
   - `[CORE]` The Stateful Mode Cycler (Cycling `chat`, `plan`, and `vibe` via `TAB`).
5. **Subsystem 5 (Operator Interface)**:
   - `[CORE]` The Output Truncator & ANSI Stripper (formatting logs and cutting large terminal scrolls).
   - `[CORE]` The Token Budget Watcher (Real-time context ratio visualization).
   - `[CORE]` The Input Lock (Freezing terminal typing during streams).
   - `[CORE]` The Audit Logger & Telemetry Monitor (Local logging of latency and token consumption metrics).
6. **Subsystem 6 (Agent Session)**:
   - `[CORE]` The Three-Partition Context Manager (Governance, Workspace, and Work partitions via Context Progressive Disclosure).
   - `[CORE]` The Prompt Cache Optimizer (Static prompt caching alignment).
   - `[CORE]` The Conversational History Compactor (Sliding-window compaction of the Work Partition).
   - `[CORE]` The Turn Serializer (Real-time JSON session persistence).
   - `[CORE]` The Session Exception Guard (API error catches to prevent UI lockups).
   - `[CORE]` The Two-Layer Memory Registry (Project vs. Global memory index with relevance scoring).

---

## 2. How it Works: The Data Flow (Human-Readable Overview)

When you run VoidRift, a single execution loop coordinates your terminal, the AI model, and your filesystem. Here is exactly what happens in plain developer terms when you type a message:

1. **You type a message** in the React Ink terminal.
2. **LangChain packages the message** alongside your conversational history and sends it to the AI model.
3. **The model streams back a reply**. You see it typing in real-time in your terminal.
4. **The model decides to run a tool** (e.g., editing a file or running a test).
5. **Our Permission Gate intercepts the tool call** before it executes.
6. **You see a prompt in the terminal** asking for approval.
7. **If you approve**, the tool executes on your machine, the harness captures the output, strips out the junk (like ANSI colors), and feeds the clean text back to the model.
8. **The model continues thinking** and responding until it's finished.
9. **The harness saves the entire chat log** to a local JSON file so you never lose your history.

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
    *   *Action*: Locates and reads `.voidrift/models.json` or `~/.config/voidrift/models.json`, resolves environment variables nested inside API keys, and registers them.
    *   *Outcome*: Zero-config startup for the developer.
*   **`[CORE]` The Workspace File System Watcher**
    *   *Trigger*: Runs continuously in the background.
    *   *Action*: Monitors local directories for file additions, modifications, or deletions, automatically triggering the vector indexer to keep semantic memory perfectly fresh.
    *   *Outcome*: Ensures the model's codebase knowledge remains synchronized with external editor saves or git branch switches in real-time.

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
    *   *Action*: Resolves configuration schemas from the local `.voidrift/models.json` or global `~/.config/voidrift/config.json`, matches the active `provider`, instantiates the corresponding LangChain adapter, and registers it as the active executor in the Agent Session.
    *   *Design Separation of Concerns*: To prevent duplicate metadata setups across workspaces, **all master model configurations (protocols, providers, context limits) and the default tier selections (`flash`, `utility`, `dense`) are declared globally** in the user's global config `~/.config/voidrift/config.json`. Project-level token costs are excluded from tracking, as API providers do not supply cost structures dynamically. The local config at `<proj_root>/.voidrift/models.json` is **strictly optional** and used only when a specific workspace needs to override the default global tier mappings or configuration parameters.
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
    *   *Specification: Local `<proj_root>/.voidrift/models.json` (Optional Workspace Overrides)*:
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

    *   *Escalation & Delegation*:
        *   *Escalation*: If a lower-tier model discovers a task requires wider context or deeper reasoning than its threshold allows, the harness automatically preserves its progress, bundles the context, and escalates the turn upward to a higher tier transparently.
            ```text
            FLASH hits limit ──► escalate ──► UTILITY
            UTILITY hits limit ──► escalate ──► DENSE
            ```
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
    *   *Outcome*: Drastically reduces execution latency and cuts API costs by reserving expensive cloud compute only for complex design work.

---

### Subsystem 3: The Capability Subsystem (Tools & Safeties)
*   **The Concept**: A modular registry for local actions. Tools are registered as individual, standalone plugins. The agent loop queries this registry to discover available capabilities and route execution payloads to the appropriate handler.

#### Nested Model-Called Tools (Model-Activated)
*   **`[CORE] read_file`**: Opens and reads the raw text contents of a specific file in the workspace. (Safe, read-only; auto-approved).
*   **`[CORE] glob_files`**: Scans the workspace directory tree using standard glob patterns to locate files. (Safe, read-only; auto-approved).
*   **`[CORE] write_file`**: Creates a new file or completely overwrites an existing file with new content. (Active modification; requires explicit permission).
*   **`[CORE] edit_file`**: Makes precise, surgical search-and-replace block changes in an existing file without rewriting the whole file. (Active modification; requires explicit permission).
*   **`[CORE] execute_command` (Bash)**: Executes terminal commands (e.g., test runners, compilers, linters) using a local subprocess. (Active execution; requires explicit permission).
*   **`[CORE] web_search` & `[CORE] web_fetch`**: Searches the web for external library documentation and fetches public web pages, converting HTML to Markdown on-the-fly. (Safe, read-only; auto-approved).
*   **`[CORE] connect_mcp_server` (External Bridge)**: Dynamically connects to remote or local Model Context Protocol (MCP) servers to acquire specialized, community-driven tools on-the-fly. (Allows advanced integrations like Slack, GitHub, or Postgres).
*   **`[CORE] lsp_go_to_definition`**: Resolves the definition location of a code symbol inside the workspace using the local Language Server. (Safe, read-only; auto-approved).
*   **`[CORE] lsp_find_references`**: Locates all references/occurrences of a symbol across the project using the local Language Server. (Safe, read-only; auto-approved).
*   **`[CORE] lsp_diagnostics`**: Retrieves active compile-time errors, syntax warnings, and linter diagnostics for a specific file. (Safe, read-only; auto-approved).
*   **`[CORE] lsp_hover`**: Retrieves type signatures, interface parameters, and documentation hover tips for a symbol. (Safe, read-only; auto-approved).

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE]` The Git Safeguard (Source Control Guard)**
    *   *Trigger*: Fires automatically right before any model-called file-writing tool (`write_file` or `edit_file`) executes.
    *   *Action*: Runs a local Git status check. If uncommitted changes exist, it warns the developer or creates an automatic stash/temporary checkpoint commit.
    *   *Outcome*: Absolute protection against model-generated code regressions.
*   **`[CORE] The Workspace Code-Map Generator (Repo Map)`**
    *   *Trigger*: Fires automatically on session startup.
    *   *Action*: Scans the workspace files and AST structures to compile a highly compressed, token-efficient structure tree (excluding function bodies).
    *   *Outcome*: Gives the model complete high-level project awareness for under 1,000 tokens, avoiding the cost of reading entire source files prematurely.
*   **`[CORE] The Progressive Disclosure Tool Registry`**
    *   *Trigger*: Fires whenever a LangGraph node activates or the active sandbox mode changes.
    *   *Action*: Dynamically binds a targeted, minimal subset of tool schemas to the active node persona using LangChain's `.bind_tools()`. This keeps the action-space context footprint under 1.5k tokens and prevents model tool selection hallucinations.
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
        *   **YAML Frontmatter Indexing**: On startup, the manager parses the header of all markdown guides in `.voidrift/resources/skills/` and local `.voidrift/skills/` paths to build an in-memory trigger index (mapping file extensions, explicit filenames, and keywords to skills) in under 5ms:
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

---

### Subsystem 4: The Security Subsystem (Governance & Policies)
*   **The Concept**: An independent safety interceptor sitting on the Event Bus. It evaluates proposed actions against defined security profiles (e.g., safe read-only operations vs. destructive modifications) and suspends the execution loop to request approval.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE]` The Interactive Permission Gate (Approval Manager)**
    *   *Trigger*: Fires automatically right before any unsafe model-called tool (`write_file`, `edit_file`, or `execute_command`) runs.
    *   *Action*: Intercepts the execution flow, suspends the active loop, and publishes a confirmation request to the Event Bus, prompting the Operator Interface to render an approval overlay.
    *   *Outcome*: Ensures no destructive changes land on the developer's system without explicit consent.
*   **`[CORE] The Stateful Mode Cycler`**
    *   *Trigger*: Fires when the developer presses `TAB` in the Operator Interface, cycling forward through the three modes.
    *   *Action*: Cycles the harness through three core execution modes, dynamically swapping system instruction templates and updating tool execution boundaries:

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
*   **`[CORE]` The Token Budget Watcher**
    *   *Trigger*: Runs in real-time as tokens stream or messages are complete.
    *   *Action*: Measures active session token usage against the model's context window limit and calculates the color-coded state (green, yellow, red) for the footer status bar.
    *   *Outcome*: Visual alert to the developer as the session approaches context limits.
*   **`[CORE]` The Input Lock (Concurrency Guard)**
    *   *Trigger*: Fires automatically when a `USER_INPUT` event is published.
    *   *Action*: Visually disables the terminal input prompt and ignores all keyboard keystrokes while the model stream is active.
    *   *Outcome*: Prevents the developer from typing and submitting overlapping messages that would corrupt the session state.
*   **`[CORE]` The Audit Logger & Telemetry Monitor**
    *   *Trigger*: Captures events in the background throughout the execution loop.
    *   *Action*: Records exact execution durations, API latencies, and token consumption metrics locally for developer access.
    *   *Outcome*: Total operational transparency for performance, token usage, and API tracking.

---

### Subsystem 6: The Agent Session (Active State & Memory)
*   **The Concept**: The state tracker. It enforces VoidRift's **Context Progressive Disclosure** directive by dividing the active prompt context window into three logical, decoupled partitions — keeping safety rules, workspace state, and conversational history each isolated, manageable, and compactable independently.

#### Nested Harness-Driven Tools (Harness-Activated)
*   **`[CORE] The Three-Partition Context Manager`**
    *   *Trigger*: Pre-formats the active prompt payload before every LLM invocation.
    *   *Action*: Natively implements VoidRift's **Context Progressive Disclosure** directive by dividing the context window into three logical, decoupled partitions, balancing strict safety, workspace awareness, and low-token runtime compactions:
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
*   **`[CORE] The Conversational History Compactor (Episodic Summary Compactor)`**
    *   *Trigger*: Fires automatically when conversation token usage in the **Work Layer** exceeds 75% of context limits.
    *   *Action*: Keeps the most recent 10 turns at full fidelity, while asynchronously condensing older turns inside the Work Layer into a highly compact, bullet-point chronological session recap.
    *   *Outcome*: Prevents the active history token size from growing exponentially over long sessions.
*   **`[CORE]` The Turn Serializer (Session State Writer)**
    *   *Trigger*: Fires automatically on the `TURN_COMPLETE` event.
    *   *Action*: Serializes the active message array and writes it to a local JSON session log file to protect against data loss.
    *   *Outcome*: Automatic transaction-level state saving across process restarts.
*   **`[CORE]` The Session Exception Guard (Error Handler)**
    *   *Trigger*: Intercepts uncaught exceptions thrown during stream generation or tool execution.
    *   *Action*: Catches LangChain network or API errors, pushes a clean error block to the active conversation history, publishes an `ERROR_OCCURRED` event to notify the TUI, and triggers the Input Lock to release control.
    *   *Outcome*: Prevents process crashes or permanent TUI lockups during dropped API connections.
*   **`[PLUGIN] The Two-Layer Memory Registry`**
    *   *Trigger*: Session startup (indexing) and conversational turn complete.
    *   *Action*: Maintains both **Project-level memory** (`.voidrift/memory/`) and **Global memory** (`~/.config/voidrift/memory/`) using a highly disciplined **Two-Stage Progressive Disclosure** lifecycle:
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
        *   **Stage 1: Discovered (Metadata Indexing)**: On turn start, the registry matches active workspace extensions, focused files, and user keywords against trigger criteria. Matching items are loaded into the Governance Partition ONLY as lightweight metadata structures (ID, title, summary) inside `activeMemoryIndex`, consuming <100 tokens.
        *   **Stage 2: Disclosed (Model-Controlled Load/Unload)**: The model is provided two native primitive tools:
            *   `load_memory(id)`: Fetches the full-text body of a discovered memory and injects it into the `activeMemory` Workspace Partition.
            *   `unload_memory(id)`: Purges the full-text body from the active context immediately.
    *   *Outcome*: Gives the model complete, active control over its own context budget. If the model loads a memory and realizes it is irrelevant to the active task, it unloads it, keeping subsequent turns completely free of context pollution.

---

## 5. File System Architecture & Directory Layout

To prevent configuration drift, namespace collisions, and bootstrap conflicts, VoidRift maintains a strict separation of concerns between local project workspaces and global system configurations:

### A. The Project Working Directory: `<proj_root>/.voidrift/`
This folder is created locally within each workspace root directory, containing project-specific configurations, memories, and session logs. Rather than forcing a blanket ignore, VoidRift supports a flexible Git integration policy, giving developers direct control over their `.gitignore` configurations:

*   **Model Config overrides (`.voidrift/models.json`)**: *[Optional to Commit]* Custom workspace-specific role mapping selectors (mapping the local `flash`, `utility`, and `dense` tiers to specific global model names), or local overrides for unique repository-specific endpoints. Committing this allows teams to share unified workspace model setups.
*   **Active Session Registry (`.voidrift/sessions/`)**: *[Recommended to Git-Ignore]* Stores transaction-level JSON history for active and historical turns specific to this repository (`session-<uuid>.json`). Prevents polluting source control with volatile session logs.
*   **Project Semantic Memory (`.voidrift/memory/`)**: *[Optional to Commit]* Houses local vector/keyword indexes and serialized episodic learned lessons unique to this codebase's development journey.
*   **Volatile Caches & Telemetry Logs (`.voidrift/cache/`)**: *[Must be Git-Ignored]* Temporary stores such as the Workspace Code-Map AST cache, transient tool logs, and cost/telemetry audit files.

### B. The Global CLI Directory: `~/.config/voidrift/`
This folder resides in the user's home directory. It contains all settings, templates, and cross-project knowledge that govern the entire harness installation.

*   **Global Harness Configuration (`~/.config/voidrift/config.json`)**: Holds the primary user settings, global model catalog specifications (protocols, providers, context limits, and token cost pricing rates), global model API keys, default endpoints, custom TUI theme overrides, and tool approval boundaries.
*   **Global Episodic Memory (`~/.config/voidrift/memory/`)**: Houses cross-project learned lessons and architectural patterns accumulated over time across all workspaces.
*   **Global Session Registry Tracker (`~/.config/voidrift/history.json`)**: An index tracking all active workspaces and their historical session IDs, allowing session recovery from any directory path.
*   **Global Prompt & Persona Resources (`~/.config/voidrift/resources/`)**: Centralized editable prompt files, system instruction templates, and custom mode definitions.

---

## 6. The Slash Command Registry

Slash commands are executed directly in the Operator Interface terminal input line. They allow the operator to manage the harness session, view performance metrics, and perform local-only actions without consuming LLM context window budget.

*   **`/help` — Help Directory**
    *   *Action*: Lists all available slash commands with high-level descriptions.
    *   *Outcome*: Instant command discovery.
*   **`/model [alias]` — Model Switcher**
    *   *Action*: Switches the active LLM dynamically. When run without arguments, it displays all available models in the current project or global config.
    *   *Outcome*: Allows the operator to dynamically scale between Flash, Utility, and Dense models without restarting the session.
*   **`/stats` — Session Analytics**
    *   *Action*: Opens a detailed panel rendering real-time metrics: session ID, active turn counts, total session duration, performance wall-time breakdowns (API network vs. local tool execution), tool success/failure counts, and active context token utilization.
    *   *Outcome*: Full transparency for tracking operational latency and token costs.
*   **`/tools` — Capability Discovery**
    *   *Action*: Lists all registered tools available to the model under the currently active execution mode (`chat`, `plan`, `vibe`).
    *   *Outcome*: Immediate auditing of the active security permission boundary.
*   **`/compact` — Manual History Compaction**
    *   *Action*: Manually triggers conversational history compaction, compressing older conversational turns inside the Work Layer into a chronological recap while leaving the Governance Layer untouched.
    *   *Outcome*: Reclaims valuable context window space on-demand.
*   **`/clear` — State Reset**
    *   *Action*: Deletes the active session JSON log from disk and resets the conversational history, returning the harness to a pristine boot state.
    *   *Outcome*: Starts a clean chat sheet instantly.
*   **`/memory` — Memory Management**
    *   *Action*: Performs operations on local and global memory layers (e.g., query, list, add, delete, or re-index).
    *   *Outcome*: Direct operator control over the agent's long-term recall buffer.
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
| `messages` | `BaseMessage[]` | All nodes (append) | Chronological conversation log. All nodes may append but never delete. |
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

## 9. High-Level Planning Roadmap (Future Research & Design)

The following architectural items represent the core research and high-level design backlog to be addressed in subsequent collaborative sessions.

*   `[x]` **LangGraph Multi-Agent State-Graph Schema Design**
    *   *Objective*: Define the exact node structures (Architect, Engineer, Auditor), the shared state schema (the variables passed between nodes), and the conditional edges governing the workflow cycle.
    *   *Status*: Complete. See Section 8.
*   `[x]` **Dynamic Model Routing & Task Classification Heuristics**
    *   *Objective*: Research semantic routing standards and map out the exact trigger rules, cost-benefit thresholds, and context-preservation mechanics when escalating between the Flash, Utility, and Dense models.
    *   *Status*: Complete. Defined 3-signal routing stack (Node -> Mode -> Complexity fallback) and the lightweight Direct Chat Path vs Active Task Path entry splits.
*   `[x]` **Progressive Disclosure Skill System & Tool Binding**
    *   *Objective*: Research LangChain and LangGraph patterns for dynamically loading and unloading tool schemas and skill files from the active context buffer during runtime based on active graph states.
    *   *Status*: Complete. Decoupled **Tools** (functional TS execution primitives bound via `.bind_tools()`) from **Skills** (markdown prompt guides loaded dynamically based on focused file extensions). Formally specified the tool-binding matrix and skill manager loading rules in Subsystem 3.
*   `[x]` **Two-Layer Memory System Relevance Scoring**
    *   *Objective*: Define the mathematical or keyword-matching heuristic that determines memory relevance scores to prevent token pollution.
    *   *Status*: Complete. Established the **Discovered -> Disclosed -> Recycled** Memory Sandbox Lifecycle, utilizing YAML Frontmatter metadata anchors for Stage 1 indexing and providing the model `load_memory(id)` and `unload_memory(id)` primitives for Stage 2 dynamic context management.
*   `[ ]` **Isolated Subagent Git Worktree Orchestration**
    *   *Objective*: Design the workspace hand-off and file-conflict resolution mechanics when the primary agent spawns isolated background subagents.
