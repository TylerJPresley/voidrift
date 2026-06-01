import type { CoreRegistry } from "@voidrift/core";
import { registerDevModes } from "./modes.js";
import { registerDevCommands } from "./commands.js";
import { registerDevPrompts } from "./prompts.js";
import { WorkflowObjects } from "./workflows.js";

export { registerDevModes } from "./modes.js";
export { registerDevCommands } from "./commands.js";
export { registerDevPrompts } from "./prompts.js";
export { WorkflowObjects, type Idea, type ChangeRequest, type Task } from "./workflows.js";

/**
 * Plugin bootstrap.
 * Registers all development modes, commands, prompts, and workflow objects
 * into the core harness registry on startup.
 */
export function registerPlugin(
  registry: CoreRegistry,
  workspaceRoot: string,
  output: (text: string) => void,
  pluginInterface?: { registerPrompt: (key: string, type: "prompt" | "template", content: string) => void }
): WorkflowObjects {
  registerDevModes(registry);
  registerDevCommands(registry, output);
  if (pluginInterface) registerDevPrompts(pluginInterface);
  return new WorkflowObjects(workspaceRoot);
}
