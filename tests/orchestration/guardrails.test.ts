import { describe, it, expect } from "vitest";
import { checkGuardrails, createGuardrailContext } from "../../src/orchestration/guardrails.js";

describe("Guardrails", () => {
  describe("Edit without read (Golden Principle #1)", () => {
    it("blocks edit_file if file was not read this turn", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const result = checkGuardrails("edit_file", { path: "src/main.ts", search: "old", replace: "new" }, ctx);
      expect(result.block).toBe(true);
      expect(result.preWarning).toContain("Error:");
      expect(result.preWarning).toContain("read_file");
    });

    it("allows edit_file if file was read this turn", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      ctx.filesRead.add("src/main.ts");
      const result = checkGuardrails("edit_file", { path: "src/main.ts", search: "old", replace: "new" }, ctx);
      expect(result.block).toBeFalsy();
    });
  });

  describe("No /tmp writes (Golden Principle #2)", () => {
    it("blocks write_file to /tmp", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const result = checkGuardrails("write_file", { path: "/tmp/hack.sh", content: "rm -rf /" }, ctx);
      expect(result.block).toBe(true);
      expect(result.preWarning).toContain("Error:");
      expect(result.preWarning).toContain(".voidrift/cache");
    });

    it("blocks write_file to /var/tmp", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const result = checkGuardrails("write_file", { path: "/var/tmp/file.txt", content: "data" }, ctx);
      expect(result.block).toBe(true);
    });

    it("allows write_file to workspace paths", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const result = checkGuardrails("write_file", { path: "src/new-file.ts", content: "export {}" }, ctx);
      expect(result.block).toBeFalsy();
    });
  });

  describe("Large replacement (Golden Principle #3)", () => {
    it("blocks edit_file with search block over 50 lines", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      ctx.filesRead.add("src/big.ts");
      const bigSearch = Array(60).fill("const x = 1;").join("\n");
      const result = checkGuardrails("edit_file", { path: "src/big.ts", search: bigSearch, replace: "new content" }, ctx);
      expect(result.block).toBe(true);
      expect(result.preWarning).toContain("full rewrite");
    });

    it("allows edit_file with search block under 50 lines", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      ctx.filesRead.add("src/small.ts");
      const smallSearch = Array(10).fill("const x = 1;").join("\n");
      const result = checkGuardrails("edit_file", { path: "src/small.ts", search: smallSearch, replace: "new content" }, ctx);
      expect(result.block).toBeFalsy();
    });
  });

  describe("Advisory: large inline content", () => {
    it("does not warn on write_file (generator script guidance removed)", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const bigContent = Array(80).fill("line").join("\n");
      const result = checkGuardrails("write_file", { path: "src/gen.ts", content: bigContent }, ctx);
      expect(result.block).toBeFalsy();
      expect(result.preWarning).toBeUndefined();
    });
  });

  describe("Advisory: /tmp in commands", () => {
    it("warns on execute_command referencing /tmp/", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      const result = checkGuardrails("execute_command", { command: "cp output.json /tmp/results.json" }, ctx);
      expect(result.block).toBeFalsy();
      expect(result.preWarning).toContain("GUARDRAIL");
      expect(result.preWarning).toContain("/tmp");
    });
  });

  describe("Advisory: repetitive tool pattern", () => {
    it("warns after 4+ calls of the same action tool in a turn", () => {
      const ctx = createGuardrailContext("/workspace", "session-1");
      ctx.round = 6;
      ctx.callHistory = [
        { name: "write_file", args: { path: "a.ts" } },
        { name: "write_file", args: { path: "b.ts" } },
        { name: "write_file", args: { path: "c.ts" } },
        { name: "write_file", args: { path: "d.ts" } },
      ];
      const result = checkGuardrails("write_file", { path: "e.ts", content: "" }, ctx);
      expect(result.postWarning).toContain("Repetitive pattern");
    });
  });
});
