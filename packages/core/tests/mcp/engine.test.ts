import { describe, it, expect, afterEach } from "vitest";
import { MCPEngine } from "../../src/mcp/engine.js";
import { EventBus } from "../../src/events/bus.js";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-mcp-test-" + Date.now());

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("MCPEngine", () => {
  it("starts with no connected servers", () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    expect(engine.connected).toHaveLength(0);
    expect(engine.all).toHaveLength(0);
  });

  it("loads configs from per-file directory", () => {
    mkdirSync(join(TMP, ".voidrift", "mcp"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "mcp", "test-db.json"), JSON.stringify({
      command: "echo", args: ["hello"],
    }));
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    const configs = engine.loadConfigs();
    expect(configs).toHaveLength(1);
    expect(configs[0].name).toBe("test-db");
  });

  it("returns empty configs when no mcp.json exists", () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    expect(engine.loadConfigs()).toHaveLength(0);
  });

  it("connects to a simple echo server", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    // Use 'cat' as a simple stdio process that stays alive briefly
    const server = await engine.connect({ name: "echo", command: "cat" });
    expect(server.status).toBe("connected");
    expect(server.name).toBe("echo");
    await engine.disconnect("echo");
    expect(engine.all[0].status).toBe("disconnected");
  });

  it("handles connection failure gracefully", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    const server = await engine.connect({ name: "bad", command: "/nonexistent/binary" });
    expect(server.status).toBe("error");
  });

  it("getToolNames returns namespaced tools", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    // Manually inject a server with tools for testing
    (engine as any).servers.set("db", {
      name: "db", process: null, status: "connected", errorLog: [],
      tools: [{ name: "query", description: "Run SQL", inputSchema: {} }],
    });
    expect(engine.getToolNames()).toEqual(["mcp_db_query"]);
  });

  it("shutdownAll disconnects everything", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    await engine.connect({ name: "cat1", command: "cat" });
    await engine.shutdownAll();
    expect(engine.connected).toHaveLength(0);
  });
});
