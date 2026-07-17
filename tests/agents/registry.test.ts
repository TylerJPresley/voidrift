import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../src/agents/registry.js";
import { FileSystemAgentRepository } from "../../src/agents/repository.js";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("AgentRegistry Source Tracking", () => {
  it("populates 'core' source for default agents", () => {
    const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
    const chat = registry.get("chat");
    expect(chat).toBeDefined();
    expect(chat?.source).toBe("core");

    const plan = registry.get("plan");
    expect(plan).toBeDefined();
    expect(plan?.source).toBe("core");
  });

  it("populates 'custom' source for discovered agents", () => {
    const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
    const tempDir = join(tmpdir(), "voidrift-agents-test-" + Date.now());
    mkdirSync(join(tempDir, ".voidrift", "agents"), { recursive: true });
    
    const manifestContent = JSON.stringify({
      id: "custom-agent",
      name: "Custom Agent",
      description: "My custom agent",
      type: "interactive",
      role: "auto",
      prompt: "Be custom",
      tools: [],
      allowedTools: [],
      approvalMode: "prompt"
    });
    
    writeFileSync(join(tempDir, ".voidrift", "agents", "custom-agent.json"), manifestContent);
    
    registry.discover(tempDir);
    const agent = registry.get("custom-agent");
    expect(agent).toBeDefined();
    expect(agent?.source).toBe("custom");
  });

  it("populates plugin name or 'plugin' fallback for registered agents", () => {
    const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
    registry.register({
      id: "plugin-agent",
      name: "Plugin Agent",
      description: "From plugin",
      type: "interactive",
      role: "auto",
      prompt: "Be plugin",
      tools: [],
      allowedTools: [],
      approvalMode: "prompt"
    }, "test-plugin");

    const agent = registry.get("plugin-agent");
    expect(agent).toBeDefined();
    expect(agent?.source).toBe("test-plugin");
  });

  it("tracks override status for overridden core agents", () => {
    const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
    const tempDir = join(tmpdir(), "voidrift-agents-override-test-" + Date.now());
    mkdirSync(join(tempDir, ".voidrift", "agents"), { recursive: true });
    
    // Override default "chat" agent
    const manifestContent = JSON.stringify({
      id: "chat",
      name: "Custom Chat",
      description: "My overridden chat",
      type: "interactive",
      role: "auto",
      prompt: "Be custom chat",
      tools: [],
      allowedTools: [],
      approvalMode: "prompt"
    });
    
    writeFileSync(join(tempDir, ".voidrift", "agents", "chat.json"), manifestContent);
    
    registry.discover(tempDir);
    const agent = registry.get("chat");
    expect(agent).toBeDefined();
    expect(agent?.name).toBe("Custom Chat");
    expect(agent?.source).toBe("core");
    expect(agent?.overrideStatus).toBe("workspace");
    expect(agent?.overridePath).toContain("chat.json");
  });

  it("can create and delete workspace overrides", () => {
    const registry = new AgentRegistry(undefined, new FileSystemAgentRepository());
    const tempDir = join(tmpdir(), "voidrift-agents-lifecycle-test-" + Date.now());
    const origHome = process.env.HOME;
    process.env.HOME = join(tmpdir(), "voidrift-fake-home-" + Date.now());
    
    // Create override
    const path = registry.createOverride("chat", "workspace", tempDir);
    expect(existsSync(path)).toBe(true);
    
    // Check that we can read it back and discover it
    registry.discover(tempDir);
    const agent = registry.get("chat");
    expect(agent?.overrideStatus).toBe("workspace");
    
    // Delete override
    const deleted = registry.deleteOverride("chat", "workspace", tempDir);
    expect(deleted).toBe(true);
    expect(existsSync(path)).toBe(false);
    
    // Run discover again and verify it reverts to default
    registry.discover(tempDir);
    const reverted = registry.get("chat");
    expect(reverted?.overrideStatus).toBe("default");

    process.env.HOME = origHome;
  });
});
