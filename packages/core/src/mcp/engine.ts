import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { EventBus } from "../events/bus.js";
import { loadCredential, refreshIfNeeded, type StoredCredential } from "./credentials.js";

export interface MCPAuthConfig {
  type: "oauth2";
  authorizeUrl: string;
  tokenUrl: string;
  clientId?: string;
  clientIdEnv?: string;
  clientSecret?: string;
  clientSecretEnv?: string;
  scopes?: string[];
  tokenEnvVar: string;
}

export interface MCPServerConfig {
  name: string;
  transport?: "stdio" | "http-sse";
  url?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: MCPAuthConfig;
}

export interface MCPServer {
  name: string;
  config: MCPServerConfig;
  process: ChildProcess | null;
  status: "connected" | "disconnected" | "error";
  errorLog: string[];
  tools: MCPToolSchema[];
}

export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * MCP Integration Engine (G-12).
 *
 * Per-file configs: .voidrift/mcp/{name}.json (workspace) and ~/.config/voidrift/mcp/{name}.json (global).
 * Key = filename without extension.
 * Supports OAuth2 authentication with credential store.
 */
export class MCPEngine {
  private servers = new Map<string, MCPServer>();
  private configDirs: string[];

  constructor(private workspaceRoot: string, private bus: EventBus) {
    this.configDirs = [
      join(workspaceRoot, ".voidrift", "mcp"),
      join(homedir(), ".config", "voidrift", "mcp"),
    ];
  }

  /** Load all configs from per-file directories. Key = filename without .json */
  loadConfigs(): MCPServerConfig[] {
    const configs: MCPServerConfig[] = [];
    for (const dir of this.configDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
        try {
          const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
          const name = basename(file, ".json");
          configs.push({ ...raw, name });
        } catch {}
      }
    }
    return configs;
  }

  /** Save a server config to workspace .voidrift/mcp/{name}.json */
  saveConfig(config: MCPServerConfig): void {
    const dir = this.configDirs[0];
    mkdirSync(dir, { recursive: true });
    const { name, ...rest } = config;
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rest, null, 2), "utf-8");
  }

  /** Remove a server config file */
  removeConfig(name: string): boolean {
    for (const dir of this.configDirs) {
      const path = join(dir, `${name}.json`);
      if (existsSync(path)) { unlinkSync(path); return true; }
    }
    return false;
  }

  /** Get config for a specific server */
  getConfig(name: string): MCPServerConfig | null {
    for (const dir of this.configDirs) {
      const path = join(dir, `${name}.json`);
      if (!existsSync(path)) continue;
      try {
        const raw = JSON.parse(readFileSync(path, "utf-8"));
        return { ...raw, name };
      } catch {}
    }
    return null;
  }

  /** Connect to an MCP server. Handles OAuth token injection if configured. */
  async connect(config: MCPServerConfig): Promise<MCPServer> {
    const server: MCPServer = { name: config.name, config, process: null, status: "disconnected", errorLog: [], tools: [] };

    // Resolve auth token
    let token: string | undefined;
    if (config.auth?.type === "oauth2") {
      const cred = await this.resolveAuth(config);
      if (cred) {
        token = cred.accessToken;
      } else {
        server.status = "error";
        server.errorLog.push("OAuth: No credentials found. Run auth flow first.");
        this.servers.set(config.name, server);
        return server;
      }
    }

    const transport = config.transport ?? (config.url ? "http-sse" : "stdio");

    if (transport === "http-sse") {
      return this.connectHttp(server, config, token);
    }
    return this.connectStdio(server, config, token);
  }

  private async connectHttp(server: MCPServer, config: MCPServerConfig, token?: string): Promise<MCPServer> {
    const url = config.url!;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    try {
      // Initialize
      const initRes = await fetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "voidrift", version: "0.1.0" } } }),
      });
      if (!initRes.ok) {
        const body = await initRes.text().catch(() => "");
        server.status = "error";
        server.errorLog.push(`HTTP ${initRes.status}: ${body.slice(0, 200)}`);
        this.servers.set(config.name, server);
        return server;
      }

      // Query tools
      const toolsRes = await fetch(url, {
        method: "POST", headers,
        body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2, params: {} }),
      });
      if (toolsRes.ok) {
        const toolsData = await toolsRes.json() as any;
        server.tools = toolsData.result?.tools ?? [];
      }

      server.status = "connected";
      // Store headers for later tool calls
      (server as any)._httpHeaders = headers;
      (server as any)._httpUrl = url;
    } catch (err) {
      server.status = "error";
      server.errorLog.push(err instanceof Error ? err.message : String(err));
    }

    this.servers.set(config.name, server);
    return server;
  }

  private async connectStdio(server: MCPServer, config: MCPServerConfig, token?: string): Promise<MCPServer> {
    const env = { ...process.env, ...this.resolveEnvVars(config.env ?? {}) };
    if (token && config.auth?.tokenEnvVar) env[config.auth.tokenEnvVar] = token;

    try {
      const proc = spawn(config.command, config.args ?? [], { stdio: ["pipe", "pipe", "pipe"], env });
      await new Promise<void>((resolve, reject) => {
        proc.on("error", reject);
        proc.on("spawn", () => resolve());
        setTimeout(() => resolve(), 500);
      });

      server.process = proc;
      server.status = "connected";

      proc.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString();
        server.errorLog.push(msg);
        if (server.errorLog.length > 50) server.errorLog.shift();
        if (msg.toLowerCase().includes("error")) {
          server.status = "error";
          this.bus.publish("ERROR_OCCURRED", { message: `MCP ${config.name}: ${msg.trim()}`, source: "mcp" });
        }
      });

      proc.on("exit", () => { server.status = "disconnected"; server.process = null; });
      server.tools = await this.queryTools(proc);
    } catch (err) {
      server.status = "error";
      server.errorLog.push(err instanceof Error ? err.message : String(err));
    }

    this.servers.set(config.name, server);
    return server;
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server?.process) return;
    try {
      server.process.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown", id: 1 }) + "\n");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { server.process?.kill("SIGKILL"); resolve(); }, 1500);
        server.process?.on("exit", () => { clearTimeout(timer); resolve(); });
      });
    } catch { server.process?.kill("SIGKILL"); }
    server.status = "disconnected";
    server.process = null;
  }

  async shutdownAll(): Promise<void> {
    for (const name of this.servers.keys()) await this.disconnect(name);
  }

  get connected(): MCPServer[] { return [...this.servers.values()].filter(s => s.status === "connected"); }
  get all(): MCPServer[] { return [...this.servers.values()]; }

  /** Returns all known server names (from configs + connected) */
  get allNames(): string[] {
    const names = new Set([...this.servers.keys()]);
    for (const c of this.loadConfigs()) names.add(c.name);
    return [...names];
  }

  getToolNames(): string[] {
    const names: string[] = [];
    for (const server of this.connected) {
      for (const tool of server.tools) names.push(`mcp_${server.name}_${tool.name}`);
    }
    return names;
  }

  /** Resolve env var references ($VAR_NAME → process.env.VAR_NAME) */
  private resolveEnvVars(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      resolved[k] = v.startsWith("$") ? (process.env[v.slice(1)] ?? "") : v;
    }
    return resolved;
  }

  /** Resolve OAuth credentials — load from store and refresh if needed */
  private async resolveAuth(config: MCPServerConfig): Promise<StoredCredential | null> {
    if (!config.auth) return null;
    const cred = loadCredential(config.name);
    if (!cred) return null;
    return refreshIfNeeded(cred, config.auth);
  }

  private async queryTools(proc: ChildProcess): Promise<MCPToolSchema[]> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve([]), 3000);
      const request = JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: 2 }) + "\n";
      let buffer = "";
      const handler = (data: Buffer) => {
        buffer += data.toString();
        try {
          const response = JSON.parse(buffer);
          clearTimeout(timeout);
          proc.stdout?.off("data", handler);
          resolve(response.result?.tools ?? []);
        } catch {}
      };
      proc.stdout?.on("data", handler);
      proc.stdin?.write(request);
    });
  }
}
