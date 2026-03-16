# VoidRift CLI

Python CLI providing the `voidrift` command for the VoidRift local-first agentic development framework.

See the [framework README](../README.md) for full documentation.

## Install

```bash
pip install -e .
```

## Usage

```bash
voidrift                          # Interactive mode
voidrift gather <model>           # Phase 1: Gather requirements
voidrift plan <model>             # Phase 2: Architecture and tasks
voidrift develop <worker> [arch]  # Phase 3: Execute tasks
voidrift automate <worker>        # Phase 4: Generate IaC
voidrift verify <worker> [arch]   # Phase 5: Quality checks
voidrift chat <model>             # Ad-hoc chat session
voidrift status                   # Project phase status
```

## Structure

```
src/voidrift_cli/
├── main.py          # Click CLI entry point and subcommands
├── agent.py         # Agent loop (OpenAI client, tool call handling)
├── models.py        # Model config, resolution, lifecycle management
├── utils.py         # Task parsing, skill validation, project helpers
└── phases/
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
- `mcp[cli]` — MCP server integration

## Tests

```bash
pytest              # From this directory
pytest -v           # Verbose
```
