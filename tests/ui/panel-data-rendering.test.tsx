/**
 * Panel Data Rendering Tests.
 *
 * Tests that panels correctly render the data they receive from CoreAPI.
 * Each test provides specific mock data and verifies the rendered output
 * matches expectations.
 *
 * Pattern: mock specific data → render → assert frame contains correct text.
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { createMockCore } from "./mock-core.js";

vi.mock("../../src/utils/safe-edit.js", () => ({
  editWithValidation: vi.fn(() => ({ success: true, changed: false })),
  validateFrontmatter: vi.fn(() => ({ valid: true })),
  validateSkillFile: vi.fn(() => ({ valid: true })),
  validateJSON: vi.fn(() => ({ valid: true })),
  validatePromptFile: vi.fn(() => ({ valid: true })),
}));

vi.mock("../../src/config/writer.js", () => ({
  safeConfigWrite: vi.fn(() => ({ success: true })),
}));

const stripAnsi = (s: string) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, "").replace(/\x1B\[[0-9;]*m/g, "");
const delay = (ms = 50) => new Promise(r => setTimeout(r, ms));

// ─── StatsPanel Data ─────────────────────────────────────────────────────────

describe("StatsPanel — data rendering", () => {
  it("renders zero-turn session correctly", async () => {
    const { StatsPanel } = await import("../../src/ui/panels/StatsPanel.js");
    const core = createMockCore({
      models: {
        ...createMockCore().models,
        stats: () => ({ sessionId: "abc123", turns: 0, duration: "0s", tools: { total: 0, success: 0, failed: 0, totalTimeMs: 0, perTool: {} }, models: [] }),
        context: () => ({ percentage: 0, used: 0, limit: 32768 }),
      },
    });
    const frame = stripAnsi(render(<StatsPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("0s");
    expect(frame).toContain("0%");
  });

  it("renders multi-model session with correct per-model stats", async () => {
    const { StatsPanel } = await import("../../src/ui/panels/StatsPanel.js");
    const core = createMockCore({
      models: {
        ...createMockCore().models,
        stats: () => ({
          sessionId: "x", turns: 10, duration: "5m 12s",
          tools: { total: 30, success: 28, failed: 2, totalTimeMs: 15000, perTool: {} },
          models: [
            { name: "claude-sonnet", turns: 7, inputTokens: 50000, outputTokens: 3000, totalTimeMs: 10000 },
            { name: "qwen-local", turns: 3, inputTokens: 5000, outputTokens: 1000, totalTimeMs: 5000 },
          ],
        }),
        context: () => ({ percentage: 62, used: 20000, limit: 32768 }),
      },
    });
    const frame = stripAnsi(render(<StatsPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("5m 12s");
    expect(frame).toContain("30");
    expect(frame).toContain("28");
    expect(frame).toContain("claude-sonnet");
    expect(frame).toContain("qwen-local");
    expect(frame).toContain("62%");
  });
});

// ─── PlanPanel Data ──────────────────────────────────────────────────────────

describe("PlanPanel — data rendering", () => {
  it("renders multiple now items", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore({
      plan: {
        list: () => ({ items: [
          { filename: "auth.md", description: "Implement JWT auth", priority: "now", rationale: "", body: "" },
          { filename: "tests.md", description: "Write integration tests", priority: "now", rationale: "", body: "" },
          { filename: "deploy.md", description: "Set up CI/CD", priority: "next", rationale: "", body: "" },
        ] }),
        get: vi.fn(), remove: vi.fn(), updatePriority: vi.fn(), dir: () => "/test",
      },
    });
    const frame = stripAnsi(render(<PlanPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("Implement JWT auth");
    expect(frame).toContain("Write integration tests");
    expect(frame).not.toContain("Set up CI/CD"); // next priority, not on now page
  });

  it("detail view renders plan body content", async () => {
    const { PlanPanel } = await import("../../src/ui/panels/PlanPanel.js");
    const core = createMockCore({
      plan: {
        list: () => ({ items: [{ filename: "big-plan.md", description: "Refactor auth", priority: "now", rationale: "Security audit", body: "" }] }),
        get: (f: string) => ({ item: { filename: f, description: "Refactor auth", rationale: "Security audit", priority: "now", body: "## Tasks\n- [ ] Extract middleware\n- [ ] Add RS256\n- [ ] Update tests" } }),
        remove: vi.fn(), updatePriority: vi.fn(), dir: () => "/test",
      },
    });
    const { lastFrame, stdin } = render(<PlanPanel core={core as any} onClose={() => {}} />);
    stdin.write("\r"); await delay();
    const frame = stripAnsi(lastFrame()!);
    expect(frame).toContain("big-plan.md");
    expect(frame).toContain("Security audit");
    expect(frame).toContain("Extract middleware");
    expect(frame).toContain("Add RS256");
  });
});

// ─── ModelPanel Data ─────────────────────────────────────────────────────────

describe("ModelPanel — data rendering", () => {
  it("renders multiple models with tier assignments", async () => {
    const { ModelPanel } = await import("../../src/ui/panels/ModelPanel.js");
    const core = createMockCore({
      models: {
        ...createMockCore().models,
        list: () => ({
          models: [
            { name: "claude-sonnet", protocol: "anthropic", model: "claude-sonnet-4", contextLimit: 200000, tiers: ["flash"] },
            { name: "qwen-local", protocol: "openai", model: "qwen2.5:7b", contextLimit: 32768, tiers: ["utility"] },
            { name: "claude-opus", protocol: "anthropic", model: "claude-opus-4", contextLimit: 200000, tiers: ["dense"] },
          ],
          modelSelected: "auto",
        }),
      },
      workspace: { ...createMockCore().workspace, config: () => ({ ...createMockCore().workspace.config(), tiers: { flash: "claude-sonnet", utility: "qwen-local", dense: "claude-opus" }, models: { "claude-sonnet": { protocol: "anthropic", model: "claude-sonnet-4", baseUrl: "https://api.anthropic.com", contextLimit: 200000 }, "qwen-local": { protocol: "openai", model: "qwen2.5:7b", baseUrl: "http://localhost:11434/v1", contextLimit: 32768 }, "claude-opus": { protocol: "anthropic", model: "claude-opus-4", baseUrl: "https://api.anthropic.com", contextLimit: 200000 } } }) },
    });
    const frame = stripAnsi(render(<ModelPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("claude-sonnet");
    expect(frame).toContain("qwen-local");
    expect(frame).toContain("claude-opus");
    expect(frame).toContain("auto");
  });
});

// ─── MemoryPanel Data ────────────────────────────────────────────────────────

describe("MemoryPanel — data rendering", () => {
  it("renders loaded vs unloaded memories distinctly", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const core = createMockCore({
      memory: {
        list: () => ({ memories: [
          { id: "m1", title: "Always use TypeScript strict", summary: "", keywords: [], scope: "global", loaded: true },
          { id: "m2", title: "API uses snake_case", summary: "", keywords: [], scope: "local", loaded: false },
          { id: "m3", title: "Deploy requires VPN", summary: "", keywords: [], scope: "local", loaded: true },
        ] }),
        load: vi.fn(), unload: vi.fn(),
      },
    });
    const frame = stripAnsi(render(<MemoryPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("Always use TypeScript strict");
    expect(frame).toContain("API uses snake_case");
    expect(frame).toContain("Deploy requires VPN");
    // Loaded ones should have ● indicator
    const lines = frame.split("\n");
    const loadedLine = lines.find(l => l.includes("Always use TypeScript strict"));
    const unloadedLine = lines.find(l => l.includes("API uses snake_case"));
    expect(loadedLine).toContain("●");
    expect(unloadedLine).not.toContain("●");
  });

  it("renders empty memory list", async () => {
    const { MemoryPanel } = await import("../../src/ui/panels/MemoryPanel.js");
    const core = createMockCore({
      memory: { list: () => ({ memories: [] }), load: vi.fn(), unload: vi.fn() },
    });
    const frame = stripAnsi(render(<MemoryPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("No items");
  });
});

// ─── ToolsPanel Data ─────────────────────────────────────────────────────────

describe("ToolsPanel — data rendering", () => {
  it("renders tool names and approval modes", async () => {
    const { ToolsPanel } = await import("../../src/ui/panels/ToolsPanel.js");
    const core = createMockCore({
      tools: { list: () => ({
        core: [
          { name: "read_file", description: "Read file content", approval: "auto", parameters: [] },
          { name: "execute_command", description: "Run shell command", approval: "gated", parameters: [] },
          { name: "web_fetch", description: "Fetch URL", approval: "gated", parameters: [] },
        ],
        mcp: [],
      }) },
      agents: { ...createMockCore().agents, list: () => ({ agents: [{ id: "chat", name: "Chat", active: true }] }) },
    });
    const frame = stripAnsi(render(<ToolsPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("read_file");
    expect(frame).toContain("execute_command");
    expect(frame).toContain("web_fetch");
    expect(frame).toContain("auto");
    expect(frame).toContain("gated");
  });

  it("MCP tools data available on mcp page", async () => {
    const core = createMockCore({
      tools: { list: () => ({
        core: [{ name: "read_file", description: "Read", approval: "auto", parameters: [] }],
        mcp: [
          { name: "search_repos", server: "github", fullName: "mcp_github_search_repos", description: "Search GitHub repos", inputSchema: "{}" },
          { name: "create_issue", server: "github", fullName: "mcp_github_create_issue", description: "Create issue", inputSchema: "{}" },
        ],
      }) },
      agents: { ...createMockCore().agents, list: () => ({ agents: [{ id: "chat", name: "Chat", active: true }] }) },
    });
    const data = core.tools.list();
    expect(data.mcp.length).toBe(2);
    expect(data.mcp[0].name).toBe("search_repos");
    expect(data.mcp[0].server).toBe("github");
    expect(data.mcp[1].name).toBe("create_issue");
  });
});

// ─── PolicyPanel Data ────────────────────────────────────────────────────────

describe("PolicyPanel — data rendering", () => {
  it("renders rules with tool, pattern, decision, source", async () => {
    const { PolicyPanel } = await import("../../src/ui/panels/PolicyPanel.js");
    const core = createMockCore({
      policy: { list: () => [
        { tool: "execute_command", pattern: "bun run test", decision: "allow", source: "workspace", label: "" },
        { tool: "write_file", pattern: "src/**", decision: "allow", source: "session", label: "" },
        { tool: "execute_command", pattern: "rm *", decision: "deny", source: "default", label: "Dangerous" },
      ] },
    });
    const frame = stripAnsi(render(<PolicyPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("execute_command");
    expect(frame).toContain("bun run test");
    expect(frame).toContain("allow");
    expect(frame).toContain("write_file");
    expect(frame).toContain("src/**");
    expect(frame).toContain("deny");
    expect(frame).toContain("rm *");
    expect(frame).toContain("workspace");
    expect(frame).toContain("session");
  });

  it("renders empty rules list", async () => {
    const { PolicyPanel } = await import("../../src/ui/panels/PolicyPanel.js");
    const core = createMockCore({ policy: { list: () => [] } });
    const frame = stripAnsi(render(<PolicyPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("Policy Rules");
    // Should not crash on empty
  });
});

// ─── HelpPanel Data ──────────────────────────────────────────────────────────

describe("HelpPanel — data rendering", () => {
  it("renders session id and workspace on general page", async () => {
    const { HelpPanel } = await import("../../src/ui/panels/HelpPanel.js");
    const core = createMockCore();
    const frame = stripAnsi(render(<HelpPanel core={core as any} sessionId="abc-123" workspace="~/my-project" onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("abc-123");
    expect(frame).toContain("~/my-project");
  });

  it("renders all registered commands on commands page", async () => {
    const { HelpPanel } = await import("../../src/ui/panels/HelpPanel.js");
    const core = createMockCore({
      session: {
        ...createMockCore().session,
        listCommands: () => [
          { name: "help", description: "Help", source: "core" },
          { name: "plan", description: "Plans", source: "core" },
          { name: "deploy", description: "Deploy to prod", source: "my-plugin" },
        ],
      },
    });
    const { lastFrame, stdin } = render(<HelpPanel core={core as any} sessionId="x" workspace="~" onClose={() => {}} />);
    stdin.write("\x1B[C"); await delay();
    const frame = stripAnsi(lastFrame()!);
    expect(frame).toContain("/help");
    expect(frame).toContain("/plan");
    expect(frame).toContain("/deploy");
    expect(frame).toContain("my-plugin");
  });
});

// ─── AgentsPanel Data ────────────────────────────────────────────────────────

describe("AgentsPanel — data rendering", () => {
  it("core interactive page shows core interactive agents only", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore({
      agents: {
        ...createMockCore().agents,
        list: () => ({ agents: [
          { id: "chat", name: "Chat", description: "General", type: "interactive", active: true, source: "core" },
          { id: "plan", name: "Plan", description: "Planning", type: "interactive", active: true, source: "core" },
          { id: "indexer", name: "Indexer", description: "Index", type: "task", active: true, source: "core" },
          { id: "custom-bot", name: "Custom Bot", description: "My bot", type: "interactive", active: true, source: "custom" },
        ] }),
      },
    });
    const frame = stripAnsi(render(<AgentsPanel core={core as any} onClose={() => {}} />).lastFrame()!);
    expect(frame).toContain("Chat");
    expect(frame).toContain("Plan");
    expect(frame).not.toContain("Indexer"); // task, not interactive
    expect(frame).not.toContain("Custom Bot"); // custom, not core
  });

  it("custom task page shows only custom task agents", async () => {
    const { AgentsPanel } = await import("../../src/ui/panels/AgentsPanel.js");
    const core = createMockCore({
      agents: {
        ...createMockCore().agents,
        list: () => ({ agents: [
          { id: "chat", name: "Chat", type: "interactive", active: true, source: "core" },
          { id: "my-task", name: "My Task", description: "Custom task", type: "task", active: false, source: "custom" },
        ] }),
      },
    });
    const { lastFrame, stdin } = render(<AgentsPanel core={core as any} onClose={() => {}} />);
    // Navigate to custom task (page 3)
    stdin.write("\x1B[C"); await delay();
    stdin.write("\x1B[C"); await delay();
    stdin.write("\x1B[C"); await delay();
    const frame = stripAnsi(lastFrame()!);
    expect(frame).toContain("My Task");
    expect(frame).not.toContain("Chat");
  });
});
