/**
 * Tool builder: assembles (tools, handlers) per command (REQ-ARCH-9, REQ-TOOL-3..8).
 */

import { DOMAIN_TOOLS, type ToolDef } from "./registry.js";
import { WriteContext, makeFileHandler } from "./filesystem.js";
import { createRunCommand } from "./shell.js";
import { readProcessOutput } from "./process.js";
import * as browser from "./browser.js";
import { getBashConfig, getAllowedCommands } from "../config.js";
import { findSkill, listSkills } from "../skills.js";

export type Handler = (...args: unknown[]) => string;

// ---------------------------------------------------------------------------
// Per-command tool sets (resolved dynamically from command modules)
// ---------------------------------------------------------------------------

const COMMAND_TOOLS: Record<string, Set<string>> = {
  gather: new Set(["file", "analyze"]),
  plan: new Set(["file"]),
  develop: new Set(["file", "shell"]),
  chat: new Set(["file", "http", "shell", "skill", "memory", "session", "analyze", "ask"]),
  "verify-plan": new Set(["file"]),
  "verify-execute": new Set(["file", "http", "shell", "browser", "process"]),
};

const COMMAND_ACTIONS: Record<string, Record<string, string[]>> = {
  gather: { file: ["read", "list"] },
  plan: { file: ["read", "write", "edit", "list"] },
  develop: { file: ["read", "write", "edit", "delete", "list"] },
  chat: { file: ["read", "write", "edit", "delete", "list"], http: ["get", "post", "put", "delete"] },
  "verify-plan": { file: ["read", "list"] },
  "verify-execute": { file: ["read", "write", "list"], http: ["get", "post", "put", "delete"] },
};

// ---------------------------------------------------------------------------
// Schema manipulation
// ---------------------------------------------------------------------------

export function filterTools(tools: ToolDef[], allowedNames: Set<string> | null): ToolDef[] {
  if (!allowedNames) return [...tools];
  return tools.filter(t => allowedNames.has(t.function.name));
}

export function narrowSchemaActions(schema: ToolDef, allowedActions: string[]): ToolDef {
  const copy = JSON.parse(JSON.stringify(schema)) as ToolDef;
  const actionProp = copy.function.parameters.properties.action as Record<string, unknown> | undefined;
  if (actionProp?.enum) {
    actionProp.enum = (actionProp.enum as string[]).filter(a => allowedActions.includes(a));
  }
  return copy;
}

export function validateSchemaHandlerContract(tools: ToolDef[], handlers: Record<string, Handler>): void {
  for (const tool of tools) {
    const name = tool.function.name;
    const handler = handlers[name];
    if (!handler) continue;
    // In TypeScript we can't easily inspect function parameter names at runtime.
    // This is a structural check — we verify the handler exists and is callable.
    if (typeof handler !== "function") {
      throw new Error(`Handler for '${name}' is not a function.`);
    }
  }
}

export function buildToolGuidelines(tools: ToolDef[]): string {
  const lines: string[] = [];
  for (const tool of tools) {
    if (!tool._guidelines?.length) continue;
    for (const g of tool._guidelines) {
      lines.push(`- ${tool.function.name}: ${g}`);
    }
  }
  return lines.length ? `## Tool Guidelines\n\n${lines.join("\n")}` : "";
}

// ---------------------------------------------------------------------------
// Handler building
// ---------------------------------------------------------------------------

export function buildDomainHandlers(
  cmd: string | null,
  projectDir: string,
  ctx?: WriteContext,
): Record<string, Handler> {
  const writeCtx = ctx ?? new WriteContext({ projectDir });
  const handlers: Record<string, Handler> = {};

  // file
  handlers.file = makeFileHandler(writeCtx, projectDir) as Handler;

  // http (stub — full in Phase 5)
  handlers.http = (action: unknown, url: unknown, headers: unknown, body: unknown, session_id: unknown) => {
    return JSON.stringify({ error: "HTTP tool not yet implemented." });
  };

  // shell
  const cmdBase = cmd?.split("-")[0] ?? "";
  if (["develop", "chat", "verify"].includes(cmdBase)) {
    const bashConfig = getBashConfig(cmdBase);
    const rc = createRunCommand(bashConfig, getAllowedCommands());
    handlers.shell = ((cmd: unknown, cwd: unknown) => rc(String(cmd), cwd ? String(cwd) : undefined)) as Handler;
  } else {
    handlers.shell = () => "Shell commands are not available in this context.";
  }

  // browser
  handlers.browser = ((action: unknown, url: unknown, selector: unknown, session_id: unknown) => {
    const a = String(action);
    if (a === "navigate") return browser.browserNavigate(String(url), session_id ? String(session_id) : undefined);
    if (a === "screenshot") return browser.browserScreenshot(undefined, session_id ? String(session_id) : undefined);
    if (a === "click") return browser.browserClick(String(selector), session_id ? String(session_id) : undefined);
    if (a === "get_text") return browser.browserGetText(selector ? String(selector) : undefined, session_id ? String(session_id) : undefined);
    return `Unknown browser action: ${a}`;
  }) as Handler;

  // process
  handlers.process = ((action: unknown, handle_id: unknown) => {
    if (String(action) === "read_output") return readProcessOutput(String(handle_id));
    return `Unknown process action: ${action}`;
  }) as Handler;

  // skill
  handlers.skill = ((action: unknown, name: unknown, topic: unknown) => {
    if (String(action) === "list") {
      const skills = listSkills(projectDir);
      if (!skills.length) return "No skills found.";
      return skills.map(s => `[${s.layer}] ${s.name}: ${s.description}`).join("\n");
    }
    if (String(action) === "get") return findSkill(String(name), projectDir) ?? `Skill '${name}' not found.`;
    return `Unknown skill action: ${action}`;
  }) as Handler;

  // memory (stub — full in Phase 7)
  handlers.memory = () => "Memory tool not yet implemented.";

  // session (stub — full in Phase 7)
  handlers.session = () => "Session tool not yet implemented.";

  // analyze (stub — full in Phase 4)
  handlers.analyze = () => "Analyze tool not yet implemented.";

  // ask (stub — full in Phase 7)
  handlers.ask = () => "Ask tool not yet implemented.";

  return handlers;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function buildLocalTools(
  cmd?: string | null,
  projectDir?: string,
  ctx?: WriteContext,
): [ToolDef[], Record<string, Handler>] {
  const dir = projectDir ?? process.cwd();
  const allowed = cmd ? COMMAND_TOOLS[cmd] ?? null : null;
  const actions = cmd ? COMMAND_ACTIONS[cmd] ?? {} : {};
  const handlers = buildDomainHandlers(cmd ?? null, dir, ctx);

  let tools = filterTools(DOMAIN_TOOLS, allowed);

  // Narrow action enums per command
  tools = tools.map(t => {
    const toolActions = actions[t.function.name];
    return toolActions ? narrowSchemaActions(t, toolActions) : t;
  });

  validateSchemaHandlerContract(tools, handlers);
  return [tools, handlers];
}
