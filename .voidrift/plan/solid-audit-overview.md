---
priority: now
description: Create a comprehensive SOLID audit report covering all five principles across the VoidRift codebase
rationale: User wants to audit the codebase for SOLID adherence. Need a structured plan to evaluate each principle against actual code.
---

## SOLID Audit Plan

### Scope
Audit all five SOLID principles against the VoidRift codebase:

1. **Single Responsibility Principle (SRP)** — Each module/class/function should have one reason to change.
2. **Open/Closed Principle (OCP)** — Extensions should be open for extension but closed for modification.
3. **Liskov Substitution Principle (LSP)** — Subtypes must be substitutable without altering correctness.
4. **Interface Segregation Principle (ISP)** — No forced dependencies on interfaces with unused methods.
5. **Dependency Inversion Principle (DIP)** — High-level modules should not depend on low-level modules; both depend on abstractions.

### Methodology
- Read each candidate file identified in the cleanup TODO and other high-complexity files.
- Map violations to specific code locations with line references.
- Classify severity: 🔴 structural (requires refactoring), 🟠 local (can be fixed in-place), 🟡 design smell (acceptable for now).
- Produce a ranked remediation list.

### Files to Audit
- `src/main.tsx` — Bootstrap + rendering god file
- `src/panels.tsx` — Panel god file (if it exists separately from `src/ui/panels/`)
- `src/orchestration/graph.ts` — Tool execution dispatcher
- `src/tools/definitions.ts` + `src/tools/langchain-tools.ts` — Schema duplication
- `src/registry/core.ts` — Obsolete modes
- `src/session/compiler.ts` — Prompt compilation
- `src/security/policy-engine.ts` — Policy engine
- `src/mcp/engine.ts` — MCP engine
- `src/bootstrap/container.ts` — Dependency injection / bootstrap
- `src/tools/executors.ts` — Tool execution logic
- `src/turn.ts` — Turn execution
- `src/plugins/registry.ts` — Plugin registry
- `src/agents/registry.ts` — Agent registry
