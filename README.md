# VoidRift

An AI harness that runs in your terminal, connects to any model, and gives you complete control over what it can do. 

![GitHub Sponsors](https://img.shields.io/github/sponsors/TylerJPresley)
![GitHub contributors](https://img.shields.io/github/contributors/TylerJPresley/voidrift)
![NPM Last Update](https://img.shields.io/npm/last-update/voidrift)
![NPM Version](https://img.shields.io/npm/v/voidrift)
![GitHub Repo stars](https://img.shields.io/github/stars/TylerJPresley/voidrift)
![GitHub watchers](https://img.shields.io/github/watchers/TylerJPresley/voidrift)
![GitHub forks](https://img.shields.io/github/forks/TylerJPresley/voidrift)

## Why VoidRift Exists

Most AI tools are closed ecosystems. They lock you into one model, one provider, one way of working. They run in the cloud, meter your usage, and decide what the AI can access. You get a chat window someone else designed and a bill at the end of the month.

VoidRift is the opposite. It's a local-first harness — an orchestration layer that sits between you and any model. You bring your own models (local or cloud), define your own rules, and extend it with plugins and MCP servers. Nothing phones home. Nothing is rate-limited by a third party. Your workspace, your models, your rules.

## What It Does

- **Model Independence** — Connect to any provider (Ollama, Claude, Gemini, GPT, vLLM, Groq). Switch mid-session. Assign an escalation model for complex tasks.
- **Real Permission System** — Policy engine with pattern matching, workspace boundaries, and command classification. The model physically cannot act without going through the gate.
- **Context Architecture** — Four-layer system designed for cache efficiency. Stable content caches between calls, volatile content churns. Faster, cheaper, more headroom.
- **MCP Support** — Full Model Context Protocol implementation. Connect any MCP server — databases, APIs, monitoring tools become available tools.
- **Planning & Memory** — Persistent task tracking and compounding project knowledge across sessions.
- **Skills & Plugins** — Injectable domain expertise and extensible architecture via events, panels, agents, and tools.
- **Workspace Tools** — Structured file access, git checkpointing, web research, command execution with full permission controls.
- **Terminal-Native** — React/Ink TUI that starts instantly, works over SSH, and stays out of your way.

## Quick Start

```bash
# Install
npm install -g voidrift

# Configure (one model is all you need)
mkdir -p ~/.config/voidrift
cat > ~/.config/voidrift/config.json << 'EOF'
{
  "models": {
    "local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:7b-instruct",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768
    }
  },
  "modelSelected": "local"
}
EOF

# Run
voidrift
```

Type `/help` for the interactive guide, or just start typing.

## Documentation

| Document | Audience | Description |
|----------|----------|-------------|
| [CLI Guide](./docs/CLI.md) | Users | Configuration, commands, panels, shortcuts, troubleshooting |
| [SDK Reference](./docs/SDK.md) | Developers | CoreAPI, events, headless mode, plugin development |
| [Architecture](./docs/ARCHITECTURE.md) | Contributors | System design, subsystems, data flow |
| [Plugins](./docs/PLUGINS.md) | Plugin Authors | Plugin development guide |
| [Contributing](./docs/CONTRIBUTING.md) | Contributors | Build, test, dev workflow |

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](./docs/CONTRIBUTING.md) for development setup, testing, and pull request guidelines.

## License

Apache 2.0 — see [LICENSE](./LICENSE).
