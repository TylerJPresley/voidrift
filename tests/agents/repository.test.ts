import { describe, it, expect } from "vitest";
import { AgentRegistry } from "../../src/agents/registry.js";
import { InMemoryAgentRepository } from "../../src/agents/repository.js";

describe("AgentRegistry (in-memory)", () => {
  function create() {
    const repo = new InMemoryAgentRepository();
    return new AgentRegistry(undefined, repo);
  }

  it("starts with core agents", () => {
    const reg = create();
    expect(reg.listInteractive().length).toBeGreaterThanOrEqual(3); // chat, plan, vibe
    expect(reg.listPassive().length).toBeGreaterThanOrEqual(2); // indexer, summarizer
  });

  it("chat is the default active agent", () => {
    const reg = create();
    expect(reg.active.id).toBe("chat");
  });

  it("setActive switches agent", () => {
    const reg = create();
    reg.setActive("plan");
    expect(reg.active.id).toBe("plan");
  });

  it("setActive throws for invalid id", () => {
    const reg = create();
    expect(() => reg.setActive("nonexistent")).toThrow();
  });

  it("cycle rotates through active interactive agents", () => {
    const reg = create();
    const first = reg.active.id;
    reg.cycle();
    const second = reg.active.id;
    expect(second).not.toBe(first);
    // Cycle back around
    const interactive = reg.listActiveInteractive();
    for (let i = 0; i < interactive.length - 1; i++) reg.cycle();
    expect(reg.active.id).toBe(first);
  });

  it("get returns agent by id", () => {
    const reg = create();
    const chat = reg.get("chat");
    expect(chat).toBeDefined();
    expect(chat!.name).toBe("Chat");
    expect(chat!.type).toBe("interactive");
  });

  it("get returns undefined for missing agent", () => {
    const reg = create();
    expect(reg.get("phantom")).toBeUndefined();
  });

  it("register adds a plugin agent", () => {
    const reg = create();
    reg.register({
      id: "custom-agent",
      name: "Custom",
      description: "A test agent",
      type: "interactive",
      role: "",
      prompt: "You are custom.",
      tools: ["read_file"],
      approvalMode: "prompt",
      allowedTools: ["read_file"],
    }, "my-plugin");
    expect(reg.get("custom-agent")).toBeDefined();
    expect(reg.get("custom-agent")!.source).toBe("my-plugin");
  });

  it("discover loads agents from repository", () => {
    const repo = new InMemoryAgentRepository();
    repo.add({
      id: "discovered",
      name: "Discovered",
      description: "From disk",
      type: "passive",
      role: "utility",
      prompt: "Do tasks.",
      tools: ["read_file", "write_file"],
      approvalMode: "autonomous",
      allowedTools: ["read_file", "write_file"],
      source: "custom",
      overrideStatus: "workspace",
      overridePath: "/fake/path/agent.json",
    }, "/fake/path/agent.json");

    const reg = new AgentRegistry(undefined, repo);
    reg.discover("/fake/workspace");
    expect(reg.get("discovered")).toBeDefined();
    expect(reg.get("discovered")!.name).toBe("Discovered");
  });

  it("discover preserves core source on override", () => {
    const repo = new InMemoryAgentRepository();
    repo.add({
      id: "chat",
      name: "Custom Chat",
      description: "Overridden",
      type: "interactive",
      role: "auto",
      prompt: "Custom prompt.",
      tools: ["read_file"],
      approvalMode: "prompt",
      allowedTools: ["read_file"],
      source: "custom",
      overrideStatus: "workspace",
      overridePath: "/fake/chat/agent.json",
    }, "/fake/chat/agent.json");

    const reg = new AgentRegistry(undefined, repo);
    reg.discover("/fake/workspace");
    const chat = reg.get("chat");
    expect(chat!.name).toBe("Custom Chat");
    expect(chat!.source).toBe("core"); // preserved!
  });

  it("listActiveInteractive excludes inactive agents", () => {
    const repo = new InMemoryAgentRepository();
    repo.add({
      id: "inactive-agent",
      name: "Inactive",
      description: "Off",
      type: "interactive",
      role: "auto",
      prompt: "",
      tools: [],
      approvalMode: "prompt",
      allowedTools: [],
      active: false,
      source: "custom",
      overrideStatus: "workspace",
      overridePath: "/fake",
    }, "/fake");

    const reg = new AgentRegistry(undefined, repo);
    reg.discover("/fake");
    const active = reg.listActiveInteractive();
    expect(active.every(a => a.id !== "inactive-agent")).toBe(true);
  });
});
