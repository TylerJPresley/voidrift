import { readdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";

/**
 * Tab Autocompletion Engine.
 *
 * Resolves completions for:
 * - Slash commands (when input starts with /)
 * - File paths (for arguments to commands like /import, /diff)
 */
export class AutocompleteEngine {
  private commands: string[] = [];
  private fileIndex: string[] = [];

  /**
   * Registers available slash commands for completion.
   */
  setCommands(commands: string[]): void {
    this.commands = commands;
  }

  /**
   * Updates the file index from the workspace watcher.
   */
  setFileIndex(files: string[]): void {
    this.fileIndex = files;
  }

  /**
   * Resolves completions for the current input text and cursor position.
   * Returns matching candidates.
   */
  complete(input: string): string[] {
    const trimmed = input.trimStart();

    // Command autocompletion: input starts with /
    if (trimmed.startsWith("/") && !trimmed.includes(" ")) {
      const partial = trimmed.slice(1).toLowerCase();
      return this.commands
        .filter((cmd) => cmd.toLowerCase().startsWith(partial))
        .map((cmd) => `/${cmd}`);
    }

    // Path autocompletion: last word in input
    const words = trimmed.split(/\s+/);
    const lastWord = words[words.length - 1] || "";
    if (!lastWord) return [];

    return this.fileIndex
      .filter((f) => f.startsWith(lastWord) || f.includes(lastWord))
      .slice(0, 10);
  }

  /**
   * Cycles through candidates on repeated TAB presses.
   */
  cycle(candidates: string[], currentIndex: number): { value: string; nextIndex: number } {
    if (candidates.length === 0) return { value: "", nextIndex: 0 };
    const idx = currentIndex % candidates.length;
    return { value: candidates[idx], nextIndex: idx + 1 };
  }

  /**
   * Builds a file index by scanning a workspace directory.
   */
  indexWorkspace(workspaceRoot: string, maxDepth = 3): void {
    this.fileIndex = walkForCompletion(workspaceRoot, workspaceRoot, 0, maxDepth);
  }
}

const IGNORED = new Set(["node_modules", ".git", ".voidrift", "dist", "build", ".next", "coverage"]);

function walkForCompletion(dir: string, root: string, depth: number, maxDepth: number): string[] {
  if (depth > maxDepth) return [];
  const results: string[] = [];
  let items: string[];
  try { items = readdirSync(dir); } catch { return []; }

  for (const item of items) {
    if (IGNORED.has(item) || item.startsWith(".")) continue;
    const fullPath = join(dir, item);
    const relPath = fullPath.slice(root.length + 1);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }

    if (stat.isDirectory()) {
      results.push(relPath + "/");
      results.push(...walkForCompletion(fullPath, root, depth + 1, maxDepth));
    } else {
      results.push(relPath);
    }
  }
  return results;
}
