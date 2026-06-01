# VoidRift TODOs

## Open

- [ ] **Namespace display for prompts/templates**: Decide on visual separation format in `/templates` TUI panel. Current: keys like `prompts/mode-plan` with a `Source` column showing `core` or `plugin-dev`. Problem: if two plugins register the same key, the key column looks identical. Options discussed: (1) prefix display with `core:prompts/chat`, (2) group by plugin with section headers, (3) make namespace part of the key path itself. Need to decide which approach and implement.

- [ ] **Wire plugin-dev prompts into the running harness**: The prompts are registered in code but the `PluginInterface` needs to be instantiated with `templateService` and `pluginName` during actual bootstrap. Verify `/templates` shows plugin-dev entries at runtime.

- [ ] **Update blueprint amendments.md**: Log the namespaced prompt service and plugin-dev prompt registration as a formal amendment if it deviates from original blueprint intent.
