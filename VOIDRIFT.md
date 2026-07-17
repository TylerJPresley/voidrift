# VoidRift — Project Instructions

This file is loaded into the model's context when working on this codebase. Follow these rules absolutely.

## Architecture

VoidRift is built on three foundations:

### Clean Architecture

Dependencies point inward. The dependency rule is inviolable.

```
Clients (TUI, VS Code, Electron) → CoreAPI → Use Cases → Entities → (nothing)
```

- **Entities**: Pure domain logic. No I/O imports.
- **Use Cases**: Orchestrate entities. No framework knowledge.
- **CoreAPI**: The sole boundary between clients and business logic.
- **Clients**: Import only `createCore()` + public types. They are consumers of the SDK.

### Event-Driven Architecture

All subsystems communicate through a typed event bus. Subscribers react to events — they don't call each other directly. This enables loose coupling, extensibility via plugins, and clean testing.

### CoreAPI is King

CoreAPI is the SDK. Every client — TUI, VS Code extension, headless mode, Electron, tests — talks exclusively through CoreAPI namespaces. No client accesses engine internals, domain classes, or the filesystem directly.

## Rules

- Never add `fs` or `child_process` imports to domain classes. Use repository interfaces.
- Never access engine internals from client code. All data flows through CoreAPI.
- Never expose internal types through CoreAPI. Return DTOs (plain objects).
- New persistence = new repository interface (FileSystem + InMemory implementations).
- New tools = `registerToolExecutor()`. No switch blocks.
- New API methods go on CoreAPI namespaces. Not standalone exports.
- Tests use InMemory repositories. No filesystem in unit tests.
- The TUI is a client. It imports nothing except React, Ink, and CoreAPI types.
