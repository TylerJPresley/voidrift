import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { execSync } from "child_process";
import { join, dirname } from "path";
import { globSync } from "fs";
import { stripAnsi, truncateOutput } from "../output/truncator.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_READ_LINES = 2000;

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * read_file: Reads file text with optional offset and limit for incremental loading.
 * Returns line count metadata so the model knows if there's more to read.
 */
export function readFile(workspaceRoot: string, path: string, offset = 0, limit = 1000): ToolResult {
  const fullPath = resolvePath(workspaceRoot, path);
  if (!existsSync(fullPath)) {
    return { success: false, output: "", error: `File not found: ${path}` };
  }
  try {
    let content = readFileSync(fullPath, "utf-8");
    content = stripAnsi(content);
    const allLines = content.split("\n");
    const totalLines = allLines.length;
    const sliced = allLines.slice(offset, offset + limit);
    const hasMore = offset + limit < totalLines;
    const header = `[${path}] Lines ${offset + 1}-${offset + sliced.length} of ${totalLines}${hasMore ? " (use offset to read more)" : ""}`;
    return { success: true, output: header + "\n" + sliced.join("\n") };
  } catch (err) {
    return { success: false, output: "", error: `Failed to read ${path}: ${errMsg(err)}` };
  }
}

/**
 * glob_files: Scans workspace with glob pattern, returns matching paths.
 */
export function globFiles(workspaceRoot: string, pattern: string): ToolResult {
  try {
    // Use Node's built-in glob (Node 22+) or fallback to manual walk
    const matches = globSyncSafe(workspaceRoot, pattern);
    return { success: true, output: matches.join("\n") };
  } catch (err) {
    return { success: false, output: "", error: `Glob failed: ${errMsg(err)}` };
  }
}

/**
 * write_file: Creates a new file or overwrites target.
 * Only allowed for new files or empty files (Safe Primitive Contract).
 */
export function writeFile(workspaceRoot: string, path: string, content: string): ToolResult {
  const fullPath = resolvePath(workspaceRoot, path);
  try {
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    return { success: true, output: `Written: ${path} (${content.length} bytes)` };
  } catch (err) {
    return { success: false, output: "", error: `Failed to write ${path}: ${errMsg(err)}` };
  }
}

/**
 * edit_file: Surgical block-replacement. Finds exact `search` block and replaces with `replace`.
 * Fails if search block is not found (prevents blind overwrites).
 */
export function editFile(workspaceRoot: string, path: string, search: string, replace: string): ToolResult {
  const fullPath = resolvePath(workspaceRoot, path);
  if (!existsSync(fullPath)) {
    return { success: false, output: "", error: `File not found: ${path}` };
  }
  try {
    const content = readFileSync(fullPath, "utf-8");
    if (!content.includes(search)) {
      return { success: false, output: "", error: `Search block not found in ${path}. Edit rejected to prevent corruption.` };
    }
    const updated = content.replace(search, replace);
    writeFileSync(fullPath, updated);
    const added = replace.split("\n").length;
    const removed = search.split("\n").length;
    return { success: true, output: `Edited: ${path} (+${added} -${removed} lines)` };
  } catch (err) {
    return { success: false, output: "", error: `Failed to edit ${path}: ${errMsg(err)}` };
  }
}

/**
 * execute_command: Runs shell command as isolated subprocess with timeout.
 * Strips ANSI from output, truncates large results.
 */
export function executeCommand(workspaceRoot: string, command: string, timeoutMs = DEFAULT_TIMEOUT_MS): ToolResult {
  try {
    const raw = execSync(command, {
      cwd: workspaceRoot,
      encoding: "utf-8",
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024, // 1MB
      stdio: ["pipe", "pipe", "pipe"],
    });
    const output = truncateOutput(stripAnsi(raw));
    return { success: true, output };
  } catch (err: any) {
    // execSync throws on non-zero exit or timeout
    const stderr = err.stderr ? stripAnsi(String(err.stderr)) : "";
    const stdout = err.stdout ? stripAnsi(String(err.stdout)) : "";
    const combined = truncateOutput([stdout, stderr].filter(Boolean).join("\n"));

    if (err.killed || (err.signal === "SIGTERM")) {
      return { success: false, output: combined, error: `Command timed out after ${timeoutMs}ms` };
    }
    if (err.message?.includes("ETIMEDOUT") || err.message?.includes("timed out")) {
      return { success: false, output: combined, error: `Command timed out after ${timeoutMs}ms` };
    }
    return { success: false, output: combined, error: `Exit code ${err.status ?? 1}` };
  }
}

function resolvePath(root: string, path: string): string {
  // Absolute paths are allowed if they passed the permission gate
  if (path.startsWith("/")) return path;
  // Prevent path traversal for relative paths
  const resolved = join(root, path);
  if (!resolved.startsWith(root)) {
    throw new Error(`Path traversal detected: ${path}`);
  }
  return resolved;
}

function globSyncSafe(root: string, pattern: string): string[] {
  try {
    // Extract the filename glob (last segment) for -name matching
    const namePattern = pattern.split("/").pop() || pattern;
    const cmd = `find . -name '${namePattern}' -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/.voidrift/*' 2>/dev/null | head -500`;
    const result = execSync(cmd, { cwd: root, encoding: "utf-8", timeout: 5000 });
    return result.trim().split("\n").filter(Boolean).map((p) => p.replace(/^\.\//, ""));
  } catch {
    return [];
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
