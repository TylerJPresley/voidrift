/**
 * Plugin Registry — tracks loaded plugins and their contributions to the harness.
 */
import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

export interface PluginMeta {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  homepage: string;
  active: boolean;
  commands: string[];
  agents: string[];
  modes: string[];
  templates: string[];
  prompts: string[];
  skills: string[];
}

export interface DiscoveredPlugin {
  id: string;
  version: string;
  description: string;
  author: string;
  license: string;
  homepage: string;
  path: string;
}

export class PluginRegistry {
  private plugins = new Map<string, PluginMeta>();

  register(meta: PluginMeta): void {
    this.plugins.set(meta.id, meta);
  }

  get(id: string): PluginMeta | undefined {
    return this.plugins.get(id);
  }

  list(): PluginMeta[] {
    return [...this.plugins.values()];
  }

  setActive(id: string, active: boolean): void {
    const p = this.plugins.get(id);
    if (p) p.active = active;
  }
}

/**
 * Scans node_modules for packages with "voidrift": { "plugin": true } in package.json.
 * Also scans workspace packages (packages/*) for local development.
 */
export function discoverPlugins(workspaceRoot: string): DiscoveredPlugin[] {
  const discovered: DiscoveredPlugin[] = [];
  const seen = new Set<string>();

  const scanDir = (dir: string) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const entryPath = join(dir, entry);
      if (entry.startsWith("@")) {
        // Scoped packages — scan one level deeper
        if (!existsSync(entryPath)) continue;
        for (const scoped of readdirSync(entryPath)) {
          const scopedPath = join(entryPath, scoped);
          checkPackage(scopedPath, `${entry}/${scoped}`);
        }
      } else {
        checkPackage(entryPath, entry);
      }
    }
  };

  const checkPackage = (pkgPath: string, name: string) => {
    if (seen.has(name)) return;
    const pkgJsonPath = join(pkgPath, "package.json");
    if (!existsSync(pkgJsonPath)) return;
    try {
      const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
      if (pkg.voidrift?.plugin) {
        seen.add(pkg.name || name);
        const author = typeof pkg.author === "string" ? pkg.author : pkg.author?.name || "";
        discovered.push({
          id: pkg.name || name,
          version: pkg.version || "0.0.0",
          description: pkg.voidrift.description || pkg.description || "",
          author,
          license: pkg.license || "",
          homepage: pkg.homepage || pkg.repository?.url || "",
          path: pkgPath,
        });
      }
    } catch {}
  };

  // Scan node_modules
  scanDir(join(workspaceRoot, "node_modules"));

  return discovered;
}
