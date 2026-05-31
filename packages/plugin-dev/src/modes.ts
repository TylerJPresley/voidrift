import type { CoreRegistry } from "@voidrift/core";

/**
 * Section 9.3: Custom Mode Sandboxes.
 *
 * Registers development-specific modes that restrict write boundaries:
 * - idea: writes locked to .voidrift/ideas/ only
 * - cr: writes locked to .voidrift/changes/ only
 * - dev: writes locked to files declared in active CR's focusedFiles
 */
export function registerDevModes(registry: CoreRegistry): void {
  registry.registerMode({
    name: "idea",
    allowedTools: ["read_file", "glob_files", "write_file", "edit_file", "web_search"],
    permissionGate: false,
  });

  registry.registerMode({
    name: "cr",
    allowedTools: ["read_file", "glob_files", "write_file", "edit_file", "web_search", "web_fetch"],
    permissionGate: false,
  });

  registry.registerMode({
    name: "dev",
    allowedTools: ["read_file", "glob_files", "write_file", "edit_file", "execute_command"],
    permissionGate: true,
  });
}
