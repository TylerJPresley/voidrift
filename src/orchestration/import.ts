import { join, resolve } from "path";
import { existsSync } from "fs";
import { generateCodeMap } from "../codemap/index.js";

/**
 * /import <path>
 *
 * Scans a codebase directory and generates a structured import report
 * using the AST code-map generator.
 */
export function importScan(workspaceRoot: string, targetPath: string): string {
  const fullPath = targetPath.startsWith("/") ? targetPath : join(workspaceRoot, targetPath);

  if (!existsSync(fullPath)) {
    return `Error: Path not found: ${targetPath}`;
  }

  const codeMap = generateCodeMap(fullPath);

  if (!codeMap) {
    return `Empty directory: ${targetPath}`;
  }

  return [
    `# Structural Import Report`,
    `**Path:** ${targetPath}`,
    ``,
    "```",
    codeMap,
    "```",
  ].join("\n");
}
