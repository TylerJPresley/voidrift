/**
 * Coverage gap tests — hit the 0% modules that are pure logic.
 */
import { describe, it, expect, vi } from "vitest";

describe("orchestration/trace-analyzer", () => {
  it("creates and attaches analyzer", async () => {
    const { TraceAnalyzer } = await import("../src/orchestration/trace-analyzer.js");
    const bus = { subscribe: vi.fn(() => () => {}), publish: vi.fn() };
    const analyzer = new TraceAnalyzer(bus as any);
    const detach = analyzer.attach();
    expect(bus.subscribe).toHaveBeenCalledTimes(3);
    expect(typeof detach).toBe("function");
    detach();
  });

  it("tracks patterns and suggests after threshold", async () => {
    const { TraceAnalyzer } = await import("../src/orchestration/trace-analyzer.js");
    const handlers: Array<(e: any) => void> = [];
    const bus = {
      subscribe: vi.fn((event: string, handler: any) => { handlers.push(handler); return () => {}; }),
      publish: vi.fn(),
    };
    const analyzer = new TraceAnalyzer(bus as any);
    analyzer.attach();

    // Find the AFTER_TOOL_EXECUTE handler (first one subscribed)
    const toolHandler = handlers[0];
    // Fire 3 identical errors to trigger suggestion
    for (let i = 0; i < 3; i++) {
      toolHandler({ payload: { toolName: "edit_file", arguments: {}, status: "error", output: "Error: Search block not found" } });
    }
    expect(bus.publish).toHaveBeenCalledWith("WARNING_EMITTED", expect.objectContaining({ source: "trace-analyzer" }));
  });
});

describe("orchestration/tool-binding categories", () => {
  it("exports BASELINE_TOOLS", async () => {
    const { BASELINE_TOOLS } = await import("../src/orchestration/tool-binding.js");
    expect(BASELINE_TOOLS).toContain("read_file");
    expect(BASELINE_TOOLS).toContain("write_file");
    expect(BASELINE_TOOLS).toContain("execute_command");
  });

  it("findCategoryForTool returns correct category", async () => {
    const { findCategoryForTool } = await import("../src/orchestration/tool-binding.js");
    expect(findCategoryForTool("spawn_subagent")).toBe("orchestration");
    expect(findCategoryForTool("save_memory")).toBe("memory");
    expect(findCategoryForTool("write_file")).toBe("write");
    expect(findCategoryForTool("nonexistent")).toBeNull();
  });

  it("expandWithCategory adds all tools from category", async () => {
    const { expandWithCategory, TOOL_CATEGORIES } = await import("../src/orchestration/tool-binding.js");
    const agentTools = ["read_file", "write_file", "edit_file", "execute_command", "save_memory", "delete_memory"];
    const expanded = expandWithCategory(["read_file"], "memory", agentTools);
    expect(expanded).toContain("save_memory");
    expect(expanded).toContain("delete_memory");
    expect(expanded).toContain("read_file"); // original preserved
  });

  it("compileToolTOC includes core and MCP tools", async () => {
    const { compileToolTOC } = await import("../src/orchestration/tool-binding.js");
    const toc = compileToolTOC(["read_file", "write_file"], [{ name: "github", tools: [{ name: "search", description: "Search repos" }] }]);
    expect(toc).toContain("read_file");
    expect(toc).toContain("write_file");
    expect(toc).toContain("mcp_github_search");
  });

  it("buildContextualQuery combines inputs", async () => {
    const { buildContextualQuery } = await import("../src/orchestration/tool-binding.js");
    const query = buildContextualQuery("fix the bug", "last turn summary", "active plan text");
    expect(query).toContain("fix the bug");
    expect(query).toContain("last turn summary");
    expect(query).toContain("active plan text");
  });

  it("isSimpleConversational detects greetings", async () => {
    const { isSimpleConversational } = await import("../src/orchestration/tool-binding.js");
    expect(isSimpleConversational("hi")).toBe(true);
    expect(isSimpleConversational("hello")).toBe(true);
    expect(isSimpleConversational("thanks")).toBe(true);
    expect(isSimpleConversational("refactor the auth module to use JWT")).toBe(false);
  });
});

describe("plugins/registry", () => {
  it("registers and lists plugins", async () => {
    const { PluginRegistry } = await import("../src/plugins/registry.js");
    const reg = new PluginRegistry();
    reg.register({ id: "test-plugin", name: "Test", version: "1.0.0", description: "A test", author: "", license: "MIT", homepage: "", active: true, commands: [], agents: [], modes: [], templates: [], prompts: [], skills: [] });
    expect(reg.list()).toHaveLength(1);
    expect(reg.get("test-plugin")!.name).toBe("Test");
  });

  it("sets active state", async () => {
    const { PluginRegistry } = await import("../src/plugins/registry.js");
    const reg = new PluginRegistry();
    reg.register({ id: "p", name: "P", version: "1.0", description: "", author: "", license: "", homepage: "", active: true, commands: [], agents: [], modes: [], templates: [], prompts: [], skills: [] });
    reg.setActive("p", false);
    expect(reg.get("p")!.active).toBe(false);
  });
});

describe("bootstrap/retention", () => {
  it("runRetention returns result with zero config", async () => {
    const { runRetention } = await import("../src/bootstrap/retention.js");
    const result = runRetention("/nonexistent/path", { maxCacheAgeDays: 0, maxSessionCount: 0, maxLogAgeDays: 0, turnsDecayAfterCount: 0 });
    expect(result.prunedCache).toBe(0);
    expect(result.prunedSessions).toBe(0);
    expect(result.prunedLogs).toBe(0);
  });
});

describe("session/stats", () => {
  it("tracks turns and tool calls", async () => {
    const { StatsTracker } = await import("../src/session/stats.js");
    const stats = new StatsTracker("test-session");
    stats.recordTurn("claude", 1000, 200, 0, 5000);
    stats.recordTurn("claude", 800, 150, 0, 3000);
    stats.recordToolCall(true, 100, "read_file");
    stats.recordToolCall(false, 50, "edit_file");
    stats.recordToolCall(true, 200, "read_file");

    expect(stats.current.turns).toBe(2);
    expect(stats.current.tools.total).toBe(3);
    expect(stats.current.tools.success).toBe(2);
    expect(stats.current.tools.failed).toBe(1);
    expect(stats.current.tools.perTool.get("read_file")).toBe(2);
    expect(stats.current.tools.perTool.get("edit_file")).toBe(1);
    expect(stats.current.modelUsage.get("claude")!.turns).toBe(2);
    expect(stats.current.modelUsage.get("claude")!.inputTokens).toBe(1800);
  });
});

describe("mcp/router", () => {
  it("isMCPTool detects mcp_ prefix", async () => {
    const { isMCPTool } = await import("../src/mcp/router.js");
    expect(isMCPTool("mcp_github_search")).toBe(true);
    expect(isMCPTool("read_file")).toBe(false);
  });
});

describe("session/providers", () => {
  it("registers and retrieves context providers", async () => {
    const { registerContextProvider, getProviders, clearProviders } = await import("../src/session/providers.js");
    clearProviders();
    registerContextProvider("agent", "test-key", () => "test content");
    const providers = getProviders("agent");
    expect(providers).toHaveLength(1);
    expect(providers[0].key).toBe("test-key");
    expect(providers[0].provider()).toBe("test content");
    clearProviders();
  });

  it("replaces provider with same key", async () => {
    const { registerContextProvider, getProviders, clearProviders } = await import("../src/session/providers.js");
    clearProviders();
    registerContextProvider("orbit", "x", () => "v1");
    registerContextProvider("orbit", "x", () => "v2");
    const providers = getProviders("orbit");
    expect(providers).toHaveLength(1);
    expect(providers[0].provider()).toBe("v2");
    clearProviders();
  });
});

describe("ui/tool-descriptions", () => {
  it("describes read_file with path", async () => {
    const { describeToolCall } = await import("../src/ui/tool-descriptions.js");
    const desc = describeToolCall("read_file", JSON.stringify({ path: "src/main.ts" }));
    expect(desc.label).toBe("Read");
    expect(desc.description).toContain("src/main.ts");
    expect(desc.color).toBe("green");
  });

  it("describes execute_command", async () => {
    const { describeToolCall } = await import("../src/ui/tool-descriptions.js");
    const desc = describeToolCall("execute_command", JSON.stringify({ command: "bun run test" }));
    expect(desc.label).toBe("Run");
    expect(desc.description).toContain("bun run test");
  });

  it("describes MCP tools", async () => {
    const { describeToolCall } = await import("../src/ui/tool-descriptions.js");
    const desc = describeToolCall("mcp_github_search", JSON.stringify({ query: "voidrift" }));
    expect(desc.label).toContain("MCP");
    expect(desc.label).toContain("github");
    expect(desc.color).toBe("magenta");
  });
});
