/**
 * Filesystem Resource Loader — infrastructure implementation.
 * Injected into use cases that need to read files without importing fs directly.
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type { ResourceLoader } from "../use-cases/activate-agent.js";

export const fsResourceLoader: ResourceLoader = {
  exists: (path: string) => existsSync(path),
  read: (path: string) => readFileSync(path, "utf-8"),
  resolve: (workspaceRoot: string, relativePath: string) => join(workspaceRoot, relativePath),
};
