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
// Per-command tool sets — resolved from command module exports (REQ-TOOL-8, REQ-ARCH-9)
// Each command module exports AGENT_TOOLS (Set<string>) and AGENT_TOOL_ACTIONS (Record<string, string[]>).
// This fallback dict is used when dynamic import fails (e.g. in tests or circular deps).
// ---------------------------------------------------------------------------

const _FALLBACK_TOOLS: Record<string, Set<string>> = {
  gather: new Set(["file", "analyze"]),
  plan: new Set(["file"]),
  develop: new Set(["file", "shell"]),
  chat: new Set(["file", "http", "shell", "skill", "memory", "session", "analyze", "ask"]),
  "verify-plan": new Set(["file"]),
  "verify-execute": new Set(["file", "http", "shell", "browser", "process"]),
};

const _FALLBACK_ACTIONS: Record<string, Record<string, string[]>> = {
  gather: { file: ["read", "list"] },
  plan: { file: ["read", "write", "edit", "list"] },
  develop: { file: ["read", "write", "edit", "delete", "list"] },
  chat: { file: ["read", "write", "edit", "delete", "list"], http: ["get", "post", "put", "delete"] },
  "verify-plan": { file: ["read", "list"] },
  "verify-execute": { file: ["read", "write", "list"], http: ["get", "post", "put", "delete"] },
};

function resolveCommandToolSet(cmd: string): { tools: Set<string>; actions: Record<string, string[]> } {
  // Try dynamic import from command module first
  const cmdToModule: Record<string, [string, string?, string?]> = {
    gather: ["../commands/gather.js"],
    plan: ["../commands/plan.js"],
    develop: ["../commands/develop.js"],
    chat: ["../commands/chat.js"],
    "verify-plan": ["../commands/verify.js", "AGENT_TOOLS_PLAN", "AGENT_TOOL_ACTIONS_PLAN"],
    "verify-execute": ["../commands/verify.js", "AGENT_TOOLS_EXECUTE", "AGENT_TOOL_ACTIONS_EXECUTE"],
  };
  const entry = cmdToModule[cmd];
  if (entry) {
    try {
      const mod = require(entry[0]);
      const toolsKey = entry[1] ?? "AGENT_TOOLS";
      const actionsKey = entry[2] ?? "AGENT_TOOL_ACTIONS";
      if (mod[toolsKey]) return { tools: mod[toolsKey], actions: mod[actionsKey] ?? {} };
    } catch { /* fallback */ }
  }
  return { tools: _FALLBACK_TOOLS[cmd] ?? new Set(), actions: _FALLBACK_ACTIONS[cmd] ?? {} };
}

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
  opts?: {
    memoryManager?: InstanceType<typeof import("../memory.js").MemoryManager>;
    session?: InstanceType<typeof import("../session.js").ChatSession>;
    askFn?: (question: string, options?: string[]) => string;
  },
): Record<string, Handler> {
  const writeCtx = ctx ?? new WriteContext({ projectDir });
  const handlers: Record<string, Handler> = {};

  // file
  handlers.file = makeFileHandler(writeCtx, projectDir) as Handler;

  // http (REQ-VF-12)
  handlers.http = ((action: unknown, url: unknown, headers: unknown, body: unknown, session_id: unknown) => {
    const { httpRequest: hr } = require("./http.js");
    // httpRequest is async — wrap for sync handler interface
    const method = String(action ?? "get").toUpperCase();
    // Use synchronous fetch via execSync for tool handler compatibility
    try {
      const { execSync } = require("node:child_process");
      const args = ["-s", "-X", method, "-w", "\\n%{http_code}"];
      if (headers) {
        try {
          const h = JSON.parse(String(headers));
          for (const [k, v] of Object.entries(h)) args.push("-H", `${k}: ${v}`);
        } catch { /* */ }
      }
      if (body && !["GET", "HEAD"].includes(method)) args.push("-d", String(body));
      args.push(String(url));
      const result = execSync(`curl ${args.map(a => `'${a}'`).join(" ")}`, { timeout: 30000, encoding: "utf-8" });
      const lines = result.trim().split("\n");
      const status = parseInt(lines.pop() ?? "0", 10);
      return JSON.stringify({ status, body: lines.join("\n") });
    } catch (e) {
      return JSON.stringify({ error: `HTTP ${method} ${url} failed: ${e instanceof Error ? e.message : e}` });
    }
  }) as Handler;

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

  // process (REQ-VF-8..11)
  handlers.process = ((action: unknown, handle_id: unknown, cmd: unknown, env: unknown, cwd: unknown) => {
    const { startProcess: sp, readProcessOutput: rpo, stopProcess: stp } = require("./process.js");
    const a = String(action);
    if (a === "start") return sp(String(cmd), env ? JSON.parse(String(env)) : undefined, cwd ? String(cwd) : undefined);
    if (a === "read_output") return rpo(String(handle_id));
    if (a === "stop") return stp(String(handle_id));
    return `Unknown process action: ${a}`;
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

  // memory (REQ-MEM-1)
  if (opts?.memoryManager) {
    const mm = opts.memoryManager;
    handlers.memory = ((action: unknown, name: unknown, content: unknown, scope: unknown, description: unknown) => {
      const a = String(action);
      if (a === "read") return mm.read(String(name)) ?? `Memory entry '${name}' not found.`;
      if (a === "write") { mm.write(String(name), String(content), String(description ?? ""), (scope as "project" | "global") ?? "project"); return `Saved memory entry '${name}'.`; }
      if (a === "list") { const entries = mm.list(); return entries.length ? entries.map(e => `[${e.layer}] ${e.name}: ${e.description}`).join("\n") : "No memory entries."; }
      if (a === "delete") { mm.delete(String(name), (scope as "project" | "global") ?? "project"); return `Deleted memory entry '${name}'.`; }
      return `Unknown memory action: ${a}`;
    }) as Handler;
  } else {
    handlers.memory = () => "Memory tool is only available in chat.";
  }

  // session (REQ-U-18)
  if (opts?.session) {
    const sess = opts.session;
    handlers.session = ((action: unknown, query: unknown, limit: unknown) => {
      const a = String(action);
      if (a === "search") {
        const results = sess.searchEntries(String(query), limit ? Number(limit) : 5);
        if (!results.length) return "No matches found.";
        return results.map(r => `[${r.timestamp}] ${r.role}: ${r.content}`).join("\n\n");
      }
      return `Unknown session action: ${a}`;
    }) as Handler;
  } else {
    handlers.session = () => "Session tool is only available in chat.";
  }

  // analyze (REQ-U-19, REQ-U-20)
  handlers.analyze = ((action: unknown, path: unknown) => {
    const a = String(action);
    if (a === "document") {
      const ext = String(path).split(".").pop()?.toLowerCase();
      if (!["pdf", "docx", "xlsx"].includes(ext ?? "")) return `Unsupported format '.${ext}'. Supported: .pdf, .docx, .xlsx`;
      if (ext === "pdf") { try { require("pdf-parse"); } catch { return "Missing dependency: npm install pdf-parse"; } }
      if (ext === "docx") { try { require("mammoth"); } catch { return "Missing dependency: npm install mammoth"; } }
      if (ext === "xlsx") { try { require("xlsx"); } catch { return "Missing dependency: npm install xlsx"; } }
      return `Document analysis for .${ext} files requires implementation of extraction logic.`;
    }
    if (a === "code") {
      // Basic code analysis without tree-sitter — use regex-based extraction
      const { readFileSync: rf, existsSync: ex } = require("node:fs");
      const { resolve } = require("node:path");
      const resolved = resolve(projectDir, String(path));
      if (!ex(resolved)) return `File not found: ${path}`;
      const content = rf(resolved, "utf-8");
      const lines = content.split("\n");
      const ext = String(path).split(".").pop()?.toLowerCase();
      const imports = lines.filter((l: string) => /^(import |from |require\(|const .* = require)/.test(l.trim())).map((l: string) => l.trim());
      const symbols = lines.reduce((acc: Array<{name: string; line: number}>, l: string, i: number) => {
        const fn = l.match(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
        const cls = l.match(/^(?:export\s+)?class\s+(\w+)/);
        const cnst = l.match(/^(?:export\s+)?const\s+(\w+)/);
        if (fn) acc.push({ name: fn[1], line: i + 1 });
        else if (cls) acc.push({ name: cls[1], line: i + 1 });
        else if (cnst) acc.push({ name: cnst[1], line: i + 1 });
        return acc;
      }, []);
      const complexity = lines.filter((l: string) => /\b(if|for|while|try|catch|switch)\b/.test(l)).length;
      return JSON.stringify({ language: ext, lines: lines.length, imports: imports.slice(0, 20), symbols: symbols.slice(0, 30), complexity }, null, 2);
    }
    return `Unknown analyze action: ${a}`;
  }) as Handler;

  // ask (REQ-U-12)
  if (opts?.askFn) {
    const askFn = opts.askFn;
    handlers.ask = ((question: unknown, options: unknown) => {
      const opts = options ? (Array.isArray(options) ? options : JSON.parse(String(options))) : undefined;
      return askFn(String(question), opts as string[] | undefined);
    }) as Handler;
  } else {
    handlers.ask = ((question: unknown) => {
      if (!process.stdin.isTTY) return "[No operator present. Use your best judgment and document your decision in comments.]";
      return "Ask tool is only available in interactive chat.";
    }) as Handler;
  }

  return handlers;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function buildLocalTools(
  cmd?: string | null,
  projectDir?: string,
  ctx?: WriteContext,
  opts?: Parameters<typeof buildDomainHandlers>[3],
): [ToolDef[], Record<string, Handler>] {
  const dir = projectDir ?? process.cwd();
  const { tools: allowed, actions } = cmd ? resolveCommandToolSet(cmd) : { tools: null as Set<string> | null, actions: {} as Record<string, string[]> };
  const handlers = buildDomainHandlers(cmd ?? null, dir, ctx, opts);

  let tools = filterTools(DOMAIN_TOOLS, allowed);

  // Narrow action enums per command
  tools = tools.map(t => {
    const toolActions = actions[t.function.name];
    return toolActions ? narrowSchemaActions(t, toolActions) : t;
  });

  validateSchemaHandlerContract(tools, handlers);
  return [tools, handlers];
}
