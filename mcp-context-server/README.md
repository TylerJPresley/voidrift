# VoidRift MCP Context Server

MCP server that stores, retrieves, and exports project artifacts and framework resources for the VoidRift framework.

See the [framework README](../README.md) for full documentation.

## Install

```bash
pip install -e .
```

## Usage

The server communicates via stdio using the MCP protocol. It is started by the CLI automatically, or can be run directly:

```bash
voidrift-mcp
```

## Tools

| Tool | Description |
|------|-------------|
| `store_file_analysis` | Store analysis results for a source file |
| `get_file_analysis` | Retrieve stored analysis for a file |
| `get_all_analyses` | Retrieve all stored analyses |
| `store_requirements` | Store requirements content in memory |
| `get_requirements` | Retrieve stored or on-disk requirements |
| `get_conventions` | Retrieve CONVENTIONS.md sections by heading |
| `get_skill` | Retrieve skill file content by name and topic |
| `read_source_file` | Read a source file from the project directory |
| `write_file` | Write content to a file in the project directory |
| `export_to_file` | Export a stored artifact to disk |
| `list_project_artifacts` | List all files in .voidrift/ |
| `get_framework_resource` | Retrieve a framework resource file by name |

## Structure

```
src/voidrift_mcp/
├── server.py          # FastMCP server with 12 tools
├── markdown_parser.py # Markdown indexing by header
├── artifact_store.py  # In-memory key-value store with disk export
└── session_store.py   # SQLite session metadata tracking
```

## Dependencies

- `mcp[cli]` — FastMCP server framework
- `pydantic` — Data validation
- `pyyaml` — Config parsing

## Tests

```bash
pytest              # From this directory
pytest -v           # Verbose
```
