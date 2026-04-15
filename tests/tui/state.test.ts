import { describe, it, expect } from "vitest";
import { createState, addOperator, addModel, addTool, addSystem, addDiff, updateLastModel } from "../../src/tui/state.js";

describe("TUIState", () => {
  it("creates with defaults", () => {
    const s = createState("qwen35", "~/project", "main");
    expect(s.modelName).toBe("qwen35");
    expect(s.messages).toHaveLength(0);
    expect(s.mode).toBe("");
    expect(s.busy).toBe(false);
    expect(s.thinking).toBe(false);
  });

  it("addOperator appends operator message", () => {
    const s = createState("m", ".", "");
    addOperator(s, "hello");
    expect(s.messages).toHaveLength(1);
    expect(s.messages[0].role).toBe("operator");
    expect(s.messages[0].text).toBe("hello");
  });

  it("addModel appends model message", () => {
    const s = createState("m", ".", "");
    addModel(s, "response", "stats", true);
    expect(s.messages[0].role).toBe("model");
    expect(s.messages[0].streaming).toBe(true);
  });

  it("addTool appends tool message with action", () => {
    const s = createState("m", ".", "");
    addTool(s, "file", "src/main.py", "read");
    expect(s.messages[0].role).toBe("tool");
    expect(s.messages[0].toolName).toBe("file");
    expect(s.messages[0].toolAction).toBe("read");
  });

  it("addSystem appends system message", () => {
    const s = createState("m", ".", "");
    addSystem(s, "Stage 1...");
    expect(s.messages[0].role).toBe("system");
  });

  it("addDiff appends diff message", () => {
    const s = createState("m", ".", "");
    addDiff(s, "+3 -1 at L22", "+line\n-old");
    expect(s.messages[0].role).toBe("diff");
    expect(s.messages[0].toolName).toBe("+3 -1 at L22");
  });

  it("updateLastModel updates streaming model message", () => {
    const s = createState("m", ".", "");
    addModel(s, "partial", "", true);
    updateLastModel(s, "full response", "stats", false);
    expect(s.messages[0].text).toBe("full response");
    expect(s.messages[0].streaming).toBe(false);
  });

  it("updateLastModel does nothing if last is not model", () => {
    const s = createState("m", ".", "");
    addSystem(s, "sys");
    updateLastModel(s, "ignored");
    expect(s.messages[0].text).toBe("sys");
  });
});
