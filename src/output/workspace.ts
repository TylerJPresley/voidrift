import { execSync } from "child_process";
import { homedir } from "os";

/**
 * Detects the current git branch name. Returns null if not in a git repo.
 */
export function getGitBranch(cwd: string): string | null {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", { cwd, encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return null;
  }
}

/**
 * Shortens a workspace path for display (replaces homedir with ~).
 */
export function shortenPath(fullPath: string): string {
  const home = homedir();
  if (fullPath.startsWith(home)) {
    return "~" + fullPath.slice(home.length);
  }
  return fullPath;
}
