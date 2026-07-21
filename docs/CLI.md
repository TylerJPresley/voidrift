# VoidRift CLI Guide

Everything you need to install, configure, and use VoidRift in your terminal.

## Installation

```bash
npm install -g voidrift
```

**Requirements:**
- Node.js ≥ 22
- Git ≥ 2.30
- Linux, macOS, or WSL

## Configuration

VoidRift uses a two-level config system:
- **Global:** `~/.config/voidrift/config.json` — your models, defaults
- **Workspace:** `.voidrift/config.json` — per-project overrides

Workspace config merges on top of global.

### Minimal Configuration

One model is all you need:

```json
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
```

### Multi-Model Configuration

Use cheap local models for routine work, cloud models for complex reasoning:

```json
{
  "models": {
    "local": {
      "protocol": "openai",
      "model": "qwen2.5-coder:14b",
      "baseUrl": "http://localhost:11434/v1",
      "contextLimit": 32768,
      "preflight": true
    },
    "claude": {
      "protocol": "anthropic",
      "model": "claude-sonnet-4-20250514",
      "apiKeyEnv": "ANTHROPIC_API_KEY",
      "contextLimit": 200000,
      "maxOutputTokens": 8192
    }
  },
  "modelSelected": "local",
  "modelEscalation": "claude",
  "modelUtility": "local"
}
```

### Model Fields

| Field | Required | Description |
|-------|----------|-------------|
| `modelSelected` | Yes | Your primary model. Must reference a model in the `models` block. |
| `modelEscalation` | No | Lifeline model for complex tasks. If set, enables escalation. |
| `modelUtility` | No | Internal harness operations (preflight, summarization). If not set, those features are off. |
| `modelBackground` | No | Model for `/run`, routines, subagents. Defaults to `modelSelected`. |

### Escalation

If you assign an escalation model, the harness can switch to it when your primary model is stuck:
- Plan creation is blocked on the primary model — forces escalation
- 2 consecutive tool failures trigger automatic escalation
- Context usage exceeding 85% triggers escalation
- The model can call `escalate` manually when overwhelmed

The escalation model calls `deescalate` when the complex reasoning is done. No user intervention needed.

### Supported Providers

- **OpenAI-compatible:** Ollama, vLLM, Groq, DeepSeek, Together, Anyscale, LM Studio
- **Anthropic:** Claude (native protocol)
- **Google:** Gemini (native protocol)

## Operating Modes

Switch modes with `Shift+Tab`:

| Mode | Behavior |
|------|----------|
| **Chat** | Collaborative. Asks before making changes. Default mode. |
| **Plan** | Read-only. Produces plans and analysis without modifying files. |
| **Vibe** | Fully autonomous. All permissions auto-approve. |

## Slash Commands

| Command | Description |
|---------|-------------|
| `/help` | Interactive help panel |
| `/model` | Switch or assign models |
| `/plan` | View and manage plans |
| `/run <instruction>` | Autonomous background execution |
| `/run routine <name>` | Execute a saved routine |
| `/stats` | Session analytics |
| `/context` | Context layer visualizer |
| `/tools` | List available tools |
| `/skills` | Skill registry |
| `/memory` | Persistent knowledge manager |
| `/agents` | Agent manager |
| `/mcp` | MCP server connections |
| `/templates` | Document templates |
| `/prompts` | System prompt overrides |
| `/tasks` | Background task monitor |
| `/routines` | Repeatable routine manager |
| `/resume` | Session browser |
| `/diff` | Code diff viewer |
| `/config` | Edit configuration |
| `/policy` | Security policy rules |
| `/history` | Audit event log |
| `/plugins` | Plugin manager |
| `/compact` | Compress conversation history |
| `/clear` | Reset session |
| `/exit` | Save and quit |

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Enter` | Submit input |
| `Shift+Tab` | Cycle mode (Chat → Plan → Vibe) |
| `Tab` | Autocomplete command/path |
| `Esc` | Cancel generation / close panel |
| `Ctrl+C ×2` | Exit VoidRift |
| `Ctrl+V` | Attach clipboard image |
| `Ctrl+X` | Remove attached image |
| `↑/↓` | Input history / autocomplete navigation |

## Tuning Guide

### Single Cloud Model (Claude, GPT, Gemini)

```json
{
  "models": { "cloud": { "protocol": "...", "model": "...", "contextLimit": 200000 } },
  "modelSelected": "cloud"
}
```

No additional tuning needed. Preflight is off by default. No escalation.

### Single Local Model (7B-32B)

```json
{
  "models": { "local": { "protocol": "openai", "model": "qwen2.5-coder:7b", "baseUrl": "http://localhost:11434/v1", "contextLimit": 32768, "preflight": true } },
  "modelSelected": "local",
  "turnsMaxToolRounds": 5,
  "turnsReminderInterval": 10
}
```

- `preflight: true` — enables tool classifier (reduces confusion on small models)
- `turnsMaxToolRounds: 5` — prevents runaway loops
- `turnsReminderInterval: 10` — more frequent behavioral reminders

### Multi-Model (Local + Cloud Escalation)

```json
{
  "models": {
    "local": { "protocol": "openai", "model": "qwen2.5-coder:14b", "baseUrl": "http://localhost:11434/v1", "contextLimit": 32768, "preflight": true },
    "cloud": { "protocol": "anthropic", "model": "claude-sonnet-4-20250514", "apiKeyEnv": "ANTHROPIC_API_KEY", "contextLimit": 200000 }
  },
  "modelSelected": "local",
  "modelEscalation": "cloud",
  "modelUtility": "local",
  "modelEscalationFailureCount": 2
}
```

### Tuning Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `turnsMaxToolRounds` | 10 | Tool calls per turn before forced stop |
| `turnsReminderInterval` | 25 | Behavioral nudge frequency (0=disabled) |
| `modelEscalationFailureCount` | 2 | Failures before auto-escalation |
| `turnsContextBudgetStopPct` | 0.6 | Context % that halts tool execution |
| `contextDecayAfterTurns` | 20 | Auto-compact after N turns |
| `networkModelTimeoutMs` | 120000 | Model API timeout |
| `securityApprovalTimeout` | 120 | Seconds to wait for tool approval |

## Troubleshooting

**Model returns empty responses:**
- Check your endpoint is reachable
- Check context limit isn't exceeded (`/context` panel shows usage)
- Try a fresh session (`/clear`)

**Tools not available:**
- Check `/tools` panel for bound tools
- Enable preflight (`"preflight": true`) if model is small
- Use `/skills` to check loaded domain knowledge

**Slow responses:**
- Disable preflight if using a capable cloud model
- Reduce `turnsMaxToolRounds` for small models
- Check endpoint latency directly

**Session not saving:**
- Ensure you're running from a compiled build, not `bun src/main.tsx` from another directory
- Check `.voidrift/sessions/` for files
