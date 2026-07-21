import { describe, it, expect, vi, afterEach } from "vitest";
import { registerCommands, type CommandDeps } from "../../src/commands/index.js";
import { CoreRegistry } from "../../src/registry/core.js";
import { ContextManager } from "../../src/session/context.js";
import { TokenBudgetWatcher } from "../../src/output/budget.js";
import { AgentRegistry } from "../../src/agents/registry.js";
import { InMemoryAgentRepository } from "../../src/agents/repository.js";
import { SessionBrain } from "../../src/session/brain.js";
import { InMemorySessionRepository } from "../../src/session/session-repository.js";
import { MemoryRegistry } from "../../src/session/memory.js";
import { InMemoryMemoryRepository } from "../../src/session/memory-repository.js";
import { StatsTracker } from "../../src/session/stats.js";
import { SkillManager } from "../../src/skills/manager.js";
import { TemplateService } from "../../src/templates/service.js";
import { MCPEngine } from "../../src/mcp/engine.js";
import { WorktreeEngine } from "../../src/worktree/engine.js";
import { GitCheckpointer } from "../../src/safeguards/checkpoint.js";
import { EventBus } from "../../src/events/bus.js";
import { TaskScheduler } from "../../src/orchestration/scheduler.js";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

const TMP = join(tmpdir(), "voidrift-cmd-test-" + Date.now());

function makeDeps(): { registry: CoreRegistry; deps: CommandDeps; output: string[]; panels: string[] } {
  const outputLines: string[] = [];
  const panels: string[] = [];
  const bus = new EventBus();
  mkdirSync(TMP, { recursive: true });
  execSync("git init && git config user.email t@t.com && git config user.name T && touch f && git add . && git commit -m init", { cwd: TMP, stdio: "ignore" });

  const deps: CommandDeps = {
    config: { modelSelected: "local", modelUtility: "local", modelEscalation: "local", models: { local: { protocol: "openai", model: "test", baseUrl: "http://localhost", contextLimit: 32768, temperature: 0.2 } }, tasksMaxRunTurns: 50, retentionMaxCacheAgeDays: 14, retentionMaxSessionCount: 20, retentionMaxLogAgeDays: 14 } as any,
    context: new ContextManager("persona", ""),
    budget: new TokenBudgetWatcher(32768),
    agents: new AgentRegistry(undefined, new InMemoryAgentRepository()),
    brain: new SessionBrain(TMP, "test", bus, new InMemorySessionRepository()),
    memory: new MemoryRegistry(new InMemoryMemoryRepository()),
    stats: new StatsTracker("test"),
    skills: new SkillManager(),
    templates: new TemplateService(TMP),
    mcp: new MCPEngine(TMP, bus),
    worktree: new WorktreeEngine(TMP, bus),
    checkpointer: new GitCheckpointer(TMP, bus),
    scheduler: new TaskScheduler(bus, () => {}),
    bus,
    workspaceRoot: TMP,
    sessionId: "test-session",
    output: (text) => outputLines.push(text),
    openPanel: (panel) => panels.push(panel),
    switchModel: (name) => name === "local",
    exit: vi.fn(),
  };

  const registry = new CoreRegistry();
  registerCommands(registry, deps);
  return { registry, deps, output: outputLines, panels };
}

afterEach(() => { rmSync(TMP, { recursive: true, force: true }); });

describe("Slash Commands (all 27)", () => {
  it("registers all 27 commands", () => {
    const { registry } = makeDeps();
    const cmds = registry.listSlashCommands();
    expect(cmds.length).toBe(27);
    expect(cmds).toContain("help");
    expect(cmds).toContain("exit");
    expect(cmds).toContain("model");
    expect(cmds).toContain("stats");
    expect(cmds).toContain("templates");
    expect(cmds).toContain("plugins");
    expect(cmds).toContain("mcp");
    expect(cmds).toContain("run");
    expect(cmds).toContain("schedule");
    expect(cmds).toContain("rewind");
    expect(cmds).toContain("resume");
    expect(cmds).toContain("policy");
    expect(cmds).toContain("history");
  });

  it("/help opens help panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("help")!.execute([]);
    expect(panels).toContain("help");
  });

  it("/stats opens stats panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("stats")!.execute([]);
    expect(panels).toContain("stats");
  });

  it("/tools opens tools panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("tools")!.execute([]);
    expect(panels).toContain("tools");
  });

  it("/model with no args opens model panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("model")!.execute([]);
    expect(panels).toContain("model");
  });

  it("/model with valid name switches model", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("model")!.execute(["local"]);
    expect(output[0]).toContain("Switched to");
  });

  it("/model with invalid name reports error", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("model")!.execute(["nonexistent"]);
    expect(output[0]).toContain("not found");
  });

  it("/clear resets session", async () => {
    const { registry, deps, output } = makeDeps();
    deps.context.addMessage({ role: "user", content: "hi" });
    deps.budget.add(500);
    await registry.getSlashCommand("clear")!.execute([]);
    expect(deps.context.getMessages()).toHaveLength(0);
    expect(deps.budget.state.used).toBe(500); // budget is not conversation state
  });

  it("/compact compacts when over threshold", async () => {
    const { registry, deps, output } = makeDeps();
    for (let i = 0; i < 20; i++) deps.context.addMessage({ role: "user", content: `msg ${i}` });
    deps.budget.set(25000);
    await registry.getSlashCommand("compact")!.execute([]);
    expect(output[0]).toContain("Compacted");
  });

  it("/exit saves and calls exit", async () => {
    const { registry, deps, output } = makeDeps();
    await registry.getSlashCommand("exit")!.execute([]);
    expect(output[0]).toContain("Goodbye");
    expect(deps.exit).toHaveBeenCalled();
  });

  it("/memory opens memory panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("memory")!.execute([]);
    expect(panels).toContain("memory");
  });

  it("/skills opens skills panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("skills")!.execute([]);
    expect(panels).toContain("skills");
  });

  it("/agents opens agents panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("agents")!.execute([]);
    expect(panels).toContain("agents");
  });

  it("/mcp opens mcp panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("mcp")!.execute([]);
    expect(panels).toContain("mcp");
  });

  it("/templates opens templates panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("templates")!.execute([]);
    expect(panels).toContain("templates");
  });

  it("/context opens context panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("context")!.execute([]);
    expect(panels).toContain("context");
  });

  it("/tasks opens background task monitor", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("tasks")!.execute([]);
    expect(panels).toContain("tasks");
  });

  it("/resume opens resume panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("resume")!.execute([]);
    expect(panels).toContain("resume");
  });

  it("/rewind with turn number rewinds history", async () => {
    const { registry, deps, output } = makeDeps();
    for (let i = 0; i < 10; i++) deps.context.addMessage({ role: "user", content: `turn ${i}` });
    await registry.getSlashCommand("rewind")!.execute(["3"]);
    expect(output[0]).toContain("Rewound to turn 3");
    expect(deps.context.getMessages()).toHaveLength(6);
  });

  it("/rewind without args opens panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("rewind")!.execute([]);
    expect(panels).toContain("rewind");
  });

  it("/diff opens diff panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("diff")!.execute([]);
    expect(panels).toContain("diff");
  });

  it("/run requires instruction", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("run")!.execute([]);
    expect(output[0]).toContain("Usage");
  });

  it("/run with instruction starts execution", async () => {
    const { registry, output, panels } = makeDeps();
    // Mock the ralphLoop import to return immediately
    vi.doMock("../../src/orchestration/run.js", () => ({
      ralphLoop: async () => ({ success: true, turns: 1, terminationReason: "complete" }),
    }));
    await registry.getSlashCommand("run")!.execute(["build", "auth", "system"]);
    expect(output[0]).toContain("Running");
    vi.doUnmock("../../src/orchestration/run.js");
  });

  it("/schedule requires args", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("schedule")!.execute([]);
    expect(output[0]).toContain("Usage");
  });

  it("/schedule --delay registers a delayed task", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("schedule")!.execute(["--delay", "10s", "check build status"]);
    expect(output[0]).toContain("Scheduled one-shot task");
  });

  it("/schedule with cron pattern registers a recurring task", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("schedule")!.execute(["*/10 * * * *", "run clean-up script"]);
    expect(output[0]).toContain("Scheduled recurring cron task");
  });
});

describe("Slash Commands — detailed flows", () => {
  it("/plan opens plan panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("plan")!.execute([]);
    expect(panels).toContain("plan");
  });

  it("/routines opens routines panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("routines")!.execute([]);
    expect(panels).toContain("routines");
  });

  it("/plugins opens plugins panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("plugins")!.execute([]);
    expect(panels).toContain("plugins");
  });

  it("/policy with no args opens policy panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("policy")!.execute([]);
    expect(panels).toContain("policy");
  });

  it("/policy add shows usage when missing args", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("policy")!.execute(["add"]);
    expect(output[0]).toContain("Usage");
  });

  it("/history opens history panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("history")!.execute([]);
    expect(panels).toContain("history");
  });

  it("/prompts opens prompts panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("prompts")!.execute([]);
    expect(panels).toContain("prompts");
  });

  it("/config with no args opens config panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("config")!.execute([]);
    expect(panels).toContain("config");
  });

  it("/run routine with missing name shows usage", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("run")!.execute(["routine"]);
    expect(output[0]).toContain("Usage");
  });

  it("/run routine with non-existent name reports not found", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("run")!.execute(["routine", "nonexistent"]);
    expect(output[0]).toContain("not found");
  });

  it("/run plan with missing name shows usage", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("run")!.execute(["plan"]);
    expect(output[0]).toContain("Usage");
  });

  it("/run plan with non-existent name reports not found", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("run")!.execute(["plan", "nonexistent"]);
    expect(output[0]).toContain("not found");
  });

  it("/compact with nothing to compact says so", async () => {
    const { registry, output } = makeDeps();
    await registry.getSlashCommand("compact")!.execute([]);
    expect(output[0]).toContain("Nothing to compact");
  });

  it("/skills with no args opens skills panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("skills")!.execute([]);
    expect(panels).toContain("skills");
  });

  it("/agents with no args opens agents panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("agents")!.execute([]);
    expect(panels).toContain("agents");
  });

  it("/templates with no args opens templates panel", async () => {
    const { registry, panels } = makeDeps();
    await registry.getSlashCommand("templates")!.execute([]);
    expect(panels).toContain("templates");
  });
});
