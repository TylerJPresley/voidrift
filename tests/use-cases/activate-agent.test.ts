import { describe, it, expect, vi } from "vitest";
import { activateAgent } from "../../src/use-cases/activate-agent.js";

describe("activateAgent", () => {
  const makeContext = () => ({
    persona: "",
    tools: [] as string[],
    boundSkills: [] as string[],
    setPersona(p: string) { this.persona = p; },
    setTools(t: string[]) { this.tools = t; },
    setBoundSkills(s: string[]) { this.boundSkills = s; },
    focusFile: vi.fn(),
  });

  const makeAgents = (agents: any[]) => ({
    setActive: vi.fn((id: string) => agents.find(a => a.id === id)),
  });

  const makePrompts = (body: string) => ({
    resolve: vi.fn(() => ({ body })),
  });

  const makeSkills = (entries: any[]) => ({
    indexedSkills: entries,
  });

  it("sets persona from agent prompt + base prompt", () => {
    const ctx = makeContext();
    const agent = { id: "chat", prompt: "You are Chat.", tools: ["read_file"], skills: [] };
    activateAgent("chat", {
      agents: makeAgents([agent]) as any,
      prompts: makePrompts("Base rules.") as any,
      context: ctx as any,
      skills: makeSkills([]) as any,
      config: { summarizeThreshold: 500 } as any,
      workspaceRoot: "/test",
    });
    expect(ctx.persona).toContain("You are Chat.");
    expect(ctx.persona).toContain("Base rules.");
  });

  it("sets tools from agent manifest", () => {
    const ctx = makeContext();
    const agent = { id: "chat", prompt: "", tools: ["read_file", "write_file", "execute_command"], skills: [] };
    activateAgent("chat", {
      agents: makeAgents([agent]) as any,
      prompts: makePrompts("") as any,
      context: ctx as any,
      skills: makeSkills([]) as any,
      config: {} as any,
      workspaceRoot: "/test",
    });
    expect(ctx.tools).toEqual(["read_file", "write_file", "execute_command"]);
  });

  it("loads bound skills from manifest", () => {
    const ctx = makeContext();
    const agent = { id: "chat", prompt: "", tools: [], skills: ["planning", "memory"] };
    const skills = [
      { name: "planning", content: "# Planning\nHow to plan." },
      { name: "memory", content: "# Memory\nHow to remember." },
      { name: "other", content: "not loaded" },
    ];
    activateAgent("chat", {
      agents: makeAgents([agent]) as any,
      prompts: makePrompts("") as any,
      context: ctx as any,
      skills: makeSkills(skills) as any,
      config: {} as any,
      workspaceRoot: "/test",
    });
    expect(ctx.boundSkills).toHaveLength(2);
    expect(ctx.boundSkills[0]).toContain("Planning");
    expect(ctx.boundSkills[1]).toContain("Memory");
  });

  it("loads resources via resourceLoader", () => {
    const ctx = makeContext();
    const agent = { id: "chat", prompt: "", tools: [], skills: [], resources: ["file://docs/README.md"] };
    const loader = {
      exists: vi.fn(() => true),
      read: vi.fn(() => "# README\nProject docs."),
      resolve: vi.fn((root: string, rel: string) => `${root}/${rel}`),
    };
    activateAgent("chat", {
      agents: makeAgents([agent]) as any,
      prompts: makePrompts("") as any,
      context: ctx as any,
      skills: makeSkills([]) as any,
      config: { summarizeThreshold: 500 } as any,
      workspaceRoot: "/test",
      resourceLoader: loader,
    });
    expect(loader.exists).toHaveBeenCalled();
    expect(loader.read).toHaveBeenCalled();
    expect(ctx.focusFile).toHaveBeenCalledWith("docs/README.md", "# README\nProject docs.", 2);
  });

  it("skips resources when no resourceLoader", () => {
    const ctx = makeContext();
    const agent = { id: "chat", prompt: "", tools: [], skills: [], resources: ["file://docs/README.md"] };
    activateAgent("chat", {
      agents: makeAgents([agent]) as any,
      prompts: makePrompts("") as any,
      context: ctx as any,
      skills: makeSkills([]) as any,
      config: {} as any,
      workspaceRoot: "/test",
    });
    expect(ctx.focusFile).not.toHaveBeenCalled();
  });
});
