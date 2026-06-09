import { execSync } from "child_process";

export interface SafeguardResult {
  wasDirty: boolean;
  stashCreated: boolean;
  stashRef?: string;
}

/**
 * Git Safeguard: checks for uncommitted changes and auto-stashes before mutations.
 * Returns info about what was done so it can be reversed if needed.
 */
export function gitSafeguard(workspaceRoot: string): SafeguardResult {
  if (!isGitRepo(workspaceRoot)) {
    return { wasDirty: false, stashCreated: false };
  }

  const dirty = isDirty(workspaceRoot);
  if (!dirty) {
    return { wasDirty: false, stashCreated: false };
  }

  // Auto-stash uncommitted changes
  try {
    execSync("git stash push -m \"voidrift-safeguard-auto-stash\"", {
      cwd: workspaceRoot,
      stdio: "ignore",
    });
    const stashRef = execSync("git stash list --max-count=1", {
      cwd: workspaceRoot,
      encoding: "utf-8",
    }).trim();
    return { wasDirty: true, stashCreated: true, stashRef };
  } catch {
    return { wasDirty: true, stashCreated: false };
  }
}

/**
 * Restores a previously created safeguard stash.
 */
export function restoreSafeguardStash(workspaceRoot: string): boolean {
  try {
    const list = execSync("git stash list --max-count=1", {
      cwd: workspaceRoot,
      encoding: "utf-8",
    });
    if (list.includes("voidrift-safeguard-auto-stash")) {
      execSync("git stash pop", { cwd: workspaceRoot, stdio: "ignore" });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function isDirty(cwd: string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd, encoding: "utf-8" });
    return status.trim().length > 0;
  } catch {
    return false;
  }
}
