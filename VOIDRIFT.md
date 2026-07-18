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

## Versioning & Release

To publish a new version to npm:

1. Update `"version"` in `package.json` (e.g. `"0.2.4"`)
2. Update `"version"` in `package-lock.json` (line 3, the root version)
3. Commit: `git add -A && git commit -m "v0.2.4"`
4. Tag: `git tag v0.2.4 -m "v0.2.4"`
5. Push: `git push origin main && git push origin v0.2.4`

The tag push triggers the GitHub Actions publish workflow which:
- Installs deps (bun)
- Typechecks (tsc --noEmit)
- Runs tests (bun run test)
- Builds (npm run build)
- Publishes to npm with provenance

**Rules:**
- The tag MUST match the version in package.json (e.g. tag `v0.2.4` → version `"0.2.4"`)
- npm rejects duplicate versions — you cannot re-publish an existing version
- If a publish fails, bump to the next patch version and re-tag
- Never push a tag without explicit permission from the user
