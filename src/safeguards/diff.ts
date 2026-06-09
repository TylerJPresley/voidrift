import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

/**
 * Computes a unified diff for a proposed file edit.
 * Used by the inline approval gate to show what will change before writing.
 */
export function computeDiff(workspaceRoot: string, filePath: string, newContent: string): string[] {
  const fullPath = join(workspaceRoot, filePath);
  if (!existsSync(fullPath)) {
    // New file — show all lines as additions
    return newContent.split("\n").map((line) => `+${line}`);
  }

  const oldContent = readFileSync(fullPath, "utf-8");
  return unifiedDiff(oldContent, newContent, filePath);
}

/**
 * Computes diff for a surgical edit (search/replace block).
 */
export function computeEditDiff(workspaceRoot: string, filePath: string, search: string, replace: string): string[] {
  const fullPath = join(workspaceRoot, filePath);
  if (!existsSync(fullPath)) return [`-File not found: ${filePath}`];

  const content = readFileSync(fullPath, "utf-8");
  if (!content.includes(search)) return [`-Search block not found in ${filePath}`];

  const lines: string[] = [];
  lines.push(`--- ${filePath}`);
  lines.push(`+++ ${filePath}`);
  search.split("\n").forEach((l) => lines.push(`-${l}`));
  replace.split("\n").forEach((l) => lines.push(`+${l}`));
  return lines;
}

/**
 * Gets the full workspace git diff (for /diff command).
 */
export function getWorkspaceDiff(workspaceRoot: string, turnOnly = false): string {
  try {
    const flag = turnOnly ? "--cached" : "";
    return execSync(`git diff ${flag}`, { cwd: workspaceRoot, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch {
    return "";
  }
}

function unifiedDiff(oldText: string, newText: string, fileName: string): string[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: string[] = [`--- ${fileName}`, `+++ ${fileName}`];

  // Simple line-by-line diff (not optimal but functional)
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];
    if (oldLine === newLine) {
      lines.push(` ${oldLine ?? ""}`);
    } else {
      if (oldLine !== undefined) lines.push(`-${oldLine}`);
      if (newLine !== undefined) lines.push(`+${newLine}`);
    }
  }
  return lines;
}
