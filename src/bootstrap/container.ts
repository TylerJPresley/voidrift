import { EventBus } from "../events/bus.js";
import { loadConfig, type VoidRiftConfig, type LoadConfigOptions } from "../config/loader.js";
import { WorkspaceWatcher } from "../watcher/index.js";
import { CoreRegistry } from "../registry/core.js";
import { cleanupWorktrees, type CleanupResult } from "./cleanup.js";

export interface ContainerOptions {
  workspaceRoot: string;
  globalConfigPath?: string;
  skipWatcher?: boolean;
}

export interface Container {
  bus: EventBus;
  config: VoidRiftConfig;
  registry: CoreRegistry;
  watcher: WorkspaceWatcher;
  cleanup: CleanupResult;
  shutdown: () => Promise<void>;
}

/**
 * Application Container (Composition Root).
 *
 * Initializes the central Event Bus, loads configuration, runs boot cleanup,
 * starts the file watcher, and returns the fully wired container.
 * This is the single entry point for bootstrapping the harness.
 */
export async function bootstrap(opts: ContainerOptions): Promise<Container> {
  const bus = new EventBus();
  const registry = new CoreRegistry();

  // 1. Load configuration (global + local workspace override)
  const config = loadConfig({
    globalConfigPath: opts.globalConfigPath,
    workspaceRoot: opts.workspaceRoot,
  });

  // 2. Run boot cleanup (prune worktrees, reset locks)
  const cleanup = cleanupWorktrees(opts.workspaceRoot);

  // 3. Start file watcher
  const watcher = new WorkspaceWatcher(opts.workspaceRoot, bus);
  if (!opts.skipWatcher) {
    await watcher.start();
  }

  // 4. Return the wired container
  return {
    bus,
    config,
    registry,
    watcher,
    cleanup,
    shutdown: async () => {
      await watcher.stop();
    },
  };
}
