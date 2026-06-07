/**
 * Anthropic Native Tools.
 *
 * When the active model is Anthropic, use Claude's purpose-built tools
 * (textEditor, bash) instead of generic function-calling tools.
 * These are specifically trained for higher accuracy.
 */
import { tools } from "@langchain/anthropic";
import { readFile, editFile, writeFile } from "./executors.js";
import { executeCommand } from "./executors.js";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

export function createAnthropicTextEditor(workspaceRoot: string) {
  return tools.textEditor_20250728({
    execute: async (args) => {
      const absPath = join(workspaceRoot, args.path);
      switch (args.command) {
        case "view": {
          if (args.path === ".") {
            return readdirSync(workspaceRoot).join("\n");
          }
          const result = readFile(workspaceRoot, args.path, 0, 200);
          return result.output || result.error || "";
        }
        case "str_replace": {
          const result = editFile(workspaceRoot, args.path, args.old_str!, args.new_str ?? "");
          return result.output;
        }
        case "create": {
          const result = writeFile(workspaceRoot, args.path, args.file_text ?? "");
          return result.output;
        }
        case "insert": {
          const content = readFileSync(absPath, "utf-8");
          const lines = content.split("\n");
          lines.splice(args.insert_line ?? lines.length, 0, args.new_str ?? "");
          const result = writeFile(workspaceRoot, args.path, lines.join("\n"));
          return result.output;
        }
        default:
          return `Unknown command: ${args.command}`;
      }
    },
  });
}

export function createAnthropicBash(workspaceRoot: string) {
  return tools.bash_20250124({
    execute: async (args) => {
      if ("restart" in args) return "Bash session restarted.";
      const result = executeCommand(workspaceRoot, args.command, 30000);
      return result.output;
    },
  });
}
