import { spawn, type ChildProcess } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { EventBus } from "../events/bus.js";

export interface MCPServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPServer {
  name: string;
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
 * Spawns and manages stdio-based MCP server child processes.
 * Implements stderr crash monitoring, graceful shutdown, and
 * dynamic tool schema translation.
 */
export class MCPEngine {
  private servers = new Map<string, MCPServer>();

  constructor(private workspaceRoot: string, private bus: EventBus) {}

  /**
   * Loads MCP server configs from workspace and global mcp.json files.
   */
  loadConfigs(): MCPServerConfig[] {
    const configs: MCPServerConfig[] = [];
    const paths = [
      join(this.workspaceRoot, ".voidrift", "mcp.json"),
      join(homedir(), ".config", "voidrift", "mcp.json"),
    ];
    for (const p of paths) {
      if (!existsSync(p)) continue;
      try {
        const raw = JSON.parse(readFileSync(p, "utf-8"));
        if (Array.isArray(raw.servers)) configs.push(...raw.servers);
      } catch {}
    }
    return configs;
  }

  /**
   * Connects to an MCP server by spawning its process.
   */
  async connect(config: MCPServerConfig): Promise<MCPServer> {
    const server: MCPServer = {
      name: config.name,
      process: null,
      status: "disconnected",
      errorLog: [],
      tools: [],
    };

    try {
      const proc = spawn(config.command, config.args ?? [], {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...config.env },
      });

      // Catch spawn errors (e.g. ENOENT)
      await new Promise<void>((resolve, reject) => {
        proc.on("error", (err) => reject(err));
        proc.on("spawn", () => resolve());
        // Fallback timeout
        setTimeout(() => resolve(), 500);
      });

      server.process = proc;
      server.status = "connected";

      // Stderr crash monitoring
      proc.stderr?.on("data", (data: Buffer) => {
        const msg = data.toString();
        server.errorLog.push(msg);
        if (server.errorLog.length > 50) server.errorLog.shift();
        if (msg.includes("Error") || msg.includes("error")) {
          server.status = "error";
          this.bus.publish("ERROR_OCCURRED", { message: `MCP ${config.name}: ${msg.trim()}`, source: "mcp" });
        }
      });

      proc.on("exit", (code) => {
        server.status = "disconnected";
        server.process = null;
      });

      // Query tools/list
      server.tools = await this.queryTools(proc);
    } catch (err) {
      server.status = "error";
      server.errorLog.push(err instanceof Error ? err.message : String(err));
    }

    this.servers.set(config.name, server);
    return server;
  }

  /**
   * Disconnects an MCP server gracefully.
   */
  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server?.process) return;

    // Send shutdown notification
    try {
      server.process.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "shutdown", id: 1 }) + "\n");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          server.process?.kill("SIGKILL");
          resolve();
        }, 1500);
        server.process?.on("exit", () => { clearTimeout(timer); resolve(); });
      });
    } catch {
      server.process?.kill("SIGKILL");
    }

    server.status = "disconnected";
    server.process = null;
  }

  /**
   * Disconnects all servers.
   */
  async shutdownAll(): Promise<void> {
    for (const name of this.servers.keys()) {
      await this.disconnect(name);
    }
  }

  get connected(): MCPServer[] {
    return [...this.servers.values()].filter((s) => s.status === "connected");
  }

  get all(): MCPServer[] {
    return [...this.servers.values()];
  }

  /**
   * Returns namespaced tool names for all connected MCP servers.
   */
  getToolNames(): string[] {
    const names: string[] = [];
    for (const server of this.connected) {
      for (const tool of server.tools) {
        names.push(`mcp_${server.name}_${tool.name}`);
      }
    }
    return names;
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
