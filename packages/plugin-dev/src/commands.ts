import type { CoreAPI } from "@voidrift/core";

/**
 * Registers all development workflow slash commands.
 */
export function registerDevCommands(api: CoreAPI): void {
  // --- Idea Management ---
  api.registerCommand("ideas", "Ideas manager", async () => {});
  api.registerCommand("idea", "Open/create an idea", async () => {});

  // --- Change Request Management ---
  api.registerCommand("cr", "Change request manager", async () => {});
  api.registerCommand("changes", "List change requests", async () => {});

  // --- 5-Stage Dev Pipeline ---
  api.registerCommand("import", "Scan codebase structure", async () => {});
  api.registerCommand("analyze", "Evaluate an Idea and decompose into CRs and Tasks", async () => {});
  api.registerCommand("develop", "Spawn Engineer subagents to implement a CR's tasks", async () => {});
  api.registerCommand("verify", "Spawn Auditor subagents to verify a CR's acceptance criteria", async () => {});
  api.registerCommand("deploy", "Commit verified changes, generate changelog, and deploy", async () => {});

  // --- Task Completion ---
  api.registerCommand("done", "Mark current task complete", async () => {});
}
