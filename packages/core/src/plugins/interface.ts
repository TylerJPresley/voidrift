import type { CoreRegistry } from "../registry/core.js";
import type { EventBus } from "../events/bus.js";
import type { WorktreeEngine } from "../worktree/engine.js";
import type { TemplateService } from "../templates/service.js";
import type { AgentRegistry, AgentManifest } from "../agents/registry.js";
import type { PromptRegistry } from "../prompts/registry.js";
import { generateCodeMap } from "../codemap/index.js";
import { executeCommand } from "../tools/executors.js";

export type PathGuard = (targetPath: string) => boolean;

export interface SandboxMode {
  name: string;
  systemPrompt: string;
  pathGuard: PathGuard;
}

export interface GraphNodeDef {
  name: string;
  persona: string;
  allowedTools: string[];
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface GraphEdgeDef {
  source: string;
  target: string;
  condition: (state: Record<string, unknown>) => boolean;
}

/**
 * Plugin Registration Interface (Section 9.1).
 *
 * Exposes hooks for plugins to register commands, modes, nodes, and edges.
 */
export class PluginInterface {
  private sandboxModes = new Map<string, SandboxMode>();
  private graphNodes = new Map<string, GraphNodeDef>();
  private graphEdges: GraphEdgeDef[] = [];

  constructor(
    private registry: CoreRegistry,
    private bus: EventBus,
    private worktree: WorktreeEngine,
    private workspaceRoot: string,
    private templateService?: TemplateService,
    private agentRegistry?: AgentRegistry,
    private promptRegistry?: PromptRegistry,
    private pluginName: string = "plugin"
  ) {}

  /** Register a custom slash command. */
  registerCommand(name: string, description: string, handler: (args: string[]) => Promise<void>): void {
    this.registry.registerSlashCommand({ name, description, execute: handler });
  }

  /** Register a sandbox mode with path-guard restrictions. */
  registerSandboxMode(name: string, systemPrompt: string, pathGuard: PathGuard): void {
    this.sandboxModes.set(name, { name, systemPrompt, pathGuard });
    this.registry.registerMode({ name, allowedTools: ["read_file", "glob_files", "write_file", "edit_file"], permissionGate: false });
  }

  /** Register a custom node in the orchestration graph. */
  registerGraphNode(name: string, persona: string, allowedTools: string[], handler: (args: Record<string, unknown>) => Promise<unknown>): void {
    this.graphNodes.set(name, { name, persona, allowedTools, handler });
  }

  /** Register a custom routing edge between graph nodes. */
  registerGraphEdge(source: string, target: string, condition: (state: Record<string, unknown>) => boolean): void {
    this.graphEdges.push({ source, target, condition });
  }

  /** Subscribe to event bus events. */
  subscribeEvent(eventType: string, handler: (event: any) => void): () => void {
    return this.bus.subscribe(eventType as any, handler);
  }

  /** Register a prompt owned by this plugin. */
  registerPrompt(key: string, content: string, label?: string, description?: string): void {
    this.promptRegistry?.register(key, content, this.pluginName, label, description);
  }

  /** Register a document template owned by this plugin. */
  registerTemplate(key: string, content: string, label?: string, description?: string): void {
    this.templateService?.register(key, "template", content, this.pluginName, label, description);
  }

  /** Override a core prompt — replaces the base entirely. */
  overridePrompt(key: string, content: string): void {
    this.promptRegistry?.register(key, content, this.pluginName);
  }

  /** Extend a core prompt — appends content to the resolved base. */
  extendPrompt(key: string, content: string): void {
    // Append to the existing prompt content
    const existing = this.promptRegistry?.resolve(key);
    if (existing) {
      this.promptRegistry?.register(key, existing.body + "\n\n" + content, this.pluginName);
    }
  }

  /** Register a custom agent owned by this plugin. */
  registerAgent = (manifest: AgentManifest): void => {
    this.agentRegistry?.register(manifest, this.pluginName);
  };

  /** Check if a path is allowed by the active sandbox mode's guard. */
  isPathAllowed(modeName: string, targetPath: string): boolean {
    const mode = this.sandboxModes.get(modeName);
    if (!mode) return true; // No guard = allowed
    return mode.pathGuard(targetPath);
  }

  getMode(name: string): SandboxMode | undefined { return this.sandboxModes.get(name); }
  getNode(name: string): GraphNodeDef | undefined { return this.graphNodes.get(name); }
  getEdges(): GraphEdgeDef[] { return this.graphEdges; }
}

/**
 * Core Service Interface (Section 9.2).
 *
 * Exposes execution primitives for plugins to invoke.
 */
export class CoreServices {
  constructor(
    private bus: EventBus,
    private worktree: WorktreeEngine,
    private workspaceRoot: string
  ) {}

  /** Provisions a worktree and returns the path. */
  async spawnSubagent(fileBoundaries: string[], execute: (wtPath: string) => Promise<"success" | "failed">) {
    return this.worktree.schedule(fileBoundaries, execute);
  }

  /** Runs a sandboxed command. */
  executeCommand(cmd: string, cwd?: string, timeout?: number) {
    return executeCommand(cwd ?? this.workspaceRoot, cmd, timeout);
  }

  /** Returns the workspace code-map. */
  getWorkspaceMap(): string {
    return generateCodeMap(this.workspaceRoot);
  }

  /** Publishes a custom event. */
  emitEvent(key: string, payload: Record<string, unknown>): void {
    this.bus.publish(key as any, payload as any);
  }
}
