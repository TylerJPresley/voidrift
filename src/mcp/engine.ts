import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ListRootsRequestSchema, CreateMessageRequestSchema, ElicitRequestSchema } from "@modelcontextprotocol/sdk/types.js";
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

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
}

export interface MCPPrompt {
  name: string;
  description: string;
  arguments: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface MCPServer {
  name: string;
  config: MCPServerConfig;
  client: Client | null;
  status: "connected" | "disconnected" | "error";
  errorLog: string[];
  tools: MCPToolSchema[];
  resources: MCPResource[];
  prompts: MCPPrompt[];
  instructions?: string;
}

export interface MCPToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type SamplingHandler = (messages: Array<{ role: string; content: string }>, options?: { maxTokens?: number; temperature?: number }) => Promise<{ role: string; content: string }>;
export type ElicitationHandler = (message: string, schema?: Record<string, unknown>) => Promise<{ action: "accept" | "deny"; content?: Record<string, string> }>;

/**
/**
 * MCP Integration Engine (G-12).
 *
 * Uses @modelcontextprotocol/sdk for transport and protocol handling.
 * Per-file configs: .voidrift/mcp/{name}.json and ~/.config/voidrift/mcp/{name}.json
 */
export class MCPEngine {
  private servers = new Map<string, MCPServer>();
  private configDirs: string[];
  private samplingHandler?: SamplingHandler;
  private elicitationHandler?: ElicitationHandler;

  constructor(private workspaceRoot: string, private bus: EventBus) {
    this.configDirs = [
      join(workspaceRoot, ".voidrift", "mcp"),
      join(homedir(), ".config", "voidrift", "mcp"),
    ];
  }

  setSamplingHandler(handler: SamplingHandler): void { this.samplingHandler = handler; }
  setElicitationHandler(handler: ElicitationHandler): void { this.elicitationHandler = handler; }

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
    const server: MCPServer = { name: config.name, config, client: null, status: "disconnected", errorLog: [], tools: [], resources: [], prompts: [] };

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
      const serverRef = server;
      const busRef = this.bus;
      const workspaceRootRef = this.workspaceRoot;
      const samplingRef = this.samplingHandler;
      const elicitationRef = this.elicitationHandler;
      const client = new Client({ name: "voidrift", version: "0.1.0" }, {
        capabilities: {
          roots: { listChanged: true },
          ...(this.samplingHandler ? { sampling: {} } : {}),
          ...(this.elicitationHandler ? { elicitation: {} } : {}),
        },
        listChanged: {
          tools: {
            onChanged: (tools: any) => {
              serverRef.tools = (tools ?? []).map((t: any) => ({
                name: t.name,
                description: t.description ?? "",
                inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
              }));
              busRef.publish("RESOURCE_CHANGED", { path: `mcp:${config.name}`, type: "tools_updated" } as any);
            },
          },
          resources: {
            onChanged: (resources: any) => {
              serverRef.resources = (resources ?? []).map((r: any) => ({ uri: r.uri, name: r.name ?? r.uri, mimeType: r.mimeType }));
            },
          },
          prompts: {
            onChanged: (prompts: any) => {
              serverRef.prompts = (prompts ?? []).map((p: any) => ({ name: p.name, description: p.description ?? "", arguments: p.arguments ?? [] }));
            },
          },
        },
      });
      await client.connect(transport);

      // Handle server-to-client requests: roots/list
      client.setRequestHandler(ListRootsRequestSchema, async () => ({
        roots: [{ uri: `file://${workspaceRootRef}`, name: "workspace" }],
      }));

      // Handle sampling request: server asks client to call a model
      if (samplingRef) {
        client.setRequestHandler(CreateMessageRequestSchema, async (request: any) => {
          const messages = (request.params?.messages ?? []).map((m: any) => ({
            role: m.role ?? "user",
            content: typeof m.content === "string" ? m.content : m.content?.text ?? "",
          }));
          const result = await samplingRef(messages, {
            maxTokens: request.params?.maxTokens,
            temperature: request.params?.temperature,
          });
          return { model: "voidrift-proxy", role: result.role, content: { type: "text", text: result.content } };
        });
      }

      // Handle elicitation request: server asks user a question
      if (elicitationRef) {
        client.setRequestHandler(ElicitRequestSchema, async (request: any) => {
          const message = request.params?.message ?? "";
          const schema = request.params?.requestedSchema;
          const result = await elicitationRef(message, schema);
          return { action: result.action, content: result.content };
        });
      }

      // List tools
      const toolsResult = await client.listTools();
      server.tools = (toolsResult.tools ?? []).map(t => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
        annotations: (t as any).annotations as Record<string, unknown> | undefined,
      }));

      // Get server instructions (additional system prompt context)
      server.instructions = client.getInstructions() ?? undefined;

      // Discover resources if supported
      try {
        const resourcesResult = await client.listResources();
        server.resources = (resourcesResult.resources ?? []).map(r => ({
          uri: r.uri,
          name: r.name ?? r.uri,
          mimeType: r.mimeType,
        }));
      } catch { server.resources = []; }

      // Discover prompts if supported
      try {
        const promptsResult = await client.listPrompts();
        server.prompts = (promptsResult.prompts ?? []).map(p => ({
          name: p.name,
          description: p.description ?? "",
          arguments: p.arguments ?? [],
        }));
      } catch { server.prompts = []; }

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

  /** Check if an MCP tool has readOnlyHint annotation */
  isToolReadOnly(fullName: string): boolean {
    const match = fullName.match(/^mcp_([^_]+)_(.+)$/);
    if (!match) return false;
    const server = this.servers.get(match[1]);
    const tool = server?.tools.find(t => t.name === match[2]);
    return tool?.annotations?.readOnlyHint === true;
  }

  /** Call a tool on a connected MCP server */
  async callTool(serverName: string, toolName: string, args: Record<string, unknown>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server?.client) return `Error: Server "${serverName}" not connected.`;
    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      const content = result.content as Array<{ type: string; text?: string }>;
      const text = content?.map(c => c.text ?? "").join("") ?? JSON.stringify(result);
      // MCP spec: isError indicates the tool call failed
      if ((result as any).isError) return `Error: ${text}`;
      return text;
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Ping a connected server to check health */
  async ping(serverName: string): Promise<boolean> {
    const server = this.servers.get(serverName);
    if (!server?.client) return false;
    try { await server.client.ping(); return true; }
    catch { server.status = "error"; return false; }
  }

  /** Get all server instructions for injection into system prompt */
  getAllInstructions(): string[] {
    return this.connected
      .filter(s => s.instructions)
      .map(s => `[MCP:${s.name}] ${s.instructions}`);
  }

  /** Read a resource from a connected MCP server */
  async readResource(serverName: string, uri: string): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server?.client) return `Error: Server "${serverName}" not connected.`;
    try {
      const result = await server.client.readResource({ uri });
      const content = result.contents as Array<{ text?: string; uri: string }>;
      return content?.map(c => c.text ?? "").join("") ?? "";
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Get a prompt from a connected MCP server */
  async getPrompt(serverName: string, promptName: string, args?: Record<string, string>): Promise<string> {
    const server = this.servers.get(serverName);
    if (!server?.client) return `Error: Server "${serverName}" not connected.`;
    try {
      const result = await server.client.getPrompt({ name: promptName, arguments: args });
      const messages = result.messages as Array<{ role: string; content: { type: string; text?: string } }>;
      return messages?.map(m => m.content?.text ?? "").join("\n") ?? "";
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  /** Request argument completion from an MCP server */
  async complete(serverName: string, ref: { type: "ref/prompt" | "ref/resource"; name?: string; uri?: string }, argumentName: string, argumentValue: string): Promise<string[]> {
    const server = this.servers.get(serverName);
    if (!server?.client) return [];
    try {
      const result = await server.client.complete({ ref: ref as any, argument: { name: argumentName, value: argumentValue } });
      return (result.completion?.values ?? []) as string[];
    } catch { return []; }
  }

  /** Set the logging level on a connected MCP server */
  async setLoggingLevel(serverName: string, level: "debug" | "info" | "warning" | "error" | "critical"): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server?.client) return;
    try { await server.client.setLoggingLevel(level); } catch {}
  }

  /** Subscribe to updates for a specific resource */
  async subscribeResource(serverName: string, uri: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server?.client) return;
    try { await server.client.subscribeResource({ uri }); } catch {}
  }

  /** Unsubscribe from updates for a specific resource */
  async unsubscribeResource(serverName: string, uri: string): Promise<void> {
    const server = this.servers.get(serverName);
    if (!server?.client) return;
    try { await server.client.unsubscribeResource({ uri }); } catch {}
  }

  /** Notify all connected servers that the roots list has changed */
  async notifyRootsChanged(): Promise<void> {
    for (const server of this.connected) {
      try { await server.client!.sendRootsListChanged(); } catch {}
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
