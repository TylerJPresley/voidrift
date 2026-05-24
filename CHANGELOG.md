# Changelog

## 2026-05-23 — Tool System

### Implemented
- **packages/cli/src/tools/registry.ts** — Tool registration, execution, OpenAI function format conversion
- **packages/cli/src/tools/builtins.ts** — 5 built-in tools: bash, read, write, edit, glob
- **packages/cli/src/adapters/openai.ts** — Now sends tool definitions, parses tool_call deltas from streaming (handles split arguments across chunks)
- **packages/cli/src/session/manager.ts** — Full tool loop: model → tool_calls → execute → send results → model continues until text-only response
- **packages/cli/src/app.tsx** — Tool call display (✓ name (args) + truncated result), pending tool spinner, wired to real tool execution

### Tool Loop Flow
1. User sends message
2. Model streams response (may include tool_calls)
3. If tool_calls: execute each tool, show results, send back to model
4. Model continues (may call more tools or respond with text)
5. Loop ends when model responds with text only

## 2026-05-23 — Foundation: Minimum Viable Chat Loop

### Architecture Decision
- Consolidated to single `@voidrift/cli` package (no multi-package workspace)
- Adapters, config, session, tools, TUI are internal modules within one package
- `@google/gemini-cli-core` remains an external dependency (not yet wired)
- Mirrors Gemini CLI / Qwen Code structure: `core` (external) + `cli` (our app)

### Implemented
- **packages/cli/src/config/loader.ts** — Reads `.voidrift/models.json`, resolves env vars in api_key, returns default model config
- **packages/cli/src/adapters/openai.ts** — OpenAI-compatible streaming adapter using native fetch + SSE parsing
- **packages/cli/src/adapters/factory.ts** — Resolves protocol string to adapter instance
- **packages/cli/src/session/manager.ts** — Holds conversation history, streams from adapter, accumulates responses
- **packages/cli/src/app.tsx** — Minimal Ink app: header, message history (Static), streaming response with cursor, text input, /exit
- **packages/cli/bin/voidrift.js** — Entry point with tsx shebang
- **packages/cli/package.json** — Package manifest with dependencies
- **packages/cli/tsconfig.json** — TypeScript config (ES2022, ESNext modules, JSX)

### Updated
- **package.json** — Root scripts: `start` → `tsx packages/cli/src/app.tsx`, `mockup` unchanged
- **plan.md** — Package map consolidated to single @voidrift/cli, internal module structure defined
- **REQUIREMENTS.md** — REQ-TUI-20 (footer layout), REQ-TUI-25 (Ctrl+C behavior), REQ-TUI-29 (/stats panel), REQ-TUI-33 (/exit), REQ-TUI-36–38 (welcome, panels, palette)

### Mockup
- Interactive Ink TUI prototype with streaming simulation, tool calls, diff display
- Blue synthwave palette (#6a7ec8 primary, #61afef accent, #5a6aa8 borders)
- Side-by-side header (VoidRift logo + session info)
- /stats panel below input with esc dismiss
- Footer: left (mode, model, context%, governance) / right (path, branch)

### How to Run
```bash
bun run start        # Interactive TUI (requires TTY)
bun run mockup       # Design mockup with simulated data
```

### What's Next
- Test with real model endpoint in terminal
- Wire gemini-cli-core dependency
- Add tool system
- Add session persistence
- Build out TUI components from mockup
