/**
 * Resource Watcher.
 *
 * Watches VoidRift configuration directories (local + global) for changes
 * to agents, skills, templates, prompts, and config files.
 * Publishes RESOURCE_CHANGED events on the bus when files are modified externally.
 */
import { watch, type FSWatcher } from "chokidar";
import { existsSync } from "fs";
import type { EventBus } from "../events/bus.js";

export type ResourceType = "agent" | "skill" | "template" | "prompt" | "config";

export class ResourceWatcher {
  private watcher: FSWatcher | null = null;

  constructor(
    private workspaceRoot: string,
    private globalRoot: string,
    private bus: EventBus,
  ) {}

  start(): Promise<void> {
    const paths = [
      `${this.workspaceRoot}/.voidrift/agents`,
      `${this.workspaceRoot}/.voidrift/skills`,
      `${this.workspaceRoot}/.voidrift/templates`,
      `${this.workspaceRoot}/.voidrift/prompts`,
      `${this.workspaceRoot}/.voidrift/config.json`,
      `${this.globalRoot}/agents`,
      `${this.globalRoot}/skills`,
      `${this.globalRoot}/templates`,
      `${this.globalRoot}/prompts`,
      `${this.globalRoot}/config.json`,
    ].filter(p => existsSync(p) || existsSync(p.replace(/\/[^/]+$/, "")));

    if (paths.length === 0) return Promise.resolve();

    return new Promise((resolve) => {
      this.watcher = watch(paths, {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
      });

      this.watcher
        .on("ready", () => resolve())
        .on("error", (err: unknown) => {
          const e = err instanceof Error ? err : new Error(String(err));
          this.bus.publish("ERROR_OCCURRED", { message: `Resource watcher error: ${e.message}`, source: "resource-watcher" });
        })
        .on("add", (p) => this.emit(p))
        .on("change", (p) => this.emit(p))
        .on("unlink", (p) => this.emit(p));
    });
  }

  private emit(path: string): void {
    const type = this.classifyPath(path);
    this.bus.publish("RESOURCE_CHANGED" as any, { path, type } as any);
  }

  private classifyPath(path: string): ResourceType {
    if (path.includes("/agents/")) return "agent";
    if (path.includes("/skills/")) return "skill";
    if (path.includes("/templates/")) return "template";
    if (path.includes("/prompts/")) return "prompt";
    return "config";
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }
}
