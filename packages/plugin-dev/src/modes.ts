import type { PluginInterface } from "@voidrift/core";

/**
 * Section 9.3: Custom Mode Sandboxes.
 *
 * Registers development-specific modes that restrict write boundaries:
 * - idea: writes locked to .voidrift/ideas/ only
 * - cr: writes locked to .voidrift/changes/ only
 * - dev: writes locked to files declared in active CR's focusedFiles
 */
export function registerDevModes(api: PluginInterface): void {
  api.registerSandboxMode("idea", "PM Idea refinement mode", (path) => path.includes(".voidrift/ideas"));
  api.registerSandboxMode("cr", "Architecture planning mode", (path) => path.includes(".voidrift/changes"));
  api.registerSandboxMode("dev", "Engineer execution mode", () => true);
}
