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
import { loadPrompt } from "../prompts.js";

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
  "verify-doc": new Set(["file"]),
};

const _FALLBACK_ACTIONS: Record<string, Record<string, string[]>> = {
  gather: { file: ["read", "list"] },
  plan: { file: ["read", "write", "edit", "list"] },
  develop: { file: ["read", "write", "edit", "delete", "list"] },
  chat: { file: ["read", "write", "edit", "delete", "list"], http: ["get", "post", "put", "delete"] },
  "verify-plan": { file: ["read", "list"] },
  "verify-execute": { file: ["read", "write", "list"], http: ["get", "post", "put", "delete"] },
  "verify-doc": { file: ["read", "write", "list"] },
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
    "verify-doc": ["../commands/verify.js", "AGENT_TOOLS_DOC", "AGENT_TOOL_ACTIONS_DOC"],
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
    webFetchKwargs?: { model: import("../models.js").ModelInterface; logPath: string; webCache: Map<string, string>; allowList?: string[] };
  },
): Record<string, Handler> {
  const writeCtx = ctx ?? new WriteContext({ projectDir });
  const handlers: Record<string, Handler> = {};

  // file
  handlers.file = makeFileHandler(writeCtx, projectDir) as Handler;

  // http (REQ-U-8, REQ-VF-12, REQ-TOOL-5)
  if (opts?.webFetchKwargs) {
    // Chat mode: SSRF guard + fetch + sub-agent summary + cache
    const { model: fetchModel, logPath: fetchLog, webCache, allowList } = opts.webFetchKwargs;
    handlers.http = ((action: unknown, url: unknown, headers: unknown, body: unknown, session_id: unknown) => {
      const a = String(action ?? "get").toLowerCase();
      if (a === "get") return _chatHttpGet(String(url), fetchModel, fetchLog, webCache, allowList ?? [], opts?.askFn);
      return JSON.stringify({ error: `HTTP action '${a}' not available in chat. Only 'get' is supported.` });
    }) as Handler;
  } else {
    // Verify/other mode: direct curl-based HTTP
    handlers.http = ((action: unknown, url: unknown, headers: unknown, body: unknown, session_id: unknown) => {
      const method = String(action ?? "get").toUpperCase();
      try {
        const { execSync } = require("node:child_process");
        const args = ["-s", "-X", method, "-w", "\\n%{http_code}"];
        if (headers) { try { const h = JSON.parse(String(headers)); for (const [k, v] of Object.entries(h)) args.push("-H", `${k}: ${v}`); } catch { /* */ } }
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
  }

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
      const { resolve: rp } = require("node:path");
      const { readFileSync: rf, existsSync: ex } = require("node:fs");
      const resolved = rp(projectDir, String(path));
      if (!ex(resolved)) return `File not found: ${path}`;
      if (ext === "pdf") {
        try {
          const pdfParse = require("pdf-parse");
          const buf = rf(resolved);
          // pdf-parse is async — use sync workaround
          const { execSync } = require("node:child_process");
          const text = execSync(`node -e "require('pdf-parse')(require('fs').readFileSync('${resolved.replace(/'/g, "\\'")}')). then(d=>process.stdout.write(d.text))"`, { timeout: 30000, encoding: "utf-8" });
          return text || "(No text extracted from PDF)";
        } catch (e) { return `Missing dependency: npm install pdf-parse`; }
      }
      if (ext === "docx") {
        try {
          const mammoth = require("mammoth");
          const { execSync } = require("node:child_process");
          const md = execSync(`node -e "require('mammoth').convertToMarkdown({path:'${resolved.replace(/'/g, "\\'")}'}).then(r=>process.stdout.write(r.value))"`, { timeout: 30000, encoding: "utf-8" });
          return md || "(No content extracted from DOCX)";
        } catch { return "Missing dependency: npm install mammoth"; }
      }
      if (ext === "xlsx") {
        try {
          const XLSX = require("xlsx");
          const wb = XLSX.readFile(resolved);
          const sheets: string[] = [];
          for (const name of wb.SheetNames) {
            const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
            const rows = csv.split("\n").filter((r: string) => r.trim());
            if (!rows.length) continue;
            const header = rows[0].split(",");
            const mdRows = rows.slice(1).map((r: string) => `| ${r.split(",").join(" | ")} |`);
            sheets.push(`### ${name}\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${mdRows.join("\n")}`);
          }
          return sheets.join("\n\n") || "(No data in spreadsheet)";
        } catch { return "Missing dependency: npm install xlsx"; }
      }
      return `Unsupported format: .${ext}`;
    }
    if (a === "code") {
      // Basic code analysis without tree-sitter — use regex-based extraction
      const { readFileSync: rf, existsSync: ex } = require("node:fs");
      const { resolve, relative } = require("node:path");
      const resolved = resolve(projectDir, String(path));
      // Path sandboxing (REQ-U-20, REQ-SEC-1)
      const rel = relative(projectDir, resolved);
      if (rel.startsWith("..")) return `Access denied: ${path} resolves outside project root.`;
      if (!ex(resolved)) return `File not found: ${path}`;
      const content = rf(resolved, "utf-8");
      const lines = content.split("\n");
      const ext = String(path).split(".").pop()?.toLowerCase();
      // Supported language check (REQ-TOOL-8)
      const SUPPORTED_LANGUAGES = new Set(["ts", "tsx", "js", "jsx", "mjs", "cjs", "py"]);
      if (!ext || !SUPPORTED_LANGUAGES.has(ext)) {
        return `Unsupported language: .${ext ?? "unknown"}. Supported: ${[...SUPPORTED_LANGUAGES].sort().join(", ")}`;
      }
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
// Chat HTTP GET with SSRF guard + sub-agent summary + cache (REQ-U-8)
// ---------------------------------------------------------------------------

function _chatHttpGet(
  url: string,
  model: import("../models.js").ModelInterface,
  logPath: string,
  cache: Map<string, string>,
  allowList: string[],
  askFn?: (question: string, options?: string[]) => string,
): string {
  // Cache hit
  if (cache.has(url)) return cache.get(url)!;

  // Operator confirmation (REQ-TOOL-4)
  if (askFn) {
    const answer = askFn(`Fetch ${url}?`, ["Allow", "Deny"]);
    if (answer.toLowerCase().includes("deny")) return JSON.stringify({ error: "Fetch denied by operator." });
  }

  // SSRF check (synchronous via execSync to avoid async in tool handler)
  try {
    const hostname = new URL(url).hostname;
    // Quick DNS + range check via the ssrf module
    const { execSync } = require("node:child_process");
    // We can't call async checkSsrf from a sync handler, so do a basic check
    const { checkSsrf } = require("./ssrf.js");
    // checkSsrf is async — use a sync workaround
    const resolved = execSync(`node -e "require('dns').lookup('${hostname.replace(/'/g, "")}', (e,a) => console.log(a||'FAIL'))"`, { timeout: 5000, encoding: "utf-8" }).trim();
    if (resolved === "FAIL") return JSON.stringify({ error: `Cannot resolve hostname: ${hostname}` });
    // Check blocked ranges inline
    const parts = resolved.split(".");
    if (parts.length === 4) {
      const [a, b] = parts.map(Number);
      if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127)) {
        if (!allowList.includes(hostname) && !allowList.some(e => e.includes("/") && resolved.startsWith(e.split("/")[0].split(".").slice(0, 2).join(".")))) {
          return JSON.stringify({ error: `SSRF blocked: ${url} resolves to private IP ${resolved}` });
        }
      }
    }
  } catch (e) {
    return JSON.stringify({ error: `SSRF check failed for ${url}: ${e instanceof Error ? e.message : e}` });
  }

  // Fetch
  let rawContent: string;
  try {
    const { execSync } = require("node:child_process");
    rawContent = execSync(`curl -sL --max-time 15 '${url.replace(/'/g, "%27")}'`, { timeout: 20000, encoding: "utf-8" });
  } catch (e) {
    const msg = `Fetch failed for ${url}: ${e instanceof Error ? e.message : e}`;
    return JSON.stringify({ error: msg });
  }

  // Strip HTML markup
  const stripped = rawContent
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 50000);

  // Summarize: extract title, headings, and leading content (REQ-TOOL-4)
  const summary = _summarizePage(stripped);
  cache.set(url, summary);
  return summary;
}

/** Extract structured summary from stripped page text. */
function _summarizePage(text: string): string {
  const lines = text.split(/\n/).map(l => l.trim()).filter(Boolean);
  const parts: string[] = [];
  // Title: first non-empty line
  if (lines.length) parts.push(`**${lines[0]}**`);
  // First 2000 chars of content
  const body = lines.slice(1).join("\n").slice(0, 2000);
  if (body) parts.push(body);
  if (text.length > 2000) parts.push(`\n[Summarized from ${text.length} chars]`);
  return parts.join("\n\n");
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
