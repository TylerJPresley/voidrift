import { describe, it, expect } from "vitest";
import { BASELINE_TOOLS, compileOnDemandTOC, compileToolTOC, buildContextualQuery } from "../../src/orchestration/tool-binding.js";
import { ALL_TOOLS } from "../../src/agents/registry.js";

describe("Tool Binding", () => {
  describe("BASELINE_TOOLS", () => {
    it("includes read tools", () => {
      expect(BASELINE_TOOLS).toContain("read_file");
      expect(BASELINE_TOOLS).toContain("glob_files");
      expect(BASELINE_TOOLS).toContain("workspace_map");
      expect(BASELINE_TOOLS).toContain("search_contents");
    });

    it("includes write tools", () => {
      expect(BASELINE_TOOLS).toContain("write_file");
      expect(BASELINE_TOOLS).toContain("edit_file");
      expect(BASELINE_TOOLS).toContain("execute_command");
    });

    it("includes research tools", () => {
      expect(BASELINE_TOOLS).toContain("web_search");
      expect(BASELINE_TOOLS).toContain("web_fetch");
    });

    it("includes plan tools", () => {
      expect(BASELINE_TOOLS).toContain("read_plan");
      expect(BASELINE_TOOLS).toContain("add_plan");
    });

    it("includes self-management tools", () => {
      expect(BASELINE_TOOLS).toContain("escalate");
      expect(BASELINE_TOOLS).toContain("deescalate");
      expect(BASELINE_TOOLS).toContain("search_tools");
      expect(BASELINE_TOOLS).toContain("load_skill");
    });

    it("has exactly 15 tools", () => {
      expect(BASELINE_TOOLS).toHaveLength(15);
    });
  });

  describe("compileOnDemandTOC", () => {
    it("excludes baseline tools from the TOC", () => {
      const toc = compileOnDemandTOC(ALL_TOOLS);
      for (const tool of BASELINE_TOOLS) {
        expect(toc).not.toContain(`- ${tool}:`);
      }
    });

    it("includes non-baseline agent tools", () => {
      const toc = compileOnDemandTOC(ALL_TOOLS);
      expect(toc).toContain("save_memory");
      expect(toc).toContain("spawn_subagent");
      expect(toc).toContain("schedule");
    });

    it("returns empty string when agent only has baseline tools", () => {
      const toc = compileOnDemandTOC(BASELINE_TOOLS);
      expect(toc).toBe("");
    });

    it("includes MCP tools when servers provided", () => {
      const servers = [{ name: "db", tools: [{ name: "query", description: "Run a SQL query" }] }];
      const toc = compileOnDemandTOC(ALL_TOOLS, servers);
      expect(toc).toContain("mcp_db_query");
      expect(toc).toContain("Run a SQL query");
    });

    it("has the activation header", () => {
      const toc = compileOnDemandTOC(ALL_TOOLS);
      expect(toc).toContain("## Additional Tools (activate with search_tools)");
    });
  });

  describe("compileToolTOC", () => {
    it("produces one line per tool", () => {
      const toc = compileToolTOC(["read_file", "write_file"]);
      const lines = toc.split("\n").filter(Boolean);
      expect(lines).toHaveLength(2);
      expect(lines[0]).toMatch(/^- read_file:/);
      expect(lines[1]).toMatch(/^- write_file:/);
    });

    it("includes MCP tools", () => {
      const servers = [{ name: "gh", tools: [{ name: "create_pr", description: "Create a pull request" }] }];
      const toc = compileToolTOC(["read_file"], servers);
      expect(toc).toContain("mcp_gh_create_pr");
    });
  });

  describe("buildContextualQuery", () => {
    it("combines user input with summaries and plan", () => {
      const query = buildContextualQuery("yes", "Proposed config changes, awaiting approval", "Refactor auth module");
      expect(query).toContain("yes");
      expect(query).toContain("Proposed config changes");
      expect(query).toContain("Refactor auth module");
    });

    it("works with empty summaries (first turn)", () => {
      const query = buildContextualQuery("hello", "", null);
      expect(query).toContain("hello");
      expect(query).not.toContain("Last Assistant");
    });

    it("includes plan when present", () => {
      const query = buildContextualQuery("do it", "", "Fix the tests");
      expect(query).toContain("Fix the tests");
    });
  });
});
