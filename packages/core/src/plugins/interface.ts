import type { CoreRegistry } from "../registry/core.js";
import type { EventBus } from "../events/bus.js";
import type { WorktreeEngine } from "../worktree/engine.js";
import type { TemplateService } from "../templates/service.js";
import type { AgentRegistry, AgentManifest } from "../agents/registry.js";
import type { PromptRegistry } from "../prompts/registry.js";
import type { ContextManager } from "../session/context.js";
import { generateCodeMap } from "../codemap/index.js";
import { executeCommand } from "../tools/executors.js";

export interface PanelColumn {
  key: string;
  label: string;
  width?: number;
}

export interface PanelAction {
  label: string;
  handler: (item: any) => void | Promise<void>;
}

export interface PanelDefinition {
  title: string;
  columns: PanelColumn[];
  getItems: () => any[];
  actions?: Record<string, PanelAction>;
}

/**
 * Core API.
 *
 * The single public interface for plugins, IDE integrations,
 * and any external consumer of VoidRift's harness capabilities.
 */
export class CoreAPI {
  private _output: (text: string) => void = () => {};
  private _openPanel: (name: string) => void = () => {};
  private panels = new Map<string, PanelDefinition>();

  constructor(
    private registry: CoreRegistry,
    private bus: EventBus,
    private worktree: WorktreeEngine,
    private workspaceRoot: string,
    private templateService?: TemplateService,
    private agentRegistry?: AgentRegistry,
    private promptRegistry?: PromptRegistry,
    private contextManager?: ContextManager,
    private pluginName: string = "plugin"
  ) {}

  /** Called by the TUI to wire output/panel callbacks. */
  setOutputHandler(fn: (text: string) => void): void { this._output = fn; }
  setPanelHandler(fn: (name: string) => void): void { this._openPanel = fn; }
  setContextManager(ctx: ContextManager): void { this.contextManager = ctx; }

  // ─── Registration ────────────────────────────────────────────────────────

  registerCommand(name: string, description: string, handler: (args: string[]) => Promise<void>): void {
    this.registry.registerSlashCommand({ name, description, source: this.pluginName, execute: handler });
  }

  registerAgent(manifest: AgentManifest): void {
    this.agentRegistry?.register(manifest, this.pluginName);
  }

  registerPrompt(key: string, content: string, label?: string, description?: string): void {
    this.promptRegistry?.register(key, content, this.pluginName, label, description);
  }

  registerTemplate(key: string, content: string, label?: string, description?: string): void {
    this.templateService?.register(key, "template", content, this.pluginName, label, description);
  }

  overridePrompt(key: string, content: string): void {
    this.promptRegistry?.register(key, content, this.pluginName);
  }

  extendPrompt(key: string, content: string): void {
    const existing = this.promptRegistry?.resolve(key);
    if (existing) {
      this.promptRegistry?.register(key, existing.body + "\n\n" + content, this.pluginName);
    }
  }

  registerPanel(name: string, definition: PanelDefinition): void {
    this.panels.set(name, definition);
  }

  getPanel(name: string): PanelDefinition | undefined {
    return this.panels.get(name);
  }

  listPanels(): string[] {
    return [...this.panels.keys()];
  }

  // ─── Events ──────────────────────────────────────────────────────────────

  registerEvent(name: string): void {
    this.bus.registerEvent(name);
  }

  subscribeEvent(eventType: string, handler: (event: any) => void): () => void {
    return this.bus.subscribe(eventType as any, handler);
  }

  emitEvent(key: string, payload: Record<string, unknown>): void {
    this.bus.publish(key as any, payload as any);
  }

  // ─── Services ────────────────────────────────────────────────────────────

  output(text: string): void {
    this._output(text);
  }

  openPanel(name: string): void {
    this._openPanel(name);
  }

  async spawnSubagent(fileBoundaries: string[], execute: (wtPath: string) => Promise<"success" | "failed">) {
    return this.worktree.schedule(fileBoundaries, execute);
  }

  executeCommand(cmd: string, cwd?: string, timeout?: number) {
    return executeCommand(cwd ?? this.workspaceRoot, cmd, timeout);
  }

  getWorkspaceMap(): string {
    return generateCodeMap(this.workspaceRoot);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  injectTurnContext(label: string, content: string): void {
    this.contextManager?.injectTurnContext(label, content);
  }
}
