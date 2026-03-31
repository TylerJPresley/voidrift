# VoidRift CLI

Python CLI providing the `voidrift` command for the VoidRift local-first agentic development framework.

See the [framework README](../README.md) for full documentation.

## Install

```bash
uv pip install -e .
```

## Usage

```bash
voidrift                          # Interactive mode
voidrift gather <model>           # Gather: requirements elicitation
voidrift plan <model>             # Plan: architecture and task breakdown
voidrift develop <worker> [arch]  # Develop: execute tasks
voidrift automate <worker>        # Automate: generate IaC
voidrift verify <worker> [arch]   # Verify: quality checks
voidrift chat <model>             # Chat: ad-hoc session
voidrift status                   # Project status
```

## Structure

```
src/voidrift_cli/
├── main.py          # Click CLI entry point and subcommands
├── agent.py         # Agent loop (OpenAI client, tool call handling)
├── models.py        # Model config, resolution, lifecycle management
├── utils.py         # Task parsing, skill validation, project helpers
└── commands/
    ├── gather.py    # Requirements elicitation (interactive + reverse engineering)
    ├── plan.py      # Architecture and task breakdown
    ├── develop.py   # Task execution with escalation
    ├── automate.py  # IaC generation and review
    └── verify.py    # Quality checks and fix planning
```

## Dependencies

- `click` — CLI framework
- `rich` — Terminal formatting
- `pydantic` — Data validation
- `openai` — Model API client (OpenAI-compatible endpoints)
- `httpx` — HTTP client for health checks
- `pyyaml` — Worker model config parsing

## Tests

```bash
pytest              # From this directory
pytest -v           # Verbose
```
