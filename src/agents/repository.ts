/**
 * Agent Repository — persistence interface for agent manifests.
 *
 * The AgentRegistry uses this interface for all filesystem I/O.
 * Default implementation discovers agents from .voidrift/agents/ and
 * ~/.config/voidrift/agents/. Alternative implementations can use
 * in-memory stores (testing).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from "fs";
import { join, dirname } from "path";
import type { AgentManifest, AgentType } from "./registry.js";

// ─── Interface ───────────────────────────────────────────────────────────────

export interface DiscoveredAgent {
  manifest: AgentManifest;
  path: string;
}

export interface AgentRepository {
  /** Scan workspace + global dirs, return all discovered agent manifests */
  discover(workspaceRoot: string): DiscoveredAgent[];

  /** Read a manifest by path */
  readManifest(path: string): AgentManifest | null;

  /** Write a manifest to path (creates dirs if needed) */
  writeManifest(path: string, manifest: Partial<AgentManifest>): void;

  /** Write a prompt file */
  writePrompt(path: string, content: string): void;

  /** Read a prompt file. Returns null if missing. */
  readPrompt(path: string): string | null;

  /** Check if a path exists */
  exists(path: string): boolean;

  /** Delete a file. Returns true if it existed. */
  delete(path: string): boolean;

  /** Ensure a directory exists */
  ensureDir(path: string): void;
}

// ─── Filesystem Implementation ───────────────────────────────────────────────

export class FileSystemAgentRepository implements AgentRepository {
  discover(workspaceRoot: string): DiscoveredAgent[] {
    const results: DiscoveredAgent[] = [];
    const dirs = [
      { path: join(process.env.HOME || "", ".config", "voidrift", "agents"), scope: "global" as const },
      { path: join(workspaceRoot, ".voidrift", "agents"), scope: "workspace" as const },
    ];

    for (const { path: dir, scope } of dirs) {
      if (!existsSync(dir)) continue;
      let entries: string[];
      try { entries = readdirSync(dir); } catch { continue; }

      for (const entry of entries) {
        const filePath = join(dir, entry);
        let stat;
        try { stat = statSync(filePath); } catch { continue; }

        if (stat.isFile() && entry.endsWith(".json")) {
          const manifest = this.parseManifestFile(filePath, scope);
          if (manifest) results.push({ manifest, path: filePath });
        } else if (stat.isDirectory()) {
          const nestedAgent = join(filePath, "agent.json");
          if (existsSync(nestedAgent)) {
            const manifest = this.parseManifestFile(nestedAgent, scope);
            if (manifest) results.push({ manifest, path: nestedAgent });
          } else {
            let subEntries: string[];
            try { subEntries = readdirSync(filePath); } catch { continue; }
            for (const subEntry of subEntries) {
              const subFilePath = join(filePath, subEntry);
              if (subEntry.endsWith(".json")) {
                const manifest = this.parseManifestFile(subFilePath, scope, entry);
                if (manifest) results.push({ manifest, path: subFilePath });
              }
            }
          }
        }
      }
    }

    return results;
  }

  readManifest(path: string): AgentManifest | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8"));
    } catch { return null; }
  }

  writeManifest(path: string, manifest: Partial<AgentManifest>): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest, null, 2), "utf-8");
  }

  writePrompt(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf-8");
  }

  readPrompt(path: string): string | null {
    if (!existsSync(path)) return null;
    try { return readFileSync(path, "utf-8"); } catch { return null; }
  }

  exists(path: string): boolean {
    return existsSync(path);
  }

  delete(path: string): boolean {
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }

  ensureDir(path: string): void {
    mkdirSync(path, { recursive: true });
  }

  private parseManifestFile(path: string, scope: "global" | "workspace", namespace?: string): AgentManifest | null {
    try {
      const raw = JSON.parse(readFileSync(path, "utf-8"));

      const approvalMode = ["prompt", "deny", "autonomous"].includes(raw.approvalMode)
        ? raw.approvalMode
        : "prompt";

      const role = ["utility", "escalation"].includes(raw.role)
        ? raw.role
        : "";

      const source = namespace || "custom";
      const overrideStatus = scope;

      // Check for prompt.md alongside agent.json
      const promptPath = join(dirname(path), "prompt.md");
      const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf-8") : (raw.prompt || "");

      return {
        id: raw.id || "",
        name: raw.name || raw.id || "",
        description: raw.description || "",
        type: raw.type === "task" ? "task" : "interactive",
        role,
        prompt,
        tools: raw.tools || [],
        approvalMode,
        allowedTools: raw.allowedTools || [],
        toolsSettings: raw.toolsSettings,
        resources: raw.resources,
        welcomeMessage: raw.welcomeMessage,
        active: raw.active !== false,
        source,
        overrideStatus,
        overridePath: path,
        skills: raw.skills,
      };
    } catch { return null; }
  }
}

// ─── In-Memory Implementation (Testing) ──────────────────────────────────────

export class InMemoryAgentRepository implements AgentRepository {
  private agents: DiscoveredAgent[] = [];
  private files = new Map<string, string>();

  add(manifest: AgentManifest, path: string): void {
    this.agents.push({ manifest, path });
  }

  discover(_workspaceRoot: string): DiscoveredAgent[] {
    return [...this.agents];
  }

  readManifest(path: string): AgentManifest | null {
    const content = this.files.get(path);
    if (!content) return null;
    try { return JSON.parse(content); } catch { return null; }
  }

  writeManifest(path: string, manifest: Partial<AgentManifest>): void {
    this.files.set(path, JSON.stringify(manifest, null, 2));
  }

  writePrompt(path: string, content: string): void {
    this.files.set(path, content);
  }

  readPrompt(path: string): string | null {
    return this.files.get(path) ?? null;
  }

  exists(path: string): boolean {
    return this.files.has(path);
  }

  delete(path: string): boolean {
    return this.files.delete(path);
  }

  ensureDir(_path: string): void {}
}
