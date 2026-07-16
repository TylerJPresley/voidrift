/**
 * Policy Engine — rule-based permission decisions for tool execution.
 *
 * Architecture:
 * - Rules evaluated by priority (highest wins)
 * - Multi-tier sources: workspace > user > defaults (higher tier overrides)
 * - Shell command classification: safe auto-approves, dangerous always asks
 * - Pattern matching on tool args (glob for paths, prefix for commands)
 * - Session-scoped and persistent rules
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";

// ─── Types ───────────────────────────────────────────────────────────────────

export type PolicyDecision = "allow" | "deny" | "ask";

export type RuleSource = "default" | "workspace" | "user" | "session";

export interface PolicyRule {
  /** Tool name or "*" for all tools */
  tool: string;
  /** Glob pattern matched against args (e.g., path arg for file tools, command for shell) */
  pattern?: string;
  /** The decision when this rule matches */
  decision: PolicyDecision;
  /** Higher priority wins. Defaults: session=300, workspace=200, user=100, default=0 */
  priority: number;
  /** Where the rule came from */
  source: RuleSource;
  /** Human-readable description */
  label?: string;
}

export interface PolicyCheckResult {
  decision: PolicyDecision;
  rule?: PolicyRule;
  /** Inferred pattern for "always allow" persistence */
  inferredPattern?: string;
}

// ─── Shell Classification ────────────────────────────────────────────────────

const SAFE_COMMAND_PREFIXES = [
  "git status", "git log", "git diff", "git branch", "git show", "git remote",
  "git rev-parse", "git describe", "git stash list", "git tag",
  "ls", "head", "tail", "wc", "pwd", "echo", "date", "whoami",
  "tree", "file", "which", "type",
  "node --version", "npm --version", "npx --version", "bun --version",
  "python --version", "pip --version",
  "tsc --noEmit", "npx tsc --noEmit",
];

const DANGEROUS_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*f|-[a-zA-Z]*r|--force|--recursive)\b/,
  /\brm\s+-rf\b/,
  /\bchmod\s/,
  /\bchown\s/,
  /\bmkfs\b/,
  /\bdd\s/,
  /\b(curl|wget)\b.*\|\s*(sh|bash|zsh)\b/,
  /\bsudo\s/,
  /\b(shutdown|reboot|halt|poweroff)\b/,
  />\s*\/dev\/sd/,
  /\bgit\s+(push\s+--force|reset\s+--hard|clean\s+-f)/,
  /\bgit\s+branch\s+-D\b/,
  /\bdrop\s+(database|table)\b/i,
  /\btruncate\s+table\b/i,
  /\bformat\s+[a-z]:/i,
];

export type ShellSafety = "safe" | "dangerous" | "unknown" | "has_equivalent";

/** Commands that have dedicated tool equivalents — auto-denied with guidance */
const TOOL_EQUIVALENT_PREFIXES: Array<{ prefix: string; message: string }> = [
  { prefix: "cat", message: "Use read_file instead of cat" },
  { prefix: "grep", message: "Use search_contents instead of grep" },
  { prefix: "find", message: "Use glob_files instead of find" },
  { prefix: "curl", message: "Use web_fetch tool instead of curl/wget" },
  { prefix: "wget", message: "Use web_fetch tool instead of curl/wget" },
  { prefix: "nc", message: "Use web_fetch tool instead of nc" },
  { prefix: "ncat", message: "Use web_fetch tool instead of ncat" },
  { prefix: "ssh", message: "Use web_fetch tool instead of ssh" },
  { prefix: "scp", message: "Use web_fetch tool instead of scp" },
];

export function getEquivalentMessage(command: string): string | undefined {
  const trimmed = command.trim();
  for (const { prefix, message } of TOOL_EQUIVALENT_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(prefix + " ") || trimmed.startsWith(prefix + "\t")) {
      return message;
    }
  }
  return undefined;
}

export function classifyCommand(command: string): ShellSafety {
  const trimmed = command.trim();

  // Check tool equivalents first — auto-deny with guidance
  if (getEquivalentMessage(trimmed) !== undefined) return "has_equivalent";

  // Check dangerous — takes priority
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(trimmed)) return "dangerous";
  }

  // Check safe prefixes
  for (const prefix of SAFE_COMMAND_PREFIXES) {
    if (trimmed === prefix || trimmed.startsWith(prefix + " ") || trimmed.startsWith(prefix + "\n")) {
      return "safe";
    }
  }

  // Pipe chains with only safe commands are safe
  const parts = trimmed.split(/\s*\|\s*/);
  if (parts.length > 1 && parts.every(p => classifyCommand(p) === "safe")) {
    return "safe";
  }

  return "unknown";
}

// ─── Pattern Matching ────────────────────────────────────────────────────────

export function matchGlob(value: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§GLOBSTAR§")
    .replace(/\*/g, "[^/]*")
    .replace(/§GLOBSTAR§/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`).test(value);
}

/** For command patterns, * matches anything (including slashes) */
function matchCommandPattern(value: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${regexStr}$`).test(value);
}

function ruleMatchesTool(rule: PolicyRule, tool: string, args: Record<string, unknown>): boolean {
  // Tool name match (supports * wildcard)
  if (rule.tool !== "*" && rule.tool !== tool) {
    if (rule.tool.includes("*")) {
      if (!matchCommandPattern(tool, rule.tool)) return false;
    } else {
      return false;
    }
  }

  // Pattern match (if rule has one)
  if (rule.pattern) {
    const matchValue = getMatchValue(tool, args);
    if (!matchValue) return false;
    // Commands use simple wildcard (cat * matches cat /any/path), file tools use path-aware glob
    if (tool === "execute_command") return matchCommandPattern(matchValue, rule.pattern);
    return matchGlob(matchValue, rule.pattern);
  }

  return true;
}

/** Extract the value to match against from tool args */
function getMatchValue(tool: string, args: Record<string, unknown>): string | undefined {
  if ((tool === "write_file" || tool === "edit_file" || tool === "read_file" || tool === "glob_files") && typeof args.path === "string") {
    return args.path;
  }
  if (tool === "execute_command" && typeof args.command === "string") {
    return args.command;
  }
  return undefined;
}

/** Infer a pattern for "always allow" from the current tool call */
export function inferPattern(tool: string, args: Record<string, unknown>): string | undefined {
  const patterns = inferPatterns(tool, args);
  return patterns.length > 0 ? patterns[0] : undefined;
}

/** Infer multiple trust patterns — from specific to broad */
export function inferPatterns(tool: string, args: Record<string, unknown>): string[] {
  // MCP tools: trust this tool, or all tools from the server
  if (tool.startsWith("mcp_")) {
    const match = tool.match(/^(mcp_[^_]+)_(.+)$/);
    if (match) {
      return [tool, `${match[1]}_*`];
    }
    return [tool];
  }

  if ((tool === "write_file" || tool === "edit_file") && typeof args.path === "string") {
    const path = args.path as string;
    const parts = path.split("/");
    const results: string[] = [];
    // Exact path
    results.push(path);
    // Directory glob
    if (parts.length > 1) {
      results.push(parts.slice(0, -1).join("/") + "/**");
    }
    return results;
  }
  if (tool === "execute_command" && typeof args.command === "string") {
    const cmd = (args.command as string).trim();
    const results: string[] = [];
    // Exact command
    results.push(cmd);
    // Extract the actual binary (skip comments, find first real command)
    const lines = cmd.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));
    const firstCmd = lines[0] || cmd;
    const firstSpace = firstCmd.indexOf(" ");
    if (firstSpace > 0) {
      const binary = firstCmd.slice(0, firstSpace);
      // Broad: "grep *", "curl *", etc.
      if (binary !== "#") results.push(binary + " *");
    }
    return results;
  }
  return [];
}
// ─── Policy Engine ───────────────────────────────────────────────────────────

export class PolicyEngine {
  private rules: PolicyRule[] = [];
  private workspaceConfigPath: string | undefined;
  private userConfigPath: string;
  private workspaceRoot: string | undefined;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot;
    this.userConfigPath = join(homedir(), ".config", "voidrift", "config.json");
    if (workspaceRoot) {
      this.workspaceConfigPath = join(workspaceRoot, ".voidrift", "config.json");
    }
    this.loadRules();
  }

  /** Evaluate rules for a tool call. Returns the decision and matched rule. */
  check(tool: string, args: Record<string, unknown>, approvalMode: "prompt" | "deny" | "autonomous"): PolicyCheckResult {
    // Autonomous mode: always allow
    if (approvalMode === "autonomous") return { decision: "allow" };

    // Deny mode: only allow if an explicit allow rule exists
    if (approvalMode === "deny") {
      const match = this.findMatchingRule(tool, args, "allow");
      if (match) return { decision: "allow", rule: match };
      return { decision: "deny" };
    }

    // Workspace boundary enforcement — anything outside workspace requires approval
    if (this.workspaceRoot && this.isOutsideWorkspace(tool, args)) {
      return { decision: "ask", inferredPattern: inferPattern(tool, args) };
    }

    // Prompt mode: check rules, shell classification, then ask
    // Check explicit user/session rules first — they override default classification
    const match = this.findHighestPriorityMatch(tool, args);
    if (match) {
      return { decision: match.decision, rule: match, inferredPattern: inferPattern(tool, args) };
    }

    // Shell classification for execute_command
    if (tool === "execute_command" && typeof args.command === "string") {
      const safety = classifyCommand(args.command);
      if (safety === "has_equivalent") {
        const reason = getEquivalentMessage(args.command) || "Use the dedicated tool instead of shell commands";
        return { decision: "deny", rule: { tool, decision: "deny", priority: 999, source: "default", label: reason } };
      }
      if (safety === "safe") return { decision: "allow", inferredPattern: inferPattern(tool, args) };
      if (safety === "dangerous") return { decision: "ask", inferredPattern: inferPattern(tool, args) };
    }

    // Default: ask for write tools, MCP tools, and network tools. Allow read tools.
    const gatedTools = ["write_file", "edit_file", "execute_command", "web_search", "web_fetch", "escalate"];
    if (gatedTools.includes(tool) || tool.startsWith("mcp_")) {
      return { decision: "ask", inferredPattern: inferPattern(tool, args) };
    }

    return { decision: "allow" };
  }

  /** Add a session-scoped rule (lost on restart) */
  addSessionRule(rule: Omit<PolicyRule, "source" | "priority">): void {
    this.rules.push({ ...rule, source: "session", priority: 300 });
    this.sortRules();
  }

  /** Persist a rule to workspace or user config (survives restart) */
  persistRule(rule: Omit<PolicyRule, "source" | "priority">, scope?: "workspace" | "global"): void {
    const targetScope = scope || (this.workspaceConfigPath ? "workspace" : "user");
    const configPath = targetScope === "global" ? this.userConfigPath : (this.workspaceConfigPath || this.userConfigPath);
    const isWorkspace = configPath === this.workspaceConfigPath;
    const newRule: PolicyRule = { ...rule, source: isWorkspace ? "workspace" : "user", priority: isWorkspace ? 200 : 100 };
    // Safe write: validate before applying
    const { safeConfigWrite } = require("../config/writer.js");
    const result = safeConfigWrite(configPath, (config: Record<string, any>) => {
      if (!Array.isArray(config.policies)) config.policies = [];
      config.policies.push(newRule);
    });
    if (result.success) {
      this.rules.push(newRule);
      this.sortRules();
    }
  }

  /** Get all loaded rules (for panel display) */
  getRules(): PolicyRule[] {
    return [...this.rules];
  }

  /** Reload rules from disk */
  reload(): void {
    this.rules = this.rules.filter(r => r.source === "session");
    this.loadRules();
  }

  // ─── Private ─────────────────────────────────────────────────────────────

  /** Check if a tool call references paths outside the workspace root */
  private isOutsideWorkspace(tool: string, args: Record<string, unknown>): boolean {
    const root = this.workspaceRoot!;

    // File tools: check path arg
    if ((tool === "write_file" || tool === "edit_file" || tool === "read_file") && typeof args.path === "string") {
      const resolved = resolve(root, args.path);
      return !resolved.startsWith(root + "/") && resolved !== root;
    }

    // Shell commands: extract paths from command string
    if (tool === "execute_command" && typeof args.command === "string") {
      return this.commandTargetsOutsideWorkspace(args.command, root);
    }

    return false;
  }

  /** Heuristic: does a shell command reference absolute paths outside workspace? */
  private commandTargetsOutsideWorkspace(command: string, root: string): boolean {
    // Extract absolute paths and ~ paths from the command
    const pathMatches = command.match(/(?:^|\s)(\/[^\s;|&>]+|~[^\s;|&>]*)/g);
    if (!pathMatches) return false;

    for (const match of pathMatches) {
      const p = match.trim();
      let resolved: string;
      if (p.startsWith("~/") || p === "~") {
        resolved = join(homedir(), p.slice(2));
      } else {
        resolved = p;
      }
      if (!resolved.startsWith(root + "/") && resolved !== root) {
        return true;
      }
    }
    return false;
  }

  private loadRules(): void {
    // Load defaults
    this.rules.push(...DEFAULT_RULES);

    // Load user rules from config (lower tier)
    const userRules = this.loadPoliciesFromConfig(this.userConfigPath);
    for (const r of userRules) {
      this.rules.push({ ...r, source: "user", priority: r.priority ?? 100 });
    }

    // Load workspace rules from config (higher tier)
    if (this.workspaceConfigPath) {
      const wsRules = this.loadPoliciesFromConfig(this.workspaceConfigPath);
      for (const r of wsRules) {
        this.rules.push({ ...r, source: "workspace", priority: r.priority ?? 200 });
      }
    }

    this.sortRules();
  }

  private loadPoliciesFromConfig(configPath: string): PolicyRule[] {
    if (!existsSync(configPath)) return [];
    try {
      const config = JSON.parse(readFileSync(configPath, "utf-8"));
      if (Array.isArray(config.policies)) return config.policies;
      return [];
    } catch {
      return [];
    }
  }

  private loadFile(path: string): PolicyRule[] {
    if (!existsSync(path)) return [];
    try {
      const content = readFileSync(path, "utf-8");
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) return parsed;
      if (parsed.rules && Array.isArray(parsed.rules)) return parsed.rules;
      return [];
    } catch {
      return [];
    }
  }

  private saveFile(path: string, rules: PolicyRule[]): void {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify({ rules }, null, 2), "utf-8");
  }

  private sortRules(): void {
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  private findHighestPriorityMatch(tool: string, args: Record<string, unknown>): PolicyRule | undefined {
    // Rules are already sorted by priority (descending)
    return this.rules.find(rule => ruleMatchesTool(rule, tool, args));
  }

  private findMatchingRule(tool: string, args: Record<string, unknown>, decision: PolicyDecision): PolicyRule | undefined {
    return this.rules.find(rule => ruleMatchesTool(rule, tool, args) && rule.decision === decision);
  }
}

// ─── Default Rules ───────────────────────────────────────────────────────────

const DEFAULT_RULES: PolicyRule[] = [
  // Read tools always allowed
  { tool: "read_file", decision: "allow", priority: 0, source: "default", label: "Read files always allowed" },
  { tool: "glob_files", decision: "allow", priority: 0, source: "default", label: "Glob always allowed" },
];
