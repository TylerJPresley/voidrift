import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  codeChallengeMethod?: string;
}

export interface MCPServerConfig {
  name: string;
  transport?: "stdio" | "http-sse";
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  auth?: MCPAuthConfig;
}

export interface MCPServer {
  name: string;
  config: MCPServerConfig;
  client: Client | null;
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
 * Uses @modelcontextprotocol/sdk for transport and protocol handling.
 * Per-file configs: .voidrift/mcp/{name}.json and ~/.config/voidrift/mcp/{name}.json
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

  loadConfigs(): MCPServerConfig[] {
    const configs: MCPServerConfig[] = [];
    for (const dir of this.configDirs) {
      if (!existsSync(dir)) continue;
      for (const file of readdirSync(dir).filter(f => f.endsWith(".json"))) {
        try {
          const raw = JSON.parse(readFileSync(join(dir, file), "utf-8"));
          configs.push({ ...raw, name: basename(file, ".json") });
        } catch {}
      }
    }
    return configs;
  }

  saveConfig(config: MCPServerConfig): void {
    const dir = this.configDirs[0];
    mkdirSync(dir, { recursive: true });
    const { name, ...rest } = config;
    writeFileSync(join(dir, `${name}.json`), JSON.stringify(rest, null, 2), "utf-8");
  }

  removeConfig(name: string): boolean {
    for (const dir of this.configDirs) {
      const path = join(dir, `${name}.json`);
      if (existsSync(path)) { unlinkSync(path); return true; }
    }
    return false;
  }

  getConfig(name: string): MCPServerConfig | null {
    for (const dir of this.configDirs) {
      const path = join(dir, `${name}.json`);
      if (!existsSync(path)) continue;
      try { return { ...JSON.parse(readFileSync(path, "utf-8")), name }; } catch {}
    }
    return null;
  }

  async connect(config: MCPServerConfig): Promise<MCPServer> {
    const server: MCPServer = { name: config.name, config, client: null, status: "disconnected", errorLog: [], tools: [] };

    // Resolve auth token
    let token: string | undefined;
    if (config.auth?.type === "oauth2") {
      const cred = await this.resolveAuth(config);
      if (cred) { token = cred.accessToken; }
      else {
        server.status = "error";
        server.errorLog.push("No credentials found. Run OAuth flow first.");
        this.servers.set(config.name, server);
        return server;
      }
    }

    try {
      const transport = this.createTransport(config, token);
      const client = new Client({ name: "voidrift", version: "0.1.0" });
      await client.connect(transport);

      // List tools
      const toolsResult = await client.listTools();
      server.tools = (toolsResult.tools ?? []).map(t => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      }));

      server.client = client;
      server.status = "connected";
    } catch (err) {
      server.status = "error";
      server.errorLog.push(err instanceof Error ? err.message : String(err));
    }

    this.servers.set(config.name, server);
    return server;
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server?.client) return;
    try { await server.client.close(); } catch {}
    server.client = null;
    server.status = "disconnected";
  }

  async shutdownAll(): Promise<void> {
    for (const name of this.servers.keys()) await this.disconnect(name);
  }

  get connected(): MCPServer[] { return [...this.servers.values()].filter(s => s.status === "connected"); }
  get all(): MCPServer[] { return [...this.servers.values()]; }

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

  /** Call a tool on a connected MCP server */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server?.client) return `Error: Server "${serverName}" not connected.`;
    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      return content?.map(c => c.text ?? "").join("") ?? JSON.stringify(result);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  private createTransport(config: MCPServerConfig, token?: string) {
    const isHttp = config.transport === "http-sse" || config.url;

    if (isHttp) {
      const url = new URL(config.url!);
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Bearer ${token}`;
      return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    }

    // Stdio
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries({ ...process.env, ...this.resolveEnvVars(config.env ?? {}) })) {
      if (v !== undefined) env[k] = v;
    }
    if (token && config.auth?.tokenEnvVar) env[config.auth.tokenEnvVar] = token;
    return new StdioClientTransport({ command: config.command!, args: config.args ?? [], env });
  }

  private resolveEnvVars(env: Record<string, string>): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const [k, v] of Object.entries(env)) {
      resolved[k] = v.startsWith("$") ? (process.env[v.slice(1)] ?? "") : v;
    }
    return resolved;
  }

  private async resolveAuth(config: MCPServerConfig): Promise<StoredCredential | null> {
    if (!config.auth) return null;
    const cred = loadCredential(config.name);
    if (!cred) return null;
    return refreshIfNeeded(cred, config.auth);
  }
}
