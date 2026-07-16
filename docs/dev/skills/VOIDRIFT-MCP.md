# VOIDRIFT-MCP

Guardrails for working on VoidRift's MCP integration.

## Architecture

- `src/mcp/engine.ts` — MCPEngine: connect, disconnect, tool calls, resources, prompts
- `src/mcp/oauth.ts` — OAuth2 + PKCE flow with localhost callback
- `src/mcp/credentials.ts` — AES-256 encrypted credential storage
- `src/mcp/discovery.ts` — auto-discovery via RFC 9728 protected resource metadata
- `src/mcp/router.ts` — routes `mcp_<server>_<tool>` names to the correct server

## Rules

- MCP tools go through the same permission gate as builtin tools. No bypass.
- Tool names follow `mcp_<serverName>_<toolName>` pattern. This is how routing works.
- Read-only MCP tools (annotated with `readOnlyHint: true`) can be auto-approved.
- All MCP server configs are per-file: `.voidrift/mcp/<name>.json` or `~/.config/voidrift/mcp/<name>.json`.
- Auto-connect on startup unless `autoConnect: false` in config.

## SDK Usage

Uses `@modelcontextprotocol/sdk`. Full spec implementation:
- Tools (list, call, change notifications)
- Resources (list, read, subscribe)
- Prompts (list, get)
- Sampling (bidirectional — server can request model calls back through VoidRift)
- Elicitation (server asks user questions through confirmation UI)
- Roots (server queries workspace)
- OAuth2 (dynamic client registration, PKCE, refresh)

## Adding to Graph

MCP tools are appended as `DynamicStructuredTool` instances in `graph.ts` after core tools are bound. Their `inputSchema` comes directly from the server's tool listing.

## Credential Security

- Credentials stored encrypted at `~/.config/voidrift/credentials/<server>.json`
- Key derived from username + salt via scrypt
- Refresh tokens auto-rotate on expiry (60s buffer)
- Never log or display access tokens
