# VOIDRIFT-SECURITY

Guardrails for working on VoidRift's security and permission system.

## Architecture

Two components:
- **PolicyEngine** (`src/security/policy-engine.ts`) — rule evaluation, shell classification, pattern matching
- **PermissionGate** (`src/security/permission-gate.ts`) — interactive UI suspension, confirmation flow

## Rules

- Never bypass the permission gate. Every write/execute/network/MCP tool call goes through it.
- `allowedTools` on an agent manifest auto-approves those tools. This is the ONLY bypass path.
- Workspace boundary is sacred. Paths outside `workspaceRoot` always trigger the gate.
- Shell classification: `safe` auto-approves, `dangerous` always asks, `has_equivalent` auto-denies with guidance.
- Rule evaluation order: session (300) > workspace (200) > user (100) > default (0). Higher priority wins.
- Session rules die on restart. Persistent rules survive via `policies.json`.

## Shell Classification

- Never add a command to `SAFE_COMMAND_PREFIXES` unless it's truly read-only and harmless.
- `has_equivalent` commands (cat, grep, find, curl) must auto-deny — the model should use dedicated tools.
- Dangerous patterns use regex. Test them. A false negative here is a security hole.

## Pattern Inference

- `inferPatterns()` returns specific-to-broad patterns for the confirmation UI.
- First pattern = exact (session trust). Later patterns = broad (permanent trust option).
- For `execute_command`: skip comment lines (`#`) when finding the binary name.
- For MCP tools: `mcp_server_*` is the broad pattern.

## Confirmation Flow

```
gate.check() → PolicyEngine.check() → decision "ask" → publish TOOL_CONFIRMATION_REQUEST → wait → TOOL_CONFIRMATION_RESPONSE
```

- Timeout is configurable (`approvalTimeout`, default 120s). 0 = wait forever.
- Response options: allow once, trust pattern (session), trust pattern (permanent), deny.
- Deny aborts the tool call, not the entire turn.
