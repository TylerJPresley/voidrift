# Gemini CLI vs Qwen Code — TUI Feature Inventory

A feature-by-feature comparison of both implementations. Each feature is described, what it does, and what makes it special.

---

## Input & Command System

### InputTextBuffer
**What it does:** Manages multi-line text input with cursor tracking, line-based storage, vim-mode, history, and shell-mode. Both Gemini and Qwen have it.

| Source | Special |
|--------|---------|
| **Gemini** | Larger, more complete text buffer. Handles combining marks, different scripts. Vim-mode + copy-mode. Paste placeholder detection with expand-on-click. |
| **Qwen** | Same core, but adds follow-up suggestions below input when idle. Also handles @-command file references. |

### Slash Commands
**What it does:** `/` prefixed commands for quick actions. Both have 20+ commands.

| Source | Special |
|--------|---------|
| **Gemini** | Commands come from multiple loaders: built-in, skill definitions, MCP prompts, and user-defined command files. Supports `/server/prompt/subcmd` MCP command paths. |
| **Qwen** | More commands (27+), organized in a `commands/` directory. Includes `/dream` (memory consolidation), `/arena` (multi-agent comparison), `/statusline` (status bar config). Has a richer /about info. |

### @ File References
**What it does:** `@path/to/file` in user input — reads the file and appends content to the message.

| Source | Special |
|--------|---------|
| **Gemini** | Implemented as part of the `useKeypress` hook system. File references are handled during input processing. |
| **Qwen** | Also handles clipboard image pasting — images saved as temp files referenced via `@path/to/file`. Double-ESC clears input. |

---

## Streaming & Display

### Streaming State Machine
**What it does:** Three-state model: `Idle` → `Responding` → `WaitingForConfirmation`. Both implement this.

| Source | Special |
|--------|---------|
| **Gemini** | Has `useGeminiStream.ts` (legacy Gemini API) AND `useAgentStream.ts` (newer Agent Protocol). Both maintain the same `pendingHistoryItems` / `streamingState` model. |
| **Qwen** | Uses a single `useGeminiStream.ts`. Has `useStatusLine.ts` that polls every 100ms for the loading indicator animation. |

### Pending vs Static Split
**What it does:** Completed history renders via Ink `<Static>` for one re-render of all items. Live content stays in `pendingHistoryItems` and re-renders on each update.

| Source | Special |
|--------|---------|
| **Gemini** | Splits text at safe markdown boundaries (`findLastSafeSplitPoint`) — code block fences, double newlines. Pushes completed tool groups to static history as `HistoryItemToolGroup` entries. |
| **Qwen** | Same pattern. Text buffer exceeds safe length, accumulated portion pushed to static. Same pending/static split model. |

### Markdown Rendering
**What it does:** Hand-written parser converts markdown to Ink components. Headers, code blocks, tables, lists, inline formatting.

| Source | Special |
|--------|---------|
| **Gemini** | Uses `lowlight` + `highlight.js` for code syntax highlighting. `MarkdownDisplay` parses all elements. `InlineMarkdownRenderer` handles inline formatting with `chalk` for ANSI codes. Theme-aware colorization via `resolveColor()`. |
| **Qwen** | Same hand-written parser. Same `colorizeCode` approach. Code blocks truncated when `isPending` and `availableTerminalHeight` is constrained. `TableRenderer` handles left/center/right alignment with auto-widths. |

### Code Syntax Highlighting
**What it does:** Highlights code blocks in code-fenced markdown.

| Source | Special |
|--------|---------|
| **Gemini** | `lowlight` with `highlight.js`. Theme-aware (uses active theme colors). Line numbers displayed. Language detection auto-detects from fence. Pending code blocks truncated to avoid flicker. |
| **Qwen** | Same approach. Handles height constraints — truncates with "... generating more ..." message when streaming. Same language detection. |

### Streaming Status
**What it does:** Shows elapsed time, token count, and model name during generation. Updates every second.

| Source | Special |
|--------|---------|
| **Gemini** | Polls status every 100ms for loading indicator animation. Shows character count and elapsed time. |
| **Qwen** | `useStatusLine.ts` polls every 100ms. Shows loading phrase cycling during AI processing. Status row in footer. |

---

## Tool Display

### Tool Groups
**What it does:** Batches multiple tool calls into a single group with visual borders.

| Source | Special |
|--------|---------|
| **Gemini** | Groups by type: topic tools, agent calls, and regular tools get different rendering. Shell tools get `ShellToolMessage`. Topic tools render as brief `TopicMessage`. Agent tools render as collapsible `SubagentGroupDisplay`. Smart boundary detection to avoid visual tearing. |
| **Qwen** | Compact mode (single-line summary) vs expanded mode (bordered boxes). Yellow for shell, warning for pending, default for completed. Focus lock when multiple tools need confirmation — only first `Confirming` tool gets keyboard focus. |

### Tool Status Indicators
**What it does:** Shows pending, executing, success, error state for each tool.

| Source | Special |
|--------|---------|
| **Gemini** | `ToolCallStatus` enum: `Pending`, `Canceled`, `Confirming`, `Executing`, `Success`, `Error`. Green checkmark, yellow spinner, red X. Spinner during execution. |
| **Qwen** | Same enum. Same visual indicators. Elapsed time shown next to each tool. Result display classified as `todo`, `plan`, `diff`, `ansi`, `string`, or `task`. |

### Tool Result Rendering
**What it does:** Displays tool output in the appropriate format.

| Source | Special |
|--------|---------|
| **Gemini** | Result classified as: `todo` (todo list), `plan` (plan summary), `diff` (file diff), `ansi` (raw terminal output with stats bar), `string` (plain text or markdown). Uses `useResultDisplayRenderer()`. |
| **Qwen** | Same classification approach. `StringResultRenderer` for plain text/markdown. `AnsiOutputText` with stats bar for raw terminal output. |

---

## Confirmations

### Tool Confirmation Overlay
**What it does:** When a tool needs user approval, an overlay renders with the tool details and options (allow/deny/always).

| Source | Special |
|--------|---------|
| **Gemini** | `ToolConfirmationQueue` component. Shows tool name, description, diff preview, and options. Handles: shell, edit, sandbox expansion, ask_user, exit_plan_mode, MCP tools, and info tools. Supports permanent approval for trusted folders, session-level approval, and tool-specific approval for MCP. Multi-tool queue with "N of M" progress. |
| **Qwen** | `ToolConfirmationMessage` component. Uses `RadioButtonSelect` for keyboard navigation. Options: "Yes, allow once", "Yes, allow always", "Modify with external editor", "No, suggest changes". Handles edit, exec, plan, info, ask_user_question, and MCP tools. Focus lock only on first `Confirming` tool. |

### Diff Viewer
**What it does:** Shows file diffs for edit tools in confirmation dialogs.

| Source | Special |
|--------|---------|
| **Gemini** | `DiffRenderer` component. Shows unified diff view with "Allow once", "Allow for session", "Allow permanently", "No, suggest changes (esc)". Supports permanent approval for trusted folders. |
| **Qwen** | Same approach. Shows diff viewer, "Yes, allow once", "Yes, allow always", "Modify with external editor", "No, suggest changes". Deceptive URL detection warns about punycode/IDN homograph attacks. |

---

## Sessions & History

### Session Persistence
**What it does:** Auto-persists sessions, restores on next start.

| Source | Special |
|--------|---------|
| **Gemini** | Sessions stored as JSON chat records in project temp directory's `chats/` subdirectory. Full `SessionBrowser` component: pagination (20 per page), search with snippet highlighting, sort by date/message count/name, reverse sort, g/G top/bottom navigation, x/X to delete, Enter to resume. |
| **Qwen** | Same persistence. Shows "Welcome back" dialog offering to continue previous session or start new one. `/restore` / `/resume` command for session picker. |

### Session Browser
**What it does:** Interactive list editor for viewing, searching, and managing past sessions.

| Source | Special |
|--------|---------|
| **Gemini** | Full interactive list: pagination, search with snippet highlighting, sort by date/message count/name, reverse sort toggle, g/G for top/bottom navigation, u/d for half-page navigation, x/X to delete, Enter to resume. Current session detection (disabled row). |
| **Qwen** | No full session browser in the base version. Only `/resume` command for session picker. |

---

## Memory & Intelligence

### Memory System
**What it does:** Two-layer memory (project + global) with read/write/list/search tools.

| Source | Special |
|--------|---------|
| **Gemini** | `/memory` commands for memory operations. Memory dialog via `DialogManager`. Memory index injected into governance on session start. |
| **Qwen** | `/memory` commands via `useMemory` hook. Memory management dialog. `memory` and `remember` commands. More comprehensive memory UI. |

### Context Utilization
**What it does:** Shows percentage of context window used, color-coded.

| Source | Special |
|--------|---------|
| **Gemini** | Shows context usage percentage in footer. Color-coded: green <50%, yellow <80%, red >=80%. `maxContext` from model config (default 128k). |
| **Qwen** | Shows context window usage bar in footer. Percentage bar with color coding. Context bar in footer. |

---

## Accessibility & Display

### Screen Reader Support
**What it does:** Separate layout for screen readers with ARIA support.

| Source | Special |
|--------|---------|
| **Gemini** | `ScreenReaderAppLayout` component. `useIsScreenReaderEnabled()` from Ink for ARIA support. Screen reader-specific text constants (e.g., `SCREEN_READER_RESPONDING`). |
| **Qwen** | Same. `ScreenReaderAppLayout`. `useIsScreenReaderEnabled()` from Ink for ARIA support. |

### Alternative Buffer Mode
**What it does:** Detects and uses alternate buffer for full-screen rendering with mouse support.

| Source | Special |
|--------|---------|
| **Gemini** | `useAlternateBuffer` hook. Detects terminal capabilities. Sticky headers in backbuffer for smooth scrolling. Alternate buffer for full-screen rendering with mouse support. Terminal capability manager. |
| **Qwen** | Same pattern. Alternate buffer mode for full-screen rendering with mouse support. |

---

## Special Features

### Shell Integration
**What it does:** Toggle shell mode with `!` prefix. Run shell commands from within the TUI.

| Source | Special |
|--------|---------|
| **Gemini** | Shell mode toggled with `!` prefix. Shell commands run as background PTY processes. `useExecutionLifecycle` hook tracks them. `ShellToolMessage` for shell output rendering. |
| **Qwen** | Same. Shell mode with `!` prefix. Background PTY processes. `ShellToolMessage` for rendering. |

### Think / Thought Display
**What it does:** Shows AI "thinking" content separately from final response.

| Source | Special |
|--------|---------|
| **Gemini** | `ThinkingMessage` component. Thinking content rendered with secondary text styling. Separated from final response in the display. |
| **Qwen** | Same. Thought content tracked in separate state variable (`thought` ref). Separated from final response. |

### Background Tasks
**What it does:** Manages running shell commands and other background processes.

| Source | Special |
|--------|---------|
| **Gemini** | `useBackgroundTaskManager` hook. `BackgroundTaskDisplay` component for running shell commands and PTY processes. Status tracking for background PTY processes. |
| **Qwen** | Same. Background task management. PTY process tracking. |

### Multi-Agent (Qwen Only)
**What it does:** In-process multi-agent architecture with tab navigation.

| Source | Special |
|--------|---------|
| **Qwen** | `AgentViewContext` manages in-process agents with tab-based navigation. Each agent has its own conversation history, input buffer, approval mode, and model. `AgentTabBar` for navigation. `Arena mode` for multi-agent comparison battles. This is the most advanced multi-agent feature in either implementation. |
| **N/A** | Gemini doesn't have this. |

### Folder Trust (Gemini Only)
**What it does:** Dialog for trusting workspace folders before allowing certain operations.

| Source | Special |
|--------|---------|
| **Gemini** | `FolderTrust` dialog for workspace security. Trusted folders get special handling for permanent tool approvals. |
| **N/A** | Qwen doesn't have this. |

### Extensions (Qwen Only)
**What it does:** Extension management system.

| Source | Special |
|--------|---------|
| **Qwen** | Extensions manager via `/extensions` command. Plugin management dialog. Extension update notifications. Hook management via `/hooks` command. |
| **N/A** | Gemini doesn't have this. |

### Loop Detection (Qwen Only)
**What it does:** Detects when stop hooks create a loop and shows a confirmation dialog.

| Source | Special |
|--------|---------|
| **Qwen** | Detects when stop hooks create a loop and shows a confirmation dialog to break it. |
| **N/A** | Gemini doesn't have this. |

---

## Architecture Notes

### Both Implement
- ✅ Ink (React-in-terminal)
- ✅ Streaming state machine (Idle → Responding → WaitingForConfirmation)
- ✅ Pending vs Static split (completed → Static, live → pendingHistoryItems)
- ✅ Hand-written markdown parser (headers, code blocks, tables, lists, inline formatting)
- ✅ Code syntax highlighting (lowlight + highlight.js)
- ✅ TextBuffer for input (cursor tracking, vim mode, history, completion)
- ✅ Overlay confirmation flow
- ✅ Tool grouping with status indicators
- ✅ Diff rendering for edit tools
- ✅ Session persistence (JSON chat records)
- ✅ Slash command system
- ✅ Context utilization display (color-coded percentage)
- ✅ Screen reader support
- ✅ Alternative buffer mode
- ✅ Shell mode (`!` prefix)
- ✅ Background task management
- ✅ Thinking / thought display

### Gemini CLI Only
- Session browser (full list editor with search, sort, pagination)
- Folder trust dialog
- Theme system (semantic colors, theme-manager)
- Hooks display for execution status
- TodoTray / Checklist components
- Desktop notification system
- Deceptive URL detection (punycode/IDN)
- Fuzzy search for session browser (fzf dependency)

### Qwen Code Only
- Multi-agent architecture (tab-based, in-process)
- Arena mode (multi-agent comparison)
- Follow-up suggestions (AI-generated prompts below input when idle)
- Loop detection confirmation
- Extension / plugin management
- Hook management
- Context window usage bar (visual bar in footer)
- Dreaming status indicator
- Compact mode (collapse tool groups to single-line)

---

---

## Claude Code

### Framework
Vendored fork of `ink` — heavily modified Ink engine with React reconciler, Yoga layout, cell-level blitting, diff-based rendering (only changed cells emitted), throttled at 50ms intervals. Alt-screen support, DEC 2026 synchronized output to prevent flicker, full terminal capability detection suite. This is the most sophisticated Ink fork of any of the three.

### Markdown Rendering
Uses **marked** (the GFM library) + `cli-highlight` (`highlight.js` wrapper) for syntax. Hand-crafted React components on top. Hybrid approach: `marked.lexer()` tokenizes, then `formatToken()` recursively walks the tree. Caches parse results by content hash (LRU, max 500 entries). Table rendering has two paths — legacy pipe format and a React `<Box>`-based flexible layout with hard-wrap and vertical format fallback. Links rendered via OSC 8 hyperlinks when supported. GitHub issue references auto-linked.

### Streaming
**Stable prefix / unstable suffix** split at token boundaries. `marked.lexer()` called only on the unstable tail — O(unstable_length) instead of O(full_text). Stable prefix is `useMemo`-memoized, never re-parses. Only the growing tail re-parses on each delta. This is more sophisticated than Gemini/Qwen's "split at code block boundaries" approach because it preserves markdown structure (unclosed code fences, incomplete lists) rather than just text boundaries.

### Thinking Display
Collapsed by default: `∴ Thinking` + expand hint (`Ctrl+O`) in dim italic. Verbose mode shows full content dimmed. Redacted thinking shows `✻ Thinking...`. Spinner animates during thinking, then shows `thought for Ns` for minimum 2 seconds.

### Code Blocks During Streaming
No special handling — they're part of the main markdown stream, grow naturally via the stable/unstable split, no truncation or line numbers. Unclosed code fences handled correctly by `marked` lexer.

### Session Management
Sessions identified by UUID. `/resume` shows session picker scanning transcript logs. Concurrent background sessions supported. Prompt history in `history.jsonl` (line-delimited). Session-scoped history separated from current session.

### Context Visualization
`/context` command renders a full breakdown: one-line summary (model · tokens · percentage), visual grid of squares per category (full/empty/parachute/reserved/free), MCP tools loaded vs available, agents/memory/skills token breakdowns, context improvement suggestions. The **ContextVisualization** component is the most detailed context display of any tool.

### Terminal Capabilities
Most sophisticated of the three. DEC 2026 synchronized output (BSU/ESU sequences), terminal query system (DA1/DA2, DECRQM, Kitty keyboard protocol, XTVERSION, OSC color, DECXCPR), extended keys list (`iTerm.app, kitty, WezTerm, ghostty, tmux, windows-terminal`), resize observer, alternate screen management, sticky headers in backbuffer.

### Input System
`PromptInput` (2339 lines) with `TextInput` component. Full `TextBuffer` with vim-mode state machine (~300 lines). Arrow key history, reverse history search (Ctrl+R, fuzzy search). Typeahead completion for file paths, mentions, commands. Mode cycling via shift+tab or meta+m. Ctrl+X Ctrl+E for external editor.

### Message Queue
Single unified module-level array of `QueuedCommand[]` with priority levels (`now` > `next` > `later`). FIFO within same priority. Independent of React state, uses `useSyncExternalStore`. Main loop checks `hasCommandsInQueue()` between each stream event. `dequeue()` pops highest-priority command. `popAllEditable()` pops all editable commands and merges them into the input buffer.

### Interruption
Multi-level priority cascade: 1) abort current API request via `AbortController`, 2) clear command queue, 3) kill background tasks, 4) exit active overlay. Ctrl+C (via `app:interrupt`) and Esc (via `chat:cancel`) both trigger same cascade. Submission undo: if user submits then immediately presses Escape, restores previously submitted message to input buffer.

### Keybinding System
Full MVC-like chain: `parser.ts` (keybinding parser), `match.ts` (match check), `resolver.ts` (core resolver with chord support like `ctrl+k ctrl+s`), `defaultBindings.ts` (~80 bindings across 20+ contexts), `useKeybinding.ts` (React hooks wiring to Ink), `loadUserBindings.ts` (user overrides), `validate.ts` (conflict detection, prevents overriding `ctrl+c` and `ctrl+d`). Multi-keystroke chords supported.

### Shell Integration
Shell commands spawned as child processes via `child_process.spawn`/`spawnSync`. PTY-based spawning for interactive commands. Shell mode toggle with `!` prefix. Background task management through `Task.ts` system with states (`idle`, `running`, `completed`, `failed`) and progress tracking.

### Permissions
Racing approval mechanism: multiple sources compete via atomic `claim()`. Sources: user interactive, preToolUse hooks, bash classifier (auto-approves safe commands), bridge/CCR remote approval, channel permission relay, speculative classifier (2-second grace period before dialog). Permission modes: `allow`, `deny`, `ask`. Persistence via `PermissionUpdate` schema with `addRules`/`removeRule` for deny/allow rule management. Bash has richest option set: simple yes, yes-apply-suggestions, yes-prefix-edited, yes-classifier-reviewed, no.

### Select Component
`CustomSelect` (`Select`) is the core selection widget. Arrow key navigation, input mode for editable options, Tab-to-amend behavior, inline descriptions, feedback tracking. Used by all permission dialogs. Supports `allowEmptySubmitToCancel`.

### Vim Mode
Full vim state machine (~300 lines): INSERT and NORMAL modes. Operators: `d` (delete), `c` (change), `y` (yank). Motions: `h/j/k/l`, `w/b/e`, `0/^/$`, `f/F/t/T`, `G`. Text objects: `ii`/`ai`, `iw`/`aw`, `i"`/`a"`, `()`/`[]`/`{}`/`<>`. Repeat: `.` (dot-repeat), `;`/`,` (repeat/reverse-find). Counters up to 10,000. Persistent register.

### Follow-up Suggestions
AI-generated follow-up prompts shown below input when idle. Two levels:
- **Prompt Suggestion:** After each assistant response, a forked agent (Haiku) predicts what user would type next. Filters out empty/evaluative/meta text. Max 12 words, 100 chars.
- **Speculation:** Pre-queues the suggested input and sends it to the model while user is still reading. If user doesn't accept, speculative result discarded. If accepted, speculative work kept. Max 20 speculation turns, 100 messages.

### Footer
StatusLine component (debounced 300ms) showing: session name, model info, workspace, version, output style, cost, context window stats, rate limits, vim mode, agent name, remote session info, worktree info. Customizable via hook command. PromptInputFooter shows: current working directory, vim mode indicator, session title, model indicator.

### Clipboard
Image paste support via `ctrl+v` (macOS `pbpaste`, Linux `xclip`/`xsel`). Clipboard images cached to disk, resized to API limits, sent as `base64` data URL. Large text paste (over 1024 chars) stored externally by hash, referenced as `[Pasted text #1 +N lines]`. Expandable on click. Clipboard writing via `setClipboard()` with tmux passthrough.

### What's Unique to Claude Code
- Vendored Ink fork with cell-level blitting and diff-based rendering
- Stable/unstable streaming split (preserves markdown structure)
- `marked` + `cli-highlight` for markdown + syntax (hybrid approach)
- Context visualization grid (`/context`)
- Racing approval mechanism with multiple concurrent approval sources
- Custom Select widget with Tab-to-amend
- Bash permission options: prefix editing, classifier descriptions
- Message queue with priority levels (`now` > `next` > `later`)
- Multi-level interruption cascade
- Full keybinding system with chord support and user overrides
- Submission undo (restore last submitted message on Escape)
- AI prompt suggestion + speculation (pre-queue while user reads)
- Most sophisticated terminal capability detection suite
- Full vim mode state machine
- Hook system for customizing status line format
- Extended key support (Kitty keyboard protocol, xterm modifyOtherKeys)
- OSC 8 hyperlinks for links and GitHub references
- DEC 2026 synchronized output
- SGR mouse tracking
- Multi-keystroke chord keybindings

---

## Key Observations

1. **Foundation is identical.** All three use Ink + React, same state machine, same streaming model, same text buffer. This is a strong, proven foundation for VoidRift.

2. **Claude Code is the most sophisticated.** Its Ink fork is heavily modified (cell-level blitting, diff-based rendering, synchronized output, terminal query system). Its streaming split (stable/unstable) is more sophisticated than Gemini/Qwen's.

3. **Gemini is feature-rich but monolithic.** ~2800-line AppContainer. Session browser, folder trust, themes.

4. **Qwen is modular and command-rich.** 27+ slash commands, multi-agent architecture, cleaner component organization. But features are often incomplete.

5. **No feature should be copied blindly.** Each has architectural choices that don't fit the others. We need to be selective.

6. **The streaming model is a winner.** Pending vs Static, 3-state machine, safe markdown splits. This is the core pattern across all three.

7. **Tool confirmation overlay is essential.** All three handle it. Claude Code's is the most sophisticated (racing approvals, bash prefix editing).

8. **Multi-agent (Qwen) and session browser (Gemini) are nice but not foundational.**

9. **Themes come later.** We need basic rendering working first.
