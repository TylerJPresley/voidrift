/**
 * Mock CoreAPI for panel rendering tests.
 * Provides minimal implementations that return test data.
 */
import { vi } from "vitest";

export function createMockCore(overrides: Record<string, any> = {}) {
  return {
    workspace: {
      root: () => "/test/workspace",
      config: () => ({
        editor: "nvim",
        modelSelected: "local", modelUtility: "local", modelEscalation: "local",
        models: { local: { protocol: "openai", model: "test", baseUrl: "http://localhost:11434/v1", contextLimit: 32768 } },
        retentionMaxCacheAgeDays: 14, retentionMaxSessionCount: 20, retentionMaxLogAgeDays: 14,
        plugins: [],
        mcp: {},
        search: { provider: "duckduckgo" },
      }),
      branch: () => "main",
      shortPath: () => "~/test/workspace",
      tasks: () => [],
      runningCount: () => 0,
      locks: () => [],
      configPaths: () => ({ global: "/home/test/.config/voidrift/config.json", workspace: "/test/workspace/.voidrift/config.json" }),
      listFiles: () => [],
      ...overrides.workspace,
    },
    session: {
      id: "test-session",
      warnings: [],
      listCommands: () => [
        { name: "help", description: "Interactive help", source: "core" },
        { name: "clear", description: "Clear session", source: "core" },
        { name: "plan", description: "Plan manager", source: "core" },
      ],
      messages: () => [],
      ...overrides.session,
    },
    models: {
      list: () => ({
        models: [{ name: "local", protocol: "openai", model: "test", contextLimit: 32768, tiers: ["selected", "utility", "escalation"] }],
        modelSelected: "local",
      }),
      stats: () => ({
        sessionId: "test-session",
        turns: 5,
        duration: "2m 30s",
        tools: { total: 12, success: 10, failed: 2, totalTimeMs: 5000, perTool: { read_file: 5, edit_file: 3, execute_command: 4 } },
        models: [{ name: "local", turns: 5, inputTokens: 1000, outputTokens: 500, totalTimeMs: 5000 }],
      }),
      context: () => ({ percentage: 25, used: 8000, limit: 32768, layers: { agent: 2000, orbit: 1000, drift: 3000, void: 2000 } }),
      contextPct: () => 25,
      contextDetail: () => ({
        limit: 32768,
        agent: { persona: "Test", personaTokens: 100, tools: ["read_file"], toolsTokens: 200, boundSkills: 0, boundSkillsTokens: 0, skillIndex: 2, skillIndexTokens: 50, memoryIndex: 1, memoryIndexTokens: 20 },
        orbit: { activeSkills: 0, activeSkillsTokens: 0, activeMemory: 0, memoryTokens: 0, plan: null, planTokens: 0 },
        drift: { focusedFiles: [], filesTokens: 0, codeMapTokens: 500, gitStatus: null, gitTokens: 0 },
        void: { messageCount: 0, messagesTokens: 0, toolResultTokens: 0, diagnostics: null, diagnosticsTokens: 0 },
      }),
      switch: () => {},
      ...overrides.models,
    },
    agents: {
      list: () => ({
        agents: [
          { id: "chat", name: "Chat", description: "General assistant", type: "interactive", role: "auto", tools: [], approvalMode: "prompt", active: true, source: "core", configOverride: "default", promptOverride: "default" },
          { id: "plan", name: "Plan", description: "Planning mode", type: "interactive", role: "auto", tools: [], approvalMode: "deny", active: true, source: "core", configOverride: "default", promptOverride: "default" },
        ],
      }),
      get: (id: string) => ({ agent: { id, name: id, description: "", type: "interactive", role: "auto", tools: [], approvalMode: "prompt", active: true, source: "core", prompt: "" } }),
      activate: (id: string) => ({ id, name: id, welcomeMessage: `Switched to ${id}` }),
      cycle: () => ({ agent: { id: "plan", name: "Plan" } }),
      create: vi.fn(() => "/tmp/test/agent.json"),
      deactivate: vi.fn(),
      deleteOverride: vi.fn(),
      reindex: vi.fn(),
      getOverrideCascade: vi.fn(() => []),
      scaffoldOverride: vi.fn(() => "/tmp/test/override"),
      deleteFile: vi.fn(() => true),
      resetOverride: vi.fn(),
      renameAgent: vi.fn(() => ({ success: true })),
      getLocation: vi.fn(() => "workspace"),
      ...overrides.agents,
    },
    plan: {
      list: () => ({
        items: [
          { filename: "task-1.md", description: "Implement feature X", rationale: "User requested", priority: "now", body: "## Tasks\n- [ ] Step 1\n- [ ] Step 2" },
          { filename: "task-2.md", description: "Fix bug Y", rationale: "", priority: "next", body: "" },
        ],
      }),
      get: (filename: string) => ({
        item: { filename, description: "Test item", rationale: "Test", priority: "now", body: "## Tasks\n- [ ] Do thing" },
      }),
      add: () => ({ item: { filename: "new.md", description: "New", priority: "now", body: "" } }),
      updatePriority: () => {},
      remove: () => {},
      dir: () => "/test/workspace/.voidrift/plan",
      ...overrides.plan,
    },
    memory: {
      list: () => ({
        memories: [
          { id: "mem-1", title: "Use snake_case", summary: "API uses snake_case", keywords: ["api", "naming"], scope: "local", loaded: true },
          { id: "mem-2", title: "Test with mocks", summary: "Always mock DB", keywords: ["test"], scope: "global", loaded: false },
        ],
      }),
      load: () => {},
      unload: () => {},
      ...overrides.memory,
    },
    skills: {
      list: () => ({
        skills: [
          { name: "planning", description: "Plan management", filePath: "(builtin)", location: "workspace", active: true, triggers: { extensions: [], files: [], keywords: ["plan"] }, agents: [] },
        ],
      }),
      reindex: () => ({ skills: [] }),
      ...overrides.skills,
    },
    tools: {
      list: () => ({
        core: [
          { name: "read_file", description: "Read a file", approval: "auto", parameters: [] },
          { name: "write_file", description: "Write a file", approval: "gated", parameters: [] },
        ],
        mcp: [],
      }),
      ...overrides.tools,
    },
    mcp: {
      list: () => ({ servers: [] }),
      listConfigs: () => [],
      connect: async () => {},
      disconnect: () => {},
      saveConfig: () => {},
      removeConfig: () => {},
      ...overrides.mcp,
    },
    templates: {
      list: () => ({ templates: [] }),
      slots: () => [],
      resolve: () => null,
      createSlotOverride: () => null,
      ...overrides.templates,
    },
    prompts: {
      list: () => ({ prompts: [] }),
      get: () => ({ key: "chat", content: "test", source: "default" }),
      createOverride: () => null,
      ...overrides.prompts,
    },
    plugins: {
      list: () => [],
      getScope: () => "available" as const,
      enable: () => {},
      disable: () => {},
      ...overrides.plugins,
    },
    routines: {
      list: () => [],
      get: () => ({ filename: "test.md", description: "Test routine", body: "## Steps\n- [ ] Step 1" }),
      add: vi.fn(() => "test.md"),
      remove: vi.fn(() => true),
      dir: () => "/test/workspace/.voidrift/routines",
      ...overrides.routines,
    },
    policy: {
      list: () => [],
      ...overrides.policy,
    },
    audit: {
      list: () => [],
      ...overrides.audit,
    },
    events: {
      subscribe: () => () => {},
      emit: () => {},
      register: () => {},
      ...overrides.events,
    },
    editor: {
      open: () => ({ success: true }),
      editValidated: () => ({ success: true, changed: true }),
      viewReadonly: () => ({ success: true }),
      hasEditor: () => true,
      ...overrides.editor,
    },
  };
}
