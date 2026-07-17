import { describe, it, expect, vi, beforeEach } from "vitest";
import { PromptRegistry } from "../../src/prompts/registry.js";

vi.mock("fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn(() => ""),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

describe("PromptRegistry", () => {
  it("registers and resolves builtins", () => {
    const reg = new PromptRegistry("/test");
    const chat = reg.resolve("chat");
    expect(chat).not.toBeNull();
    expect(chat!.key).toBe("chat");
    expect(chat!.source).toBe("default");
    expect(chat!.body.length).toBeGreaterThan(0);
  });

  it("registers core.rules builtin", () => {
    const reg = new PromptRegistry("/test");
    const rules = reg.resolve("core.rules");
    expect(rules).not.toBeNull();
    expect(rules!.body).toContain("Role");
  });

  it("registers compact builtin", () => {
    const reg = new PromptRegistry("/test");
    const compact = reg.resolve("compact");
    expect(compact).not.toBeNull();
    expect(compact!.body).toContain("Compactor");
  });

  it("returns null for unknown keys", () => {
    const reg = new PromptRegistry("/test");
    expect(reg.resolve("nonexistent")).toBeNull();
  });

  it("lists all registered prompts", () => {
    const reg = new PromptRegistry("/test");
    const list = reg.list();
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list.some(e => e.key === "chat")).toBe(true);
    expect(list.some(e => e.key === "core.rules")).toBe(true);
    expect(list.some(e => e.key === "compact")).toBe(true);
  });

  it("register adds a custom prompt", () => {
    const reg = new PromptRegistry("/test");
    reg.register("custom", "Custom content", "my-plugin", "Custom", "A custom prompt");
    const resolved = reg.resolve("custom");
    expect(resolved).not.toBeNull();
    expect(resolved!.body).toBe("Custom content");
    expect(resolved!.sourcePlugin).toBe("my-plugin");
  });

  it("register replaces same key+plugin", () => {
    const reg = new PromptRegistry("/test");
    reg.register("test", "v1", "plugin");
    reg.register("test", "v2", "plugin");
    expect(reg.resolve("test")!.body).toBe("v2");
  });
});
