import type { CoreAPI } from "@voidrift/core";
import { registerDevCommands } from "./commands.js";
import { registerDevTemplates } from "./prompts.js";
import { registerDevAgents } from "./agents.js";
import { WorkflowObjects } from "./workflows.js";

export { registerDevCommands } from "./commands.js";
export { registerDevTemplates } from "./prompts.js";
export { registerDevAgents } from "./agents.js";
export { WorkflowObjects, type Idea, type ChangeRequest, type Task } from "./workflows.js";

/**
 * Plugin bootstrap.
 * Called by core's config-driven plugin loader.
 * Registers all development commands, templates, and agents
 * into the core harness via the public CoreAPI.
 */
export function register(api: CoreAPI): void {
  registerDevCommands(api);
  registerDevTemplates(api);
  registerDevAgents((manifest) => api.registerAgent(manifest));
}
