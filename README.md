# VoidRift

A local-first, model-agnostic AI harness with a React/Ink terminal interface. VoidRift runs on your machine, connects to any model (local or cloud), and gives you full control over what it can do.

## What It Does

VoidRift is a TUI application that puts an AI assistant in your terminal with workspace access — file reading/writing, shell execution, web search, and third-party tool integrations via MCP. It's designed for engineers who want cloud-grade agent orchestration without rate limits, API costs, or cloud lock-in.

**It is not a code editor.** It's a general-purpose harness that works on any file workspace.

## Features

**Model Independence**
- Connects to any OpenAI-compatible endpoint (Ollama, vLLM, Groq, DeepSeek)
- Native Anthropic and Google Gemini support
- Three-tier model router: Flash (fast/cheap) → Utility → Dense (powerful)
- Automatic escalation when context fills up

**Security & Permissions**
- Workspace boundary enforcement — model can't read outside your project without approval
- Permission gate for write operations, shell commands, network access, and MCP tools
- Arrow-key selector: allow once, trust for session (exact or pattern), deny
- Shell command classification: safe commands auto-approve, dangerous always ask
- Auto-deny shell commands that have dedicated tool equivalents (cat→read_file, find→glob_files)

**MCP (Model Context Protocol)**
- Full spec implementation using `@modelcontextprotocol/sdk`
- Add servers via URL with OAuth auto-discovery
- Tools, resources, prompts, sampling, elicitation, notifications
- Per-server trust management with session-scoped rules

**Context Management**
- Three-partition prompt architecture (Agent → Orbit → Drift → Void)
- Progressive skill disclosure — model sees what's available, loads on demand
- Prompt cache optimization (ascending volatility serialization)
- Automatic history compaction

**Multi-Agent Architecture**
- Chat / Plan / Vibe modes (shift+tab to cycle)
- Concurrent subagent execution in isolated git worktrees
- Path-mutex scheduling prevents write conflicts
- Task agents delegated to Flash tier

**Planning**
- Structured plan items with priorities (now / next / later)
- Model can read, write, and update plans in any mode
- Plans persist as markdown files in `.voidrift/plan/`

**Workspace Tools**
- File read/write/edit with diff preview
- Glob search, content search
- Web search and fetch (gated)
- Git checkpointing and safeguards
- Flash file summarizer with line-range indexing

**TUI**
- Panels: `/help`, `/tools`, `/mcp`, `/skills`, `/memory`, `/plan`, `/policy`, `/history`, `/stats`, `/model`, `/agents`
- Tab completion for files and commands
- Markdown rendering in responses
- Token budget visualization
- Audit logging

**Plugin System**
- CoreAPI for extensions
- Register commands, agents, prompts, panels, events
- MCP servers as first-class plugins

## Quick Start

```bash
# Prerequisites: Bun runtime, a model endpoint (Ollama, vLLM, or cloud API)

# Clone and install
git clone https://github.com/TylerJPresley/voidrift.git
cd voidrift
bun install

# Configure your model in ~/.config/voidrift/config.json
# (see docs for format)

# Run
bun start
```

## Configuration

Global config lives at `~/.config/voidrift/config.json`. Project-level overrides go in `.voidrift/config.json`.

```json
{
  "tiers": {
    "flash": "qwen-local",
    "utility": "claude-sonnet",
    "dense": "claude-opus"
  },
  "models": {
    "qwen-local": {
      "protocol": "openai",
      "model": "qwen2.5-coder-7b-instruct",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768,
      "temperature": 0.2
    }
  }
}
```

## Project Structure

```
packages/core/src/
├── adapters/       Model connectivity (LangChain adapters, streaming)
├── agents/         Agent registry and manifests
├── codemap/        AST code mapping and flash summarizer
├── commands/       Slash command registration
├── events/         Central event bus
├── mcp/            MCP engine, OAuth, credentials, discovery
├── orchestration/  Tool execution loop, goal runner, scheduler
├── output/         Budget watcher, truncator, autocomplete
├── plugins/        Plugin interface and registry
├── prompts/        Prompt registry and override cascade
├── router/         Three-tier model router with escalation
├── safeguards/     Git checkpoint, diff
├── security/       Permission gate, policy engine
├── session/        Context manager, compactor, brain, serializer
├── skills/         Progressive disclosure skill manager
├── templates/      Template service
├── tools/          Tool definitions and executors
├── watcher/        File system watcher
├── worktree/       Git worktree concurrency engine
└── main.tsx        TUI entry point
```

## Contributing

Contributions are welcome. Please:

1. Fork the repository
2. Create a feature branch
3. Write tests for new functionality
4. Ensure `bun test` passes (305+ tests)
5. Submit a pull request

Keep changes focused. One PR per feature or fix. Follow the existing code style and patterns (check the panels and tools for conventions).

## License

MIT — see [LICENSE](./LICENSE). Provided as-is with no warranty.
