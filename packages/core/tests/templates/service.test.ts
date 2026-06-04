import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TemplateService } from "../../src/templates/service.js";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const TMP = join(tmpdir(), "voidrift-templates-test-" + Date.now());

beforeEach(() => { mkdirSync(TMP, { recursive: true }); });
afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("TemplateService", () => {
  it("registers and resolves a template from default", () => {
    const svc = new TemplateService(TMP);
    svc.register("unique-key", "template", "# Task {{id}}", "plugin-dev");
    const resolved = svc.resolve("unique-key");
    expect(resolved?.source).toBe("default");
    expect(resolved?.body).toContain("{{id}}");
  });

  it("workspace override takes priority over default", () => {
    const svc = new TemplateService(TMP);
    svc.register("doc-task", "template", "# Default", "core");
    mkdirSync(join(TMP, ".voidrift", "templates", "core"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "templates", "core", "doc-task.md"), "# Workspace Override");
    const resolved = svc.resolve("doc-task");
    expect(resolved?.source).toBe("workspace");
    expect(resolved?.content).toContain("Workspace Override");
  });

  it("renders template with context variables", () => {
    const svc = new TemplateService(TMP);
    svc.register("test", "prompt", "Hello {{session.uuid}} on {{git.branch}}", "core");
    const ctx = svc.buildContext("abc123", "qwen");
    const rendered = svc.render("test", ctx);
    expect(rendered).toContain("abc123");
  });

  it("renders with extra variables", () => {
    const svc = new TemplateService(TMP);
    svc.register("greet", "prompt", "Hi {{name}}", "core");
    const ctx = svc.buildContext("s1", "m1");
    const rendered = svc.render("greet", ctx, { name: "World" });
    expect(rendered).toBe("Hi World");
  });

  it("returns null for unregistered key", () => {
    const svc = new TemplateService(TMP);
    expect(svc.resolve("nonexistent")).toBeNull();
    expect(svc.render("nonexistent", svc.buildContext("", ""))).toBeNull();
  });

  it("createOverrideForSlot creates the file on disk", () => {
    const svc = new TemplateService(TMP);
    svc.register("my-prompt", "prompt", "Default prompt content", "core");
    const slot = svc.allSlots.find(s => s.key === "my-prompt")!;
    const path = svc.createOverrideForSlot(slot, "workspace");
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
  });

  it("lists all registered slots", () => {
    const svc = new TemplateService(TMP);
    const builtinCount = svc.allSlots.length;
    svc.register("a", "template", "", "core");
    svc.register("b", "prompt", "", "plugin");
    expect(svc.allSlots.length).toBe(builtinCount + 2);
  });

  it("buildContext includes standard enrichment fields", () => {
    const svc = new TemplateService(TMP);
    const ctx = svc.buildContext("sess-1", "gpt-4o");
    expect(ctx["harness.version"]).toBe("0.1.0");
    expect(ctx["session.uuid"]).toBe("sess-1");
    expect(ctx["session.model"]).toBe("gpt-4o");
    expect(ctx["workspace.root"]).toBe(TMP);
  });

  it("plugin override replaces core base", () => {
    const svc = new TemplateService(TMP, ["plugin-dev"]);
    svc.register("test-prompt", "prompt", "Core base", "core");
    svc.registerOverride("test-prompt", "prompt", "Plugin override", "plugin-dev");
    const resolved = svc.resolve("test-prompt");
    expect(resolved?.body).toBe("Plugin override");
  });

  it("plugin extension appends to core base", () => {
    const svc = new TemplateService(TMP, ["plugin-dev"]);
    svc.register("chat", "prompt", "Core chat", "core");
    svc.registerExtension("chat", "prompt", "Plugin extension", "plugin-dev");
    const resolved = svc.resolve("chat");
    expect(resolved?.body).toContain("Core chat");
    expect(resolved?.body).toContain("Plugin extension");
  });

  it("operator override on base still gets plugin extension appended", () => {
    const svc = new TemplateService(TMP, ["plugin-dev"]);
    svc.register("chat", "prompt", "Core chat", "core");
    svc.registerExtension("chat", "prompt", "Plugin extension", "plugin-dev");
    // Operator overrides the base
    mkdirSync(join(TMP, ".voidrift", "prompts", "core"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "prompts", "core", "chat.md"), "My custom chat");
    const resolved = svc.resolve("chat");
    expect(resolved?.body).toContain("My custom chat");
    expect(resolved?.body).toContain("Plugin extension");
  });

  it("operator can override the extension slot independently", () => {
    const svc = new TemplateService(TMP, ["plugin-dev"]);
    svc.register("chat", "prompt", "Core chat", "core");
    svc.registerExtension("chat", "prompt", "Plugin extension default", "plugin-dev");
    // Operator overrides the extension
    mkdirSync(join(TMP, ".voidrift", "prompts", "plugin-dev"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "prompts", "plugin-dev", "chat.md"), "My custom extension");
    const resolved = svc.resolve("chat");
    expect(resolved?.body).toContain("Core chat");
    expect(resolved?.body).toContain("My custom extension");
    expect(resolved?.body).not.toContain("Plugin extension default");
  });

  it("slotsByType filters correctly", () => {
    const svc = new TemplateService(TMP);
    const prompts = svc.slotsByType("prompt");
    const templates = svc.slotsByType("template");
    expect(prompts.every(s => s.type === "prompt")).toBe(true);
    expect(templates.every(s => s.type === "template")).toBe(true);
    expect(prompts.length + templates.length).toBe(svc.allSlots.length);
  });

  it("discovers custom flat prompts and templates from disk", () => {
    const svc = new TemplateService(TMP);
    
    // Create a custom flat prompt and template
    mkdirSync(join(TMP, ".voidrift", "prompts"), { recursive: true });
    mkdirSync(join(TMP, ".voidrift", "templates"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "prompts", "custom-prompt.md"), "Custom Prompt Content");
    writeFileSync(join(TMP, ".voidrift", "templates", "custom-tmpl.md"), "Custom Tmpl Content");
    
    svc.discover();
    
    const pSlot = svc.slotsByType("prompt").find(s => s.key === "custom-prompt");
    expect(pSlot).toBeDefined();
    expect(pSlot?.sourcePlugin).toBe("custom");
    
    const tSlot = svc.slotsByType("template").find(s => s.key === "custom-tmpl");
    expect(tSlot).toBeDefined();
    expect(tSlot?.sourcePlugin).toBe("custom");
  });

  it("resolves flat overrides for namespaced base slots", () => {
    const svc = new TemplateService(TMP);
    svc.register("chat", "prompt", "Core Chat Content", "core");
    
    // Create flat override in .voidrift/prompts/chat.md directly
    mkdirSync(join(TMP, ".voidrift", "prompts"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "prompts", "chat.md"), "Flat Chat Override");
    
    const resolved = svc.resolve("chat");
    expect(resolved?.source).toBe("workspace");
    expect(resolved?.body).toBe("Flat Chat Override");
  });
});
