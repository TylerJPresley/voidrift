# VOIDRIFT-PLUGINS

Guardrails for working on VoidRift's plugin system.

## Architecture

- `src/plugins/interface.ts` — CoreAPI: the public plugin surface
- `src/plugins/registry.ts` — PluginRegistry: tracks loaded plugins + discovery
- `src/bootstrap/cli.ts` — plugin loading sequence during startup

## Discovery

Plugins are npm packages with `"voidrift": { "plugin": true }` in package.json. Discovered from `node_modules/` automatically.

Activation: listed in config's `plugins: ["package-name"]` array. Discovered but not listed = inactive.

## CoreAPI Surface

What plugins CAN do:
- Register slash commands
- Register agents
- Register skills
- Register prompts and templates (base, override, extend)
- Register panels
- Subscribe to bus events
- Inject turn context
- Spawn subagents
- Execute commands

What plugins CANNOT do:
- Access the ContextManager directly
- Bypass the permission gate
- Modify other plugins' registrations
- Access raw model clients

## Rules

- CoreAPI is sandboxed. A plugin gets a `CoreAPI` instance scoped to its own `pluginName`.
- Commands registered by plugins show their source in `/help`.
- Plugin agents appear in the agents panel with their source plugin name.
- Plugins load synchronously during bootstrap. A failing plugin logs a warning but doesn't crash startup.
- Template actions: `base` (default), `override` (replaces), `extends` (appends). Override wins over base from same key.
- Active plugins list lives in config. Plugin code lives in node_modules.

## Adding Plugin Capabilities

1. Add the method to `CoreAPI` class in `src/plugins/interface.ts`
2. If it needs a new service, inject it via constructor
3. Document in `docs/PLUGINS.md`
4. Add test in `tests/plugins/`

## Event-Driven Integration

Plugins subscribe to events, not poll. Available events:
- FILE_CREATED/MODIFIED/DELETED
- BEFORE/AFTER_TOOL_EXECUTE
- TURN_BEFORE (before model invocation — inject context, suggest tools)
- TURN_AFTER (after model response — log, summarize, trigger actions)
- TURN_COMPLETE
- SESSION_START/END
- MODE_CHANGED
- SUBAGENT_SPAWNED/COMPLETED

Custom events: `api.registerEvent("MY_EVENT")` + `api.emitEvent("MY_EVENT", payload)`
