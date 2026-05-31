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
    svc.register("test/unique-key", "template", "# Task {{id}}", "@voidrift/plugin-dev");
    const resolved = svc.resolve("test/unique-key");
    expect(resolved?.source).toBe("default");
    expect(resolved?.body).toContain("{{id}}");
  });

  it("workspace override takes priority over default", () => {
    const svc = new TemplateService(TMP);
    svc.register("dev/task", "template", "# Default", "core");
    mkdirSync(join(TMP, ".voidrift", "templates", "dev"), { recursive: true });
    writeFileSync(join(TMP, ".voidrift", "templates", "dev", "task.md"), "# Workspace Override");
    const resolved = svc.resolve("dev/task");
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

  it("createOverride creates the file on disk", () => {
    const svc = new TemplateService(TMP);
    svc.register("my/prompt", "prompt", "Default prompt content", "core");
    const path = svc.createOverride("my/prompt", "workspace");
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
  });

  it("lists all registered templates", () => {
    const svc = new TemplateService(TMP);
    const builtinCount = svc.all.length;
    svc.register("a", "template", "", "core");
    svc.register("b", "prompt", "", "plugin");
    expect(svc.all).toHaveLength(builtinCount + 2);
  });

  it("buildContext includes standard enrichment fields", () => {
    const svc = new TemplateService(TMP);
    const ctx = svc.buildContext("sess-1", "gpt-4o");
    expect(ctx["harness.version"]).toBe("0.1.0");
    expect(ctx["session.uuid"]).toBe("sess-1");
    expect(ctx["session.model"]).toBe("gpt-4o");
    expect(ctx["workspace.root"]).toBe(TMP);
  });
});
