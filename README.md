# VoidRift

A development harness built on `@google/gemini-cli-core`. Multi-model, governance-aware agent framework with a custom Ink TUI.

## Install

```bash
bun install
```

## Configure Models

Create `.voidrift/models.json`:

```json
{
  "default": "local",
  "models": {
    "local": {
      "protocol": "openai",
      "model_id": "qwen2.5-coder-32b",
      "base_url": "http://192.168.50.100:8000/v1"
    }
  }
}
```

Set the API key environment variable for your chosen model.

## Run

```bash
bun run start
```

Opens the interactive TUI.

## Test

```bash
bun test
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for component design.

## Requirements

See [REQUIREMENTS.md](REQUIREMENTS.md) for the full specification.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the change workflow.
