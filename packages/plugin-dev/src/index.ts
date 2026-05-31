import type { CoreRegistry } from "@voidrift/core";
import { registerDevModes } from "./modes.js";
import { registerDevCommands } from "./commands.js";
import { WorkflowObjects } from "./workflows.js";

export { registerDevModes } from "./modes.js";
export { registerDevCommands } from "./commands.js";
export { WorkflowObjects, type Idea, type ChangeRequest, type Task } from "./workflows.js";

/**
 * Plugin bootstrap.
 * Registers all development modes, commands, and workflow objects
 * into the core harness registry on startup.
 */
export function registerPlugin(
  registry: CoreRegistry,
  workspaceRoot: string,
  output: (text: string) => void
): WorkflowObjects {
  registerDevModes(registry);
  registerDevCommands(registry, output);
  return new WorkflowObjects(workspaceRoot);
}
