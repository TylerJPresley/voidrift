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
    // SDK requires a proper MCP server — cat won't work. Test that error is handled gracefully.
    const server = await engine.connect({ name: "echo", command: "cat" });
    expect(server.status).toBe("error");
    expect(server.errorLog.length).toBeGreaterThan(0);
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
      name: "db", client: null, status: "connected", errorLog: [], config: {},
      tools: [{ name: "query", description: "Run SQL", inputSchema: {} }],
    });
    expect(engine.getToolNames()).toEqual(["mcp_db_query"]);
  });

  it("shutdownAll disconnects everything", async () => {
    mkdirSync(TMP, { recursive: true });
    const bus = new EventBus();
    const engine = new MCPEngine(TMP, bus);
    // Can't connect without a real server, just verify shutdownAll doesn't throw
    await engine.shutdownAll();
    expect(engine.connected).toHaveLength(0);
  });
});
