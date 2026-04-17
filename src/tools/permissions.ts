/**
 * Session-scoped permission gate for chat (REQ-U-22).
 *
 * Categories: writes (file write/edit/delete), runs (shell), reads-outside (reads outside project dir).
 * Reads within project dir are always free.
 */

import { resolve, relative } from "node:path";

export type PermCategory = "writes" | "runs" | "reads-outside";
export type PermDecision = "allow-once" | "always" | "deny";

export interface PermissionGate {
  /** Check if an action needs permission. Returns null if allowed, category if needs prompt. */
  check(toolName: string, args: Record<string, unknown>, projectDir: string): PermCategory | null;
  /** Record a decision for a category. */
  grant(category: PermCategory, decision: PermDecision): void;
  /** Get the beforeToolCall hook function. */
  hook(projectDir: string, promptFn: (category: PermCategory, description: string) => PermDecision): (name: string, args: string) => string | null;
}

export function createPermissionGate(): PermissionGate {
  const grants = new Map<PermCategory, "always">();

  function check(toolName: string, args: Record<string, unknown>, projectDir: string): PermCategory | null {
    // Shell → runs
    if (toolName === "shell") {
      return grants.has("runs") ? null : "runs";
    }

    // File tool — check action
    if (toolName === "file") {
      const action = String(args.action ?? "");
      if (["write", "edit", "delete"].includes(action)) {
        return grants.has("writes") ? null : "writes";
      }
      if (action === "read" || action === "list") {
        // Check if path is outside project dir
        const p = String(args.path ?? "");
        if (p) {
          try {
            const resolved = resolve(projectDir, p);
            const rel = relative(projectDir, resolved);
            if (rel.startsWith("..")) {
              return grants.has("reads-outside") ? null : "reads-outside";
            }
          } catch { /* allow on error */ }
        }
        return null; // reads inside project are free
      }
    }

    return null;
  }

  function grant(category: PermCategory, decision: PermDecision): void {
    if (decision === "always") grants.set(category, "always");
  }

  function hook(
    projectDir: string,
    promptFn: (category: PermCategory, description: string) => PermDecision,
  ): (name: string, args: string) => string | null {
    return (name: string, argsStr: string): string | null => {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(argsStr || "{}"); } catch { /* */ }

      const category = check(name, args, projectDir);
      if (!category) return null; // allowed — proceed

      // Build description
      const detail = name === "shell" ? String(args.cmd ?? args.command ?? "")
        : name === "file" ? `${args.action}(${args.path ?? ""})`
        : name;

      // Non-TTY → auto-deny
      if (!process.stdin.isTTY) {
        return `Permission denied (non-interactive): ${name}(${detail})`;
      }

      const decision = promptFn(category, `${name}: ${detail}`);
      grant(category, decision);

      if (decision === "deny") {
        return `Permission denied by operator: ${name}(${detail})`;
      }
      return null; // allow-once or always → proceed
    };
  }

  return { check, grant, hook };
}
