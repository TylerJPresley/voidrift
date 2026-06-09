import { watch, type FSWatcher } from "chokidar";
import { relative } from "path";
import type { EventBus } from "../events/bus.js";

export type WatcherStatus = "idle" | "starting" | "ready" | "error" | "closed";

export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null;
  private _status: WatcherStatus = "idle";
  private _error: Error | null = null;

  constructor(private workspaceRoot: string, private bus: EventBus) {}

  get status(): WatcherStatus { return this._status; }
  get error(): Error | null { return this._error; }

  /**
   * Starts watching. Returns a promise that resolves when the watcher is ready
   * (initial scan complete) or rejects on error.
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this._status = "starting";

      this.watcher = watch(this.workspaceRoot, {
        ignored: [/(^|[/\\])\../, /node_modules/],
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });

      this.watcher
        .on("ready", () => {
          this._status = "ready";
          resolve();
        })
        .on("error", (err: unknown) => {
          const wasStarting = this._status === "starting";
          this._status = "error";
          this._error = err instanceof Error ? err : new Error(String(err));
          this.bus.publish("ERROR_OCCURRED", {
            message: `File watcher error: ${this._error.message}`,
            source: "watcher",
          });
          if (wasStarting) reject(this._error);
        })
        .on("add", (p) => {
          this.bus.publish("FILE_CREATED", { path: relative(this.workspaceRoot, p) });
        })
        .on("change", (p) => {
          this.bus.publish("FILE_MODIFIED", { path: relative(this.workspaceRoot, p) });
        })
        .on("unlink", (p) => {
          this.bus.publish("FILE_DELETED", { path: relative(this.workspaceRoot, p) });
        });
    });
  }

  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
      this._status = "closed";
    }
  }
}
