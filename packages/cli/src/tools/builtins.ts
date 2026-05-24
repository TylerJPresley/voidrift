import { execSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { dirname } from "path";
import { globSync } from "fs";
import type { ToolDefinition } from "./registry.js";

export const bashTool: ToolDefinition = {
  name: "bash",
  description: "Execute a shell command. Returns stdout, stderr, and exit code.",
  parameters: { command: { type: "string", description: "The shell command to execute" } },
  async execute(args) {
    const cmd = args.command as string;
    try {
      const output = execSync(cmd, { encoding: "utf-8", timeout: 30000, maxBuffer: 1024 * 1024 });
      return output || "(no output)";
    } catch (err: any) {
      return `Exit code ${err.status}\n${err.stderr || err.stdout || err.message}`;
    }
  },
};

export const readTool: ToolDefinition = {
  name: "read",
  description: "Read a file at the given path.",
  parameters: { path: { type: "string", description: "Path to the file to read" } },
  async execute(args) {
    const path = args.path as string;
    if (!existsSync(path)) return `Error: file not found: ${path}`;
    const content = readFileSync(path, "utf-8");
    if (content.length > 50000) return content.slice(0, 50000) + `\n... (truncated, ${content.length} chars total)`;
    return content;
  },
};

export const writeTool: ToolDefinition = {
  name: "write",
  description: "Write content to a file. Creates parent directories if needed.",
  parameters: {
    path: { type: "string", description: "Path to the file to write" },
    content: { type: "string", description: "The content to write" },
  },
  async execute(args) {
    const path = args.path as string;
    const content = args.content as string;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
    return `Wrote ${content.length} chars to ${path}`;
  },
};

export const editTool: ToolDefinition = {
  name: "edit",
  description: "Replace exact text in a file with new text.",
  parameters: {
    path: { type: "string", description: "Path to the file" },
    old_text: { type: "string", description: "Exact text to find and replace" },
    new_text: { type: "string", description: "Replacement text" },
  },
  async execute(args) {
    const path = args.path as string;
    const oldText = args.old_text as string;
    const newText = args.new_text as string;
    if (!existsSync(path)) return `Error: file not found: ${path}`;
    const content = readFileSync(path, "utf-8");
    if (!content.includes(oldText)) return `Error: old_text not found in ${path}`;
    writeFileSync(path, content.replace(oldText, newText), "utf-8");
    return `Edited ${path}`;
  },
};

export const globTool: ToolDefinition = {
  name: "glob",
  description: "Find files matching a glob pattern.",
  parameters: { pattern: { type: "string", description: "The glob pattern to match" } },
  async execute(args) {
    const pattern = args.pattern as string;
    try {
      const { execSync } = await import("child_process");
      const result = execSync(`find . -path './${pattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' 2>/dev/null | head -50`, { encoding: "utf-8" });
      return result || "(no matches)";
    } catch {
      return "(no matches)";
    }
  },
};

export const builtinTools = [bashTool, readTool, writeTool, editTool, globTool];
