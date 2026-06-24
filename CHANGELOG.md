# Changelog

## 0.1.0 — Initial Release

First public release of VoidRift.

### Features
- Model-agnostic harness: connects to any OpenAI-compatible endpoint, Anthropic, or Google Gemini
- Three-tier model router (flash/utility/dense) with automatic escalation and de-escalation
- Permission system with policy engine, workspace boundary enforcement, and shell command classification
- Interactive approval flow with session-scoped trust rules
- Full MCP client implementation (tools, resources, prompts, sampling, elicitation, OAuth2+PKCE)
- Four-layer context architecture (Agent/Orbit/Drift/Void) with cache optimization
- Multi-agent modes: Chat, Plan, Vibe (shift+tab to cycle)
- Planning system with now/next/later priority lanes
- Memory system with local and global scopes
- Skills system with extension/file/keyword triggers and progressive disclosure
- Plugin system with CoreAPI, event bus, and panel registration
- Background subagents in isolated git worktrees
- 24 slash commands with full panel UIs
- Tab completion for files and commands
- Git checkpointing and rollback
- Web search and fetch
- Audit logging

### Technical
- React/Ink TUI
- TypeScript strict mode
- 303 tests (vitest)
- Zod-based tool schema system
- Registration-based tool dispatch
