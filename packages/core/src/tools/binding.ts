import type { ToolSchema } from "./types.js";
import { TOOL_SCHEMAS } from "./definitions.js";
import type { NodeType, Mode } from "../router/index.js";

/**
 * Blueprint's Persona & Mode Dynamic Tool Binding Matrix:
 *
 * plan mode (any node)     → read_file, glob_files, web_search, web_fetch, lsp_*
 * architect (chat/vibe)    → read_file, glob_files, web_search, web_fetch, lsp_*
 * engineer (chat/vibe)     → all tools
 * auditor (chat/vibe)      → read_file, execute_command, lsp_*
 */

const READ_ONLY = ["read_file", "glob_files", "web_search", "web_fetch", "lsp_definition", "lsp_references", "lsp_hover"];
const AUDITOR_SET = ["read_file", "execute_command", "lsp_definition", "lsp_references", "lsp_hover"];
const ALL_TOOLS = TOOL_SCHEMAS.map((t) => t.name);

export function bindTools(node: NodeType, mode: Mode): ToolSchema[] {
  const allowed = resolveAllowed(node, mode);
  return TOOL_SCHEMAS.filter((t) => allowed.includes(t.name));
}

function resolveAllowed(node: NodeType, mode: Mode): string[] {
  // Plan mode overrides everything — strict read-only sandbox
  if (mode === "plan") return READ_ONLY;

  switch (node) {
    case "auditor":
      return AUDITOR_SET;
    case "engineer":
      return ALL_TOOLS;
    case "architect":
    case null:
    default:
      return READ_ONLY;
  }
}
